# Decision ↔ implementation conflicts

**Baseline:** `main` @ `3651f7e` (2026-10-09). This is the 2026-10-09 audit plus the
audit docs; no application code changed since `9032151`.
**In flight:** `claude/charming-bell-i0xo4w` @ `4168309` (unmerged).

## How to read this document

The product direction in [product-decisions.md](product-decisions.md) is
**APPROVED**. This document records where the approved direction meets existing
code that does something different.

- **Approved** labels the owner's decision.
- **Engineering recommendation** labels a proposed approach. Recommendations still
  need technical validation and code review. Any recommendation that changes
  production SQL (constraints, RLS, RPCs, data) needs the owner's **explicit
  approval at the time it is applied**. Nothing here was implemented or applied.

Evidence is cited as `file:line` on `main`. `schema.sql` line numbers refer to the
cumulative snapshot. Where a later migration redefines an object, the migration is
cited.

## New evidence found during this pass

These are facts about *current* behaviour, uncovered while reconciling the
decisions. They don't change any status in the feature inventory. They do make
several decisions bigger than they looked.

| # | Finding | Evidence |
|---|---|---|
| N-1 | Deleting an auth user **cascades to their owned search** (`searches.user_id … on delete cascade`). The search's `search_members`, invitations, priorities, places, Realtor suggestions and notes all cascade from `searches` | `schema.sql:81`, `:360`, `:391`, `:472`, `:1096`, `:2234` |
| N-2 | `homes.user_id` (the *creator*) is `on delete cascade`. **Deleting a co-buyer's account deletes the shared homes that co-buyer added** to the owner's search | `schema.sql:111` |
| N-3 | `homes.search_id` is `on delete set null`. When a search is deleted, homes created by *other* members survive as orphans with `search_id = null`, invisible to everyone | `schema.sql:112` |
| N-4 | Realtor-authored rows use `on delete restrict` (`realtor_suggestions.suggested_by`, `realtor_notes.author_id`, `tour_suggestions.suggested_by`). **Deleting a Realtor account that has authored any of these currently fails** | `schema.sql:2236`, `:2395`, `:2407` |
| N-5 | A Realtor can read **every** `home_member_state`, `search_member_priorities` and `commute_destinations` row for homes and searches they are attached to, regardless of whether that row's author is still a member | `schema.sql:1573-1574`, `:1585-1586`, `:1595-1596` |
| N-6 | `accept_invitation` locks only the **invitation row** (`for update`). Two *different* co-buyer invitations to the same search can be accepted concurrently; nothing serialises on the search or caps the role | `2026-10-07-invitation-acceptance-conflict-targets.sql:53, 69-71` |
| N-7 | One-owned-search assumptions: 13 SQL `searches … where user_id = caller` lookups across `schema.sql` and the migrations (some superseded), and 5 `from('searches') … eq('user_id', …)` lookups in `src/lib/supabase/collaboration.js` | grep counts in [audit-evidence.md](audit-evidence.md#decision-lock-pass-2026-10-09) |
| N-8 | `resolve_display_name` has 7 internal SQL call sites, all inside SECURITY DEFINER functions. The in-flight fix `4168309` adds the **first direct client call** (labelling "<Owner>'s search") | `2026-09-19-account-name-capture-and-realtor-home.sql:117-295`; `4168309` `collaboration.js` |
| N-9 | Legacy shared `homes.status` (default `'Considering'`) still exists alongside personal `home_member_state.status`. Legacy values including "Offer made" and "Under contract" are kept for colour mapping only | `schema.sql:133`; `constants.js:476-482` |
| N-10 | The Vercel bot's comment on docs PR #138 listed the production domain `feelslikehome.app` as the "Preview" for a non-`main` branch. **Unverified.** It may be a bot-display quirk or a real production alias | PR #138 bot comment, 2026-10-09 17:25 UTC |

---

## C-01 — One-owned-search constraint vs automatic ownership succession

- **Decisions:** D-05 (APPROVED), D-03, D-07. Owner question Q-01.

**Current implementation**
- `searches` has `unique (user_id)` (`schema.sql:85`).
- `handle_new_user` creates exactly one search per account (`schema.sql:~229-232`).
- 13 SQL lookups and 5 JS lookups assume `searches where user_id = X` returns at most one row (N-7). Examples:
  - the Realtor→buyer branch of `accept_invitation` (`select s.id … where s.user_id = caller`);
  - `claim_prospective_search`.

**Why it conflicts**
- Succession means setting `searches.user_id` to the surviving co-buyer.
- If that co-buyer already owns a search (they always do: `handle_new_user` gives every account one), the unique constraint rejects the update.

**Engineering recommendation (minimal)**
1. Introduce a notion of the account's **primary** search:
   - add `searches.is_primary boolean not null default true`;
   - replace `unique(user_id)` with a **partial unique index** `(user_id) where is_primary`.
   - Every existing row is `true`, so the constraint is unchanged for every current user.
2. Succession sets `user_id = successor, is_primary = false`. The successor then owns their own primary search **plus** the inherited one. Nothing is merged.
3. Change every one-search lookup in N-7 to add `and is_primary` (SQL) or `.eq('is_primary', true)` (JS). Search access everywhere else already goes through `search_members` / `can_access_search`, and `active_search_id` already supports viewing more than one search.
4. **Alternative considered (rejected for V1):** model ownership as a `search_members` role. That is cleaner long term but touches every RLS policy that calls `is_search_owner`, so the risk is far higher.

**DB / RLS implications**
- One constraint swap.
- About 13 function bodies re-issued with the extra predicate.
- `is_search_owner` is unchanged (`user_id = p_user_id`) and correctly grants the successor owner rights on the inherited search.

**Existing users / migration**
- Additive. All rows default to primary, so there is no behaviour change until a succession happens.
- Preflight (read-only): `select user_id, count(*) from searches group by 1 having count(*) > 1` must return 0.

**Security / privacy**
- The successor gains owner powers: invite, remove member, delete homes.
- They must **not** gain the deleted owner's personal rows; those are deleted (C-02).

**Regression tests (real Postgres)**
- An existing user's primary search is unchanged.
- Succession onto a co-buyer who owns a primary search: both searches are reachable, nothing is merged, `active_search_id` stays valid.
- Every N-7 lookup returns the primary search.
- `accept_invitation` (Realtor→buyer) still targets the primary search.
- A concurrent succession and invitation acceptance.

**Production SQL approval:** **required.** Constraint change plus function re-issue.

**Dependencies / gate:** prerequisite for C-02. Release gate: **before external TestFlight**, because account deletion is required for beta testers and for the public launch.

---

## C-02 — Account deletion vs preserving shared search data

- **Decisions:** D-05 (APPROVED), D-06, D-13. Owner questions Q-02, Q-03, Q-05.

**Current implementation**
- There is no account deletion (AUTH-005).
- Deleting an `auth.users` row directly would:
  - delete the owner's search and cascade everything under it (N-1);
  - delete homes the user created in **any** search, including the co-buyer's shared homes (N-2);
  - orphan other members' homes (N-3);
  - **fail outright** for Realtors who authored suggestions, notes or tour suggestions (N-4).
- Storage objects (home photos) are not covered by any FK.

**Why it conflicts**
- D-05 requires the shared search to survive for the remaining co-buyer, and requires the deleted owner's *private* data to be removed.
- Today's FK graph does the opposite: it destroys the shared data and, for N-2, the survivor's work too.

**Engineering recommendation (minimal)**

A single server-side `delete_account` flow:
- a Next.js route using the **scoped privileged key** (the same class of credential already approved for entitlement writes; needs explicit approval to reuse for deletion);
- a SECURITY DEFINER SQL function doing the data work in **one transaction**;
- `auth.admin.deleteUser` called **last**.

Order of operations:

1. **For each search the user owns:**
   - **Eligible successor exists:** the only co-buyer. Realtors are never eligible (recommended; Q-03).
     - Transfer per C-01 (`user_id = successor`, `is_primary = false` if the successor has a primary search; otherwise `true`).
     - Delete the successor's `search_members` row, since they are now the owner.
     - Reassign `homes.user_id` for the deleted user's homes in that search to the successor, or to a neutral marker (Q-02). This keeps N-2 from deleting shared homes.
   - **No eligible successor** (solo search, or Realtor only): delete the search. The Realtor's membership goes with it. This is the "clearly disclosed deletion path": the UI lists what will be deleted before the user confirms.
2. **For each search the user is a co-buyer on:**
   - remove their membership;
   - delete their personal rows (`home_member_state`, `search_member_priorities`, `commute_destinations`);
   - re-attribute the homes they created (`homes.user_id`) to the search owner, so N-2 doesn't delete shared homes. Their reactions and ratings are deleted; their shared notes/pros/cons text on `homes` stays as part of the shared record. **This needs disclosure in the privacy policy (D-13), or an owner choice (Q-02).**
3. **Realtor-authored rows (N-4):**
   - change the three FKs to `on delete set null`, with the column made nullable and the UI showing "Former Realtor";
   - **or** delete those rows in step 3 before deleting the user.
   - **Recommended:** set null for suggestions (the buyer's promoted home must survive), delete for Realtor notes and tour suggestions (the author's private content).
4. **Personal rows everywhere:**
   - `profiles`, `beta_feedback` (cascade already), invitations sent by the user (cascade already);
   - storage objects under the user's prefix (explicit delete through the Storage API);
   - entitlements: **revoke, never transfer** (rule 7). The entitlement row may be kept with `user_id` nulled if Apple transaction records must be retained. Needs a decision in the FLH+ work.
5. Delete the auth user.

**DB / RLS implications**
- New SECURITY DEFINER function, owner = postgres, executable only by the privileged role (not `authenticated`).
- Three FK changes (N-4).
- Possibly a `homes.created_by` semantics change (Q-02).

**Existing users / migration**
- FK changes are metadata-only.
- No backfill is needed.
- Preflight counts (read-only):
  - Realtor-authored rows per author;
  - homes where `user_id` is not the search owner (co-buyer-created shared homes).

**Security / privacy**
- The privileged key never reaches the client.
- The route re-authenticates (recent sign-in or password re-entry).
- Idempotent and resumable: if `deleteUser` fails after the SQL commits, the next attempt must succeed.
- A deletion audit row records only that the user id was deleted, at what time, with which successor search ids. It holds no personal content.

**Regression tests**
- Solo owner.
- Owner with co-buyer (succession), including a co-buyer who owns a primary search.
- Owner with Realtor only.
- Co-buyer deleting: owner's search intact; homes they created survive, re-attributed.
- Realtor with authored suggestions, notes and tours deletes cleanly; the buyer still sees promoted homes.
- Storage objects removed.
- Retry after a partial failure.
- Every other user's data byte-identical before and after (snapshot diff).

**Production SQL approval:** **required.** FKs and a new function. The privileged key's scope also needs explicit approval.

**Dependencies / gate:**
- Depends on C-01 and C-03 (shared deletion helpers).
- **Platform-required:** Guideline 5.1.1(v) applies to App Store review, not to TestFlight. Recommended gate: **external TestFlight**, because testers are real users.

---

## C-03 — Leave-and-retain vs leave-and-delete personal data

- **Decisions:** D-06 (APPROVED). Owner question Q-04.

**Current implementation**
- Leaving or removing is a plain `search_members` delete (`collaboration.js:790-808`). RLS `search_members_owner_delete` (`schema.sql:382-387`) allows the owner or the member themself.
- Personal rows are **always** retained after leaving.
- The departed member can still `SELECT` their own rows (own-row policy).
- Search Realtors can still read them (N-5).
- Co-buyer projections pick participants from `search_members`, so they correctly ignore departed users.

**Why it conflicts**
- There is no "delete my data" option.
- Retained data is still visible to the Realtor (N-5), which violates "not visible to other members while absent".

**Engineering recommendation (minimal)**
1. Add a `leave_search(p_search_id uuid, p_delete_personal_data boolean)` SECURITY DEFINER RPC that:
   - deletes the caller's membership;
   - when `p_delete_personal_data` is true, deletes the caller's `home_member_state` for that search's homes, plus their `search_member_priorities` and `commute_destinations` for the search;
   - when the caller is the owner, refuses (owners use deletion/succession, not leave).
   - Owner-initiated **removal** keeps today's behaviour (retain), because only the departing person can choose deletion. Removal **notifies** nobody in V1.
2. **Hide retained data:** tighten the three Realtor read policies (N-5) to require the row's author to be a **current decision-maker** on that search, i.e. `is_search_decision_maker(search, row.user_id)`. Departed members' rows then drop out of every other member's view.
3. **Rejoin:** a new invitation plus acceptance restores the membership, and the retained rows become visible and usable again with no copying. This is already true, because rows are keyed by `(home_id, user_id)` and `(search_id, user_id)`.
4. **Edge cases to document and test:**
   - leave-and-retain, then account deletion → data deleted (C-02);
   - leave-and-delete, then rejoin → starts empty;
   - removed by the owner → retained (cannot choose); the member may delete later from Account → "Searches you left";
   - a Realtor leaving → no personal buyer data exists, so this is a membership delete only.

**DB / RLS:**
- One RPC.
- Three SELECT policies re-issued.
- No schema change.

**Existing users:** members who already left have retained rows that become hidden from Realtors once the policies change. That is the desired effect. Preflight: count rows whose author is not a current member.

**Security / privacy:**
- The policy change narrows access only.
- Verify that the realtor roster and other Realtor RPCs don't depend on departed authors.

**Regression tests**
- Each leave mode.
- Retained data is invisible to the owner, co-buyer and Realtor.
- Rejoin restores the data.
- Delete mode removes only that search's rows.
- The owner can't `leave_search`.
- Realtor read paths still work for current members.

**Production SQL approval:** **required.**

**Dependencies / gate:** independent of C-01. Shares deletion helpers with C-02. Gate: **before external TestFlight.**

---

## C-04 — Concurrent invitation acceptance and the one-co-buyer limit

- **Decisions:** D-07 (APPROVED), D-09.

**Current implementation**
- No cap exists. `search_members` only has `unique(search_id, user_id)` (`schema.sql:364`).
- The acceptance lock covers the invitation row only (N-6).
- V1 RPCs pick an arbitrary "other participant" with `limit 1` (COLLAB-011).

**Why it conflicts:** D-07 requires enforcement at the database/acceptance boundary, including concurrent acceptance.

**Engineering recommendation (minimal)**
1. Add a **partial unique index** `search_members (search_id) where role = 'co_buyer'`. This is race-proof by construction: the second concurrent insert fails no matter the transaction timing.
2. In `accept_invitation`, catch `unique_violation` on that index and return a new reason `co_buyer_limit`, leaving the invitation `pending`.
3. When a co-buyer is already present, refuse to **create** a co-buyer invitation, so the owner can't send a doomed link:
   - via a `create_invitation` RPC (also needed for C-05);
   - or via an RLS insert check.
4. UI copy for `co_buyer_limit` on both the owner's and the invitee's side.

**DB / RLS:** one index, an `accept_invitation` re-issue and an invitation-creation guard.

**Existing users / migration**
- **The index creation fails if production already has a search with two co-buyers.**
- Read-only preflight: `select search_id from search_members where role='co_buyer' group by 1 having count(*) > 1`.
- If any rows come back, the owner decides who stays. **Never** delete one automatically.

**Security:** none negative.

**Regression tests**
- Two co-buyer invitations accepted concurrently on two connections: exactly one succeeds.
- Realtor plus co-buyer coexist.
- Re-accepting the same invitation is idempotent.
- A co-buyer invitation is refused while a co-buyer is present.
- After the co-buyer leaves, a new invite works.

**Production SQL approval:** **required.**

**Gate:** **before internal TestFlight**, because invitation acceptance is in the core beta journeys.

---

## C-05 — Email invitations and revocation

- **Decisions:** D-08 (APPROVED), D-09 (APPROVED). Owner question Q-09.

**Current implementation**
- Invitations are a direct client insert under RLS `search_invitations_owner_insert` (`collaboration.js:695-705`; `schema.sql:490-495`).
- The link is copy-only (`InviteCoBuyer.jsx`, `InviteBuyer.jsx`, `ConnectBuyer.jsx`). The UI says "Send connection request".
- There is no UPDATE policy and nothing sets `revoked`. However, `preview_invitation` and `accept_invitation` **already reject** any non-`pending` status, so a `revoked` row is refused server-side once something can set it.
- There is no email provider.

**Engineering recommendation**
1. **Revocation**
   - Add `revoke_invitation(p_invitation_id)`, owner-only (or the inviting Realtor for `realtor_to_buyer`), which sets `status = 'revoked'` only if the invitation is pending.
   - Add a "Pending invitations" list with Revoke, reading through the existing owner select policy.
   - No change is needed to acceptance.
2. **Invitation creation**
   - Move creation into a `create_invitation` RPC. This gives one place for the C-04 cap, for **duplicate handling** (an existing pending invite for the same email and search: return it and refresh its expiry rather than creating a second), and for rate limiting.
3. **Email**
   - A server route (`/api/invitations/send`) that loads the invitation **with the caller's session** (owner RLS), so no privileged key is needed, and sends through the chosen provider.
   - Store `last_sent_at`, `send_count` and `last_send_error` on the invitation, for UI state and QA.
   - Separate **"Send email"** and **"Copy link"** controls, each with distinct success copy.
   - Requires:
     - provider choice (Q-09: e.g. Resend, Postmark or Amazon SES);
     - sending-domain DNS (SPF, DKIM, DMARC);
     - a server-only API key env var;
     - templates for co-buyer, Realtor→buyer and buyer→Realtor.
   - The email contains the same `/invite/<token>` link. Email binding is unchanged.
4. **Supabase Auth email:** configure custom SMTP with the same provider, so auth emails aren't throttled by the default mailer (NOTIFY-001).

**DB / RLS:** two RPCs and three columns. Everything else is additive.

**Existing users:** pending invitations remain valid and gain a Revoke control.

**Security / privacy**
- Send-rate limits per user and per recipient, so this can't be used for spam.
- The token must not leak into analytics or monitoring (redaction rule, D-10).
- The email provider becomes a processor and must be disclosed (D-13).

**Regression tests**
- Revoke, then accept → `revoked`.
- Revoke an accepted invitation → refused.
- Duplicate invite returns the same pending row.
- Send failure stored and shown; Copy still works.
- Wrong-account, expired and self-invite paths unchanged.

**Manual QA:** real inboxes (Gmail, iCloud), spam placement, link opens the app via Universal Links.

**Production SQL approval:** required (RPCs and columns). External configuration: provider account, DNS, env var.

**Gate:**
- Revocation: **before internal TestFlight** (D-09 says "before beta").
- Email: **before external TestFlight**.

---

## C-06 — Onboarding V2 vs existing-user invitation continuation

- **Decisions:** D-02 (APPROVED), D-03.

**Current implementation**
- V1 onboarding: `CURRENT_ONBOARDING_VERSION = 1` (`onboardingFlow.js`).
- V2 step keys exist in `ONBOARDING_FLOWS[2]`, with no screens.
- The protected layout redirects any profile with `onboarding_complete = false` to `/onboarding` (`src/app/(app)/layout.js:25`).
- **On `main`:** an existing account accepting a co-buyer invite was routed through account onboarding again. **`4168309` (unmerged)** adds a separate `shared_search_setup` mode that asks only for the person's own priorities on the shared search and leaves account onboarding fields alone.
- `claim_prospective_search` sets `onboarding_complete = true` for Realtor-started buyers.

**Why it conflicts:** V2 must be the first-run experience, but D-02 forbids forcing already-onboarded users through it. V2 must therefore coexist with:
- the shared-search setup mode;
- the prospective-search claim;
- accounts finished on V1.

**Engineering recommendation**

Treat **account onboarding** (who you are, how FLH works) and **search setup** (your preferences on *this* search) as separate state machines.

| Entrant | V2 behaviour |
|---|---|
| Brand-new account, no invitation | Full V2 sequence |
| Brand-new account arriving by co-buyer invite | V2, with **Who** pre-answered ("with <Owner>"), Basics/Locations/Priorities written to **the shared search**, and Welcome / Tour Discoveries / Import lesson kept |
| Existing account (V1 done) accepting an invite | `shared_search_setup` only (from `4168309`). **Never** full V2 |
| Existing V1 accounts, no invite | **No forced V2.** Optionally an in-app "What's new" or Get Started card |
| Realtor-started buyer (claim) | Confirm screen, then a short V2 subset (Welcome, Import lesson, Match reveal). Owner may simplify |
| Realtor accounts | Realtor entry flow unchanged; no buyer V2 |

- The version bump to 2 applies to **new** onboarding runs only. `onboarding_complete = true` accounts are never re-gated.
- **`4168309` must merge first.** V2 builds on its predicate. Building V2 on `main` without it would re-introduce the incident path.

**DB:** none beyond the existing `onboarding_state` (shipped 10-07; production presence NEEDS VERIFICATION). Locations need C-08-style location areas (P2-02).

**Regression tests**
- Each entrant row in the table above.
- Interrupted V2 resumes.
- An existing account accepting an invite never sees Welcome.
- The V1 → V2 version change doesn't re-gate.
- Shared-search setup writes only the caller's priority row.

**Production SQL approval:** none expected for the screens. Location areas need it.

**Gate:** **before external TestFlight** (D-02). Merging `4168309` plus real-account QA is a **Phase 0** gate.

---

## C-07 — "Offer Submitted" and "Under Contract" lifecycle states

- **Decisions:** D-15 (APPROVED). Owner question Q-08.

**Current implementation**
- Lifecycle is **personal**: `home_member_state.status` takes Saved / Want to Tour / Toured / Archived (`constants.js:476`).
- Favorite and archive are personal.
- A legacy **shared** `homes.status` column (default `'Considering'`) exists, and legacy values ("Offer made", "Under contract") survive only for colour (N-9).
- Compare and Realtor views read the personal state and projections.

**Options**

| Option | Description | Assessment |
|---|---|---|
| A | Add the values to the personal `home_member_state.status` | Wrong semantics: a household makes **one** offer. Each buyer would have to set it, and the two could disagree |
| B | Reuse the legacy `homes.status` | Collides with historical values and old code paths. Confusing |
| C | **A new search-wide nullable field `homes.offer_stage` (`'offer_submitted' \| 'under_contract'`) plus `offer_stage_updated_at` / `offer_stage_updated_by`** | Smallest coherent design. Orthogonal to the personal lifecycle. Visible to all members and the Realtor |

**Engineering recommendation: Option C**
- **Who can set it:** decision-makers (owner and co-buyer) through the existing `homes` update policy. Realtors read only (Q-08). That is consistent with no impersonation and buyer control.
- **Interactions:**
  - **Match:** unaffected.
  - **Compare:** show a badge.
  - **Home card/detail:** a badge plus a set/clear control.
  - **Archive:** remains personal. An archived home keeps its offer stage. Archiving a home that is *Under Contract* shows a confirm warning.
  - **Realtor view:** read-only badge.
  - **Lifecycle signals:** unchanged.
  - **Filters:** add "Offer / under contract".
- **Migration:**
  - Additive nullable columns, so no backfill is required.
  - **Optional, owner choice:** a read-only preflight counts legacy `homes.status in ('Offer made','Under contract')`. If any exist, an approved one-time backfill can set `offer_stage`, leaving `homes.status` untouched.
- **Out of scope (D-15):** contracts, escrow, documents, contingencies, closing.

**DB / RLS:** additive columns; the existing update policy covers writes. Add a `check` constraint.

**Regression tests**
- Set and clear by owner and by co-buyer.
- A Realtor cannot set it.
- Existing personal states unchanged.
- Compare/detail render.
- Archive interaction.
- Match % unchanged with and without an offer stage.

**Production SQL approval:** required (additive migration).

**Gate:** in V1, **before external TestFlight** (Phase 2).

---

## C-08 — FLH+ purchase, collaboration and grandfathering boundaries

- **Decisions:** D-01 (APPROVED) plus locked rules 1–7. Owner questions Q-05, Q-06, Q-07, Q-10.

**Current implementation**
- Nothing exists beyond the reserved analytics event names (`analytics.js:35-39`) and comments stating that entitlements must not live in client-writable `profiles` (`2026-10-07-onboarding-state.sql:23-24`).
- `profiles` is fully own-row writable.

**Why it conflicts / risks**
- D-01 requires a free external TestFlight with **no client-side bypass**, so gating must be server-truth from the moment it exists.
- Rule 4 (per-search unlock) combined with D-05 (succession) produces R-3/Q-05.
- Rule 6 (grandfathering) combined with D-01 produces R-4/Q-06.
- Rule 3's "one meaningful collaborative loop" has no server-checkable definition (Q-07).

**Engineering recommendation**
1. **`entitlements` table**
   - Columns: `user_id`, `product`, `source in ('purchase','grandfather','beta','admin')`, `original_transaction_id unique null`, `status in ('active','revoked')`, `granted_at`, `revoked_at`.
   - **No client write grants.** Owner-read RLS.
   - Writes only via the scoped privileged key in server routes.
2. **`search_has_plus(search_id)`:** a SECURITY DEFINER function returning true if the owner or the co-buyer (never a Realtor) has an active entitlement. All gates call it, so there is never a client-side `isPlus` check.
3. **Server-enforced limits**
   - A `homes` insert guard (trigger or insert RPC) counts **non-staged** homes in the search. A third home requires `search_has_plus` (Q-10: staged Realtor suggestions don't count until promoted).
   - Collaboration gate per Q-07.
   - The guards ship **disabled** behind a server-side flag row until Phase 4, so TestFlight is ungated with no client bypass.
4. **Beta / grandfathering**
   - At monetization go-live, a single auditable migration inserts `source = 'grandfather'` for every account with `created_at < cutoff`.
   - TestFlight QA of the paywall uses accounts created after the cutoff, with Apple sandbox purchases (Q-06).
5. **IAP**
   - A StoreKit 2 plugin (Capacitor) purchases; the server verifies with the App Store Server API.
   - `restore` re-verifies and **never reassigns** a transaction claimed by another account (rule 7). It shows an account-state message instead.
   - App Store Server Notifications V2 → refund or revoke sets `status = 'revoked'`.
6. **Succession (R-3):** entitlements never move. `search_has_plus` is re-evaluated for the new owner.

**DB / RLS:** new table, functions, guards and flag row.

**Existing users:** grandfather migration. The guards must be proven not to block grandfathered users.

**Security:**
- The privileged key is scoped to the entitlement routes (plus account deletion if approved).
- Webhook signature verification.
- Idempotent transaction processing.

**Regression tests**
- Free 1st and 2nd home, 3rd blocked.
- Grandfathered user unaffected.
- Co-buyer with FLH+ unlocks the search for the owner.
- Realtor FLH+ (if ever present) does **not** unlock.
- Restore claimed by another account is refused.
- Refund revokes.
- Guard flag off means no gating.

**Production SQL approval:** required. External: App Store Connect product (**$9.99 non-consumable**, subject to App Store Connect configuration), shared secret / API keys, Server Notifications URL.

**Gate:** **public App Store release.** The entitlement table and grandfather design should land earlier (Phase 4 start) so the TestFlight data model is final.

---

## C-09 — Remote-hosted Capacitor release reliability

- **Decisions:** D-18 (APPROVED), D-17, D-10, D-04.

**Current implementation**
- The app loads `https://feelslikehome.app` remotely (`capacitor.config.js:29-32`).
- No CI (no `.github/`).
- No error monitoring.
- No native offline screen; the service worker is skipped in native.
- `CAPACITOR_DEBUG = true` in `ios/debug.xcconfig`.
- `TARGETED_DEVICE_FAMILY = "1,2"`.
- N-10: a possible production alias on a branch deploy (unverified).

**Why it conflicts / risks**
- Every web deploy instantly changes the installed iOS app, including for App Review.
- A bad merge, or a branch deploy aliased to production, ships to every TestFlight and App Store user with no binary update.

**Engineering recommendation**
1. CI on every PR: tests plus the build.
2. Verify the Vercel production-branch setting is `main` only, and that no non-`main` deploy carries the production domain (N-10).
3. Error monitoring with release tagging.
4. A **native-version header**: the shell sends its version, and the web can show "Please update" for incompatible builds. That lets breaking web changes be staged.
5. A **branded offline screen with Retry**, bundled **inside the binary** (not remote), so it works when the site cannot load (D-17).
6. A Release configuration audit:
   - `CAPACITOR_DEBUG` off;
   - `TARGETED_DEVICE_FAMILY = 1` (D-04);
   - plist keys;
   - privacy manifest.
7. A documented web release checklist: preview QA on a device build pointed at the preview URL (`CAP_SERVER_URL`), then promotion.
8. **App Review 4.2:** document the purposeful native behaviours:
   - Share Extension;
   - Universal Links;
   - native offline/Retry;
   - native loading;
   - keyboard and safe-area handling;
   - (later) IAP.

   This **reduces risk but does not guarantee approval.**

**DB:** none.

**Tests**
- CI itself.
- A native offline screen test on a device (airplane mode, server 5xx, DNS failure).
- A version-gate unit test.

**Production SQL approval:** none. External: Vercel settings, monitoring vendor.

**Gate:**
- CI and the Vercel verification: **Phase 0**.
- Offline/Retry and the Release config: **before internal TestFlight**.

---

## C-10 — Privacy-sensitive display-name resolution

- **Decisions:** D-16 (APPROVED).

**Current implementation**
- `resolve_display_name(p_user_id, p_fallback)` (`2026-09-19-…sql:89-108`) is executable by `authenticated` for **any** user id.
- It returns the profile name, or the auth metadata name, or the email local part.
- 7 internal SECURITY DEFINER callers (N-8): roster, suggestion creation, Realtor note, tour suggestion, prospective invite, collaborator context, connection request.
- `4168309` adds a client caller (the owner's name for "<Owner>'s search").
- The membership helpers `is_search_owner` / `is_search_member` / `can_access_search` / `can_access_home` / `is_search_realtor` / `is_search_decision_maker` also accept arbitrary user ids (T-12).

**Why it conflicts:** D-16 limits lookups to authorized relationships.

**Engineering recommendation (narrow migration plan — not executed)**
1. Rename the current body to an **internal** `_resolve_display_name_unchecked(uuid, text)`, with `revoke execute … from public, authenticated, anon`. Re-point the 7 internal callers to it. They already enforce their own authorization.
2. Re-issue the public `resolve_display_name(uuid, text)` as a wrapper that returns the name only when the caller is that user, **or** shares a search with them (owner, co-buyer or Realtor via `search_members` / `searches`), **or** has a pending invitation relationship with them. Otherwise it returns `p_fallback`.
3. The `4168309` client call (owner of a search the caller belongs to) satisfies rule 2, so no client change is needed.
4. Membership helpers:
   - revoke `execute` from `authenticated` where RLS policies don't need them directly. Policies run as the table owner, but the helpers are invoked as the caller, so **verify each policy's dependency before revoking**;
   - or add `p_user_id = auth.uid()` guards.
   - This is the riskiest sub-step and can ship separately.

**Migration / existing users:**
- No data change.
- Read-only preflight: `production-function-fingerprints.sql` confirms the deployed body matches the 09-19 definition before replacing it.

**Regression tests**
- An unrelated user gets the fallback.
- Co-buyer, owner and Realtor get names.
- Invitation preview shows the inviter's name.
- All 7 internal callers unchanged (output snapshot).
- The `4168309` label test passes.

**Production SQL approval:** **required.**

**Gate:** before **external TestFlight**. The privacy policy and App Privacy answers depend on it.

---

## Owner questions

Each has a recommended default. These are implementation rules the approved
decisions leave open, **not** reopened decisions.

| ID | Question | Recommended default | Blocks |
|---|---|---|---|
| Q-01 | Succession onto a co-buyer who owns a primary search | Allow a second, non-primary owned search (C-01) | C-01, C-02 |
| Q-02 | Shared homes created by a deleted or departed member | Keep them in the search, re-attributed to the owner; delete the member's personal state; keep shared notes text, disclosed in the policy | C-02, C-03 |
| Q-03 | Can a Realtor be a successor? | No. Buyers only | C-02 |
| Q-04 | Retention period for leave-and-retain | Until rejoin or account deletion; no time limit in V1 | C-03 |
| Q-05 | Collaboration unlock after succession when no remaining buyer has FLH+ | Unlock follows the live rule: re-evaluated, so it can be lost. Show the survivor a clear message | C-08 |
| Q-06 | Grandfathering and beta model | Cutoff = monetization go-live. All accounts before it get `grandfather`. Paywall QA uses post-cutoff sandbox accounts | C-08 |
| Q-07 | Definition of the "one free collaborative loop" | Free until the shared search has 1 home with both buyers' Match, then collaboration actions on additional homes need `search_has_plus` | C-08 |
| Q-08 | Who may set the offer stage | Buyers (owner and co-buyer) only | C-07 |
| Q-09 | Email provider and sending domain | A transactional provider with good deliverability (e.g. Postmark or Resend) on a subdomain such as `mail.feelslikehome.app` | C-05 |
| Q-10 | Do staged Realtor suggestions count toward the 2 free homes? | No, until promoted | C-08 |
