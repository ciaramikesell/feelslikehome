# Technical & security audit

Scope: `main` @ `9032151`. Read-only. No production access.

## Architecture snapshot

- **Web:** Next.js 15.5.25 App Router, React 19.
  - Server Components enforce auth on every navigation (`(app)/layout.js`).
  - The middleware refreshes the Supabase session.
- **Data:** Supabase Postgres with the publishable (anon) key only on the client.
  - RLS is on every table.
  - Cross-user reads go through SECURITY DEFINER RPCs with `set search_path = ''` and an `auth.uid()` check.
- **Server-only secrets:** used by two API routes:
  - `/api/import-listing` uses RentCast;
  - `/api/commute` uses Google Routes and Geocoding.
- **Native:** a Capacitor 8 shell that loads `https://feelslikehome.app` remotely. The only plugin is `@capacitor/app`. There is a Share Extension.
- **Data model:**
  - One owned search per account.
  - `search_members` carries the role: `co_buyer` or `realtor`.
  - Shared home facts live on `homes`.
  - Personal state and priorities are per member.
  - `profiles.active_search_id` selects the search being viewed.

## Strengths

- The authorization model is deliberate and documented:
  - Realtors are read-mostly.
  - Membership can only be created by the email-bound acceptance RPCs (the direct owner insert was removed).
  - Personal state is own-row only.
- Migrations are idempotent and guarded:
  - the 10-08 bridge refuses to downgrade a 4-column function;
  - real-Postgres tests prove it, and also prove privilege preservation.
- "Unknown ≠ No" is implemented consistently in JS and SQL, and a parity test enforces it.
- Server keys never reach the client, and the commute route avoids logging keys.
- The import pipeline never auto-saves and never scrapes listing pages. That reduces both legal and correctness risk.

## Findings

Severity: **H** high · **M** medium · **L** low · **I** informational.

