# Home Facts → Match parity (first PR)

A buyer used to answer some Match criteria twice: once on Home Facts (Basement
condition: Finished) and again as their own Yes/No ("Finished basement"). That
is homework FLH can do. Now an exact shared Home Fact answers those criteria for
every buyer who hasn't given their own answer. The buyer's own Yes or No is
always an override. This PR also makes the co-buyer Compare scorer give the same
result as each buyer's own Match.

Principle: **FLH does the homework. You make the decisions.**

The new shared fireplace, pool and fencing fields are the second PR.

## The rule (both scorers)

For every check criterion, in this order:

1. **The buyer's own explicit Yes (`true`) or No (`'no'`)** in their own
   `home_member_state.checks`. It is an override, and only ever written by that
   buyer.
2. **Otherwise, an exact reading of a shared Home Fact** (table below).
3. **Otherwise, Unknown**, which is never counted.

Historical `false` (from the old toggle) is still Unknown, so it is not an
override. The fact is read each time Match is calculated and is **never copied
into anyone's checks**. A corrected Home Fact therefore updates every buyer who
hasn't overridden it, immediately.

| Criterion (every stored label) | Yes | No | Unknown |
|---|---|---|---|
| Garage | Garage spaces greater than 0 (`'3+'` reads as 3) | `0`, `none`, `no`, `no garage` | Blank; text with no count (`Attached`, `yes`); garbled numbers (`1.2.3`) |
| Finished basement / Finished Basement | Condition **Finished** | Condition **Unfinished**; condition or style **None** | Partially finished; not recorded; contradictory fields (see below) |
| Walkout basement / Walkout Basement | Style **Walkout** | Style or condition **None** | **Traditional** or **Gardenview** (neither says there's no walkout); not recorded; contradictory fields |
| First-floor laundry / First-Floor Laundry | Laundry location **First floor** | — (never No) | Any other location, or not recorded |
| Second-Floor Laundry | Laundry location **Second floor** | — (never No) | Any other location, or not recorded |
| First-Floor Primary | Primary bedroom **Main Floor** | Primary bedroom **Upstairs** | Not recorded |
| No HOA | — | HOA fee **above $0** | **$0** (doesn't prove there's no HOA), or not recorded |

**Contradictory basement facts:** one field says "None" while the other
describes a basement. That answers nothing, with one exception: Unfinished is
never a finished basement under either reading.

**Laundry never answers No:** Laundry Location records one location, which says
where the laundry is, not that there's none elsewhere.

The table lives once in `src/lib/homeFactCriteria.js`. The database scorer
(`2026-11-02-home-facts-match-parity.sql`) carries the same table, and
`test/home-fact-match-parity.test.js` checks that the two list the same keys and
legacy aliases.

## Scorer parity fixes found along the way

| Gap (before) | Own Match (JS) | Compare (SQL) | Now (both) |
|---|---|---|---|
| Garage with spaces set and an own answer | Ignored the answer | Ignored the answer | Own answer wins |
| Garage with spaces blank and an own answer | Unknown | Used the answer | Uses the answer |
| Garage spaces with no digits (`Attached`) | Read as **0 → No garage** | Unknown | Unknown |
| Garage spaces like `1.2.3` | Unknown | **Error for the whole Compare call** | Unknown |
| A search saved under an older purchase label (`First-Floor Laundry`, `Home Office`, `Fenced Yard` …) with the current label also selected | Counted once | **Counted twice** | Once, at the current label's level |
| Answer stored under the other label (old vs current) | Found (folded) | Missed | Found, current label first |
| Rating stored under an older label | Not read | Read | Not read (matches JS) |

## What buyers see

- **Match Criteria**, on the home overlay and Home Detail:
  - A row a Home Fact answers shows "From Home Facts: **No** · Garage ↗" under
    the name. The link opens the fact.
  - The third option of the Yes / No / Unknown control reads **Home Facts** and
    is selected. Choosing Yes or No overrides; choosing Home Facts removes the
    override.
  - When an override disagrees with the fact, the row says "Your answer · Home
    Facts: No ↗".
  - Garage moved from read-only to this same control, since buyers may now
    override it.
- **Add / Edit Home editor:** the same "Home Facts" option, and a "From Home
  Facts: Yes" tag instead of "Not confirmed".
- **Realtors:** see the result and its source, with no controls (unchanged
  permissions).
- **Co-buyers:** each buyer's Match uses their own overrides only. A shared fact
  feeds both.

Screenshots (desktop 1440, iPad 820, iPhone 390; real app on the Postgres
stand-in) are in `docs/home-facts-match-parity-screenshots/`.

## Effect on existing buyers' Match scores

Nothing stored is rewritten. Scores change only through:

1. **Criteria newly answered by a Home Fact.** Unknown becomes Yes or No for
   buyers with no answer of their own. Their Match % moves, and a Must-Have can
   become a confirmed miss (e.g. First-Floor Primary when Home Facts says the
   primary bedroom is upstairs).
2. **Garage overrides.** A buyer's existing Yes / No for Garage now wins over
   garage spaces. Those answers came from the Add/Edit editor's Garage Yes/No,
   which Match used to ignore whenever garage spaces were set.
3. **Garage text.** A garage-spaces value with no digits, such as `Attached`,
   counted as "No garage" in the buyer's own Match and is now Unknown. A value
   like `1.2.3` used to break Compare and is now Unknown.
4. **Older purchase labels in Compare.** These are folded exactly as the
   buyer's own Match already did. A co-buyer's Compare score can change where
   their saved search still used an older label.

`supabase/home-facts-match-parity-preflight.sql` is a read-only SELECT that
returns counts only. It reports each of these before the migration is applied:
- evaluations newly answered per criterion and tier
- Must-Haves that become misses
- Garage overrides that now win
- historical `false` Garage answers
- garage text that changes reading
- older-label documents

## Deploying (needs approval; not done)

1. Run `supabase/home-facts-match-parity-preflight.sql` in the production SQL
   editor:
   - every `required` row must be `ok`;
   - the body must be the 2026-10-18 lot-size version;
   - `basement_style`, `basement_condition` and `laundry_location` must exist;
   - review the `info` counts.
2. Apply `supabase/migrations/2026-11-02-home-facts-match-parity.sql`. It
   replaces one function body: same signature, `SECURITY DEFINER`, empty
   `search_path`, access check and grants. It can be re-run.
3. Deploy the app. The JS and SQL rules ship together, so deploy soon after the
   migration (until both are live, Compare and own Match can differ for these
   criteria).
4. Re-run the preflight. The body row then reads `ALREADY APPLIED`.

**Rollback:** re-apply `2026-10-18-lot-size-units-match-parity.sql` and revert the
app.

## Tests

- `test/home-fact-match-parity.test.js` (unit):
  - every basement condition × style
  - laundry, primary bedroom, HOA and garage readings
  - precedence and historical false
  - weights
  - no writes to checks
  - Match Criteria resolution and clearing
  - JS↔SQL key and alias pins
  - "the migration changes only the item-list section"
  - the security contract
- `test/home-fact-match-parity-db.test.js` (real Postgres): both scorers on the
  same participant must give the same percentage, selected count and evaluated
  count, across:
  - every fact combination, with no answer, historical false, own No and own Yes
  - an exhaustive grid of 48 homes × 7 criteria scored one at a time
  - live fact changes with and without overrides
  - owner/co-buyer independence
  - older purchase labels, answers under either label, and both labels selected
  - rental labels
  - the production path: preflight on pre-migration data, the old scorer failing
    on `1.2.3`, then the migration (twice), with nothing rewritten and the
    security settings and grants verified
- Updated tests that pinned the previous rules: "HOA / Laundry Location are not
  Match inputs", "Garage is never answered in Match Criteria", "no SQL function
  reads laundry_location", and the scorer file pins.
- Browser QA: `scripts/qa/home-fact-match-parity-e2e.mjs`.

## Known, unchanged

- **No member-state row:** Compare falls back to the creator's legacy
  `homes.checks` when a participant has no `home_member_state` row; the
  buyer's own Match doesn't.
- **Tiers without a matching `customItems` entry:** a stored tier for a catalog
  label with no matching `customItems` entry is ignored by the buyer's own Match
  but counted by Compare. Selection always writes both, so only very old or
  hand-built documents have this shape.
- **Realtor suggestions:** they don't carry Home Facts details (basement,
  laundry, HOA) into the home. The second PR adds the new shared fields to the
  Realtor suggestion transfer, as decided.
