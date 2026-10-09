# Roadmaps

There are three roadmaps:
- **Roadmap A (Minimum Reliable Launch):** the shortest honest path to a free App Store launch.
- **Roadmap B (Ideal V1):** adds Onboarding V2 and FLH+.
- **Roadmap C (Post-Launch):** growth and depth work after launch.

**How to read the tables**
- Effort: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks · **XL** > 2 weeks.
- Risk is delivery or regression risk. Impact is user or launch impact.
- Everything that touches production SQL needs the owner's explicit approval at the
  time it is applied. None of it was done in this audit.

## Roadmap A — Minimum Reliable Launch (free; L0 → L3)

| # | Item | IDs | Depends on | Effort | Risk | Impact | Reason |
|---|---|---|---|---|---|---|---|
| A1 | Run the read-only production checks (inventory, fingerprints, co-buyer checks, beta-feedback verification, env-var names, AASA curl) | INFRA-003/013/014, IOS-002 | — | S | Low | High | Turns 16 NEEDS VERIFICATION rows into facts |
| A2 | Review, QA and merge the multi-search invitation fix (`4168309`) | SEARCH-002, COLLAB-003/004, DESIGN-006 | A1 | S | Med | High | Fixes the "my search vanished" incident |
| A3 | Add CI (tests + build on PR) | INFRA-005 | — | S | Low | High | Remote-hosted app ⇒ every web merge ships to iOS |
| A4 | Provider quotas/budgets for RentCast + Google; complete `.env.example` | INFRA-010/015 | — | S | Low | Med | Bounded cost; reproducible env |
| A5 | Error monitoring (D-10) | INFRA-007 | A3 | S | Low | High | See launch failures |
| A6 | Co-buyer cap (D-07), revoke invitation (D-09), relabel "Send" → "Copy link" (D-08) | COLLAB-009/010/011 | A2 | M | Med | Med | Prevents a wrong-perspective state; honest copy. Includes a migration needing approval |
| A7 | iOS plist hygiene: camera string, encryption flag, drop `armv7`, privacy manifest; iPhone-only if D-04 | IOS-006/007/010 | — | S | Low | High | TestFlight upload prerequisites |
| A8 | Native offline fallback screen | IOS-009 | A7 | S | Low | Med | Reviewer airplane-mode test |
| A9 | Device QA pass (native-device-qa.md + [qa-matrix.md](qa-matrix.md)) → TestFlight internal | RELEASE-006/008 | A2, A7, A8 | M | Med | High | First real-device evidence |
| A10 | Privacy policy, terms, support page + landing footer links | RELEASE-001/002/003 | D-13/14 | S–M | Low | High | Required for external TestFlight and the App Store |
| A11 | Account deletion (server route, scoped key, cascade per D-05/D-06) | AUTH-005, INFRA-017 | A10 | M | Med | High | Guideline 5.1.1(v) |
| A12 | Patch dependency advisories (bump `next` 15.x) | INFRA-011 | A3 | S | Low | Med | 3 high advisories |
| A13 | Security headers (CSP etc.) | INFRA-009 | A3 | S–M | Med | Med | Defense in depth; test Maps/YouTube |
| A14 | Beta Feedback presentation (D-11) | INFRA-014 | — | S | Low | Low | Review polish |
| A15 | App Store Connect: privacy label, screenshots, review notes + demo account, external TestFlight → submission | RELEASE-004/005/007/009, IOS-011 | A9–A11 | M | Med | High | Launch |

**Critical path:** A1 → A2 → A7 → A9 → A10 → A11 → A15.
**Rough total:** 3–4 focused weeks plus App Review time.

## Roadmap B — Ideal V1 (Onboarding V2 + FLH+)

It builds on Roadmap A. The order follows the 2026-10-07 phase plan, with
dependencies made explicit.

