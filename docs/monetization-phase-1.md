# Monetization Phase 1 — search entitlement and free-home allowance

Phase 1 adds the entitlement foundation only. **No real purchasing exists yet.** Nothing in
the app can mark a search unlocked; the Unlock and Restore buttons can't grant access.

## Free-tier model

- Each buyer search may admit its **first three unique homes** for free.
- Admitting a **fourth unique home** requires the search to be unlocked with a one-time
  purchase ($6.99, not a subscription). Once a search is unlocked, it can admit unlimited homes.
- The entitlement belongs to the **search**, not to a user, so co-buyers share it.
- The allowance counts homes **admitted**, not homes currently present:
  - Deleting or archiving a home never gives back its slot.
  - Re-adding a property that was admitted before never uses a new slot.
  - A duplicate of an admitted property (the same listing URL or the same address) never uses a slot.

## Unique-home counting

The identity of a property is `public.suggestion_listing_identity(listing_url, address)`. This is
the same normalization Realtor suggestions already use: a lower-cased URL with the query string,
fragment and trailing slashes removed, or `address:<alphanumerics>` when there is no URL. A
property also matches an earlier admission when its normalized **address** matches
(`public.home_address_key`). This means a home first added by URL and later added by hand
with the same address is not counted twice. A home with neither a URL nor an address counts
by its own id.

## Architecture

| Object | Purpose | Client access |
|---|---|---|
| `search_entitlements` | One row per search: `status` free/unlocked, `free_home_limit` (3), `unlocked_at`, `source` (apple/web/admin/promo), `product_id` | none (RLS on, no policies, all grants revoked) |
| `search_entitlement_transactions` | Provider transaction and original-transaction ids, environment, purchaser, verified time. Used for Phase 2 verification and restore. | none |
| `search_home_admissions` | One row per unique property ever admitted to a search: identity, address key, first home (set to null when that home is deleted), source (`buyer_add`, `suggestion_promotion`, `grandfathered`), and whether it counted against the free allowance | none |
| `admit_search_home(...)` | **The single admission gate.** Locks the search's entitlement row (`for update`), then returns `existing` / `unlocked` / `free`, or raises `paywall_required` (SQLSTATE `FL402`) | not executable by any client role |
| triggers `enforce_home_admission_insert` / `_promotion` | AFTER INSERT on non-staged homes, and AFTER UPDATE of `suggestion_staged` true→false. Both call the gate. | fire on every path |
| `get_search_entitlement(search_id)` | Read-only status and free-slot counts, for decision-makers only | authenticated |
| `check_home_admission(search_id, url, address)` | Read-only check before a save, for decision-makers only; advisory | authenticated |
| `record_search_entitlement_unlock(...)` | **The only way to unlock.** Idempotent per (source, provider transaction). Sources `apple` and `web` require a provider transaction id. | **service_role only** |

Enforcement is a database trigger. Every way a home can enter a search is covered: the client's
direct PostgREST insert or upsert (Add Home, URL import, share intake, manual entry), Realtor
suggestion promotion, and any future RPC. A client can't reach an unguarded path. Homes can't
move between searches (`enforce_home_shared_identity`), so a home can't enter a search by
changing its `search_id`. Editing an existing home through an upsert never fires the insert
trigger.

Two simultaneous requests are serialized on the per-search row lock. The second request sees
the first request's admission and receives `paywall_required`. This was verified with two live
sessions.

Client side:
- `src/lib/entitlements.js` reads entitlement status, runs the check before a save, recognizes
  `FL402`, and stores the pending action in `sessionStorage` (`flh:pending-home-admission`).
- `src/lib/purchases.js` holds the provider abstraction. The provider is **unconfigured**, and
  every call returns `unavailable`.
- `src/components/Paywall.jsx` is a bottom sheet on mobile and a dialog on desktop, using the
  approved copy. It appears only when a new unique home is refused. Close it and you return to
  the still-open Add Home form with nothing lost. Restore only re-reads the server's
  entitlement.

## Grandfathering (non-destructive)

