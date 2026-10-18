# Lot-size Match accuracy — audit, fix and deployment

## Root cause
`homes.lot_size` is free text. RentCast reports lot size in square feet and
`formatLotSize` (`src/lib/rentcast.js`) stores a lot under one acre as
`'8850 sq ft'` (one acre or more as `'1.25 acres'`). Both Match scorers read it
by stripping every non-digit:

| Scorer | Before |
| --- | --- |
| JS `computeMatch` (`src/lib/matching.js`) | `parseNum(home.lotSize)` → `8850` |
| SQL `resolve_cobuyer_compare_perspectives` (co-buyer Match in Compare) | `regexp_replace(lot_size, '[^0-9.]', '', 'g')::numeric` → `8850` |

and compared that number with the buyer's target, which is in acres. An
8,850 sq ft (0.203 acre) lot therefore met a 0.5 acre Must-Have as if it were
8,850 acres. The two scorers agreed with each other, so the parity tests did
not catch it.

Side defects of the same reading:
- `'1/4 acre'` read as 14 acres; `'0,25 acres'` as 25 acres.
- Text with no digits (`'irregular'`) read as 0 in JS (a Must-Have miss) but
  NULL in SQL (Unknown) — a parity gap.
- A leftover like `'0.25 ac.'` → `'0.25.'` failed the SQL numeric cast and
  errored the whole co-buyer Compare projection for that search.

## Stored shapes (where each comes from)
| Shape | Source |
| --- | --- |
| `'8850 sq ft'` (no commas, under 1 acre) | RentCast import |
| `'1.25 acres'` (2 decimals, ≥ 1 acre) | RentCast import |
| `'0.25 acres'` / `'1 acre'` | Home Facts edit (`normalizeLotSizeInput`) |
| `'8,850 sq ft'`, `'0.25 acres'` | pasted listing text (`parseListingText`) |
| anything typed, incl. bare numbers | Add Home form (`HomeModal`, stored as typed), Realtor suggestions |
| `''` | unknown |

## The fix (no table, column or row changes)
`src/lib/lotSize.js` `lotSizeAcres(raw)` is the one reading, used by
`computeMatch` and by Home Facts' `normalizeLotSizeInput`:
- a number (thousands commas allowed) plus `acres`/`ac`, `sq ft` (÷ 43,560),
  `sq m`, `hectares`; a **bare number is acres** (unchanged; the field is
  labeled in acres);
- anything else — a fraction, a decimal comma, other words, zero — is
  **Unknown** (never a miss, never in the percentage).

`supabase/migrations/2026-10-18-lot-size-units-match-parity.sql` replaces only
the `lotSizeTarget` expression in the SQL scorer with the same grammar. Same
signature, `SECURITY DEFINER`, empty `search_path`, access check, projection
and grants; `create or replace`, re-runnable.

Unchanged: Must-Have 4× / Important 2× / Nice to Have 1×, partial credit
(`actual / target`), Unknown neutral, every other criterion. There is no
maximum-lot criterion; only a minimum exists.

## Product decisions (approved)
1. **Bare numbers are acres** when interpreting input to a field labeled in
   acres, without silently reinterpreting ambiguous saved data.
2. **Zero or unparseable measurements are Unknown**, never a confirmed
   Must-Have miss.

### Bare numbers: the discrepancy and the fix
Before, a saved bare number was read three ways:

| Surface | Read `'0.5'` as | Read `'8712'` as |
| --- | --- | --- |
| Match (both scorers) | 0.5 acres | 8,712 acres |
| Home Facts input (`normalizeLotSizeInput`) | 0.5 acres | 8,712 acres |
| Display (`formatLotSizeDisplay`: Compare, My Homes, Home Facts, cards) | **"0 sq ft"** | **"0.20 acres"** |

So a buyer who typed `0.5` in Add Home saw "0 sq ft" while Match scored
0.5 acres, and focusing that Home Facts field started the edit from
"0 sq ft".

