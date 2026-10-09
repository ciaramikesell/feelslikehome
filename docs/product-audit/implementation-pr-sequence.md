# Implementation PR sequence (proposed, not implemented)

This is a sequence of small, reviewable PRs implementing [roadmap.md](roadmap.md).
**None of these PRs has been opened or implemented.** Do not start until the
product owner has reviewed the roadmap.

## Rules for every PR

- **One concern per PR.** Database, payment, onboarding and native changes never share a PR.
- **SQL PRs**
  - A SQL PR ships the migration file, a read-only preflight, a verification query, and real-Postgres tests proving:
    - existing data and permissions are preserved;
    - the migration is idempotent.
  - **Merging a SQL PR does not apply it.** Production application is a separate, owner-approved step, following `docs/production-schema-drift-repair.md` practice: preflight, then apply, then verify.
- **Never** move, merge or delete existing user data except where the PR's purpose and the owner's approval explicitly cover it (account deletion, an approved backfill).
- The web deploy reaches the iOS app immediately, so every PR keeps CI green, gets preview QA, and avoids a breaking change without a native-version gate.

## Phase 0

| # | Suggested PR title | Scope / exclusions | Prerequisites | Acceptance criteria | Tests | Production migration / config | Owner approval |
|---|---|---|---|---|---|---|---|
| PR-01 | *Existing accounts join shared searches without losing sight of their own* (`4168309`) | As built: `shared_search_setup`, switcher sheet, keyed remount, labels. **No** SQL | — | J-8 passes on both real accounts | Existing suite (719/719 re-run 2026-10-09) | None; deploy only | Merge + QA sign-off |
| PR-02 | Run tests and build on every pull request | GitHub Actions workflow + Postgres service. **No** app changes | — | CI green on `main`; red on an injected failure | CI | None | Merge |
| PR-03 | Read-only preflights for collaboration and account work | One read-only SQL file (duplicate co-buyers, multiple owned searches, Realtor-authored rows, co-buyer-created homes, legacy offer statuses, departed-member retained rows) | — | File provably read-only | Harness test executing it on a seeded DB | Owner runs it in production (read-only) | Run approval |
| PR-04 | Patch Next.js and audited dependencies | Version bumps only | PR-02 | 0 high advisories, or each documented | Suite + build | None | Merge |
| PR-05 | Production error monitoring with redaction | SDK, scrubber, release tags. **No** analytics | PR-02 | Test error visible; scrubbed | Scrubber unit tests | Vendor DSN env var | Vendor choice |
| PR-06 | Rate-limit paid API routes | Per-user limits on import and commute; friendly 429; optional short import cache. **Provider budgets are configured separately in consoles** | PR-02 | Limits enforced; normal use unaffected | Route tests | A rate-limit table (SQL) or KV; console quotas and alerts | SQL apply + console config |
| PR-07 | Document every runtime environment variable | `.env.example` + README | — | Complete list | Source test | None | Merge |

## Phase 1

| # | Suggested PR title | Scope / exclusions | Prerequisites | Acceptance criteria | Tests | Production migration / config | Owner approval |
|---|---|---|---|---|---|---|---|
| PR-08 | Enforce one co-buyer per search at acceptance | Partial unique index, `co_buyer_limit` reason, UI copy. **Excludes** revocation and email | PR-03 shows 0 duplicates | Concurrent accept → exactly one | DB concurrency test (two connections) | SQL ✔ | Apply |
| PR-09 | Create and revoke invitations through RPCs | `create_invitation` (dedupe, cap guard), `revoke_invitation`, pending list UI. **Excludes** email | PR-08 | Revoked link refused; duplicates reuse the row | DB + UI tests | SQL ✔ | Apply |
| PR-10 | Send invitation emails alongside copyable links | Provider integration, send route, send-status columns, separate Send/Copy UI, Auth custom SMTP | PR-09; provider chosen (Q-09) | Real delivery; failures shown | Route tests (mocked provider) | SQL ✔ (columns); provider, DNS, server key | Provider + DNS + apply |
| PR-11 | Leave a search, keeping or deleting your data | `leave_search` RPC, Leave sheet, **Realtor read policies limited to current decision-makers** | PR-03 | Retained data invisible; rejoin restores | DB tests per mode | SQL ✔ | Apply |
| PR-12 | Primary-search model for safe ownership succession | `is_primary` + partial unique index; update the 13 SQL + 5 JS lookups. **No** deletion UI | PR-03 shows 0 multi-owned | Zero behaviour change for existing users | DB tests on every lookup | SQL ✔ (constraint + functions) | Apply |
| PR-13 | Fix account-deletion blockers in foreign keys | Realtor-authored FKs (N-4) → set null or delete per the recommendation; `homes.user_id` re-attribution helper. **No** UI | PR-12; Q-02 | Realtor deletion no longer blocked (in tests) | DB tests | SQL ✔ | Apply |
| PR-14 | Delete your account (with shared-search succession) | Server route, privileged scoped key, transactional SQL, storage purge, Account UI with disclosure | PR-11, PR-12, PR-13; Q-01–Q-03; key-scope approval | All C-02 scenarios pass | DB + route tests; snapshot that other users are unchanged | SQL ✔; server key env var | Apply + key scope |
| PR-15 | Restrict display-name lookups to related accounts | Internal unchecked function + checked wrapper. **Excludes** the membership helpers | PR-01 merged | Unrelated → fallback; callers unchanged | DB tests | SQL ✔ | Apply |
| PR-16 | Stop membership helpers answering for other users | Revoke or guard per policy dependency | PR-15 | No policy regressions | Full DB suite | SQL ✔ | Apply |

