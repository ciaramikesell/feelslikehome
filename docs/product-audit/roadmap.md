# Roadmap (rebased on the locked decisions, 2026-10-09)

**This replaces the original audit roadmap.** The earlier plan was a free public App
Store launch, then Onboarding V2 and FLH+. **That is no longer the approved plan.**
Under D-01 and D-02:
- the TestFlight beta (internal and external) is free;
- the **public App Store release includes FLH+**;
- the **full Onboarding V2 ships before external TestFlight**.

The superseded Roadmaps A, B and C are summarised at the end for traceability.

**Conventions**
- **Effort:** **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks · **XL** > 2 weeks.
- **Risk:** delivery and regression risk.
- **"SQL ✔":** a production migration needing the owner's explicit approval when applied. Nothing in this document has been implemented or applied.
- **Conflicts:** C-xx and Q-xx refer to [decision-implementation-conflicts.md](decision-implementation-conflicts.md).
- **PRs:** PR-xx refers to [implementation-pr-sequence.md](implementation-pr-sequence.md).
- **No dates.** No launch date and no App Store approval timing is implied.

## Release gates

| Gate | Meaning |
|---|---|
| **G0 — Dev/device QA** | Private development builds on owner devices against production or preview |
| **G1 — Internal TestFlight** | App Store Connect team testers; no Beta App Review |
| **G2 — External TestFlight** | Beta App Review; real outside testers; free |
| **G3 — Public App Store with FLH+** | Full App Review; IAP live |

Gate detail, including which items are platform-required and which are FLH quality
bars, is in [launch-readiness.md](launch-readiness.md).

---

## Phase 0 — Foundation and verification

| Task | IDs | Description | Reuse | Depends on | Effort | Risk | Migrations / external config | Automated tests | Manual QA | Gate | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P0-01 | D-03; SEARCH-002, COLLAB-003/004, DESIGN-006 | Open a PR for `4168309`, review, merge, deploy; real-account QA on **both** accounts | The fix as written (719/719 tests, build OK on 2026-10-09 re-run) | — | S | Med | None (no SQL in the fix) | Existing `multi-search-invitation-db` + suite | QA matrix J-8 on Ciara's and Andrew's real accounts: switching, saved homes, own preferences, invitations, session persistence after app kill | G0 | Both accounts see both searches labelled correctly; no data missing (compare against `account-searches-check.sql` before and after); no stale lists after switching |
| P0-02 | INFRA-003, COLLAB-002, REALTOR-006/007, ONBOARD-002, INFRA-014 | Read-only production verification: migration inventory, function fingerprints, co-buyer checks, beta-feedback verification, env-var names, AASA | Existing `supabase/*-check.sql`, `production-*.sql` | — | S | Low | Read-only only | — | Owner runs the queries and pastes the boolean output | G0 | Every repair object `true`; fingerprints match the repo; `APPLE_TEAM_ID` present; AASA lists `QCQYKZVAC8.app.feelslikehome.mobile` |
| P0-03 | — (C-04/C-02/C-01 preflights) | Read-only preflights for later phases: duplicate co-buyers, multiple owned searches, Realtor-authored rows, co-buyer-created homes, legacy offer statuses | New read-only SQL file | — | S | Low | Read-only | Harness test that the file is read-only | Owner runs it | G0 | Counts recorded in `audit-evidence.md` |
| P0-04 | INFRA-005/006 | CI: `npm ci`, `npm test`, `npm run build` on every PR (DB tests in a Postgres service container) | Existing harness | — | S | Low | GitHub Actions | CI itself | Open a test PR | G0 | Red on a failing test; green on `main` |
| P0-05 | C-09; N-10 | Verify the Vercel production branch is `main`-only and the production domain alias | — | — | S | Med | Vercel settings (read) | — | Inspect deployments | G0 | Documented; any branch alias removed by the owner |
| P0-06 | INFRA-011 | Dependency maintenance: bump `next` within 15.x; re-run `npm audit` | — | P0-04 | S | Low | — | Suite + build | Smoke the top journeys on preview | G0 | 0 high advisories, or each documented as not reachable |
| P0-07 | D-10; INFRA-007 | Production error monitoring (web + server routes), release-tagged, with **redaction** (tokens, emails, addresses, notes) | `analytics.js` sink pattern | P0-04 | S–M | Low | Vendor account, DSN env var | Unit test of the redaction scrubber | Trigger a test error on preview | G0 | Errors visible with release; no invitation tokens or emails in payloads |
| P0-08 | D-12; INFRA-010, IMPORT-009, MATCH-013 | Provider quotas, budgets and alerts (RentCast, Google Routes, Geocoding, Maps JS) **plus** app-level per-user rate limits on `/api/import-listing` and `/api/commute`; evaluate a short-TTL import cache | Existing auth checks in both routes | — | M | Med | Google Cloud / RentCast console; possibly a rate-limit table (SQL ✔) or KV | Rate-limit unit tests; route tests for 429 | Hammer test on preview | G0 | Limits return a friendly 429; alerts configured; **documented that alerts are not caps** |
| P0-09 | INFRA-015 | Complete `.env.example` (`RENTCAST_API_KEY`, `APPLE_TEAM_ID`, `CAP_SERVER_URL`, monitoring and email keys as added) | — | — | S | Low | — | Source test | — | G0 | All runtime env vars documented |

