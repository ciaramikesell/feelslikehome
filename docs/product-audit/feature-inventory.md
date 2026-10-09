# Master feature inventory

Audit baseline: `main` @ `9032151` (2026-10-09). Evidence is in
[audit-evidence.md](audit-evidence.md). Every row below was checked against the
code on `main`. Plans, PR descriptions and earlier docs were not taken as proof.

## How to read this table

**Status vocabulary.** Only these exact terms are used:

| Status | Meaning |
|---|---|
| COMPLETE — VERIFIED | Built, connected, tested, and confirmed in production **and** on a real device (or the capability needs neither, and this audit verified it directly) |
| BUILT — QA PENDING | Code, data and UI are connected and covered by automated checks. Not yet confirmed in production or on a device |
| PARTIAL | Some layers exist; a material piece is missing |
| NOT STARTED | No implementation found on `main` |
| DEFERRED | Deliberately postponed by an earlier, documented decision |
| SUPERSEDED | Replaced by a different approach |
| UNKNOWN | Cannot be determined from the repository |
| NEEDS VERIFICATION | Exists in code, but correctness depends on production state or on in-flight work that this audit could not observe |

**Verification ladder columns.**

| Column | Question |
|---|---|
| Code | Does the code exist on `main`? |
| DB | Does the database support it? |
| UI | Can a user reach it? |
| Conn | Are the UI, data and server actually wired together? |
| Tests | What automated tests cover it? |
| Prod | Has it been verified in production? |
| Dev | Has it been verified on a real device? |

**Cell values:**
- `Y` yes · `N` no · `P` partial · `?` not observable · `—` not applicable
- Tests:
  - `U` unit/behavioural JS tests
  - `S` source-text assertions only (the test reads source files and matches strings)
  - `D` real-Postgres tests
  - `N` no tests

**Two facts drive the Prod and Dev columns:**
- **No production deployment was observable from this environment**, and no
  post-deploy production verification output was provided. Prod is `?` everywhere
  unless the owner has reported something, which is then noted.
- **No real-device QA record exists.** `docs/native-device-qa.md` says "READY FOR
  CIARA ACCEPTANCE QA … not certification". Dev is therefore `N` everywhere.

**Consequence: no user-facing capability qualifies as COMPLETE — VERIFIED.** That
reflects missing evidence, not proof the features are broken. It is the single most
important finding of this audit.