| # | Item | IDs | Depends on | Effort | Risk | Impact | Reason |
|---|---|---|---|---|---|---|---|
| B1 | Onboarding V2 shell + Welcome, Who, Basics, Priorities, Tour Discoveries concept, Import lesson (reusing editors) | ONBOARD-003…008 | A complete | L | Med | High | Activation and collaboration-first |
| B2 | Location areas with labelled ranks + an "In your areas" criterion (JS **and** SQL, parity tests) | MATCH-008, ONBOARD-006 | B1 | L | High | Med | Locked decision 6. Unknown ≠ No |
| B3 | Match semantics: "Pre-tour" label, coverage, after-tour separation, SQL parity incl. legacy alias folding | MATCH-004/005/009 | — | L | High | High | Locked decision 7. Known scorer drift |
| B4 | First Match reveal + `/help/share` lesson | ONBOARD-009 | B1, B3 | M | Low | High | Aha moment |
| B5 | Get Started module | ONBOARD-010 | B1–B4 | M | Low | Med | Guided activation |
| B6 | Mine / Theirs / Together; "Add to mine"; bring-over-my-preferences for joined co-buyers | COLLAB-014 | B3 | L | Med | High | Fixes empty Match for joined co-buyers |
| B7 | FLH+ entitlement table + functions (non-client-writable), grandfathering cutoff | PAY-001/005 | D-01 | M | High | High | Locked decisions 2 and 8 |
| B8 | StoreKit plugin + server verification, restore, App Store Server Notifications V2 (refund → revoke) | PAY-002/003 | B7, App Store Connect product | L–XL | High | High | Locked decisions 3 and 4 |
| B9 | Paywall sheet + gates (Home #3+, collaboration after the free loop), search-scoped checks | PAY-004/006/007 | B7, B8 | L | High | High | Locked decision 5 |
| B10 | Analytics sink + funnel (onboarding, paywall) | INFRA-008, PAY-008 | D-10 | M | Low | Med | Measure monetization |
| B11 | Existing-user regression + device QA (small iPhone, Dynamic Type, VoiceOver) | DESIGN-003 | all | M | Med | High | Phase 9 of the plan |

**Rough total:** 8–12 weeks after A.

## Roadmap C — Post-Launch

| # | Item | IDs | Depends on | Effort | Risk | Impact | Reason |
|---|---|---|---|---|---|---|---|
| C1 | Transactional email (invites, suggestions, tour suggestions) | NOTIFY-002, COLLAB-010 | provider choice | M | Low | High | Invitation completion rate |
| C2 | Push notifications | NOTIFY-003, IOS-008 | C1 patterns | L | Med | Med | Re-engagement |
| C3 | Realtime updates / activity feed | COLLAB-013, NOTIFY-004 | — | M–L | Med | Med | Live co-buying |
| C4 | Comments on homes | COLLAB-012 | — | M | Low | Med | Discussion in context |
| C5 | Multiple co-buyers | COLLAB-011 | D-07 reversal, B3 | L | High | Low–Med | Households > 2 |
| C6 | Tour scheduling, tour photos | REALTOR-009, HOMES-011 | — | L | Med | Med | Realtor value |
| C7 | Offer / contract statuses | HOMES-007 | — | S–M | Low | Low | Late-funnel |
| C8 | Server commute cache + app rate limits | MATCH-013, IMPORT-009 | — | M | Low | Med | Cost at scale |
| C9 | Dark mode | DESIGN-005 | — | M | Low | Low | Polish |
| C10 | Browser/E2E tests for the top journeys | T-17 | A3 | M | Low | High | Real behaviour coverage |
| C11 | Regenerate `schema.sql` from a migrated DB | INFRA-004 | — | S | Low | Med | Disaster recovery |
| C12 | Privacy hardening: `resolve_display_name`, membership helpers, anon revokes | INFRA-012, T-11…T-14 | approval | S | Low | Med | Least privilege |
| C13 | Web purchase (Stripe), Realtor monetization, multiple owned searches, school/GIS data | PAY-009, SEARCH-003 | strategy | XL | High | ? | See [ideas-parking-lot.md](ideas-parking-lot.md) |
