# Co-buyer invitation journey: incident notes (2026-10-08)

## What production is running

* **PR #135 merged only the audit document.** It was merged 2026-10-07 19:05 UTC
  at head `3b0694a`; merge commit `9904040` changes one file
  (`docs/onboarding-v2-product-evolution-audit.md`). Every Phase 0/1 fix was
  pushed to the branch *after* that merge and is not on `main`.
* `main` (what Vercel serves) still loads onboarding with
  `getSearch(user.id)`, the account's own search.
* None of the three `2026-10-07-*.sql` migrations exist on `main`. Whether any
  was applied to production by hand is unknown; section 1 of
  `supabase/cobuyer-journey-production-check.sql` answers it.
* A stale client is ruled out. The iOS app loads the live site, and
  `public/sw.js` caches only `/offline.html` and icons, never app code.

## The journey, checkpoint by checkpoint

| # | Checkpoint | On `main` | After this fix |
|---|---|---|---|
| 1 | Membership created (`accept_invitation`) | Depends on the production function body (see below) | ✓ (needs the conflict-target migration) |
| 2 | Shared search becomes active (`setActiveSearch` → `profiles.active_search_id`) | ✓ | ✓ |
| 3 | Onboarding loads for the shared search | ✗ New account: onboarding writes to his own search. Existing account: never asked at all. | ✓ both |
| 4 | Preferences saved to the shared search | ✗ | ✓ |
| 5 | Back in the shared search afterwards (persists across refresh, sign-out, reopen) | ✓ (stored server-side) | ✓ |

Checkpoint 1 on `main`: the repository's current `accept_invitation` has
`on conflict(search_id,user_id)` while returning a `search_id` column, which
stock Postgres rejects (42702). Andrew *was* able to accept, so production
must differ from the repository: either the fix was applied by hand,
production has an older or different body, or `plpgsql.variable_conflict` is
overridden. Section 1 of the check shows which.

## Root causes

1. **Not deployed:** the Phase 0 fix for brand-new co-buyers is not on `main`.
2. **Existing-account gap (on `main` *and* in the Phase 0 code):** onboarding
   completion is account-wide. A co-buyer who had already finished onboarding
   on their own account was routed straight to the shared search's homes with
   no preferences of their own there, so My Search showed blanks and Match was
   empty, and nothing ever asked them to set it up.

## The fix

One predicate, `needsSharedSearchSetup` (`src/lib/supabase/collaboration.js`):
*a co-buyer on the active search who has no preference document of their own
on it.* It is used by both:

* the `(app)` layout gate, which redirects such a co-buyer to `/onboarding`
  (`/account` stays reachable), and
* the onboarding page, which lets a finished account in only in that case
  and otherwise redirects to `/homes`.

Because both use the same predicate, and finishing onboarding always writes
the caller's own document on that search, the two can't loop.

Owners, Realtor memberships, and co-buyers already set up are never affected.
No search is created, no RLS changes, and nothing is copied between searches.

## Data stranded in the wrong search

Affected co-buyers have `prefs_on_own = true` and `prefs_on_shared = false`
in section 3 of the check (or appear in
`supabase/cobuyer-onboarding-placement-check.sql`). **Nothing is lost**: their
preferences are intact on their own search.

After the fix is deployed, the next time such a co-buyer opens FLH they are
asked for their own preferences on the shared search, starting blank. Their
other search keeps its document untouched.

**Optional, with the co-buyer's explicit consent only:** if they want the
preferences they already entered to become their shared-search preferences,
an operator can copy (not move) that one document. It is their own data, it is
inserted only if no shared-search document exists, and the source is
unchanged. Run it before they redo setup. Do not run it without approval.

```sql
-- TEMPLATE — do not run without the co-buyer's explicit approval.
-- Copies the co-buyer's OWN-search preference document to the shared search,
-- only if they have none there yet. The source document is not modified.
begin;
insert into public.search_member_priorities (search_id, user_id, priorities)
select '<shared search id>'::uuid, m.user_id, m.priorities
from public.search_member_priorities m
join public.searches own on own.id = m.search_id and own.user_id = m.user_id
where m.user_id = '<co-buyer user id>'::uuid
  and exists (select 1 from public.search_members sm
              where sm.search_id = '<shared search id>'::uuid and sm.user_id = m.user_id and sm.role = 'co_buyer')
on conflict on constraint search_member_priorities_search_id_user_id_key do nothing;
-- Expect exactly 1 row inserted; otherwise ROLLBACK and investigate.
commit;
```

## Deploying

1. **Migrations** (production Supabase project, SQL Editor). Run each file in
   full, in this order. Each is a single transaction and replaces or adds
   only; no data changes.
   1. `supabase/migrations/2026-10-07-invitation-acceptance-conflict-targets.sql`
   2. `supabase/migrations/2026-10-07-cobuyer-compare-garage-parity.sql`
   3. `supabase/migrations/2026-10-07-onboarding-state.sql`

   Then re-run section 1 of the check: expect `fixed = true` for both
   acceptance functions, `compare_parity = true`, and 2 onboarding columns.
   They are safe to apply before the code deploys: the current production
   code doesn't read the new columns, and the replaced functions keep their
   signatures.
2. **Code:** merge the branch into `main` through a new PR (PR #135 is closed)
   and confirm the Vercel production deployment's commit SHA matches the
   merge commit.
3. **Verify** (below).

## Verifying with real accounts

* Andrew opens FLH (web or iOS). If his preferences were stranded, he should
  land on onboarding ("Step 1 of 3"). Completing it returns him to Ciara's
  homes with his own Match on each home.
* Re-run section 3 of the check: expect `membership_role = co_buyer`,
  `active_is_shared = true`, `prefs_on_shared = true`, `prefs_on_own`
  unchanged.
* Andrew fully closes and reopens the app, and signs out and back in. He
  should land in the shared search each time.
* Ciara opens Compare: Andrew's Match appears for shared homes.
* A fresh test account accepting a new co-buyer invite should go through
  onboarding once, then land in the shared search.