## Phase 1 — Collaboration and account integrity

| Task | IDs | Description | Reuse | Depends on | Effort | Risk | Migrations / external config | Automated tests | Manual QA | Gate | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P1-01 | D-07; COLLAB-011; C-04 | One-co-buyer cap: partial unique index plus `co_buyer_limit` reason; refuse new co-buyer invites while one exists | `accept_invitation` (10-07) | P0-03 (no duplicates) | S–M | Med | SQL ✔ | DB: concurrent accept on 2 connections; Realtor + co-buyer coexist | Try a 2nd invite in the UI | G1 | Exactly one co-buyer under concurrency; clear copy |
| P1-02 | D-09; COLLAB-009; C-05 | `create_invitation` RPC (dedupe, cap guard) + `revoke_invitation` RPC + pending-invitations list with Revoke | Acceptance already rejects non-pending | P1-01 | M | Low | SQL ✔ | DB: revoke → accept refused; duplicate returns the same row | Revoke, then open the old link | G1 | Revoked link refused server-side; owners see pending invites |
| P1-03 | D-08; COLLAB-010, NOTIFY-002; C-05 | Transactional invitation email + distinct Copy link; send status columns; Supabase Auth custom SMTP | P1-02 RPCs; `/invite/<token>` | P1-02, **Q-09** | M | Med | Provider, DNS (SPF/DKIM/DMARC), server key; SQL ✔ (columns) | Route tests with a mocked provider; failure state | Real inboxes; spam check; link → app | G2 | "Send" sends; "Copy" copies; failures visible; auth emails via custom SMTP |
| P1-04 | D-06; C-03; N-5 | `leave_search(search, delete_personal_data)` + Leave sheet with two options; **Realtor read policies limited to current decision-makers** | `CoBuyerManagement.jsx`, RLS helpers | — | M | Med | SQL ✔ | DB: each mode; retained data invisible to everyone; rejoin restores | Leave/rejoin with real accounts | G2 | Access revoked immediately; choice honoured; no other member sees retained rows |
| P1-05 | D-05; C-01 | Primary-search model: `is_primary` + partial unique index; update the 13 SQL + 5 JS one-search lookups | `is_search_owner`, `active_search_id` | P0-03 | M–L | **High** | SQL ✔ (constraint swap + function re-issue) | DB: every lookup returns the primary search; existing users unchanged | Regression of J-1, J-7, J-8, J-9 | G2 | No behaviour change for existing users; succession-ready |
| P1-06 | D-05, D-06; AUTH-005, INFRA-017; C-02; N-1…N-4 | Account deletion: server route + privileged scoped key + transactional SQL (succession, re-attribution, personal-data purge, Realtor FK fixes, storage purge) + Account UI with disclosure | P1-04 helpers, P1-05 | P1-04, P1-05, **Q-01–Q-03**, key-scope approval | L | **High** | SQL ✔ (FKs, function); privileged key scope | DB: solo owner, owner+co-buyer (incl. successor with primary search), owner+Realtor, co-buyer, Realtor author, retry after partial failure; other users' data unchanged | Delete a real test account in each role | G2 (platform-required at G3) | The shared search survives for the co-buyer; the deleted user's personal data is gone; nothing merged |
| P1-07 | D-16; INFRA-012; C-10 | Display-name privacy: internal unchecked function + relationship-checked public wrapper; separate follow-up for the membership helpers | 09-19 function body | P0-01 (the client caller exists) | S–M | Med | SQL ✔ | DB: unrelated user gets the fallback; all 7 internal callers unchanged; the `4168309` label still works | Spot-check names in the roster, compare, invite preview | G2 | No name leak to unrelated users |

