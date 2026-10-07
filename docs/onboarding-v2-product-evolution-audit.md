# Onboarding V2 / FLH+ product evolution — audit and implementation plan (2026-10-07)

Status: **audit + proposal only**. No application code, schema, RLS, or RPC is
changed by this document. Decisions marked **DECISION** need product sign-off
before the phase that depends on them starts.

Baseline at audit time: `npm test` → 636/638 pass. The two failures
(`capacitor-foundation`, `native-presentation-v1`) are environmental
(`@capacitor/core` not installed in the container), not regressions.

---

## Part 1 — Audit of the current implementation

### A. Onboarding architecture

| Piece | Where | Notes |
|---|---|---|
| Route | `src/app/onboarding/page.js` | Server component. Redirects to `/homes` when `profiles.onboarding_complete`. Loads the user's **owned** search via `getSearch(user.id)` (see bug below). |
| UI | `src/components/onboarding/Onboarding.jsx` | 3 steps + Ready: **Basics** (search type: Home to Buy / Home to Rent / Apartment to Rent; budget, min beds, min baths, sqft, lot, property types, layout, condition) → **What Matters** (criteria chips from the canonical catalog, all start Important; custom criteria) → **Rank** (`RankBoard`, Must Have / Important / Nice to Have, garage qualifier) → **Ready** (`/homes?add=1` or `/search?welcome=1`). |
| Domain | `src/lib/onboarding.js`, `src/lib/searchProfile.js` | Suggestions are derived from `getItemlistCategories` (one shared taxonomy with My Search). |
| Persistence | `useReliableOptimisticState` → `savePriorities` | Every change autosaves to the caller's `search_member_priorities` row, so data survives interruption. |
| Step state | React `useState` only | **Not persisted.** Reload/background-kill restarts at step 1 (data intact, position lost). |
| Completion | `profiles.onboarding_complete boolean` | The only onboarding state. No version, no step, no answers about collaboration. |
| Gate | `src/app/(app)/layout.js` | Redirects incomplete profiles to `/onboarding?redirect=…`; Realtor-entry accounts bypass for `/people` + `/realtor`; `/account` always opens. Pending share-intake destination survives onboarding. |
| Name | `AuthForm` (sign-up) → `profiles.first_name/last_name` (2026-09-19 migration) | Name is **already required at sign-up**; legacy accounts get a dismissible name prompt in `AppShell`. |
| Post-onboarding education | `AppShell` `MobileFirstRunTour` (coach marks, `localStorage` dismissal) | No checklist / Get Started. |

**Bug found — co-buyer onboarding writes to the wrong search.** An invited
co-buyer accepts (`AcceptInvitationClient` → `accept_invitation` →
`setActiveSearch(shared)`), lands on `/homes`, is gated to `/onboarding`
(their `onboarding_complete` is false), and `onboarding/page.js` loads
`getSearch(supabase, user.id)` — the co-buyer's own auto-created, unused
search — instead of `resolveActiveSearch`. Their onboarding priorities are
saved to that dormant search; on the shared search they have no priority
document, so their Match is empty until they rebuild it in My Search. This
directly undermines "co-buyer creates their own preferences" and should be
fixed first (Phase 0).

### B. Preference / data model

* One JSON document per **(search, participant)** in
  `search_member_priorities` (RLS: own row read/write for decision-makers;
  Realtor read). Legacy `searches.priorities` is column-revoked and never
  read (pass 3c3).
* Shape (`defaultPriorities`/`normalizePriorities` in `src/lib/constants.js`):
  * Structured facts, each `{ value|values, tier }`: `budget` (max),
    `bedsMin`, `bathsMin`, `sqftTarget`, `lotSizeTarget`,
    `preferredPropertyTypes`, `homeLayout`, `homeCondition`,
    `primaryBedroomLocation`, `secondaryBedroomLocation`.
  * Criteria families `location`, `features`, `exterior`, `homeFeel`, each
    `{ customItems, tiers: {label: tier}, order, hiddenCore }`. Durable
    identity is `category:label`; display overrides and legacy alias folding
    are in-memory only.
  * Private hints: `searchType`, `onboardingSearchType`,
    `exterior.garagePreference` (any/attached/detached — informational).
* Tiers: `must` 4 / `important` 2 / `nice` 1 / `dontcare` 0.
* **Garage already exists** as the weighted `exterior:Garage` criterion,
  scored from the shared `homes.garage_spaces` fact, plus the
  attached/detached qualifier. No new concept is needed to put it on a
  Basics screen.
* Beds/baths are **minimums** (`>=` scoring with partial credit), not
  "ideal". Changing to "ideal" would silently reinterpret existing data.
