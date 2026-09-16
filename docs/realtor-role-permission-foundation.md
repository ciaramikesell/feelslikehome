# PR #78 — Realtor role and permission foundation

## Architecture audit (before implementation)

### Ownership and collaboration

- `searches.user_id` is the owner. The unique constraint still gives every account one owned search, while `profiles.active_search_id` lets the account work in another accessible search.
- Accepted collaborators are rows in `search_members`; before this change every row had the undifferentiated `member` role and every membership passed `can_access_search`.
- Invitations are opaque, email-bound, expiring `search_invitations` rows. Authenticated SECURITY DEFINER RPCs preview and atomically accept them. Sign-in/sign-up preserve the same-origin `/invite/<token>` continuation.
- `/homes?url=` is preserved through authentication and opens existing consumer intake. It is not a suggestion model, and this PR does not repurpose it.

### Shared truth and participant state

- `homes` contains shared property facts and also shared `notes`, `pros`, and `cons`. This differs from the product prompt's participant-owned-note assumption. Moving those fields would be destructive and belongs in the later attributed-contribution design, so #78 protects them from Realtor writes without changing their semantics.
- `search_member_priorities`, `home_member_state`, and `commute_destinations` are participant-owned. Home state contains lifecycle/status (including archive), Favorite, Want to Tour, reaction/Overall Feeling, tour time, ratings, checks, and rejection reason.
- Match is computed from the viewing decision-maker's priorities and the shared home facts. Cross-buyer Compare and lifecycle RPCs deliberately project limited signals rather than merging opinions.
- Archived homes remain ordinary shared `homes` rows; archive is participant state. The global archived conclusion is calculated across decision-makers.

### Existing authorization and concrete risks

- RLS isolated searches by owner or accepted membership, but treated every member as equivalent for shared-home insert/update.
- Participant tables were own-row write-only, but their write checks used generic search access. A new Realtor membership would therefore have been able to create Realtor-shaped priorities, lifecycle, Favorite, WTT, rating, and commute rows and would have been counted as a buyer by Match/lifecycle RPCs.
- Shared home editing included shared notes/pros/cons and objective facts, so generic member access would have let a Realtor alter buyer context or add a normal contender.
- The direct owner membership-insert policy could bypass invitation acceptance. It is removed; membership establishment is now only through the email-bound RPC.
- Existing RPCs assumed one owner plus one equivalent member. Realtor rows must be excluded from buyer calculations and collaborator projections.

## Chosen design

`search_members.role` is the relationship-scoped authority with exactly `co_buyer` and `realtor`; ownership remains `searches.user_id`. Existing `member` rows migrate to `co_buyer`, preserving behavior. `search_invitations.relationship_type` carries the intended relationship and defaults/backfills to `co_buyer`.

Two database helpers separate visibility from decision authority:

- `can_access_search`: owner, co-buyer, or Realtor may read the shared search.
- `is_search_decision_maker`: owner or co-buyer may mutate decision state.
- `is_search_realtor`: grants near-transparent read policies for participant priorities, home state, and commute context.

Realtors can read shared searches/homes (including homes archived by a buyer) and decision-maker rows. They cannot insert/update participant decision rows, add/edit homes, change priorities/Match inputs, or enter buyer lifecycle state. Co-buyer RPCs filter membership to `co_buyer`, so a Realtor never changes Match or archive conclusions.

This is the smallest safe extension: no global account role, parallel Realtor tables, suggestion entity, brokerage concept, Realtor Match, or future UI is introduced. Future Realtor suggestions/notes should be separate attributed rows keyed by search/home plus Realtor user id. Future suggestion disposition should be a separate `(suggestion_id, decision_maker_user_id)` relation, which this search-scoped membership design supports without reinterpretation.

## Migration and operations

Apply `supabase/migrations/2026-09-16-realtor-role-foundation.sql` after all earlier migrations. It is additive except for replacing policies/functions and updating only role/default metadata:

1. Existing `search_members.role = 'member'` becomes `co_buyer`.
2. Existing invitations receive `relationship_type = 'co_buyer'`.
3. Constraints then permit only `co_buyer` or `realtor`.
4. Policies and RPCs are replaced atomically in one transaction.

Rollback risk: reverting application code before database policy rollback would leave new `realtor` values unknown to old code. A rollback must first revoke/remove Realtor memberships or map them deliberately, restore the prior RPCs/policies, then restore the old constraint. Never map Realtors to legacy `member`, because that grants buyer mutation authority.

There is no Vercel configuration, environment-variable, native shell, Universal Link, Share Extension, importer, or listing-intake deployment change. The database migration must be deployed before the application.

## Permission matrix

| Resource | Realtor read | Realtor write |
| --- | --- | --- |
| Search metadata/shared homes, active or archived | Allowed in joined search | Forbidden |
| Buyer/co-buyer priorities and Match inputs | Allowed in joined search | Forbidden |
| Buyer/co-buyer home state (Favorite, WTT, reaction, Overall Feeling, ratings, archive) | Allowed in joined search | Forbidden |
| Buyer/co-buyer commute context | Allowed in joined search | Forbidden |
| Membership/invitation | Own membership visible/leave allowed; owner manages invitations | Cannot create/alter another participant |
| Another search | Forbidden | Forbidden |
| Future Realtor-attributed suggestion/note | Not implemented | Not implemented |
