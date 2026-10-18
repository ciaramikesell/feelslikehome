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
(`actual / target`), Unknown neutral, every other criterion, all displays
(`formatLotSizeDisplay` already converted sq ft for Compare / My Homes / Home
Facts). There is no maximum-lot criterion; only a minimum exists.

## Deliberately not changed (needs a product decision)
- **Bare numbers.** Match and Home Facts read `'8850'` as acres;
  `formatLotSizeDisplay` shows a bare number as square feet. The preflight
  counts bare numbers ≤ 50 / > 50 so the call can be made from real data.
- **Zero.** Now Unknown (it was a 0-score miss): `'0'` / `'0 sq ft'` is not a
  measured lot, and Home Facts never stores it. Easy to revert if a 0 should
  stay a confirmed miss.

## Preflight and impact (read-only)
Run `supabase/lot-size-match-preflight.sql` in the production SQL Editor. One
SELECT; counts only — no ids, addresses, lot sizes or preferences. Proceed only
if every `required` row has `ok = true`. The `info` rows report: homes by
stored shape; how many readings change; homes that currently error Compare;
lot-size targets by level; home × participant (owner and co-buyer)
evaluations that change, by shape and old → new state; Must-Have status
changes; and the lot criterion's score change. A home's Match changes by
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