* Criterion metadata registry: `criterionMetadata()` → `evaluationMode`
  (`pre_tour` | `tour`) and property-type applicability.
* Purchase intentionally offers **no** tour-mode criteria (Home Feel and
  experiential exterior items are retired from purchase Match). Rental and
  investment still offer them.
* Personal per-home evaluation: `home_member_state` (status, reaction,
  toured_at, favorite, `ratings`, `checks`) — own-row writes only.
* Post-Tour Take V2: four fixed evaluations under reserved `tour-v2:*` keys
  in personal `ratings` (Curb Appeal, Layout, Privacy, Neighborhood),
  deliberately **outside** Match.
* "Places that matter" = `commute_destinations` (participant-owned table,
  Google Routes evaluation into the `location:Commute` criterion).

### C. Match-score calculation

Two implementations that must agree:

1. `computeMatch` (`src/lib/matching.js`) — client, for the caller.
2. `resolve_cobuyer_compare_perspectives` (SQL, latest definition in
   `2026-09-18-tour-evaluations.sql`) — SECURITY DEFINER projection of the
   **other** participant's Match for Compare; returns only sanitized
   pct/counts/different takes.

Semantics today:

* `pct = Σ(score × weight) / Σ(weight)` over criteria that are **evaluated
  and numerically scored**. Unknown criteria are pushed as
  `evaluated:false` and are **excluded from the denominator**.
