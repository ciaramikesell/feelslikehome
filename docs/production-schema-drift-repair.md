# Production schema drift: diagnosis and repair runbook (revised 2026-10-08)

This revision is based on production's actual inventory output. It replaces
the first version of this runbook, which predicted a different baseline.

## Production's inventory, explained

| Inventory row | Production | Real state |
|---|---|---|
| realtor-role-foundation, realtor-suggestions (+ homes select fix), realtor-notes-tours-buyer-invitations, listing-import (+ hotfix) | true | Applied. |
| collaborator display-name (map-collaborator-places / my-search-collaborator-display-name) | false | **Missing, and those two files can't apply.** Both change `resolve_collaborator_search_context` from 3 to 4 output columns with `CREATE OR REPLACE`; Postgres refuses (42P13 "cannot change return type"), so each attempt rolls back. Not a false negative. |
| realtor-started-searches | false | **Missing** (`prospective_searches`, `search_invitations.prospective_search_id`, and their functions). |
| people-workspace-draft-select-privileges | false | Missing: it can't apply without `prospective_searches`. |
| tour-evaluations | false | **Missing.** Production's `resolve_cobuyer_compare_perspectives` is a pre-2026-09-18 version (secure-compare / rental-v1 / realtor-role), which `supabase/production-function-fingerprints.sql` identifies exactly. Not a false negative. |
| account-name-capture-and-realtor-home (09-19) | false | Missing: it can't apply without `prospective_searches` *and* the 4-column collaborator context. |
| 2026-10-07 conflict targets / onboarding state | false | Not applied (correct; you held them). |
| 2026-10-07 **garage-parity** | **true** | **False positive.** The first inventory checked only "the compare body doesn't retire `exterior:Garage`". Pre-2026-09-18 bodies have no retired list at all, so they pass trivially. The check now also requires the tour-evaluation lineage, and production reads **false**. |

**Could garage-parity be overwritten by an earlier migration?** It isn't
applied yet, but yes: that is the hazard to avoid.
`2026-09-18-tour-evaluations.sql` contains *only* the compare function, and
`2026-10-07-cobuyer-compare-garage-parity.sql` is that exact body minus two
retired keys (Garage, Guest / In-Law Suite). Running tour-evaluations after
garage-parity silently re-retires Garage, so a co-buyer's Garage Must Have
vanishes from Compare again. `test/production-drift-repair-db.test.js`
demonstrates this. **tour-evaluations.sql is therefore never applied:
garage-parity delivers its behavior plus the fix.**

## Revised order (seven files)

| # | File | Why here |
|---|---|---|
| 1 | `supabase/migrations/2026-09-16-realtor-started-searches.sql` | Creates the missing table/column. Everything below needs it. |
| 2 | `supabase/migrations/2026-09-18-people-workspace-draft-select-privileges.sql` | Narrows `prospective_searches` SELECT; needs 1. |
| 3 | `supabase/migrations/2026-10-08-collaborator-context-return-type.sql` | **New bridge.** Only if the collaborator context still has 3 columns, drop it and create the display-name version in one transaction. A no-op otherwise. Needed before 4. |
| 4 | `supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql` | Needs 1 and 3. Newest versions of names, display names, Realtor functions, 8-column `preview_invitation`. |
| 5 | `supabase/migrations/2026-10-07-invitation-acceptance-conflict-targets.sql` | Newest `accept_invitation` / `claim_prospective_search`; needs 1. |
| 6 | `supabase/migrations/2026-10-07-cobuyer-compare-garage-parity.sql` | Newest compare projection (includes tour-evaluation behavior). |
| 7 | `supabase/migrations/2026-10-07-onboarding-state.sql` | Independent; last. |

**Never apply to production:** `2026-09-16-map-collaborator-places.sql`,
`2026-09-16-my-search-collaborator-display-name.sql` (superseded by 3 and 4;
they fail on production anyway), and `2026-09-18-tour-evaluations.sql`
(superseded by 6; harmful after it).

After step 7, every function the repair touches runs its **newest**
repository definition. The test checks this by body fingerprint.

## Why this order is safe

`test/production-drift-repair-db.test.js` rebuilds production three times,
once per possible pre-09-18 compare version. Each rebuild reproduces your
inventory row-for-row (including all four FACT rows and the old check's false
positive), with existing users, memberships, preferences, homes, personal
state, Realtor notes, places, and pending invitations seeded. It proves:

* the original plan fails: display-name, 09-19 and the conflict fix each
  error and **roll back completely**, with nothing half-applied;
* the revised seven files all apply, and **every existing row is
  byte-for-byte unchanged**;
* every repaired function matches its newest repository version, and
  re-running the bridge afterwards changes nothing;
* drift-era co-buyer and Realtor invitations accept; the Realtor-started
  draft → claim flow works; names save; Ciara's My Search shows Andrew by
  name;