## Phase 2

| # | Suggested PR title | Scope / exclusions | Prerequisites | Acceptance criteria | Tests | Production migration / config | Owner approval |
|---|---|---|---|---|---|---|---|
| PR-17 | Onboarding V2 shell and entrant routing | Shell, routing table (C-06), Welcome + Who screens, version handling. **No** new criteria logic | PR-01 | Existing accounts never re-gated | Flow tests per entrant | None | Merge |
| PR-18 | Onboarding V2: Basics, Priorities, Tour Discoveries concept, Import lesson | Screens reusing existing editors | PR-17 | Full sequence minus Locations | Flow tests | None | Merge |
| PR-19 | Separate pre-tour Match from after-tour discoveries | JS scorer + SQL scorer re-issue + parity fixtures (incl. legacy alias folding, R-1) | — | Parity green; tour answers don't move the pre-tour % | Parity + DB tests | SQL ✔ | Apply |
| PR-20 | Location areas with labelled ranks | Area model, Locations step + My Search editor, "In your areas" (Unknown if unverifiable) in JS and SQL | PR-17, PR-19 | Ranks never weight | Parity + DB | SQL ✔ | Apply |
| PR-21 | First Match reveal and Get Started | Reveal moment + checklist | PR-18, PR-19 | Shown once; reflects real data | Unit/render | None | Merge |
| PR-22 | Offer Submitted and Under Contract | `homes.offer_stage` + UI (badge, set/clear, filter, Compare, Realtor read-only, archive warning). **Excludes** contracts/escrow/documents | PR-03 (legacy counts); Q-08 | Personal lifecycle and Match unchanged | DB + UI | SQL ✔ (additive); optional backfill needs separate approval | Apply |

## Phase 3

| # | Suggested PR title | Scope / exclusions | Prerequisites | Acceptance criteria | Tests | Production migration / config | Owner approval |
|---|---|---|---|---|---|---|---|
| PR-23 | iPhone-only native target and iOS privacy configuration | Device family, plist keys, privacy manifest, Release debug off, versioning. **No** web changes | — | Upload validation clean; camera works | Source tests | Xcode only | Merge |
| PR-24 | Branded offline screen with Retry | Bundled offline page + native-version header | PR-23 | Offline/5xx/DNS show the screen; Retry recovers | Unit + device | None | Merge |
| PR-25 | Native polish: keyboard, navigation, share handoff | Per the native-device-qa checklist | PR-23 | Checklist passes | iOS source tests | None | Merge |
| PR-26 | Move feedback into Account | Remove the floating tab; "Send Feedback" entry | — | Submission unchanged | Source/unit | None | Merge |
| PR-27 | Security headers | CSP and friends, tested against Maps / YouTube / Supabase | PR-02 | No console CSP violations on the top journeys | Header tests | None | Merge |
| PR-28 | Support page and legal pages (draft) | `/support`, `/privacy`, `/terms` pages + links. **Content needs review before publication** | PR-10, PR-14 data flows | Pages live behind the owner's go-ahead | Link tests | Mailbox setup | Content review + publish |

## Phase 4

| # | Suggested PR title | Scope / exclusions | Prerequisites | Acceptance criteria | Tests | Production migration / config | Owner approval |
|---|---|---|---|---|---|---|---|
| PR-29 | FLH+ entitlement model | Table, `search_has_plus`, guard flag (off). **No** StoreKit, **no** UI | Q-06 | No client writes possible | DB/RLS tests | SQL ✔ | Apply |
| PR-30 | Server-enforced free limits (disabled by default) | Home-count and collaboration guards behind the flag | PR-29; Q-07, Q-10 | Flag off = unchanged; on = enforced | DB tests | SQL ✔ | Apply |
| PR-31 | Verify App Store purchases on the server | Verification route, ASSN V2 webhook, restore rules, idempotency. **No** client purchase UI | PR-29 | Fixtures: purchase, restore-claimed, refund | Route tests | Privileged key scope; ASC API keys; webhook URL | Key + ASC config |
| PR-32 | StoreKit purchase and restore in the app | Capacitor StoreKit plugin + client flow | PR-31 | Sandbox purchase/restore on device | Unit + device | ASC product ($9.99 non-consumable, subject to ASC config) | ASC product |
| PR-33 | Paywall and Account purchase state | UI only | PR-30, PR-32 | Correct state per source | Render tests | None | Copy review |
| PR-34 | Grandfather pre-monetization accounts | Auditable data migration at the cutoff | PR-29; Q-06 | Exactly one grandfather row per eligible account | Dry-run test | SQL ✔ (data) | Go/no-go |
| PR-35 | Product analytics sink (optional for G3) | Sink + funnel events, redaction | PR-05 | Privacy-reviewed | Unit | Vendor | Vendor |

App Store metadata, screenshots and the privacy label (P4-07) are App Store Connect
work, not a PR.