| ID | Sev | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| T-01 | H | No CI. Tests and the build are never run automatically | no `.github/` | Add a GitHub Actions workflow: `npm ci && npm test && npm run build`. Optionally a DB job using the existing harness |
| T-02 | H | No in-app account deletion, and no data-deletion path for removed members | AUTH-005, INFRA-017 | **D-05/D-06 APPROVED:** automatic succession to the remaining co-buyer, personal-data purge, leave retain/delete choice. See C-01…C-03, P1-04…P1-06 |
| T-03 | H | Paid-API spend is not bounded (RentCast, Google Routes, Geocoding). Any signed-in user can loop the endpoints | `import-listing/route.js`, `commute/route.js` | Provider quotas and budgets now; later a per-user rate limit (e.g. a Postgres counter table or an edge KV) |
| T-04 | M | `schema.sql` snapshot lags the migrations (09-19+) | `grep resolve_display_name schema.sql` = 0 | Regenerate the snapshot from a migrated test DB, or document the canonical rebuild order in `database-tests.md` |
| T-05 | M | A second co-buyer is not prevented, while the V1 RPCs assume one (`limit 1`) | collaboration RPCs | Either enforce a cap (constraint or acceptance-RPC check) or design multi-co-buyer support |
| T-06 | M | Pending invitations cannot be revoked | no UPDATE policy or RPC sets `revoked` | Owner-only `revoke_invitation` RPC + UI |
| T-07 | M | No error monitoring or crash reporting; no production analytics sink | `analytics.js:107-108` | **D-10 APPROVED:** error monitoring before beta (P0-07); analytics later. This affects the privacy label |
| T-08 | M | No security headers (CSP, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`) | empty `next.config.mjs` | Add a conservative header set. Test the Maps, YouTube-nocookie and Supabase origins |
| T-09 | M | `npm audit`: 3 high, 1 moderate (next, postcss, sharp, source-map-js) | audit run | Bump `next` within 15.x; re-run the audit |
| T-10 | M | iOS plist gaps: camera usage string, encryption flag, legacy `armv7`; no privacy manifest | `Info.plist`, `find` | Add them before the first TestFlight upload |
| T-11 | L | `resolve_display_name(uuid)` returns a name or email local part for any user | 09-19 migration | Restrict to users sharing a search or invitation with the caller |
| T-12 | L | Membership helper functions (`is_search_member` and others) accept an arbitrary `p_user_id` from `authenticated` | `schema.sql:346-353, 1563-1566` | Make them internal (revoke execute) or force `auth.uid()` |
| T-13 | L | Some suggestion RPCs revoke only from `public`, not explicitly from `anon` | `schema.sql:2370-2375` | Add an explicit `revoke … from anon` for consistency |
| T-14 | L | `prospective_searches`: `authenticated` keeps broad table grants; effective UPDATE is owner-only through RLS | earlier audit | Narrow the column privileges |
| T-15 | L | `.env.example` is incomplete (`RENTCAST_API_KEY`, `APPLE_TEAM_ID`, `CAP_SERVER_URL`) | `.env.example` | Document them |
| T-16 | L | Removed members' personal rows persist | `search_members` delete only | Decide on retention; cleanup on leave or account delete |
| T-17 | I | 38 of 76 test files are source-text assertions | test classification | Add a small set of behaviour tests (component render or Playwright) for the top journeys |
| T-18 | I | No lint or typecheck | `package.json` | Add `next lint` (ESLint) as a first step |
| T-19 | I | The native shell depends on a live web deploy, so a web regression is an app regression | Capacitor remote mode | Preview-deploy QA plus CI before promoting to production |
| T-20 | I | `CAPACITOR_DEBUG = true` in the debug config | `ios/debug.xcconfig` | Confirm the Release configuration doesn't inherit it |

### Findings added in the decision-lock pass (2026-10-09)

Details are in [decision-implementation-conflicts.md](decision-implementation-conflicts.md#new-evidence-found-during-this-pass).

| ID | Sev | Finding | Evidence | Recommendation / task |
|---|---|---|---|---|
| T-21 | H | Deleting an auth user cascades to their owned shared search (N-1) and to shared homes they created in any search (N-2); other homes are orphaned (N-3). **Do not delete users from the dashboard** until P1-06 | `schema.sql:81, 111, 112` | C-02 / P1-06 |
| T-22 | M | Realtor-authored rows are `on delete restrict`, so deleting a Realtor account fails (N-4) | `schema.sql:2236, 2395, 2407` | C-02 / PR-13 |
| T-23 | M | Realtors can read departed members' retained personal rows (N-5) | `schema.sql:1573-1596` | C-03 / P1-04 |
| T-24 | M | Concurrent acceptance of two co-buyer invitations is not serialised (N-6) | `2026-10-07-…-conflict-targets.sql:53` | C-04 / P1-01 (partial unique index) |
| T-25 | M | The Vercel bot listed the production domain as the preview for a non-`main` branch (N-10). If real, unmerged code reaches iOS users | PR #138 bot comment | C-09 / P0-05 |
| T-26 | I | The in-flight fix adds a client caller of `resolve_display_name` (N-8). The D-16 wrapper must keep allowing an owner's name to that owner's members | `4168309` | C-10 / P1-07 |

### Privacy and redaction requirements from the locked decisions

- **D-10 monitoring:** scrub invitation tokens (`/invite/<uuid>`), emails, street addresses, notes and listing URLs from error payloads and breadcrumbs. Disable session replay, or mask all inputs.
- **D-08 email:** the provider processes invitee emails and names, so it must be disclosed (D-13). Send-rate limits prevent abuse.
- **D-05/D-06:**
  - account deletion purges personal rows and storage;
  - leave-and-retain data is hidden from everyone else;
  - the retention semantics go into the privacy policy.
- **FLH+:** Apple transaction ids are personal data linked to the account. Retention on account deletion is to be decided in P4-01.

## Privacy inventory (input for the App Privacy label and the policy)

| Data | Where | Linked to user | Shared with |
|---|---|---|---|
| Email, name | Supabase auth + `profiles` | Yes | Collaborators see names (and email in invitations) |
| Home addresses, listing URLs, prices, notes, photos | `homes`, storage | Yes | Search members |
| Preferences / priorities | `search_member_priorities` | Yes | Realtor on that search can read them |
| Places (addresses of work, school, etc.) | `commute_destinations` | Yes | Co-buyer (map) and Realtor read |
| Commute queries | Google Routes / Geocoding | Addresses sent | Google |
| Listing address lookups | RentCast | Address sent | RentCast |
| Beta feedback (route, viewport, app version, text) | `beta_feedback` | Yes | None (insert-only) |
| Analytics | none in production today | — | — |

## Production verification commands

See [audit-evidence.md](audit-evidence.md#production-checks-the-owner-should-run-read-only).
None of them write data.