## Phase 2 — Onboarding V2 and core experience

| Task | IDs | Description | Reuse | Depends on | Effort | Risk | Migrations / external config | Automated tests | Manual QA | Gate | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P2-01 | D-02; ONBOARD-003…008; C-06 | V2 shell + Welcome, Who, Basics, Priorities, Tour Discoveries concept, Import lesson; entrant routing per C-06 (new / invited-new / existing / Realtor-started / Realtor) | `onboardingFlow.js` V2 keys, `onboarding_state`, existing editors, `4168309` `shared_search_setup` | **P0-01** | L | Med | None (state model exists; production presence verified in P0-02) | Flow unit tests per entrant; DB onboarding-state tests | Full V2 on iPhone; interrupted resume; existing account never re-gated | G2 | Every row of the C-06 table behaves as specified |
| P2-02 | D-02; MATCH-008, ONBOARD-006; locked 6 | Location areas with labelled ranks + Locations step + My Search editor + "In your areas" criterion (Unknown when unverifiable) | `PlacesEditor`, `commute_destinations` | P2-01 shell | L | High | SQL ✔ (area model, `homes` locality fields) | JS + SQL parity fixtures | Rank labels never change the score | G2 | Ranks are labels only; Unknown ≠ No |
| P2-03 | Locked 8, 9; MATCH-004/005/009; R-1, R-2 | Match semantics: "Pre-tour" Match label + coverage; after-tour discoveries as a separate assessment; SQL legacy-alias parity | `computeMatch`, `resolve_cobuyer_compare_perspectives`, parity test | — (parallel with P2-01) | L | **High** | SQL ✔ (scorer re-issue) | Shared fixtures through both scorers; tour answers no longer move the pre-tour % | Compare co-buyer perspectives before and after | G2 | Parity tests green; pre/after-tour separated in UI and SQL |
| P2-04 | D-02; ONBOARD-009 | First Match reveal moment after the first home | Match panel | P2-01, P2-03 | M | Low | — | Render/flow test | First home on device | G2 | Reveal shows the pre-tour Match + explanation |
| P2-05 | D-02; ONBOARD-010 | Homes + Get Started contextual checklist | `flhMoments`, empty states | P2-01 | M | Low | — | Unit tests | Device | G2 | Checklist reflects real progress; dismissible |
| P2-06 | D-15; HOMES-007; C-07 | Offer Submitted / Under Contract: `homes.offer_stage` + badge, set/clear, filter, Compare, Realtor read-only, archive warning | `homes` update policy, `HomeDetail`, `CompareBoard` | P0-03 (legacy counts), **Q-08** | M | Low–Med | SQL ✔ (additive columns + check) | DB: buyers set, Realtor can't; personal states unchanged; Match unchanged | Set/clear on device; co-buyer sees it | G2 | Search-wide stage visible to all members; nothing else in the lifecycle changes |
| P2-07 | D-03, D-02, D-07…D-09; QA J-1, J-7…J-9 | Journey regression across existing-account, co-buyer and Realtor flows on the V2 build | QA matrix | P1-01…P1-04, P2-01…P2-06 | M | Med | — | Full suite + new Playwright smoke (if added) | QA matrix rows J-1…J-22 + E-1…E-18 | G2 | Results log complete; no P0/P1 defects open |