* Andrew is routed to set up his own preferences on the shared search, with
  his own-search preferences untouched;
* a co-buyer's Garage Must Have scores the same in Compare as in their own
  Match;
* applying tour-evaluations afterwards regresses Garage, and the corrected
  inventory catches it.

No file writes data at the top level; every insert/update sits inside a
function body.

### RLS and privileged-function review

* **New table `prospective_searches`:** RLS on. SELECT and UPDATE only where
  `started_by = auth.uid()`; no client INSERT or DELETE. File 2 narrows
  SELECT to `id, client_name, invited_email, status, draft_priorities,
  created_at, updated_at`, so `started_by` isn't exposed.
* **New SECURITY DEFINER functions** (`create_prospective_search`,
  `invite_prospective_client`, `create_buyer_invitation`,
  `claim_prospective_search`): empty `search_path`, require `auth.uid()`,
  write only the caller's own drafts, membership, or preferences, and are
  email-bound to the invited account.
* **Replaced functions** (`accept_invitation`, `preview_invitation`, 09-19's
  name-aware functions, the compare projection): same access checks as the
  versions they replace. `preview_invitation` still returns invitation
  metadata only, plus `requires_confirmation`.
* **Bridge (3):** the reviewed display-name definition unchanged, re-granted
  to `authenticated` only. Nothing depends on the function.
* No existing policy is loosened; no grant beyond the above is added.

## Runbook (Supabase SQL Editor, production project)

**Before anything:** confirm a recent backup / point-in-time recovery
(Supabase → Database → Backups), and that the project URL matches Vercel's
`NEXT_PUBLIC_SUPABASE_URL`.

### A. Read-only preflight: run all three and keep the output

1. `supabase/production-migration-inventory.sql` (corrected): expect the
   table above, with garage-parity now **false**.
2. `supabase/production-function-fingerprints.sql`: which repository version
   of each function production runs. Expected:
   * `accept_invitation`, `create_buyer_invitation`, `preview_invitation`,
     `save_realtor_note`, `suggest_home_tour` → `…realtor-notes-tours-buyer-invitations.sql`
   * `resolve_cobuyer_compare_perspectives` → one of `…secure-compare-perspectives.sql`,
     `…fix-compare-bedroom-location-type.sql`, `…rental-v1-shared-facts.sql`,
     `…realtor-role-foundation.sql`
   * `resolve_collaborator_search_context` → `…shared-search-collaboration-contract.sql`
     or `…realtor-role-foundation.sql`
   * `claim_prospective_search`, `create_prospective_search`,
     `invite_prospective_client`, `create_realtor_connection_request`,
     `resolve_display_name` → `NOT PRESENT`
3. `supabase/production-repair-preflight.sql`: the last row must read
   `VERDICT | all prerequisites present | true`.

**Stop and send me the output if:** any fingerprint says `NO REPOSITORY
MATCH` (a hand-edited function would be overwritten); any result differs
from the expectations above; or the preflight verdict is not true.

### B. Apply: only after A matches, one file at a time

Paste each file **whole** from `main` (files 3 and the revised SQL checks
arrive on `main` with this change), run it, and confirm success before the
next. If any file errors, stop: it rolls back entirely. Send the error.
Order: **1 → 7** from the table above.

### C. Verify (read-only)

* Inventory: every migration row `true` (including garage-parity and
  tour-evaluations, whose behavior arrives via file 6);
  "accept_invitation conflict clause" = `named constraint (fixed)`.
* Fingerprints: every function shows the file listed under "newest" in
  `test/production-drift-repair-db.test.js` (`EXPECTED_AFTER`), e.g.
  `accept_invitation` → `…2026-10-07-invitation-acceptance-conflict-targets.sql`,
  `resolve_cobuyer_compare_perspectives` → `…2026-10-07-cobuyer-compare-garage-parity.sql`,
  `resolve_collaborator_search_context` → `…2026-09-19-account-name-capture-and-realtor-home.sql`.
* `supabase/cobuyer-journey-production-check.sql` section 0: all true;
  section 3 for you and Andrew.

### D. In the app

* Andrew opens FLH and lands on onboarding for your shared search; afterwards
  he's in your homes with his own Match. Your My Search shows him by name.
* A fresh co-buyer invitation accepts; a Realtor account's `/people` loads;
  Account settings saves a name.

## Not done automatically (needs a decision)

* **Andrew's stranded preferences:** consent-only copy template in
  `docs/cobuyer-journey-incident.md`. Otherwise he simply sets them up
  again.
* **Names of accounts created during the drift** are in sign-up metadata but
  not `profiles.first_name`. A backfill is a data change, so it needs
  approval.
* **Invitations that failed during the drift:** re-open the same link if it
  hasn't expired (7 days); otherwise send a new one.
