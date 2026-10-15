# Mudroom Match parity — migration and deployment

Restores `features:Mudroom` as a scored purchase criterion in **both** Match
scorers so the approved 34-option Home to Buy catalog can offer it honestly.
This change does **not** add the Mudroom chip; that is a one-line follow-up
after this is live (see "Order").

## What changes
| Layer | Change |
| --- | --- |
| JS Match (`computeMatch`, `src/lib/constants.js`) | `features:Mudroom` removed from `RETIRED_PURCHASE_BUILT_INS`. |
| SQL co-buyer Compare (`resolve_cobuyer_compare_perspectives`) | `supabase/migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql`: the current body (2026-10-07 garage parity) with exactly that key removed from the retired array. Same signature, `SECURITY DEFINER`, empty `search_path`, access check, sanitized projection, grants. `create or replace` — re-runnable. |
| Fingerprints | `supabase/production-function-fingerprints.sql` regenerated (identifies the new body). |
| Preflight | `supabase/mudroom-parity-preflight.sql` — read-only, one SELECT, counts only. |

No table, column, policy, grant, or row changes. Preferences and home answers
are never rewritten.

## Effect on existing data
- A buyer who selected Mudroom before it was retired keeps the exact stored
  preference (`features.tiers.Mudroom`, in `customItems` or as a bare tier); it
  starts counting again at its saved level — restoring their intent.
- Their earlier personal answers on homes count: `true` = met, `'no'` = missed.
  Absent or the historical boolean `false` stays **Unknown**, which is never a
  miss and stays out of the percentage, including for a Must-Have.
- Must-Have reporting (`mustHaveStatus`): a Mudroom Must-Have with no answer is
  "still unknown", never "missing".
- Rental searches already counted Mudroom; unchanged. A deselected Mudroom
  (`dontcare`) stays off.

## Prerequisites
- Production's `resolve_cobuyer_compare_perspectives` must be the 2026-10-07
  garage-parity body (or this one). The preflight checks this by body
  fingerprint and lists any older version with what to do.
- Every column the body reads must exist (preflight checks them; the function
  body is validated only when called).

## Preflight (read-only)
Run `supabase/mudroom-parity-preflight.sql` in the production SQL Editor.
Proceed only if every `required` row has `ok = true`. The `info` rows report how
many purchase preference documents have Mudroom selected (and at which level)
and how many personal Mudroom answers exist — these start counting.
`test/mudroom-match-parity-db.test.js` runs it on pre-migration data, asserts
the counts, and asserts it writes nothing.

## Order
1. Run the preflight; stop on any `required` failure.
2. Apply the migration (SQL Editor, one transaction). Re-run the preflight:
   the body row reads `ALREADY APPLIED`.
3. Merge this PR (Vercel deploys the JS change).
   Between steps 2 and 3 a co-buyer's Mudroom counts in the other person's
   Compare view but not yet in their own Match; with step 3 straight after, the
   window is minutes, and only for searches the preflight counted.
4. After #145 is merged: add `['features', 'Mudroom']` to "Layout & Living
   Spaces" in `BUY_WHAT_MATTERS_GROUPS` and `FEATURES_SUGGESTED`, update the
   catalog tests to 34. Never ship the chip before steps 2–3.

## Rollback
Re-apply `supabase/migrations/2026-10-07-cobuyer-compare-garage-parity.sql`
(restores the previous body) and revert this PR. No data to restore.

## Tests
- `test/mudroom-match-parity-db.test.js`: JS Must-Have / Unknown / No / Yes;
  stored shapes; co-buyer own Match = owner's Compare projection (pct, selected,
  evaluated) for Unknown, No and Yes; production path on a pre-migration
  database (preflight → migrate → re-run) with snapshots proving no row changes.
- `test/match-scorer-parity.test.js`: the two retired lists stay identical.