Bare values can only come from the Add Home / Edit home / Realtor-suggestion
form (`HomeModal`): imports and listing text always carry a unit, and Home
Facts saves `'0.5 acres'`. The smallest consistent fix:
- **One reading everywhere.** `formatLotSizeDisplay` now uses `lotSizeAcres`,
  so every display shows what Match scores. A bare number shows as acres;
  anything Match treats as Unknown (`'1/4 acre'`, `'0'`, words) is shown
  exactly as saved instead of being guessed at (`'1/4 acre'` used to show as
  "4.00 acres").
- **No new bare values.** HomeModal's field is labeled "Lot size (acres)",
  and a bare number a person types there is saved with its unit
  (`'0.25'` → `'0.25 acres'`, `withAcresUnit`).
- **Saved data is never rewritten.** An unchanged lot size is passed through
  as saved (HomeModal compares with the opened value; Home Facts saves only a
  field the person edited). No backfill.

The only visible change for ambiguous saved data: a bare number that was
really square feet (e.g. `'8712'`) is now shown as "8712.00 acres", which is
how Match has always scored it. Before, the display hid the error behind a
plausible "0.20 acres". The preflight's `review` row counts bare numbers
over 50 acres. If it is not zero, those homes need a reviewed correction
(a separate, approved data step); this PR does not guess.

## Preflight and impact (read-only)
Run `supabase/lot-size-match-preflight.sql` in the production SQL Editor. One
SELECT; counts only — no ids, addresses, lot sizes or preferences. For extra
safety, run it as `begin read only;` … `rollback;`. Proceed only
if every `required` row has `ok = true`. The `info` rows report: homes by
stored shape; how many readings change; homes that currently error Compare;
lot-size targets by level; home × participant (owner and co-buyer)
evaluations that change, by shape and old → new state; Must-Have status
changes; and the lot criterion's score change. Transitions are reported for
both readings that existed before: Compare (old SQL: digit-less text was
Unknown, a leftover like `'0.25.'` errored) and each person's own Match (old
JS: digit-less text was a 0-score miss). It also counts saved lot-size
*targets* the scorer cannot parse (e.g. `'0.5.'`): those error Compare before
and after this change and are not touched by it.

Robustness: every cast is guarded by the regular expression it follows, so
no saved value can make the preflight itself fail (tested with every stored
shape, malformed targets, and both owner and co-buyer documents).

## Migration review
- The function body differs from `2026-10-15-cobuyer-compare-mudroom-parity.sql`
  **only** in the `lotSizeTarget` expression. `test/match-scorer-parity.test.js`
  pins this.
- Verified on Postgres 16 before and after applying: SECURITY DEFINER, empty
  `search_path`, STABLE, owner, signature, return type, ACL, and execute
  rights (`anon` no, `authenticated` yes, `service_role` no) are identical.
  The access check (`can_access_search`) and participant selection are
  untouched.
- The new expression reads only `v_home.lot_size`, a row the function already
  loaded. It calls only `pg_catalog` built-ins (`regexp_match`, `btrim`,
  `replace`, `coalesce`, `nullif`), which resolve with the empty
  `search_path`. It adds no table access and no output; only the sanitized
  score changes. A home's Match changes by
`weight × Δscore / (sum of evaluated weights)`; for the RentCast sq ft shape
the change is always downward.

## Order
1. Run the preflight; stop on any `required` failure and review the `review` row.
2. Apply the migration (SQL Editor, one transaction). Re-run the preflight:
   the body row reads `ALREADY APPLIED`.
3. Merge the PR (Vercel deploys the JS change). Between 2 and 3 a co-buyer's
   lot size is corrected in the other person's Compare view but not yet in
   their own Match; keep the window to minutes.

## Rollback
Re-apply `supabase/migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql`
(restores the previous body) and revert the PR. No data to restore.

## Tests
- `test/lot-size-match-db.test.js`: every shape; minimum targets at and around
  the boundary; weights; Unknown; only lot size changes; displays; Match sort;
  real-Postgres co-buyer parity for every shape and level; the production path
  (preflight → migrate → re-run) with snapshots proving no row changes; the
  former cast error.
- `test/match-scorer-parity.test.js`: both scorers read lot size with its unit.