**In-flight work.** Branch `claude/charming-bell-i0xo4w` @ `4168309` ("Existing
accounts join shared searches without losing sight of their own") is **not merged**.
Rows it affects are marked **⟳ in flight**, and their status may change when it lands.

---

## A. Auth & account

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-001 | Email + password sign-up with email confirmation redirect | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | `AuthForm.jsx` `signUp` with `emailRedirectTo /auth/callback?next=`. Uses Supabase default mail unless custom SMTP is configured (see NOTIFY-001) |
| AUTH-002 | Sign in | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | `signInWithPassword` |
| AUTH-003 | Forgot / reset password | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | `/auth/forgot-password`, `/auth/reset-password` |
| AUTH-004 | Sign out | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | AppShell, AccountSettings, AcceptInvitationClient |
| AUTH-005 | Delete account (in-app) | N | N | N | N | N | — | — | NOT STARTED | **App Store Guideline 5.1.1(v) blocker** |
| AUTH-006 | Change email or password from Account | N | — | N | N | N | — | — | NOT STARTED | Email is shown read-only. Password only via the forgot flow |
| AUTH-007 | Edit first/last name | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | `updateProfileName` |
| AUTH-008 | Personal data export | N | N | N | N | N | — | — | NOT STARTED | Not an App Store requirement. Possible privacy-law ask |
| AUTH-009 | Sign in with Apple / social login | N | — | N | N | N | — | — | NOT STARTED | Not required: no third-party login exists, so Guideline 4.8 is not triggered |
| AUTH-010 | Redirect continuation through auth (invite, `?url=`) | Y | — | Y | Y | S/U | ? | N | BUILT — QA PENDING | `safeRedirect.js` |
| AUTH-011 | Signed-out / incomplete-profile routing (protected layout) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | `(app)/layout.js` |

## A2. Search management

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| SEARCH-001 | One owned search auto-created per account | Y | Y | — | Y | D | ? | N | BUILT — QA PENDING | `handle_new_user`; `unique(user_id)` |
| SEARCH-002 | Switch the active search (own vs shared) | Y | Y | P | P | D/S | ? | N | NEEDS VERIFICATION ⟳ in flight | On `main` the switcher is a tiny `<select>` labelled "My Search / Shared Search", and the client state goes stale after `router.refresh()`. Fix is on `4168309` (unmerged) |
| SEARCH-003 | More than one *owned* search per account | N | N | N | N | N | — | — | NOT STARTED | Blocked by `unique(user_id)`. A product decision |
| SEARCH-004 | Search intent: buy home / rent home / rent apartment | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | `searchIntent.js` |
| SEARCH-005 | Rename / archive / reset / delete a search | N | N | N | N | N | — | — | NOT STARTED | |
| SEARCH-006 | Search labels ("Your search" / "<Owner>'s search") | P | Y | P | P | D | ? | N | NEEDS VERIFICATION ⟳ in flight | Part of `4168309` |

## B. Importing homes

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| IMPORT-001 | Manual add / edit home | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | `HomeModal.jsx` |
| IMPORT-002 | Paste listing URL → extract address → RentCast lookup → fill empty fields → user reviews and saves | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | Never auto-saves. **Needs `RENTCAST_API_KEY`, which is missing from `.env.example`** |
| IMPORT-003 | Source-specific URL parsing | P | — | Y | Y | U | ? | N | PARTIAL | Explicit parsing: Zillow (incl. apartments), Redfin, Realtor.com, Homes.com, Apartments.com, Rent.com. Trulia, builder sites and others use the generic fallback |
| IMPORT-004 | Exact-match duplicate detection | Y | Y | Y | Y | U | ? | N | BUILT — QA PENDING | `listingUrl.js:153` is deliberately conservative |
| IMPORT-005 | iOS Share Extension → `/homes?url=` | Y | — | Y | P | S | ? | N | BUILT — QA PENDING | Depends on Universal Links (IOS-002) resolving on a device |
| IMPORT-006 | Photo: upload (≤5 MB) or URL | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | **iOS camera-permission risk** (IOS-007) |
| IMPORT-007 | Import provenance ("What FLH Found") | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | 2026-09-17 migrations |
| IMPORT-008 | Fetch listing page (photos, status, description) | N | — | N | N | N | — | — | DEFERRED | Deliberate: no scraping (`listingUrl.js` header; import-enrichment audit doc) |
| IMPORT-009 | RentCast cost controls (caching, per-user rate limit) | N | N | — | — | N | — | — | NOT STARTED | Only a sign-in check and passing through RentCast's own 429 |
| IMPORT-010 | Rental / apartment import corrections | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | rental-pass-d/e, apartment-v1 |

## C. My Homes

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| HOMES-001 | Homes board: cards, sort (6 options), filters, free-text search | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | `homesCollection.js` |
| HOMES-002 | Home detail page | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | Scoped to the active search |
| HOMES-003 | Lifecycle: Saved → Want to Tour → Toured → Archived (personal state) | Y | Y | Y | Y | U/D | ? | N | BUILT — QA PENDING | `home_member_state` |
| HOMES-004 | Favorite (personal) | Y | Y | Y | Y | U | ? | N | BUILT — QA PENDING | |
| HOMES-005 | Archive with reason; restore | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | |
| HOMES-006 | Permanent delete (from Archive only) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | |
| HOMES-007 | Offer / under contract / closed statuses | N | P | N | N | N | — | — | NOT STARTED | Legacy values exist for colour mapping only |
| HOMES-008 | Shared notes / pros / cons | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | Shared with all decision-makers |
| HOMES-009 | Post-tour capture: verdict, 4 ratings, note | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | `PostTourModal.jsx`, `tour-v2:*` ratings |
| HOMES-010 | Want to Tour list (`/tour`) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | Union across participants |
| HOMES-011 | Tour photos / voice notes | N | N | N | N | N | — | — | NOT STARTED | |
| HOMES-012 | Realtor suggestions inbox (`/homes/suggestions`) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | See REALTOR-003 |
| HOMES-013 | Empty states for all collections | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | |

## D. Preferences & Match

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| MATCH-001 | Basics editor (budget, size, beds/baths, types, layout, condition) with tiers | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | `BasicsEditor.jsx` |
| MATCH-002 | Priority tiers (must 4 / important 2 / nice 1 / don't care 0) + rank board | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | |
| MATCH-003 | Custom priorities | Y | Y | Y | Y | U | ? | N | BUILT — QA PENDING | Taxonomy unification fixed earlier duplicates |
| MATCH-004 | `computeMatch`: Unknown ≠ No, excluded from the denominator | Y | — | Y | Y | U | ? | N | BUILT — QA PENDING | `matching.js:281` |
| MATCH-005 | SQL mirror of the scorer for collaborator perspectives | Y | Y | Y | Y | D | ? | N | BUILT — QA PENDING | `match-scorer-parity` test |
| MATCH-006 | Match explanation (must-haves met/missing/unknown) | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | No per-weight breakdown |
| MATCH-007 | Places (commute destinations) with max drive | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | |
| MATCH-008 | Location ranks (labels, not weights) | N | N | N | N | N | — | — | NOT STARTED | Locked V2 decision; no code yet |
| MATCH-009 | Tour-evaluated criteria feed Match | Y | Y | Y | Y | U/D | ? | N | BUILT — QA PENDING | |
| MATCH-010 | Compare up to 4 homes, differences-only toggle | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | |
| MATCH-011 | Map of homes + own and collaborator places | Y | Y | Y | Y | U/S | ? | N | BUILT — QA PENDING | Needs browser key + Map ID in production |
| MATCH-012 | Commute times (Routes API, ≤25×25) | Y | Y | Y | Y | U | ? | N | BUILT — QA PENDING | Session-memory cache only. No server rate limit |
| MATCH-013 | Server-side commute cache / quotas | N | P | — | — | N | — | — | NOT STARTED | Only geocodes are persisted |

## E. Co-buyer collaboration

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| COLLAB-001 | Owner invites co-buyer via copy link (UUID, 7 days, email-bound) | Y | Y | Y | Y | D/S | ? | N | BUILT — QA PENDING | No email sent |
| COLLAB-002 | Accept invitation (single-use, wrong-account, expired, self-invite) | Y | Y | Y | Y | D | owner reports repair applied | N | NEEDS VERIFICATION | The 10-07 migration header records that **every acceptance failed (42702) from 09-16 until that migration was applied**. Production post-check output not seen |
| COLLAB-003 | Existing account accepts and keeps its own search reachable | P | Y | P | P | D | ? | N | NEEDS VERIFICATION ⟳ in flight | `4168309`; root cause was hidden data, not lost data |
| COLLAB-004 | Co-buyer setup onboarding (`shared_search_setup`) | P | Y | P | P | D/U | ? | N | NEEDS VERIFICATION ⟳ in flight | On `main`, the full account onboarding is reused for shared setup |
| COLLAB-005 | Per-member priorities and personal home state | Y | Y | Y | Y | D | ? | N | BUILT — QA PENDING | |
| COLLAB-006 | Collaborator perspective in Compare (never merged) | Y | Y | Y | Y | D | ? | N | BUILT — QA PENDING | Garage parity fix 10-07 |
| COLLAB-007 | Collaborator places on map / context | Y | Y | Y | Y | D | ? | N | BUILT — QA PENDING | Return-type bridge 10-08 |
| COLLAB-008 | Remove member / leave search | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | Personal rows of a removed member are retained (orphaned) |
| COLLAB-009 | Revoke / cancel a pending invitation | N | P | N | N | N | — | — | NOT STARTED | The `revoked` status exists but nothing sets it |
| COLLAB-010 | Email delivery of invitations | N | — | N | N | N | — | — | NOT STARTED | Copy link only; UI says "Send connection request" |
| COLLAB-011 | More than one co-buyer per search | N | P | N | N | N | — | — | NOT STARTED | RPCs use `limit 1`. **The DB does not prevent a 2nd co-buyer**; see hidden blockers |
| COLLAB-012 | Comments / discussion threads | N | N | N | N | N | — | — | NOT STARTED | |
| COLLAB-013 | Realtime updates between participants | N | — | N | N | N | — | — | NOT STARTED | No Supabase channels |
| COLLAB-014 | "Add to mine" explicit copy between searches | N | N | N | N | N | — | — | NOT STARTED | Locked decision: copy only on explicit action |
| COLLAB-015 | Lifecycle signals (co-buyer archived / WTT) | Y | Y | Y | Y | D/U | ? | N | BUILT — QA PENDING | Summaries only, via SECURITY DEFINER |

## F. Realtor

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| REALTOR-001 | Realtor role and permissions (#78) | Y | Y | Y | Y | S/D | ? | N | BUILT — QA PENDING | Membership-level role. Read-mostly |
| REALTOR-002 | Client roster / search view `/people/[searchId]` (#79) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | |
| REALTOR-003 | Suggestions: stage, buyer promote / dismiss-by-all (#80, #81) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | |
| REALTOR-004 | Realtor notes per home (#82) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | |
| REALTOR-005 | Tour suggestions (#82) | Y | Y | Y | Y | S | ? | N | BUILT — QA PENDING | Recommendation only |
| REALTOR-006 | Realtor ↔ buyer invitations / connection request | Y | Y | Y | Y | S/D | owner reports repair applied | N | NEEDS VERIFICATION | 09-19 objects were missing in production before the repair |
| REALTOR-007 | Realtor-started (prospective) searches + buyer claim | Y | Y | Y | Y | D | owner reports repair applied | N | NEEDS VERIFICATION | `prospective_searches` was absent in production at Section 0 |
| REALTOR-008 | `/for-realtors` landing | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | |
| REALTOR-009 | Tour scheduling / calendar | N | N | N | N | N | — | — | NOT STARTED | |
| REALTOR-010 | Realtor billing | N | N | N | N | N | — | — | DEFERRED | Locked decision: Realtors free |
| REALTOR-011 | Brokerage / team accounts, CRM export | N | N | N | N | N | — | — | NOT STARTED | Parking lot |

## G. Onboarding

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| ONBOARD-001 | Current onboarding: Basics → What Matters → Rank → Ready | Y | Y | Y | Y | U/S/D | ? | N | BUILT — QA PENDING | `CURRENT_ONBOARDING_VERSION = 1` |
| ONBOARD-002 | Resumable progress (`onboarding_state`, version, save on background) | Y | Y | Y | Y | D/U | owner reports migration applied | N | NEEDS VERIFICATION | 2026-10-07 migration |
| ONBOARD-003 | V2 flow definition (`ONBOARDING_FLOWS[2]`) | P | Y | N | N | U | — | — | PARTIAL | Step keys only; not live |
| ONBOARD-004 | V2 Welcome | N | — | N | N | N | — | — | NOT STARTED | Paused by owner |
| ONBOARD-005 | V2 Who are you searching with | P | Y | N | N | U | — | — | PARTIAL | Answer storage exists; no screen |
| ONBOARD-006 | V2 Locations step (with labelled ranks) | N | N | N | N | N | — | — | NOT STARTED | Places editor exists outside onboarding |
| ONBOARD-007 | V2 Tour Discoveries | N | — | N | N | N | — | — | NOT STARTED | |
| ONBOARD-008 | V2 Import lesson | N | — | N | N | N | — | — | NOT STARTED | |
| ONBOARD-009 | V2 First Match reveal | P | — | P | P | N | — | — | PARTIAL | The Ready screen links to "Add your first home"; no reveal |
| ONBOARD-010 | V2 Homes + Get Started checklist | P | — | P | P | N | — | — | PARTIAL | Ready-screen buttons only |
| ONBOARD-011 | Onboarding analytics events | P | — | — | P | U | — | — | PARTIAL | Events fire; **no production sink** |
| ONBOARD-012 | Earlier onboarding designs (pre-#95) | — | — | — | — | — | — | — | SUPERSEDED | Replaced by #95 / #131 |

## H. FLH+ monetization

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| PAY-001 | Entitlement table (non-client-writable) | N | N | — | — | N | — | — | NOT STARTED | Only a comment in the 10-07 migration |
| PAY-002 | StoreKit / iOS in-app purchase | N | — | N | N | N | — | — | NOT STARTED | No plugin, no StoreKit config |
| PAY-003 | Server receipt validation, restore, refund handling (scoped privileged key) | N | N | — | — | N | — | — | NOT STARTED | |
| PAY-004 | Paywall UI | N | — | N | N | N | — | — | NOT STARTED | |
| PAY-005 | Grandfather pre-monetization accounts | N | N | — | — | N | — | — | NOT STARTED | Locked decision |
| PAY-006 | Per-search collaboration unlock if any buyer has FLH+ | N | N | — | — | N | — | — | NOT STARTED | Locked decision |
| PAY-007 | Homes #1–2 free, #3+ gated; one full collab loop free | N | N | N | N | N | — | — | NOT STARTED | Locked decision |
| PAY-008 | Monetization analytics event names | P | — | — | N | U | — | — | PARTIAL | Names reserved in `analytics.js` |
| PAY-009 | Web purchase (Stripe) | N | — | N | N | N | — | — | DEFERRED | Owner chose iOS IAP first |

## I. Native iOS

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| IOS-001 | Capacitor 8 remote-hosted shell (`app.feelslikehome.mobile`, iOS 15+) | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | Team `QCQYKZVAC8`; version 1.0 (1) |
| IOS-002 | Universal Links + AASA route | Y | — | — | Y | U/S | ? | N | NEEDS VERIFICATION | AASA is **empty unless `APPLE_TEAM_ID` is set** in production. Not in `.env.example` |
| IOS-003 | Share Extension (`.share`) | Y | — | Y | P | S | ? | N | BUILT — QA PENDING | |
| IOS-004 | Safe-area contract / native presentation | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | |
| IOS-005 | App icon (1024 universal) + launch screen | Y | — | Y | — | S | ? | N | BUILT — QA PENDING | |
| IOS-006 | `PrivacyInfo.xcprivacy` | N | — | — | — | N | — | — | NOT STARTED | Required for upload since 2024 when required-reason APIs are used (Capacitor uses some) |
| IOS-007 | Info.plist: `NSCameraUsageDescription`, `ITSAppUsesNonExemptEncryption`; remove legacy `armv7` | N | — | — | — | N | — | — | NOT STARTED | Camera prompt via `<input type=file>` likely crashes without the string — **verify on a device** |
| IOS-008 | Push notifications | N | — | N | N | N | — | — | NOT STARTED | |
| IOS-009 | Offline / no-network handling in native | P | — | P | P | S | ? | N | PARTIAL | The service worker is skipped in native. Native boot needs the network |
| IOS-010 | iPad support (device family 1,2) | Y | — | ? | ? | N | — | N | NEEDS VERIFICATION | Requires iPad QA and screenshots, or drop to iPhone-only |
| IOS-011 | Native value beyond the website (Guideline 4.2) | P | — | P | P | — | — | N | PARTIAL | Share Extension + Universal Links help; still a review risk |
| IOS-012 | `CAPACITOR_DEBUG = true` excluded from Release | ? | — | — | — | N | — | — | NEEDS VERIFICATION | Set in `debug.xcconfig`; confirm Release config |

## J. Visual design

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| DESIGN-001 | Public landing page | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | No legal links, App Store badge or pricing |
| DESIGN-002 | Visual refreshes (auth, collections, compare, detail, My Search, map) | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | |
| DESIGN-003 | Accessibility | P | — | P | — | S | ? | N | PARTIAL | Source-text checks only; no axe or VoiceOver pass recorded |
| DESIGN-004 | Personality moments (`flhMoments`) | Y | — | Y | Y | S | ? | N | BUILT — QA PENDING | |
| DESIGN-005 | Dark mode | N | — | N | N | N | — | — | NOT STARTED | No `prefers-color-scheme` |
| DESIGN-006 | Search switcher presentation | P | — | P | P | S | ? | N | NEEDS VERIFICATION ⟳ in flight | Chip + sheet on `4168309` |
| DESIGN-007 | PWA install prompt + manifest (web) | Y | — | Y | Y | S | ? | — | BUILT — QA PENDING | |

## K. Notifications

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| NOTIFY-001 | Supabase Auth emails (confirm, reset) | Y | Y | — | Y | N | ? | — | NEEDS VERIFICATION | Default Supabase mailer is rate-limited; custom SMTP status unknown |
| NOTIFY-002 | Transactional product email (invites, suggestions, tour suggestions) | N | — | — | — | N | — | — | NOT STARTED | |
| NOTIFY-003 | Push notifications | N | — | — | — | N | — | — | NOT STARTED | |
| NOTIFY-004 | In-app activity feed / badges | N | N | N | N | N | — | — | NOT STARTED | |

## L. Infrastructure, security & privacy

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| INFRA-001 | RLS on every table; SECURITY DEFINER RPCs check `auth.uid()` | Y | Y | — | Y | D/S | ? | — | BUILT — QA PENDING | |
| INFRA-002 | Real-Postgres DB test harness + full suite | Y | Y | — | Y | D | — | — | COMPLETE — VERIFIED | Run in this audit: 710/710 with the DB; 682 pass + 28 skipped without it |
| INFRA-003 | Production schema drift repair (7 migrations) | Y | Y | — | — | D | owner reports applied | — | NEEDS VERIFICATION | Post-repair inventory/fingerprint output not seen |
| INFRA-004 | `schema.sql` matches the migrations | P | P | — | — | D | — | — | PARTIAL | `schema.sql` lacks 09-19+ objects; the harness compensates |
| INFRA-005 | CI (tests on PR) | N | — | — | — | — | — | — | NOT STARTED | No `.github/` |
| INFRA-006 | Lint / typecheck | N | — | — | — | — | — | — | NOT STARTED | |
| INFRA-007 | Error monitoring / crash reporting | N | — | — | — | — | — | — | NOT STARTED | |
| INFRA-008 | Product analytics sink | P | — | — | N | U | — | — | PARTIAL | Dev-only `console.debug` sink |
| INFRA-009 | Security headers (CSP, frame-ancestors) | N | — | — | — | — | — | — | NOT STARTED | `next.config.mjs` is empty |
| INFRA-010 | Rate limits / spend caps on RentCast and Google routes | N | — | — | — | — | — | — | NOT STARTED | Set provider-side quotas as a minimum |
| INFRA-011 | Dependency advisories | P | — | — | — | — | — | — | PARTIAL | `npm audit --omit=dev`: 3 high, 1 moderate (next 15.5.25, postcss, sharp, source-map-js; mostly transitive via next) |
| INFRA-012 | Cross-user lookups (`resolve_display_name`, membership helpers taking any user id) | P | P | — | — | N | ? | — | PARTIAL | Known low-severity info disclosure |
| INFRA-013 | Backups / PITR | ? | ? | — | — | — | owner reports paid plan + backup | — | NEEDS VERIFICATION | Confirm the PITR / daily backup setting |
| INFRA-014 | Beta feedback capture (`beta_feedback`, flag on) | Y | Y | Y | Y | S | ? | N | NEEDS VERIFICATION | Flag is `true` in source. The runbook requires the migration to be verified first |
| INFRA-015 | `.env.example` completeness | P | — | — | — | — | — | — | PARTIAL | Missing `RENTCAST_API_KEY`, `APPLE_TEAM_ID`, `CAP_SERVER_URL` |
| INFRA-016 | Staging / preview environment with a separate DB | ? | ? | — | — | — | — | — | UNKNOWN | Runbooks mention Preview; DB separation not observable |
| INFRA-017 | Removed member's personal data cleanup | N | N | — | — | N | — | — | NOT STARTED | Rows retained after leave/remove |

## M. TestFlight & App Store

| ID | Capability | Code | DB | UI | Conn | Tests | Prod | Dev | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| RELEASE-001 | Privacy policy (public URL) | N | — | N | — | — | — | — | NOT STARTED | Required by App Store Connect |
| RELEASE-002 | Terms of service | N | — | N | — | — | — | — | NOT STARTED | Strongly advised; required once IAP ships |
| RELEASE-003 | Support URL / contact | N | — | N | — | — | — | — | NOT STARTED | Required |
| RELEASE-004 | App Store Connect record, metadata, screenshots (iPhone + iPad) | ? | — | — | — | — | — | — | UNKNOWN | Not observable from the repo |
| RELEASE-005 | App Privacy "nutrition label" answers | N | — | — | — | — | — | — | NOT STARTED | Depends on analytics/crash decisions |
| RELEASE-006 | TestFlight build uploaded | ? | — | — | — | — | — | — | UNKNOWN | |
| RELEASE-007 | Reviewer demo account + review notes | N | — | — | — | — | — | — | NOT STARTED | Needed: the app is login-gated |
| RELEASE-008 | Native device QA sign-off (#77 sequence) | P | — | — | — | — | — | N | PARTIAL | Checklist exists in `native-device-qa.md`; not executed |
| RELEASE-009 | Export-compliance declaration | N | — | — | — | — | — | — | NOT STARTED | See IOS-007 |
| RELEASE-010 | Version / build numbering process | P | — | — | — | — | — | — | PARTIAL | Hard-coded 1.0 (1) |

---

## Status count

| Status | Count |
|---|---|
| COMPLETE — VERIFIED | 1 (INFRA-002, a developer capability; **0 user-facing**) |
| BUILT — QA PENDING | 60 |
| PARTIAL | 17 |
| NOT STARTED | 49 |
| DEFERRED | 3 |
| SUPERSEDED | 1 |
| UNKNOWN | 3 |
| NEEDS VERIFICATION | 16 (including 5 ⟳ in flight) |
| **Total** | **150** |

The counts were produced by a script over this file; re-run it after edits (see
[audit-evidence.md](audit-evidence.md#reproducing-the-status-count)).
Ideas that were never built are tracked separately in
[ideas-parking-lot.md](ideas-parking-lot.md) as FUTURE-xxx and are not counted here.
