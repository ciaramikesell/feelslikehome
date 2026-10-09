# Existing accounts accepting invitations; switching between searches (2026-10-09)

## What happened (production report)

Account A (onboarded, own search with preferences and homes) accepted Account
B's co-buyer invitation, was sent through onboarding again, ended in B's
search, and A's own search and homes seemed to be gone.

## Root cause: hidden, not deleted

Accepting writes exactly two things: a `search_members` row
(`accept_invitation`) and `profiles.active_search_id` (`setActiveSearch`).
Setup then writes only A's own preference document *on B's search*. A's
search, homes, personal ratings and preferences are never touched
(`test/multi-search-invitation-db.test.js` asserts they're unchanged, row
for row). Three presentation problems made them look lost:

1. **The wrong setup experience.** The gate correctly saw "co-buyer with no
   preferences on this search" but reused first-time *account* onboarding
   ("Let's find what feels like home", Step 1 of 3), whose finish also
   rewrote account-level onboarding fields.
2. **An invisible way back.** The only route to A's own search was a small
   native `<select>` labelled "My Search / Shared Search". "My Search" is
   also the preferences page, so the label was ambiguous.
3. **Switching didn't fully switch.** It only called `router.refresh()`.
   Pages that copy server data into client state (`HomesBoard`,
   `MySearchPanel`) could keep showing the previous search's homes and
   preferences.

## Five concepts, kept separate

| Concept | Stored in | Changed by |
|---|---|---|
| Account-level onboarding completion | `profiles.onboarding_complete` (+ version/state) | First-time account onboarding only |
| Search-specific preferences | `search_member_priorities (search_id, user_id)` | That person, on that search |
| Owned search | `searches.user_id` | Never by invitations or switching |
| Active search | `profiles.active_search_id` | Accepting an invitation; the switcher |
| Co-buyer / Realtor searches | `search_members (search_id, user_id, role)` | `accept_invitation`; removal |

## The fix (no schema change)

* `/onboarding` has two modes. **Account onboarding** is unchanged.
  **Shared-search setup** is shown only to an already-onboarded co-buyer with
  no preferences of their own on the active search:
  * titled "Set up your preferences for Bea's search";
  * starts from their own empty document (nothing copied from any search or
    person);
  * never writes account onboarding state;
  * finishes on that search's Homes;
  * offers "Not now—go to your own search".
* **Search switcher:** a clearly named chip in the header ("Bea's search"),
  opening FLH's bottom sheet. It lists every owned and member search with its
  role and marks the current one. Switching only changes
  `profiles.active_search_id`, then opens that search's Homes.
* **Per-search remount:** `AppShell` keys page content by the active search,
  so homes, preferences, collaborators and Match always belong to the
  search shown.
* **Labels:** `getAccessibleSearches` names searches by owner ("Your search",
  "Bea's search") using the existing `resolve_display_name` RPC, with
  generic fallbacks.

Unchanged: accept/membership RPCs, RLS, Realtor workflows, Match
calculation, stale active-search fallback (`resolveActiveSearch` already
returns the owned search when the active one is no longer accessible).

## Verifying an account in production (read-only)

`supabase/account-searches-check.sql`: put the account's user id in, and it
lists every search the account owns or belongs to, with relationship,
whether it is active, its home count, the account's own home states there,
and whether the account has its own preferences there. No names, emails or
preference contents are returned.