## Phase 3 — Native polish and free TestFlight

| Task | IDs | Description | Reuse | Depends on | Effort | Risk | Migrations / external config | Automated tests | Manual QA | Gate | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P3-01 | D-04; IOS-010 | iPhone-only target (`TARGETED_DEVICE_FAMILY = 1`, both targets); keep iPad *browser* access working | — | — | S | Low | Xcode project | Source test on pbxproj | Install on iPhone; open the site in iPad Safari | G1 | iPhone-only binary; iPad web unaffected |
| P3-02 | IOS-006/007/012; RELEASE-009 | iOS config: `NSCameraUsageDescription` (+ photo library if needed), `ITSAppUsesNonExemptEncryption = NO`, drop `armv7`, `PrivacyInfo.xcprivacy`, Release `CAPACITOR_DEBUG` off, version/build scheme | — | — | S | Low | Xcode project | Source tests | Take Photo works; upload passes validation | G1 | Upload accepted with no warnings; no camera crash |
| P3-03 | D-17; IOS-009; C-09 | Branded offline screen **bundled in the binary** + Retry; native loading state; native-version header for an "update required" path | Capacitor shell, `ios-shell-placeholder` | P3-02 | M | Med | — | Unit test for the version gate | Airplane mode, server 5xx, DNS failure, slow network | G1 | Offline screen always appears instead of a blank WebView; Retry recovers |
| P3-04 | D-18; IOS-004/011 | Purposeful native polish: keyboard avoidance, safe areas, navigation/back, share handoff timing, link handling (`www.` host), haptics where meaningful | Safe-area contract, `DeepLinkBridge`, Share Extension | P3-02 | M | Med | — | Existing iOS source tests + new ones | `native-device-qa.md` checklist | G1 | Checklist passes on a small and a large iPhone |
| P3-05 | D-11; INFRA-014 | Remove the floating Beta Feedback tab; add "Send Feedback" in Account (same submission flow) | `BetaFeedback.jsx`, `beta_feedback` table | P0-02 (feedback verified) | S | Low | — | Source + unit tests | Submit from Account | G1 | No floating tab; submissions still stored |
| P3-06 | D-13, D-14; RELEASE-001…003 | Draft Privacy Policy + Terms from verified data flows (incl. email provider, monitoring, Google, RentCast, deletion and retention semantics, purchases); `/support` page + support email; footer and Account links. **Review before publication** | Privacy inventory in the technical audit | P1-03, P1-06, P0-07 decisions | M | Med | Mailbox setup + verification | Link tests | Owner and reviewer read-through; send a test email to support | G2 (policy URL) | Pages live; mailbox verified; no "attorney-approved" claim |
| P3-07 | RELEASE-006/007/008 | Internal TestFlight: archive, upload, tester group; device QA results logged | — | P3-01…P3-05, Phase 0 | S–M | Med | App Store Connect | — | QA matrix on TestFlight builds | **G1** | Build installable; G1 checklist complete |
| P3-08 | RELEASE-004/005/007 | External TestFlight: Beta App Review info, demo account, review notes (4.2), privacy URL | P3-07 | Phase 1 + Phase 2 complete, P3-06 | S | Med | App Store Connect | — | External tester smoke | **G2** | Beta App Review passed (not guaranteed; plan for iteration) |

## Phase 4 — FLH+ and public launch

