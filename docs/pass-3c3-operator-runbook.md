# V1 pre-beta Pass 3C.3 — lock the old privacy doors

## Scope and decision

This pass is **database enforcement only**. It does not drop, clear, copy, or
re-migrate legacy values and it does not change the UI. Do not apply the SQL as
part of a Vercel deploy and do not merge this PR before production verification.

The recommended surface is native PostgreSQL column privileges on the existing
`homes` and `searches` tables, combined with their existing RLS. PostgREST can
continue using the explicit 3C.2 projections without a view/RPC cutover. RLS
selects rows; column ACLs prevent requesting private columns. A trigger preserves
the current home upsert shape while making identity and timestamps immutable.
Therefore 3C.3 can remain one restrictive database pass; no 3C.3A/B/C cutover is
needed, provided the preflight matches the assumptions below.

## Repository audit findings and production assumptions

Repository main at `2e61ac2` represents this contract:

* `home_member_state` has the privacy leak: `hms_select_members` permits the
  caller's row **or every state row on an accessible home**. INSERT and UPDATE
  are already caller-owned and require accessible homes. There is no DELETE
  policy, so V1 direct DELETE is unavailable.
* `search_member_priorities` SELECT is own-row only. INSERT is own-row plus
  accessible-search. UPDATE uses own-row and checks own-row plus access. There
  is no DELETE policy. No change is needed.
* `commute_destinations` has own-row plus two-argument
  `can_access_search(search_id, auth.uid())` for SELECT/INSERT/UPDATE/DELETE.
  Canonical schema consistently has the two-argument call. No change is needed.
* `homes_select_member` shares accessible rows and `homes_update_member` permits
  updates to an accessible row. RLS cannot protect individual legacy columns.
  `homes_insert_member` also fails to bind `user_id` to the caller.
* `searches_select_member` shares search rows. Owner UPDATE exists, but runtime
  has no direct search UPDATE after 3C.2. Table-level grants are not declared in
  canonical schema, so production platform grants must be inventoried rather
  than inferred.
* 3C.2's runtime allowlists exactly match the READ allowlists below. Its home
  persistence sends the shared write fields plus `id`, `user_id`, `search_id`,
  and `updated_at`; coordinate enrichment updates only coordinate columns.
* The lifecycle and compare RPCs are `SECURITY DEFINER`, fixed empty
  `search_path`, derive `auth.uid()`, check search access, and explicitly deny
  PUBLIC/anon/service_role. Shared-fact awareness does the same validation and
  has a fixed empty path, but its checked-in ACL only revokes PUBLIC and grants
  authenticated. 3C.3 explicitly revokes anon/service_role as ACL hygiene.
* Invitation functions are separate fixed-path `SECURITY DEFINER` functions.
  Execute is authenticated-only. Acceptance binds `auth.uid()` and invited
  email; preview exposes only validity/reason and relies on authenticated-only
  execution. They are not rewritten.
* Access helpers are fixed-path `SECURITY DEFINER`, take explicit search/home and
  user arguments, and grant authenticated execution. 3C.3 explicitly removes
  anon/service_role execution without changing their bodies.

Production must confirm: all relevant tables have RLS; policy expressions and
names match; no extra permissive policy exists; required columns exist; exact
function overloads/configuration match; authenticated currently has the expected
table grants; and no unexpected column grants would survive. Any safety-relevant
mismatch is a **STOP**, not permission to edit SQL ad hoc.

## Final enforced contract

### Participant-owned tables

`home_member_state` SELECT becomes exactly `auth.uid() = user_id`. Existing
own/access-bound INSERT and UPDATE remain. No DELETE policy is added.
`search_member_priorities` and `commute_destinations` remain unchanged and are
proved by preflight/verification.

### Homes

Authenticated READ columns are exactly:

`id, user_id, search_id, address, crossroads, listing_url, photo_url, price,
est_monthly, sqft, beds, baths, lot_size, garage_spaces, year_built,
days_on_market, home_layout, home_condition, primary_bedroom_location,
secondary_bedroom_location, notes, pros, cons, latitude, longitude,
coordinate_address_fingerprint, coordinate_status, coordinate_source,
hoa_fee_monthly, property_tax_annual, property_tax_year, basement_notes,
schools_notes, condition_notes, created_at, updated_at`.

The seven legacy columns (`status`, `reaction`, `toured_at`, `is_favorite`,
`rejection_reason`, `ratings`, `checks`) and the unused `school_district` are not
readable. Table-level SELECT is revoked, so `select('*')` cannot bypass this.

INSERT supports Add Home with shared facts, `id`, caller-bound `user_id`, and an
accessible `search_id`. `updated_at` remains accepted for compatibility but the
trigger overwrites it; `created_at` and all legacy fields cannot be supplied.

UPDATE supports Edit Home/shared Pros/Cons/Notes and objective/enrichment fields.
The 3C.2 upsert needs target privileges for `id`, `user_id`, `search_id`, and
`updated_at`; a before trigger rejects any identity change and overwrites the
system timestamp. `created_at` and all legacy columns lack UPDATE privilege.
Existing DELETE semantics/policies are untouched.

### Searches

Authenticated READ is exactly `id, user_id, created_at, updated_at`.
`priorities` cannot be selected. All authenticated direct UPDATE is revoked,
preventing priority, identity, and timestamp mutation. There is no post-3C.2
runtime search update requirement: active search changes `profiles`, invitation
acceptance uses its RPC, membership changes use `search_members`, and personal
priorities use `search_member_priorities`. Existing search INSERT/DELETE and RLS
are untouched.

## Scripts and result sets