* Numeric facts get partial credit (budget over-by-%, beds/baths/sqft/lot
  ratio). Check criteria: `true` = met, `'no'` = confirmed miss, historical
  `false`/absent = **Unknown** (explicitly "UNKNOWN MUST NOT PRODUCE
  MISSING").
* Tour responses: positive = 1, negative = 0, neutral = evaluated but
  unscored; unanswered = Unknown. Once answered they blend into the same
  `pct`.
* Presentation helpers already split groups: `summarizeForCard` →
  `matches / missing / notConfirmed / preTourUnknown / afterTour`;
  `mustHaveStatus` counts confirmed misses only; `matchFactualSummary`
  says "N Must-Haves still unknown" rather than failing them.

**Conclusion:** "Unknown never lowers Match" is **already implemented** in
both scorers. What is missing is (1) an explicit *Pre-tour* label, (2) a
coverage signal (a 100% built from 1 of 9 known criteria is honest math but
misleading at a glance — `evaluatedCount/selectedCount` exist but are not
prominent), and (3) separation of after-tour evaluations from the pre-tour
number.

### D. Location representation

* **No area concept exists.** There are no cities, regions, school
  districts, or rankings in the preference model.
* Location criteria are check-kind chips (`Reputable Schools`,
  `Walkable to Town`, `Parks nearby`, `Quiet street`, …) answered per home by
  each participant (personal Yes/No/Unknown).
* Homes store `address` (free text), `latitude/longitude` +
  coordinate status (RentCast / geocoding), no structured `city`, `state`,
  `postal_code`, or `county`. `homes.school_district` is a legacy column that
  is never read or written.
* RentCast property records include structured city/state/ZIP/county, but
  `normalizeRentCastFields` (`src/lib/rentcast.js`) does not keep them
  (verify against a live response before relying on it).
* Listing-URL parsers (`src/lib/listingUrl.js`) already split
  street/city/state/ZIP for Redfin and Realtor.com; Zillow/Homes.com are
  heuristic.

### E. Collaboration / member architecture

* `searches` — one owned search per user (`unique(user_id)`), auto-created by
  `handle_new_user`. Owner is implicit (`searches.user_id`).
* `search_members(role in ('co_buyer','realtor'))`. Owners cannot insert
  members directly; membership is created only by `accept_invitation`.
* `search_invitations` — email-bound token, `relationship_type`,
  `invitation_direction` (`buyer_to_realtor` / `realtor_to_buyer`),
  prospective searches for Realtor-started clients.
* Helpers: `is_search_owner`, `is_search_member`, `can_access_search`,
  `can_access_home`, `is_search_realtor`, `is_search_decision_maker`.
* Shared vs personal split: shared property facts on `homes` (column-level
  grants, `enforce_home_shared_identity` trigger); personal state in
  `home_member_state`; personal priorities in `search_member_priorities`.
* Cross-participant reads go **only** through SECURITY DEFINER projections:
  `resolve_shared_fact_priority_awareness` (booleans),
  `resolve_cobuyer_compare_perspectives` (other person's Match),
  `resolve_cobuyer_lifecycle_signals`, and
  `resolve_collaborator_search_context` (returns the other co-buyer's
  **full priorities JSON**, places, statuses, display name — currently
  rendered only as a count summary in My Search).
* V1 limit: one co-buyer. Several RPCs pick "the other participant" with
  `limit 1`. Co-buyer + Realtor works; two co-buyers does not.
* There is no record of *intent* to collaborate — only actual membership.

Implications for the brief:

* "Andrew's Match" for a home **already exists** (Compare, via RPC).
* "Mine | Theirs" and "Add to mine" can be built on
  `resolve_collaborator_search_context` + the caller's own
  `savePriorities` — no RLS change, never writes the other person's row.
* "Ciara cannot answer for Andrew" is already enforced: `home_member_state`
  and `search_member_priorities` writes require `auth.uid() = user_id`.

### F. Realtor architecture

Search-scoped `realtor` membership; Realtor reads priorities/personal state
but every buyer-state write requires decision-maker + own row. Suggestions
live in `realtor_suggestions` with `suggestion_dispositions` and are made
contenders only by buyer `promote_realtor_suggestion` (staged homes keep
provenance via `suggestion_staged` + listing import). Realtor notes and tour
suggestions are RPC-only writes. Realtor workspace (`/people`, `/realtor`)
bypasses buyer onboarding via `account_entry_intent = 'realtor'`.
Onboarding V2's "With a Realtor" option must reuse `search_invitations`
(`relationship_type = 'realtor'`) — no parallel membership concept.

### G. Import / share-extension flow

* Add Home (`HomeModal`) → paste URL → `extractAddressFromListingUrl` →
  `POST /api/import-listing` (RentCast, signed-in only) → review
  ("What FLH Found", immutable `homes.listing_import` snapshot).
* Sources with explicit parsers: **Zillow, Redfin, Realtor.com, Homes.com**
  (sale); **Apartments.com, Rent.com, Zillow apartments**, official
  community sites (rental). Anything else falls back to a generic slug
  parser. **Trulia is not explicitly supported** — the education screen must
  not name it.
* iOS: `ShareExtension` target (`app.feelslikehome.mobile.share`) accepts a
  URL/plain text, builds `https://feelslikehome.app/homes?url=<encoded>`,
  opens it as a Universal Link; `DeepLinkBridge` routes it into the
  `/homes?url=` intake; signed-out/onboarding users keep the destination.
* No in-app help explains the share sheet today.

### H. FLH+ / paywall / IAP

**Nothing exists.** No entitlement table, no StoreKit plugin, no web
payment provider, no paywall UI. `AccountSettings.jsx` explicitly states
there is no paid-access entitlement. The iOS app is a **remote-hosted**
Capacitor WebView (`server.url = https://feelslikehome.app`), so purchases
need a native StoreKit 2 bridge plus server-side verification. The project
deliberately uses only the publishable Supabase key; entitlement writes
cannot be client-writable, so this is the first place a server-only
privileged credential would be needed (see §10).

`profiles` has a blanket own-row UPDATE policy with no column grants, so
**entitlement must never live on `profiles`**.

### I. Analytics / events

None. No vendor SDK, no event table, no `track()` helper. The only
user-to-team channel is `beta_feedback` (insert-only RLS, column grants) —
a good pattern to copy for a first-party event sink.

### J. Existing-user migration risks

1. Every existing account has `onboarding_complete = true` and no version —
   any new gate keyed only on new fields would force them through V2.
2. Priority JSON is live production data with legacy labels, retired
   built-ins, alias folding, and historical boolean `false` = Unknown.
   Nothing may be renamed or rewritten in bulk.
3. Two Match implementations (JS + SQL) — any scoring change must land in
   both or co-buyer Compare will disagree with the caller's own number.
4. `homes` uses column-level grants and a shared-identity trigger — new home
   columns need explicit grants, `HOME_SHARED_COLUMNS` updates, and trigger
   review.
5. Beta users currently get all collaboration and Compare for free;
   gating them later is a regression unless they are grandfathered.
6. Rental/investment homes with recorded tour ratings: separating
   after-tour evaluations from the headline number would change their
   displayed %.
7. Co-buyers onboarded under the bug in §A may have priorities on their
   dormant owned search and none on the shared one.

---

## Part 2 — Classification of the brief

**Already implemented**
* Unknown ≠ bad in Match (both scorers); confirmed miss only from explicit
  "No" or known numeric facts.
* Three-tier Must Have / Important / Nice to Have with weights.
* Independent, participant-owned co-buyer preferences and personal home
  state; no impersonation (RLS + own-row writes).
* Other participant's Match per home (Compare RPC).
* Garage as a weighted criterion + attached/detached qualifier.
* Name capture (required at sign-up).
* Share extension, Universal Link intake, share-before-sign-up continuity.
* Realtor roles, suggestions lifecycle, provenance, buyer promotion.
* Tour-mode metadata and semantic tour responses.

**Partially implemented**
* Onboarding (3 steps; no welcome/value, collaboration, location, tour, or
  import-education screens; no persisted step).
* Tour Discoveries (metadata + fixed four post-tour evaluations; no
  per-user watchlist; after-tour answers blend into the same %).
* Location (only commute "Places that matter" + check-kind chips).
* Collaborator preference viewing (data available, UI shows counts only).
* Post-onboarding education (coach-mark tour only).

**Incompatible as written / needs adaptation**
* "Ideal beds/baths" → keep existing **minimum** semantics; label "At least".
* Name on the Basics screen → prefilled from sign-up; ask only if missing.
* "Not per household" vs. shared-search features → needs a rule for whose
  entitlement unlocks a shared search (**DECISION 1**).
* Web purchase → no payment provider exists; Apple requires IAP for the
  in-app unlock (**DECISION 2**).
* Entitlement writes vs. "publishable key only" → needs a narrowly scoped
  server credential (**DECISION 2**).
* Multiple co-buyers → V1 RPCs assume one; keep "a co-buyer" singular.
* Trulia → not supported; do not list it.

**Unnecessarily risky now**
* Automatic school-district evaluation (no data source) and any GIS
  boundary/proximity logic.
* Bulk SQL migration of priority JSON.
* Hard DB-enforced home caps before the entitlement system is proven.
* Gating features existing beta households already use.
* Rewriting Match math (vs. relabeling and separating phases).

**Defer**
* Polygon / proximity micro-areas, school-district lookups (NCES/ATTOM),
  multi-co-buyer, Stripe/web checkout, Realtor-side monetization,
  admin-managed criteria catalog, multi-search per user.

---

## Part 3 — Proposals

### 1. Recommended onboarding sequence

One decision per screen, persisted step, Back always preserves answers.

| # | Screen | Content | Writes |
|---|---|---|---|
| 1 | **Welcome** | One sentence of value ("FLH helps you figure out what fits — not just save listings.") + the three search-type cards as the call to action. | `searchType`, `onboardingSearchType` (existing `applySearchChoice`) |
| 2 | **The basics** | "What should we call you?" (prefilled first name; required only if missing), budget (currency field), beds + baths (steppers, "at least"), garage (segmented: No need · Nice · Important · Must; attached/detached appears once chosen). "More details" disclosure: sqft, lot, property types, layout, condition. | profile name; existing structured priorities; `exterior:Garage` tier via existing `setGaragePreference`/`selectPriorityItem` |
| 3 | **Where are you looking?** | Add areas (search a town, name a group of towns, add a school district, describe a specific area); drag/arrow to rank: First choice / Would consider / Fallback. Copy explains that some areas can't be checked automatically yet. | `locationAreas` (§5) |
| 4 | **Who are you searching with?** | Just me · With a partner or co-buyer · With a Realtor · Both. | `profiles.onboarding_state.collaboration` |
| 4b | *(collab only)* **Everyone gets their own list** | "You don't have to agree on everything." Mine / theirs / the shared picture illustration. Optional invite (co-buyer email, Realtor email) via existing invitation paths, or "Later". | `search_invitations` (existing) |
| 5 | **What matters to you?** (2 short screens) | Existing chip catalog split into *Around the home* (location) and *The home itself* (features + exterior). Copy: "Just yours — not a compromise." | existing criteria |
| 6 | **Sort them** | Existing `RankBoard` (Must Have / Important / Nice to Have). | existing tiers |
| 7 | **Some things you'll only know on tour** | Shows in-person items (light, layout flow, street noise, room scale, yard usability, "does it feel right?"). Optional "remind me to notice" picks. Explicit: these never lower a home's pre-tour Match. | `tourWatchlist` (§6) |
| 8 | **Bring your homes in** | iOS: animated 4-step share sheet lesson (find a home → Share → Feels Like Home → it's here), including "tap More and turn on Feels Like Home" for first use. Web: paste-a-link lesson. Names only supported sources. CTA "Add your first home" → `/homes?add=1&first=1`; secondary "I'll do it later". | `onboarding_completed` |
| — | **First Match reveal** (after first import, not part of the stepper) | Full-screen sheet: Pre-tour Match, what matched, what's unknown, what you'll learn on tour. | — |

Rental/apartment paths use the same skeleton with their existing
suggestion groups; Realtor-entry accounts keep bypassing buyer onboarding.

### 2. Branching logic

* Step 1 choice drives taxonomy (unchanged `applySearchChoice`).
* Step 4 = **Just me** → skip 4b; Get Started omits invite tasks; no
  collaboration copy anywhere in onboarding.
* Step 4 = co-buyer and/or Realtor → 4b with only the relevant invite
  fields; Get Started includes the matching invite task.
* **Invited co-buyer** (arrives via accepted invite): skip Step 4 (already
  collaborating), show 4b as "*{Owner} invited you. Your list is yours.*",
  skip the share-sheet lesson's "first home" CTA if the search already has
  homes ("See how {N} homes look through your eyes").
* **Realtor-started buyer** (`claim_prospective_search`): their draft is
  prefilled; onboarding confirms rather than re-asks.
* Pending share-intake redirect: unchanged — finishing goes straight to the
  shared listing.
* Existing users (§11) never enter V2.

### 3. Database / schema changes (all additive)

| Change | Purpose | Security |
|---|---|---|
| `profiles.onboarding_version smallint null`, `profiles.onboarding_state jsonb not null default '{}'` | Step for resume, collaboration intent, started/completed timestamps, Get Started dismissal & "seen" tasks, paywall dismissals. | Own-row update (existing policy). Non-security data only. |
| `homes.city`, `homes.state_code`, `homes.postal_code` (nullable text) | Evaluate city/town areas. Filled from listing parse / RentCast; derived from `address` client-side when null. | Add to column grants, `HOME_SHARED_COLUMNS`, shared-identity trigger review. |
| `account_entitlements` (new) | FLH+ ownership (§10). | RLS select-own only; **no** insert/update/delete grants to `authenticated`. |
| `product_events` (new, optional) | First-party analytics sink (§12). | Insert-own only, no select, column grants — copies `beta_feedback`. |
| SQL: `resolve_cobuyer_compare_perspectives` update | Mirror any Match changes (areas, phase split). | Same signature, same access check. |

No change to `search_members`, `search_invitations`, role checks, or
existing policies.

### 4. Preference model changes

Inside the existing participant JSON document (no table change, read by
existing projections automatically):

```jsonc
{
  "locationAreas": { "tier": "important", "areas": [ /* §5 */ ] },
  "tourWatchlist": ["homeFeel:Natural Light", "exterior:Noise Level"],
  "prefsVersion": 2
}
```

`normalizePriorities` gains defaults for these keys only. Everything else is
untouched. Facts vs. priorities stays a **presentation** distinction (the
Basics screen vs. the chip screens); scoring keeps its existing shapes.

### 5. Location model

```jsonc
{
  "id": "a_x1",                    // stable client id
  "kind": "place" | "place_group" | "school_district" | "custom",
  "label": "Grosse Pointe",
  "places": [{ "city": "Grosse Pointe Park", "state": "MI" }, …], // place / place_group
  "district": { "name": "L'Anse Creuse Public Schools", "state": "MI", "ref": null }, // school_district
  "description": "Lakeshore side of St. Clair Shores near…", // custom
  "boundaryRef": null              // reserved: future GIS geometry / NCES id
}
```

* Order in `areas[]` = rank (1 = first choice). Labels: First choice /
  Would consider / Fallback (positions 3+).
* Evaluation per home:
  * `place`/`place_group`: met when the home's city/state matches any
    member. Needs `homes.city`.
  * `school_district`, `custom`: **Unknown** automatically. The participant
    can confirm per home ("Is this in L'Anse Creuse?" Yes / No / Not sure),
    stored as a personal check `area:<id>` in `home_member_state.checks` —
    the same own-row mechanism existing check criteria use.
  * A home outside every *checkable* area is a confirmed miss **only** when
    the user has no uncheckable areas; otherwise it is Unknown ("may be in
    L'Anse Creuse Public Schools").
* Match: one criterion, **"In your areas"**, at `locationAreas.tier`.
  Matched area and its rank are shown in the breakdown. Whether rank changes
  the score is **DECISION 4** (default: binary met/unknown/miss, rank shown
  but not scored).
* Commute "Places that matter" stays separate and unchanged.

### 6. Tour Discovery model

* Tour-only criteria remain identified by the existing
  `criterionMetadata().evaluationMode === 'tour'` registry (single source of
  truth).
* `tourWatchlist` holds *notice-on-tour* items with **no tier** — it can't
  affect pre-tour Match by construction and creates no Unknown rows.
* Post-tour: the existing Post-Tour Take shows the fixed four `tour-v2:*`
  items **plus** watchlist items, answered with the existing semantic
  responses into the participant's own `ratings`.
* The Match breakdown gets a calm "Learn on tour" group (never styled as a
  missing/incomplete state, no counts badge).

### 7. Match-score evolution

Smallest safe change — relabel and separate, don't re-weight:

1. `computeMatch` returns `preTour` = current formula restricted to
   `pre_tour` criteria, plus `coverage = { known, total }`.
2. Headline everywhere: **"94% · Pre-tour"** with "Based on 7 of 9" coverage
   when coverage < 100%.
3. Tour-mode answers move to a separate **"After your tour"** summary
   (counts of loved / fine / not for me) instead of blending into the %.
4. Breakdown groups: *Fits* · *Doesn't fit* · *Not in the listing yet* ·
   *Learn on tour*.
5. Mirror (1)+(3) in `resolve_cobuyer_compare_perspectives`; add a parity
   test fixture that runs the same cases through both scorers' rules.

Effect on existing data: purchase homes are unchanged (no tour criteria are
selectable). Rental/investment homes with recorded tour ratings lose those
ratings from the headline % and see them in "After your tour" instead —
**DECISION 5** confirms this.

### 8. Co-buyer comparison architecture

* **Mine | Theirs | Together** on My Search: built from the caller's
  priorities and `resolve_collaborator_search_context().priorities`
  (already authorized). "Together" = agree (both selected, same tier),
  differ (both selected, different tier), only mine, only theirs.
* **Add to mine**: copies one criterion (identity + their tier as the
  default, user can change) into the caller's own document via
  `savePriorities`. Never writes the other row; no sync.
* **Per home, "Andrew's Match"**: extend the existing compare RPC (or a new
  single-home sibling with the same guard) to also return per-criterion
  `{key, label, evaluated, met}` for *listing-evaluable* criteria only.
  Personal checks/ratings of the other person are never returned, and the
  UI never offers to record them.
* Researcher case: the importer sees both Matches immediately after import
  because Match is derived, not stored.

### 9. Get Started architecture

* `src/lib/getStarted.js` — pure function
  `deriveGetStartedTasks({ homes, participants, priorities, profileState, platform })`.
* Completion derived from real data where possible: first home (homes ≥ 1),
  another contender (≥ 2), co-buyer/Realtor joined (participants), areas
  added, priorities set, toured a home (`touredAt`), post-tour take recorded.
* View-only tasks (Compare opened, Map opened, Match explainer read, share
  help viewed) recorded once in `profiles.onboarding_state.seen`.
* Relevance: invite tasks only for matching collaboration intent (or when
  later chosen); share-sheet task only on iOS; Compare task only once ≥ 2
  homes.
* UI: compact card on Homes with a progress ring; collapses to a quiet
  "Getting started · 6/8" row; dismissible; celebratory completion state;
  share-sheet lesson reusable at `/help/share`.

### 10. Entitlement / paywall architecture

* `account_entitlements(user_id, product_id 'flh_plus', source
  'app_store'|'grant'|'web', status 'active'|'revoked', original_transaction_id
  unique, environment, purchased_at, revoked_at, updated_at)`.
* `has_flh_plus(p_user uuid)` and `search_has_flh_plus(p_search uuid)`
  (SECURITY DEFINER, stable, narrowly scoped; same pattern as
  `is_search_decision_maker`).
* iOS: StoreKit 2 **non-consumable** `flh_plus`, purchased with
  `appAccountToken = Supabase user id`. A small custom Capacitor plugin in
  the App target exposes `products`, `purchase`, `restore`
  (`Transaction.currentEntitlements`), and a transaction-update listener.
  The signed JWS goes to `POST /api/entitlements/apple`, which verifies it
  (App Store Server Library) and upserts the entitlement.
* App Store Server Notifications V2 webhook → revoke on refund.
* States handled: purchase, pending (Ask to Buy), cancelled, failed,
  already owned, restore, device change (restore + server state is the truth
  on any device/web), JWS belonging to a different FLH account (**DECISION
  2**).
* Writes require a server-only privileged credential used only in those two
  routes — a deliberate, documented exception to "publishable key only"
  (**DECISION 2**).
* Free taste: unlimited onboarding/preferences; Home #1 and Home #2 fully
  usable and readable forever; invite, accept, co-buyer onboarding, and the
  Mine/Theirs/Together overview are free.
* FLH+: Home #3+, Compare, co-buyer Match per home / Together on homes,
  Realtor collaboration depth (exact split **DECISION 3**).
* Triggers: (a) Home #2 import success → "Two contenders" sheet with a live
  two-column preview of real data; (b) tapping a locked action. Dismissals in
  `onboarding_state.paywall` with cooldown (no re-show of the same trigger
  for 7 days; never more than once per session).
* Existing beta accounts: `grant` entitlement rows (**DECISION 6**).
* Copy direction: "$9.99 once. Yours for every search after this one." No
  trial, no auto-renew language, visible Restore Purchases.

### 11. Migration strategy

* `onboarding_version`: null = legacy. Gate stays
  `onboarding_complete = false → /onboarding`; V2 only renders for accounts
  that are incomplete. Legacy-complete users are never redirected.
* Legacy users discover new fields in My Search (new "Where are you
  looking?" card, Mine/Theirs) and get one dismissible "What's new" row, not
  the Get Started card (unless fewer than 2 homes).
* Priority JSON: defaults added in `normalizePriorities` only; no bulk
  rewrite; `prefsVersion` written on next explicit save.
* Location areas coexist with location chips and commute places.
* Tour watchlist starts empty for everyone.
* Co-buyer bug repair: on onboarding load, use the active search; for
  co-buyers with an empty shared-search document and a populated owned
  document, offer a one-tap "Bring over the preferences you set up" copy
  (caller-owned, both rows are theirs).
* Entitlements: grant rows for pre-launch accounts (decision 6) before any
  gate turns on; gates ship behind a single feature flag.

### 12. Analytics plan

* `src/lib/analytics.js`: `track(name, props)` with a typed event list (the
  brief's names, snake_case), PII-free props (no URLs, emails, addresses),
  pluggable sinks: no-op in tests, `console.debug` in dev, and the optional
  `product_events` insert-only table. No third-party SDK.
* Abandonment: `onboarding_step_viewed` + last step in `onboarding_state`
  derives `onboarding_abandoned` server-side later; no unload beacons.

### 13. Implementation phases (revised order)

| Phase | Scope | Depends on |
|---|---|---|
| **0** | Fix co-buyer onboarding search bug + test. | — |
| **1** | Foundations: `profiles.onboarding_version/onboarding_state`, `analytics.js`, persisted step + resume. | — |
| **2** | Onboarding V2 shell and screens 1, 2, 4, 4b, 5, 6, 8 (reusing existing editors); branching. | 1 |
| **3** | Location areas: model, editor (onboarding step 3 + My Search), `homes.city/state/postal_code`, "In your areas" criterion in JS **and** SQL. | 1, decision 4 |
| **4** | Match semantics: Pre-tour label, coverage, breakdown groups, tour watchlist (step 7), after-tour separation in JS + SQL, parity tests. | decision 5 |
| **5** | First Match reveal + `/help/share` lesson. | 2, 4 |
| **6** | Get Started module. | 1–5 |
| **7** | Mine / Theirs / Together, Add to mine, per-home co-buyer criteria. | 4 |
| **8** | FLH+: entitlement table/functions, StoreKit plugin, verify + notification routes, paywall sheet, triggers, grants for beta accounts. | decisions 1–3, 6; App Store Connect product |
| **9** | Existing-user regression, device QA (small iPhone, Dynamic Type, VoiceOver), web keyboard pass. | all |

Each phase: unit tests for new domain logic, contract tests in the existing
`test/*.test.js` style for SQL/RLS boundaries, `npm test` + `npm run build`,
logical commits.

---

## Part 4 — Locked decisions (2026-10-07) and Phase 0/1 results

### Locked product decisions

These supersede the corresponding proposals and DECISION markers above.

1. **Sequence:** Welcome → Who are you searching with? → Practical basics →
   Ranked location areas → Personal priorities → Tour Discoveries concept →
   Import/share lesson → (after completion) first-home Match reveal → My Homes
   + contextual Get Started. Collaboration comes before any criteria.
   The name from sign-up is reused. Budget stays a maximum; beds and baths
   stay "at least".
2. **FLH+ scope:** a permanent entitlement owned by the purchaser's account.
   Collaboration features unlock per *search* when at least one buyer
   participant on it owns FLH+. That never grants the other buyer an account
   entitlement. Realtors never need FLH+. Checks are search-scoped, never just
   `currentUser.isPlus`.
3. **Payments:** native iOS IAP first; web honors existing entitlements but
   doesn't sell. A server-only privileged key is approved only for verified
   purchase writes, restore processing, and refund/revocation.
4. **Restore:** a transaction stays with the FLH account that first claimed
   it. A restore that finds it claimed by another account shows an
   account-state message and is never reassigned.
5. **Free tier:** Homes #1–#2 are free; Home #3+ needs FLH+. A free
   collaborative search gets one complete shared-home loop (invite, accept,
   independent preferences, one shared home, each buyer's Match, a Together
   view, agree/differ) before anything collaborative is gated.
6. **Location rank** is a label, not a weight, in v1. An area FLH can't verify
   is Unknown, never a miss.
7. **After-tour separation approved:** "94% Match · Pre-tour"; Tour
   Discoveries stay a separate assessment.
8. **Grandfathering:** every account that exists before monetization goes live
   gets a real, persisted, permanent FLH+ entitlement, granted by a
   deterministic, auditable cutoff.
9. **Unknown never equals No**; tour-only criteria never lower pre-tour Match
   or read as unfinished work.
10. **Researcher behavior:** a buyer may evaluate listing data against the
    other buyer's declared criteria, but may never record their reaction,
    answer for them, or change their preferences. "Add to mine" copies a
    criterion on an explicit action only, and never links the two records.

### Phase 0 — shipped

| Change | Files |
|---|---|
| Invited co-buyers onboard into the shared search (`resolveOnboardingSearch`; the ambiguous `getSearch` removed) | `src/lib/supabase/collaboration.js`, `src/app/onboarding/page.js`, `src/lib/supabase/data.js` |
| **New finding, fixed:** every invitation acceptance failed with 42702 (ambiguous `search_id`) since 2026-09-16, covering co-buyer, Realtor, Realtor connection, and Realtor-started claim | `migrations/2026-10-07-invitation-acceptance-conflict-targets.sql`, `schema.sql` |
| **New finding, fixed:** co-buyer Compare Match ignored Garage and Guest / In-Law Suite, so it disagreed with the co-buyer's own Match | `migrations/2026-10-07-cobuyer-compare-garage-parity.sql`, `test/match-scorer-parity.test.js` |
| **New finding, fixed:** `schema.sql` ended in an open transaction; fresh installs rolled back the Realtor-started-searches block | `schema.sql` |
| Real-Postgres authorization harness (opt-in, no npm dependency) | `test/support/*`, `docs/database-tests.md` |
| Read-only check for co-buyers already affected by the onboarding bug | `supabase/cobuyer-onboarding-placement-check.sql` |

### Phase 1 — shipped

* `profiles.onboarding_version` + `profiles.onboarding_state`
  (`migrations/2026-10-07-onboarding-state.sql`): additive, constrained, no
  backfill, existing policies only. Existing accounts keep `NULL`, which means
  "finished before versioning"; the gate is still `onboarding_complete` alone.
* `src/lib/onboardingFlow.js` holds the flow versions, per-person step
  branching (V2 defined, not yet rendered), resume, Back without data loss,
  invited co-buyer context, re-doing search-scoped steps when the search
  changes, and v1→v2 carry-over. `CURRENT_ONBOARDING_VERSION` stays 1 until
  Phase 2 ships the screens.
* The current onboarding UI persists and resumes its position, saves on
  backgrounding, and never blocks on a progress write.
* `src/lib/analytics.js` is the event boundary: a typed vocabulary, allowlisted
  PII-free properties, pluggable sinks, no vendor. Onboarding funnel and
  `collaborator_joined` are instrumented.

### Findings that affect later phases

* **Scorer drift beyond Garage (Phase 4):** the SQL projection doesn't apply
  `PURCHASE_LEGACY_LABEL_ALIASES` folding, and it skips retired keys even when
  a buyer typed them as their own criterion (`source: 'custom'`), which the JS
  scorer keeps. A legacy document can still score differently on the two
  sides. Phase 4 rewrites this function anyway (pre-tour split); it should
  extend the parity test to run shared fixtures through both scorers.
* **Already-joined co-buyers (Phase 7):** a person who had finished onboarding
  before accepting has no priority document on the shared search (Match
  empty), because onboarding is never re-run for them. The planned explicit
  "bring over my preferences" copy (caller-owned) also serves the accounts
  listed by the placement check.
* **Production verification needed:** apply the three 2026-10-07 migrations
  in filename order (conflict targets, compare parity, onboarding state;
  they're independent). Then accept one real co-buyer invitation to confirm
  42702 is gone. If production had silently been failing acceptances, there
  may be pending invitations users gave up on.
* **`AcceptInvitationClient` comment drift:** it refers to an
  `accept_invitation` exception handler that produced sanitized
  `error_<stage>_<sqlstate>` reasons. The current function has no such
  handler, so unexpected failures surface only as a generic invalid state.
* **schema.sql snapshot drift:** it still defines the pre-display-name
  `resolve_collaborator_search_context` and lacks several 2026-09-16+
  migrations. The test harness documents the replay order
  (`POST_SNAPSHOT_MIGRATIONS`). Regenerating `schema.sql` from production
  would remove that maintenance.
* **Entitlement placement (Phase 8):** confirmed `profiles` is fully
  own-row-writable (no column grants), so onboarding state can live there but
  entitlements must not.