| Task | IDs | Description | Reuse | Depends on | Effort | Risk | Migrations / external config | Automated tests | Manual QA | Gate | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P4-01 | Locked 1, 4, 6; PAY-001/005; C-08 | `entitlements` table (no client writes), `search_has_plus`, guard flag row; grandfather migration design (**Q-06**) | — | Q-06 | M | High | SQL ✔ | DB: RLS denies client writes; `search_has_plus` buyer-only | — | G3 | Server truth only; Realtors never unlock |
| P4-02 | Locked 2, 3, 4; PAY-006/007 | Server-enforced limits: 3rd non-staged home, collaboration beyond the free loop (**Q-07, Q-10**); ship disabled, enable at launch | P4-01 | P4-01 | M | High | SQL ✔ | DB: free 1–2, 3rd blocked; grandfathered unaffected; flag off = no gating | Hit limits with a post-cutoff account | G3 | Guards can't be bypassed from the client |
| P4-03 | Locked 1, 7; PAY-002/003 | StoreKit 2 purchase (Capacitor plugin) + server verification (App Store Server API) + restore (no reassignment) + Server Notifications V2 (refund → revoke) | P4-01 | P4-01, App Store Connect product **$9.99 non-consumable** (subject to App Store Connect config) | XL | **High** | Privileged scoped key; ASC keys; webhook URL | Verification, idempotency, restore-claimed, refund tests with fixtures | Sandbox purchase, restore, refund on device | G3 | Purchase and restore verified server-side; refunds revoke; no silent transfer |
| P4-04 | PAY-004 | Paywall sheet + Account purchase state (owned, grandfathered, restore button) | P4-01…P4-03 | P4-03 | M | Med | — | Render/unit tests | Copy review; small-screen check | G3 | Accurate state for every source |
| P4-05 | Locked 6 | Execute the grandfather migration at the go-live cutoff (auditable) | P4-01 | Owner go/no-go | S | High | SQL ✔ (data) | DB dry-run on a production-shaped copy | Count before and after | G3 | Every pre-cutoff account has exactly one `grandfather` row |
| P4-06 | INFRA-008, PAY-008 | Product analytics sink for onboarding and paywall funnels (privacy-reviewed) | `analytics.js` | D-10 vendor | M | Low | Vendor | Sink unit tests | Event spot-check | G3 (optional) | Events flow; no sensitive payloads |
| P4-07 | RELEASE-004/005; D-04; C-09 | App Store metadata, **iPhone** screenshots, App Privacy label (from verified flows), IAP review info, 4.2 notes; submission | P3-08 | All above | M | Med | App Store Connect | — | Final regression on the release candidate | **G3** | Submitted; no approval date promised |

## Phase 5 — Post-launch

| Task | IDs | Description | Effort | Notes |
|---|---|---|---|---|
| P5-01 | D-04; FUTURE (iPad) | Native iPad support, layouts and screenshots | L | |
| P5-02 | D-07; COLLAB-011, FUTURE-018 | Multiple co-buyers (remove the cap; rewrite the `limit 1` RPCs) | L | |
| P5-03 | INFRA-008 | Product analytics expansion | M | If P4-06 was deferred |
| P5-04 | REALTOR-009, HOMES-011, COLLAB-012/013, NOTIFY-003/004 | Tour scheduling and photos, comments, realtime, push, activity feed | L–XL | |
| P5-05 | T-12…T-14 follow-ups | Remaining least-privilege hardening | S–M | |
| P5-06 | FUTURE-* | Advanced home-search ideas from [ideas-parking-lot.md](ideas-parking-lot.md) | — | Prioritise from beta evidence |

---

## Parallel tracks

These can proceed at the same time without conflict:

