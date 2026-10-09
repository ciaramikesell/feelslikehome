# Ideas parking lot

This file lists every idea found in the briefs, the earlier audits and the docs that
is **not built**. Nothing here is a launch blocker unless
[launch-readiness.md](launch-readiness.md) says so. Nothing has been dropped: where
an idea was rejected or adapted earlier, that is recorded here.

The **Source** column uses these abbreviations:

| Abbreviation | Meaning |
|---|---|
| V2 brief | The Onboarding V2 / FLH+ brief |
| V2 audit | `docs/onboarding-v2-product-evolution-audit.md` |
| Locked | A decision locked on 2026-10-07 |

| ID | Idea | Source | Status | Notes / why parked |
|---|---|---|---|---|
| FUTURE-001 | Onboarding V2 full sequence (Welcome → … → Get Started) | V2 brief; Locked 1 | NOT STARTED (paused) | Roadmap B1–B5 |
| FUTURE-002 | Ranked location areas, "In your areas" criterion | V2 brief; Locked 6 | NOT STARTED | Roadmap B2 |
| FUTURE-003 | Polygon / proximity micro-areas, GIS boundaries | V2 brief | DEFERRED | V2 audit: "unnecessarily risky now" |
| FUTURE-004 | Automatic school-district evaluation (NCES / ATTOM) | V2 brief | DEFERRED | No data source |
| FUTURE-005 | Tour Discoveries watchlist (per-user, things to check on tour) | V2 brief | NOT STARTED | Roadmap B1/B3 |
| FUTURE-006 | "Pre-tour" Match label + coverage + after-tour separation | Locked 7 | NOT STARTED | Roadmap B3 |
| FUTURE-007 | Match breakdown groups ("why this score" by weight) | V2 audit Part 3 §7 | NOT STARTED | |
| FUTURE-008 | First Match reveal moment | Locked 1 | PARTIAL | Ready screen only |
| FUTURE-009 | Get Started contextual checklist | Locked 1 | NOT STARTED | Roadmap B5 |
| FUTURE-010 | Import / share lesson (`/help/share`) | Locked 1 | NOT STARTED | Candidate for Roadmap A (D-02) |
| FUTURE-011 | Mine / Theirs / Together views | V2 audit Phase 7 | NOT STARTED | Roadmap B6 |
| FUTURE-012 | "Add to mine" explicit criterion copy | Locked 10 | NOT STARTED | |
| FUTURE-013 | Bring my preferences into a joined shared search | V2 audit findings | NOT STARTED | Joined co-buyers start with an empty Match |
| FUTURE-014 | Per-home co-buyer criteria evaluation (researcher behaviour) | Locked 10 | NOT STARTED | |
| FUTURE-015 | FLH+ entitlement, StoreKit, restore, refunds (ASSN V2), paywall, gates, grandfathering | V2 brief; Locked 2–5, 8 | NOT STARTED | Roadmap B7–B9 |
| FUTURE-016 | Web checkout (Stripe) | V2 brief | DEFERRED | Locked 3: iOS first; web honours entitlements but doesn't sell |
| FUTURE-017 | Realtor-side monetization | V2 audit | DEFERRED | Locked 2: Realtors free |
| FUTURE-018 | Multiple co-buyers per search | V2 audit | DEFERRED | V1 RPCs assume one; see D-07 |
| FUTURE-019 | Multiple owned searches per user | V2 audit | DEFERRED | `unique(user_id)` |
| FUTURE-020 | Admin-managed criteria catalog | V2 audit | DEFERRED | |
| FUTURE-021 | Hard DB-enforced home caps before entitlements are proven | V2 audit | DEFERRED | Rejected for now (V2 audit). Risky; gate in app logic first |
| FUTURE-022 | Bulk SQL migration of priority JSON | V2 audit | DEFERRED | Rejected for now (V2 audit). Prefer lazy normalisation |
| FUTURE-023 | "Ideal" beds/baths | V2 brief | SUPERSEDED | Kept "at least" semantics (Locked 1) |
| FUTURE-024 | Name on the Basics screen | V2 brief | SUPERSEDED | Captured at sign-up |
| FUTURE-025 | Trulia import support | V2 brief | NOT STARTED | Must not be advertised; generic fallback only |
| FUTURE-026 | Fuzzy duplicate detection | import docs | DEFERRED | Exact-match only, by design |
| FUTURE-027 | Fetch listing pages (photos, status) | import-enrichment audit | DEFERRED | No scraping |
| FUTURE-028 | Beta feedback screenshot attachment | pre-beta-feedback runbook | DEFERRED | No bucket created |
| FUTURE-029 | Beta feedback email notification | pre-beta-feedback runbook | DEFERRED | No email transport |
| FUTURE-030 | Transactional email (invites, suggestions) | #82 doc | NOT STARTED | Roadmap C1 |
| FUTURE-031 | Push notifications | native docs | NOT STARTED | Roadmap C2 |
| FUTURE-032 | Realtime collaboration / activity feed | — | NOT STARTED | Roadmap C3 |
| FUTURE-033 | Comments on homes | — | NOT STARTED | Roadmap C4 |
| FUTURE-034 | Tour scheduling / calendar | #82 doc | NOT STARTED | Roadmap C6 |
| FUTURE-035 | Tour photos / voice notes | — | NOT STARTED | |
| FUTURE-036 | Offer / under-contract / closed lifecycle | legacy statuses | NOT STARTED | D-15 |
| FUTURE-037 | Rental details (lease terms, fee matrices, pet restrictions, amenity catalogs) | rental audits | DEFERRED | Use custom criteria / notes |
| FUTURE-038 | Dogs / Cats Allowed suggestions | rental audits | DEFERRED | Until beta evidence asks for them |
| FUTURE-039 | Moving buyer notes/pros/cons to per-participant notes | #78 doc | DEFERRED | Destructive migration risk |
| FUTURE-040 | Brokerage / team Realtor accounts, CRM export | — | NOT STARTED | |
| FUTURE-041 | Dark mode | — | NOT STARTED | Roadmap C9 |
| FUTURE-042 | Personal data export | — | NOT STARTED | |
| FUTURE-043 | Email / password change in Account | — | NOT STARTED | |
| FUTURE-044 | Sign in with Apple | — | NOT STARTED | Becomes **required** if any social login is ever added |
| FUTURE-045 | Additional native features (widgets, Siri, haptics) to strengthen App Review 4.2 | — | NOT STARTED | Only if rejected (D-18) |
| FUTURE-046 | Regenerate `schema.sql` from a migrated DB | V2 audit findings | NOT STARTED | Roadmap C11 |
| FUTURE-047 | `AcceptInvitationClient` sanitized error reasons (comment drift) | V2 audit findings | NOT STARTED | Small diagnostics improvement |
| FUTURE-048 | Pending invitations users gave up on during the 42702 window: re-send | V2 audit findings | NOT STARTED | Read-only query first; owner decides outreach |
