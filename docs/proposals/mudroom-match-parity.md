# Proposal: restore Mudroom in both Match scorers

**Status:** built and validated locally, **not in #145**. Separately deployable;
#145 does not depend on it. Awaiting approval to open as its own draft PR.

## Why
The approved Home to Buy catalog has 34 options. `features:Mudroom` is a
retired purchase built-in in **both** scorers — `RETIRED_PURCHASE_BUILT_INS`
(`src/lib/constants.js`) and the retired array inside
`public.resolve_cobuyer_compare_perspectives` (SQL, co-buyer Compare). Offering
the chip before both are changed would show a priority that never counts, or a
co-buyer Match in Compare that disagrees with that person's own Match.

## Change (one commit, based on `main`)
| File | Change |
| --- | --- |
| `supabase/migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql` | `create or replace` of the current function body from `2026-10-07-cobuyer-compare-garage-parity.sql` with exactly `'features:Mudroom'` removed from the retired array. Same signature, `SECURITY DEFINER`, empty `search_path`, access check, sanitized projection, grants. Idempotent. |
| `src/lib/constants.js` | Remove `'features:Mudroom'` from `RETIRED_PURCHASE_BUILT_INS`. |
| `test/match-scorer-parity.test.js` | Points at the new newest definition; asserts Mudroom is scored on both sides. |
| `test/mudroom-match-parity-db.test.js` (new) | Real Postgres: a co-buyer with a Mudroom Must-Have; Unknown → not evaluated on both sides (and never a miss); their own No → miss; Yes → met; own Match and the owner's Compare projection agree on pct, selected and evaluated counts at each step. |
| `test/support/supabaseDb.mjs` | Adds the migration to `POST_SNAPSHOT_MIGRATIONS`. |
| `supabase/production-function-fingerprints.sql` | Regenerated (new repository version of the function). |

Validation (disposable Postgres 16): the new DB test **fails without** the
migration and passes with it; full suite 849/849, 0 skipped.

## Existing data
Buyers who chose Mudroom before it was retired keep their stored tier; it starts
counting again (restoring their intent). Their earlier Yes/No answers on homes
count; Unknown stays Unknown.

## Rollout
1. Merge the parity PR; apply the migration (operator runbook, fingerprints
   identify the version).
2. Then add one entry — `['features', 'Mudroom']` in "Layout & Living Spaces" —
   to `BUY_WHAT_MATTERS_GROUPS` and `FEATURES_SUGGESTED` (follow-up to #145, with
   catalog tests updated to 34). The chip must not ship before step 1 is live.
