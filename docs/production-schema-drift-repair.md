# Production schema drift: diagnosis and repair runbook (2026-10-08)

## What production's Section 0 result means

| Check | Production | Created by |
|---|---|---|
| `has_invitation_direction` | true | `2026-09-16-realtor-notes-tours-buyer-invitations.sql` |
| `has_prospective_searches` | **false** | `2026-09-16-realtor-started-searches.sql` |
| `has_invitation_prospective_link` | **false** | `2026-09-16-realtor-started-searches.sql` |

The two missing objects are created only by
`2026-09-16-realtor-started-searches.sql`, which runs as one transaction, so
the whole migration is absent: the table, its RLS and grants, the
`search_invitations.prospective_search_id` link, and its functions
(`create_prospective_search`, `invite_prospective_client`,
`claim_prospective_search`, and new versions of `create_buyer_invitation`,
`preview_invitation`, `accept_invitation`).

**Most likely cause:** the pre-fix `supabase/schema.sql`. Its last block was
exactly this migration, and it began with `begin;` but had no `commit;`
(fixed in PR #136). Running that file rolls back only that block. Every
earlier block, including `invitation_direction`, commits. That reproduces
production's Section 0 result exactly.

### Knock-on effects (not intentional drift)

Because the table is missing, two later migrations **cannot** apply. Each
runs as one transaction and fails on the missing table, so it is absent
entirely:

* `2026-09-18-people-workspace-draft-select-privileges.sql`
* `2026-09-19-account-name-capture-and-realtor-home.sql`: adds
  `profiles.first_name/last_name`, `resolve_display_name`,
  `create_realtor_connection_request`, the 8-column `preview_invitation`,
  and name-aware display functions.

Current `main` code expects all of these. In production today:

* co-buyer and Realtor invitation acceptance fails with 42702 if
  `accept_invitation` is the Sept 16 Realtor-notes version (the inventory's
  FACT row says which);
* People workspace (`/people`), Realtor "start a search for a client",
  "invite a buyer", "connect with an existing buyer", and the confirmation
  step fail;
* saving a name in Account settings or the name prompt fails. Names typed at
  sign-up during the drift are still in sign-up metadata; nothing is lost.

The October 7 acceptance fix cannot apply either: its
`claim_prospective_search` needs the missing table. Section 0 caught this.

## Why replaying the missing files as-is is safe

Proven by `test/production-drift-repair-db.test.js`, which rebuilds the
drifted state from the repository, seeds existing users, memberships,
preferences, homes, personal state, notes, places, and pending invitations,
then applies the order below exactly as the SQL Editor does:

* every file applies cleanly in this order, and **every existing row is
  byte-for-byte unchanged** (fingerprinted before and after);
* out of order, the dependent files fail and roll back completely, so a
  mistake can't leave anything half-applied;
* invitations created during the drift (co-buyer, and Realtor→buyer without
  a draft) accept successfully afterwards;
* the Realtor-started draft → invite → claim flow works;
* Andrew-style co-buyers are routed to set up their own preferences on the
  shared search, and their own-search preferences are untouched;
* account names save again.

No file contains a top-level data write: every `insert`/`update` sits inside
a function body that runs only when the app calls it.

**RLS and privileged-function review** (all from previously reviewed
migrations, now reviewed again):

* `prospective_searches`: RLS on; SELECT and UPDATE only where
  `started_by = auth.uid()`; no client INSERT or DELETE. The people-workspace
  migration then narrows SELECT to `id, client_name, invited_email, status,
  draft_priorities, created_at, updated_at`, so `started_by` is not
  exposed.
* `create_prospective_search`, `invite_prospective_client`,
  `create_buyer_invitation`: SECURITY DEFINER with an empty `search_path`.
  They require `auth.uid()`, write only drafts stamped with the caller as
  `started_by`, and only invite from a draft the caller started.
* `claim_prospective_search`, `accept_invitation`: email-bound to the
  invited account, and write only the caller's own membership/preferences.
  The October 7 file replaces both with constraint-named conflict targets.
* `preview_invitation`: returns only invitation metadata (no
  search contents), as before, plus `requires_confirmation`.
* 2026-09-19 replaces existing functions with name-aware versions (same
  access checks) and `handle_new_user` (seeds names for *new* signups only).
  It adds nullable profile columns, with no backfill.

No existing policy is loosened, and no grant beyond these is added.

## Runbook (Supabase SQL Editor, production project)

### 0. Before anything

* Confirm a recent backup / point-in-time recovery is available
  (Supabase → Database → Backups).
* Use the project whose URL matches Vercel's `NEXT_PUBLIC_SUPABASE_URL`.

### 1. Read-only inventory

Run **`supabase/production-migration-inventory.sql`** and keep the output.
Expected for the diagnosed state:

| migration | applied |
|---|---|
| realtor-role-foundation, realtor-suggestions, realtor-suggestions-homes-select-fix, realtor-notes-tours-buyer-invitations, collaborator display-name, listing-import-provenance, listing-import-z-privileges-hotfix, tour-evaluations | **true** |
| realtor-started-searches, people-workspace-draft-select-privileges, account-name-capture-and-realtor-home, all three 2026-10-07 | **false** |
| FACT: Realtor-started functions present | **none** |

**Stop and send the output instead of continuing if:**
* any migration in the "true" row is false (production is behind in a
  different way, and the order below would need re-checking), **or**
* "FACT: Realtor-started functions present" is not `none` (a partial manual
  attempt exists), **or**
* the collaborator display-name row is false (the 2026-09-19 file would fail
  on a return-type change; it needs a reviewed extra step).

### 2. Apply, one file at a time, in this order

Open each file from `main`, paste the **entire** file, run it, and confirm
"Success" before moving on. If any file errors, stop: its transaction rolls
back entirely, so nothing is half-applied. Send the error.

1. `supabase/migrations/2026-09-16-realtor-started-searches.sql`
2. `supabase/migrations/2026-09-18-people-workspace-draft-select-privileges.sql`
3. `supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql`
4. `supabase/migrations/2026-10-07-invitation-acceptance-conflict-targets.sql`
5. `supabase/migrations/2026-10-07-cobuyer-compare-garage-parity.sql`
6. `supabase/migrations/2026-10-07-onboarding-state.sql`

Skip any file the inventory already showed as applied.

### 3. Verify (read-only)

* Re-run `supabase/production-migration-inventory.sql`: every migration row
  `true`, and "FACT: accept_invitation conflict clause" = `named constraint
  (fixed)`.
* Re-run section 0 of `supabase/cobuyer-journey-production-check.sql`:
  every column `true`.
* Run section 3 of the same file for you and Andrew (see
  `docs/cobuyer-journey-incident.md`).

### 4. Functional checks in the app

* Andrew opens FLH. If his preferences are stranded on his own search, he
  lands on onboarding for your shared search; after it, he's in your homes
  with his own Match.
* A test co-buyer invitation to a fresh account accepts and onboards into
  the shared search.
* As a Realtor account, `/people` loads.
* Account settings saves a name.

## Not done automatically (needs a decision)

* **Andrew's stranded preferences:** see the consent-only template in
  `docs/cobuyer-journey-incident.md`.
* **Names of accounts created during the drift:** names typed at sign-up
  are in `auth.users.raw_user_meta_data` but not in `profiles.first_name`.
  Display already falls back to them where `full_name` exists; otherwise to
  the email-derived name. A one-off backfill is possible but is a data
  change, so it isn't proposed without approval.
* **Pending invitations that failed:** anyone who saw an error accepting an
  invitation can simply open the same link again after the repair, if it
  hasn't expired (7 days). Expired ones need a new invitation.