1. `supabase/3c3-production-preflight.sql` is read-only and returns: RLS flags;
   exact policies; API-role table grants; homes/searches column grants; function
   overload/definer/path/ACL metadata; missing required columns; and a compact
   summary of RLS, table privileges, and critical overload counts. It never reads
   application rows.
2. `supabase/migrations/2026-09-09-pass-3c3-lock-legacy-privacy.sql` is the
   restrictive transaction. It fails on missing required columns, changes the
   one leaking policy, installs allowlists/identity guard, removes unneeded
   searches UPDATE, tightens home INSERT identity, and performs RPC/helper ACL
   hygiene. It must not be run by automation or against a local database as a
   substitute for production preflight review.
3. `supabase/3c3-production-verification.sql` is read-only and returns named
   pass/fail catalog checks, effective homes/searches column surfaces, the home
   guard trigger, and home/search policies.

## Authenticated two-user adversarial and smoke plan

Use two ordinary, non-admin accounts A and B with real JWT-backed Supabase
clients. They must share one search and have at least one shared home. Never use
`service_role` as evidence. Record only pass/fail and HTTP/Postgres error codes;
do not paste private returned data into the operator log.

For both directions (A attacking B, then B attacking A):

1. Query `home_member_state` by the other participant's `user_id`, known home ID,
   and then without filters. Expect zero other-user rows. Attempt UPDATE/UPSERT
   of the other's row; expect denial/no affected row. Confirm own-row
   insert/upsert/select still succeeds.
2. Query and mutate the other's `search_member_priorities`, including by known
   search ID and unfiltered. Expect no other row and no modification. Confirm
   caller priorities save/load independently.
3. Query and mutate the other's `commute_destinations`, by known search and
   guessed/known destination ID and unfiltered. Expect no other row and no
   modification. Confirm caller CRUD still works.
4. Request each legacy home column individually and together, and request
   `homes.select('*')`. Expect permission failure. Attempt each legacy column in
   UPDATE and INSERT; expect permission failure. Confirm no legacy value changed.
5. Request `searches.priorities` and `searches.select('*')`; attempt UPDATE of
   priorities, `id`, `user_id`, `created_at`, and `updated_at`. Expect permission
   failure and unchanged metadata.
6. Attempt home UPDATE changing `id`, `user_id`, `search_id`, or `created_at`.
   Expect the identity guard/RLS to deny. Attempt a client-selected `updated_at`;
   confirm the database substitutes current time rather than accepting it.
7. Confirm each participant can load Homes, open Home Detail, Favorite, Want to
   Tour, Archive, edit shared Pros/Cons/Notes and an approved property fact, use
   My Search, Compare, and Map. Add a home and confirm shared access. Exercise
   coordinate enrichment if provider keys are available.
8. Confirm favorite/tour/archive actions remain independent. Confirm the three
   sanitized RPCs return only their documented columns/results and co-buyer
   lifecycle conclusions still render. Confirm invitation preview/accept on a
   fresh test invitation if invitation smoke coverage is required.

## Exact manual production order

1. Review this PR, migration, and read-only preflight. Do not merge.
2. In production, run only `supabase/3c3-production-preflight.sql`.
3. Compare every result with this audit and migration assumptions, especially
   extra policies, overloads, effective grants, and missing columns.
4. If any mismatch affects safety, **STOP**. Revise/review the PR; do not weaken
   production interactively.
5. Confirm commit `2e61ac2` (Pass 3C.2) or its merged production-main equivalent
   is currently deployed and its prior Preview smoke passed.
6. Manually apply the reviewed 3C.3 migration in the production Supabase SQL
   Editor. Do not apply it through Vercel and do not alter data.
7. Immediately run `supabase/3c3-production-verification.sql`; every named check
   must be true and effective column lists must exactly match review.
8. Immediately execute the authenticated two-user adversarial/smoke plan above.
9. Only after all checks pass, merge the repository PR so canonical schema and
   migration history match production. The operator—not this PR—performs the
   production SQL and GitHub merge.
10. On failure, stop testing the failed path and use only the applicable narrow
    rollback below. Re-run verification and focused JWT tests after rollback.

## Privacy-preserving rollback

Never restore cross-participant `home_member_state`, table-level `SELECT *`, or
legacy private columns.

* Missing shared home READ: grant SELECT on only the single reviewed shared
  column, update both source allowlist and migration history, then retest. Never
  grant any of the seven legacy columns.
* Broken shared home edit/enrichment: grant INSERT or UPDATE on only the required
  objective column. If the upsert unexpectedly needs another immutable target,
  add only that target to UPDATE while retaining/expanding the guard trigger.
  Do not disable the guard wholesale.
* Broken Add Home identity binding: do not restore `homes_insert_member` as
  written. Add a narrow SECURITY DEFINER insert RPC that derives `user_id` from
  `auth.uid()` or revise the client in a staged pass.
* Broken search behavior: restore SELECT on only a required non-private metadata
  column. If a legitimate mutation is discovered, prefer a narrow RPC or one
  column UPDATE plus owner-only RLS; never restore priorities or broad UPDATE.
* RPC regression caused only by ACL cleanup: restore EXECUTE only to the exact
  required role and exact signature after validating its caller checks. Never
  use PUBLIC and never create an overload.
* Home identity trigger defect: replace it transactionally with a corrected
  trigger. Do not remove immutability while broad upsert target privileges remain.
* The own-only state SELECT policy is not rolled back. If a sanitized feature
  fails, fix that feature's narrow RPC instead.

## Outside GitHub and blockers

Production preflight review, manual Supabase application, catalog verification,
and real two-user JWT tests must be performed outside GitHub by an authorized
operator. No production action is performed by this change. There are no known
repository blockers; a production drift mismatch is an intentional deployment
blocker until reviewed.