The migration backfills a `grandfathered` admission, counted against the free allowance, for
each unique property among existing non-staged homes, taken in `created_at` order. It never
updates or deletes any home.
- More than 3 historical homes: every home stays usable, 0 free slots remain, and the next new
  unique home needs an unlock.
- 0–2 historical homes: the remaining free slots are kept.
- Exactly 3: no free slots remain.

## Realtor behavior

- The Realtor workspace has no limit. `create_realtor_suggestion` inserts **staged** homes,
  which the trigger skips. Suggestions never use a slot.
- A buyer's promotion (`promote_realtor_suggestion`) is an admission. If the search has no
  free slot and isn't unlocked, the RPC fails with `FL402` and the whole transaction rolls back.
  The suggestion stays `pending`, the home stays staged, and provenance, dispositions and
  feedback are untouched. The Suggestions page then shows the paywall and a note that the
  suggestion is still there.
- Promoting a suggestion for a property already admitted uses no slot.
- Realtors can't read entitlement status and gain no new buyer permissions.

## Security boundary

- Buyers can't write any entitlement or admission table, can't call the gate or the unlock
  function, and can't read provider transaction data.
- A buyer can't directly un-stage a home. The existing `homes_update_decision_maker` policy
  excludes staged rows.
- Both read RPCs require `is_search_decision_maker`, so one search can't read another's
  entitlement.
- The three new tables have row-level security on, no policies, and all privileges revoked
  from `public`, `anon` and `authenticated`.
- The SECURITY DEFINER functions use `set search_path = ''`. Their execute grants follow the
  project's existing revoke/grant pattern.
- `service_role` is kept for the unlock function only; it is revoked from the gate, the
  trigger function and the read RPCs.

## Phase 2 StoreKit connection point

1. Add an Apple provider in `src/lib/purchases.js` and register it in `getPurchaseProvider()`.
   On iOS it runs the StoreKit purchase for `SEARCH_UNLOCK_PRODUCT.id`, preferably showing the
   store's localized price.
2. Send the signed transaction to a new server route. The route verifies it with Apple (App
   Store Server API), checks that the caller is a decision-maker of the search, then calls
   `record_search_entitlement_unlock` with a service-role client, passing the transaction id,
   original transaction id, environment, purchaser and purchase time.
3. The provider reports success **only** after `getSearchEntitlement(searchId)` reads back
   `unlocked`. `Paywall.jsx` already works this way: its `onUnlocked` fires only from a
   server read.
4. Resume the preserved intent with `readPendingAdmission()`: save the Add Home form again, or
   call `promoteSuggestion(suggestionId)` again, then call `clearPendingAdmission()`.

## Manual Supabase steps

1. In the SQL editor, run `supabase/migrations/2026-09-30-search-entitlements-phase-1.sql`.
   It is a single transaction and is safe to run again.
2. Check:
   - `select count(*) from public.search_home_admissions;` returns roughly the number of
     distinct existing homes.
   - `select status, count(*) from public.search_entitlements group by 1;` shows every search
     as `free`.
3. `notify pgrst, 'reload schema';` if the new RPCs don't appear right away.
4. To unlock a search by hand (admin or promo), run as service role:
   `select public.record_search_entitlement_unlock('<search id>', 'admin', 'flh_search_unlock');`
5. Deploy the app. If the app ships before the migration, the check before a save returns
   `null` and saves proceed; the database enforces the limit only after the migration runs.
6. `supabase/schema.sql` already lacked migrations from 2026-09-17 onward and doesn't include
   this one. Fresh projects must apply the migrations in order.

## Local verification

`FLH_TEST_PG="-h <socket dir> -p <port> -U postgres" node --test test/monetization-phase-1.test.js`
loads `test/sql/search-entitlements-scaffold.sql` and the migration into a throwaway database.
It runs the scenarios in `test/sql/search-entitlements-scenarios.sql` and a two-session
concurrency check. Without `FLH_TEST_PG` those two tests are skipped.

## Known limitations

- Changing an existing home's address or URL in place to a *different* property is not
  limited. Blocking it would also block typo fixes once the free slots are used up.
- A consumable $6.99 purchase per search can't be restored by StoreKit. "Restore" has to rely
  on our server records, which `get_search_entitlement` already provides.