| Track | Tasks | Why safe in parallel |
|---|---|---|
| **A. Account integrity (DB-heavy)** | P1-01 → P1-02 → P1-04 → P1-05 → P1-06; P1-07 | Mostly SQL/RPC; minimal UI overlap with onboarding |
| **B. Onboarding UI** | P2-01 → P2-04/P2-05 | UI over existing state; starts as soon as P0-01 merges |
| **C. Match semantics** | P2-03 (then P2-02) | Scorer work; touches neither onboarding screens nor collaboration RPCs, *except* `resolve_cobuyer_compare_perspectives`, so coordinate with nothing else in Track A |
| **D. Native config** | P3-01, P3-02, P3-03, P3-05 | Xcode project and the shell only; can start in Phase 0 |
| **E. Ops** | P0-04, P0-06, P0-07, P0-08, P0-09 | Independent infrastructure |
| **F. Legal/support drafting** | P3-06 drafting | Writing can start early; finalise after P1-03/P1-06 settle the data flows |

Track A and Track B touch different files. The only shared surface is invitation
acceptance UI copy (`co_buyer_limit` and revoked states), so land P1-01/P1-02
before polishing the invite screens in P2-01.

## Critical path

```
P0-01 (merge + real-account QA) ─┬─► P2-01 V2 shell ─► P2-04/05 ─┐
P0-02/03 (prod verify, preflights)┼─► P1-05 primary search ─► P1-06 account deletion ─┤
                                  └─► P1-01 cap ─► P1-02 revoke ─► P1-03 email ──────┤
P2-03 Match semantics ─► P2-02 locations ────────────────────────────────────────────┤
P3-01/02/03 native config ─► P3-07 internal TestFlight (G1) ─────────────────────────┤
                                                                                     ▼
                             P2-07 regression + P3-06 legal ─► P3-08 external TestFlight (G2)
                                                                                     ▼
                     P4-01 ─► P4-02 ─► P4-03 (XL) ─► P4-04 ─► P4-05 ─► P4-07 submission (G3)
```

The longest chain is Phase 1 account integrity plus Phase 2 Match/Location semantics
into G2, followed by StoreKit (P4-03) into G3. **Internal TestFlight (G1) can happen
early**, as soon as Phase 0, P1-01/P1-02 and the Phase 3 native config are done.
It does not need V2.

## Three highest-risk tasks

1. **P1-06 account deletion with automatic succession** (High). Today's FK graph (N-1…N-4) destroys shared data on user deletion. The fix spans succession, re-attribution, personal-data purge, storage and three FK changes, in production, in one transaction, and must be retry-safe.
2. **P4-03 StoreKit purchase, server verification, restore and refunds** (High, XL). This is new external integration with Apple; the correctness rules (no silent transfer, refund revocation) are security-relevant; and it is only testable end to end on a device with sandbox accounts.
3. **P1-05 primary-search model / P2-03 Match semantics** (High, tied). P1-05 touches a core constraint plus 18 lookup sites. P2-03 rewrites the SQL scorer that co-buyer Compare depends on, with known JS/SQL drift (R-1). Both can silently change what existing users see.

---

## Superseded roadmap (original audit, `9032151`) — summary

- **Roadmap A:** free public launch (about 3–4 weeks).
- **Roadmap B:** Onboarding V2 + FLH+ after launch.
- **Roadmap C:** post-launch.

Superseded by D-01 and D-02 on 2026-10-09. Item content was carried forward into
the phases above:
- A1→P0-02
- A2→P0-01
- A3→P0-04
- A4→P0-08/09
- A5→P0-07
- A6→P1-01…P1-03
- A7→P3-01/02
- A8→P3-03
- A9→P3-07
- A10→P3-06
- A11→P1-06
- A12→P0-06
- A13→PR-27 (security headers, Phase 3)
- A14→P3-05
- A15→P4-07
- B1…B11→P2-xx/P4-xx
- C1→P1-03 (now V1)
- C7→P2-06 (now V1)
- the rest of C→Phase 5

The full original text is in git history: `docs/product-audit/roadmap.md` @ `3651f7e`.
