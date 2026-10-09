# Audit evidence

This file records what was checked, how it was checked, and what was found. Each
claim in the other audit documents should trace back to a line here.

## Baseline

- **Repository:** `ciaramikesell/feelslikehome`, `main` @ `9032151` ("Merge pull request #137"), date 2026-10-09.
- **Audit branch:** `claude/product-audit-docs`. It contains documentation only (`docs/product-audit/`).
- **In-flight, unmerged work:** `claude/charming-bell-i0xo4w` @ `4168309`, "Existing accounts join shared searches without losing sight of their own". It is not in `main` (`git log origin/main..origin/claude/charming-bell-i0xo4w` shows it).
  - Its own reported results: 719/719 tests and a passing build. This audit did **not** re-verify that branch and did not touch its files.
- **GitHub state:** at the time of the audit there were 0 open issues and 0 open PRs. The "#77", "#78" and similar numbers in docs refer to earlier PRs or native-sequence labels, not to open issues.
- **What was not available:**
  - production Supabase;
  - the production Vercel project and environment variables;
  - App Store Connect;
  - Xcode and a physical device.

## Commands run (all non-destructive)

| Command | Result |
|---|---|
| `FLH_TEST_PGHOST=/var/lib/postgresql/flh-test FLH_TEST_PGPORT=54329 npm test` | **710 tests, 710 pass, 0 fail, 0 skipped** |
| `npm test` (no DB) | 710 tests, 682 pass, 0 fail, 28 skipped (the DB tests) |
| `npm run build` | **Success.** All routes compiled; middleware 93.4 kB; shared JS 103 kB |
| `npm audit --omit=dev` | 4 vulnerabilities: 3 high (postcss, sharp, source-map-js), 1 moderate (next). Installed `next` is 15.5.25 |
| Lint / typecheck | **Not available.** No scripts are configured |

### What the 76 test files actually cover

The classification was done with a heuristic (imports vs `readFileSync` vs `createTestDatabase`):

| Kind | Files | What it proves |
|---|---|---|
| Real-Postgres (`createTestDatabase`) | 6 | SQL behaviour, RLS, RPCs, migration idempotence |
| Behavioural unit (imports `src/`, no source reading) | 4 | Pure-function behaviour |
| Mixed (behavioural + source-text) | 28 | Partly behavioural |
| Source-text only | 38 | That certain strings or patterns exist in source files. **Not runtime behaviour** |

There are no browser, end-to-end, component-render or native tests. "710 passing"
therefore overstates how much behaviour is verified. It does show that the contracts
written down in tests have not regressed.

## Evidence by area

### A. Auth & search management
- `src/components/auth/AuthForm.jsx` handles sign-in and sign-up (`signInWithPassword`, `signUp` with `emailRedirectTo`).
- `forgot-password/page.js` calls `resetPasswordForEmail`; the reset page calls `updateUser`.
- `grep -rni "deleteUser\|delete account"` over `src`: no account deletion anywhere.
- `AccountSettings.jsx`: name editing, email shown read-only, sign out. Nothing else.
- Searches are created only by `handle_new_user`, and `searches` has `unique(user_id)`.
- `profiles.active_search_id` selects the active search. `SearchSwitcher.jsx` on `main` is a native `<select>` and calls `router.refresh()`.

### B. Importing
- `src/lib/listingUrl.js` has host-specific parsers:
  - `zillow.com`, `redfin.com`, `realtor.com`, `homes.com` (`:184-187`);
  - `apartments.com`, `rent.com` (`:263-264`);
  - no Trulia.
- The parser only extracts an address from the URL. It never fetches the page.
- `src/app/api/import-listing/route.js`:
  - requires sign-in (`:41-43`, 401);
  - calls RentCast with a server key and maps an upstream 429 to `rateLimited` (`:24`, `:76-84`);
  - uses `fetchWithTimeout`;
  - has no caching and no per-user limit.
- Duplicate detection: exact match only (`listingUrl.js:153`; `HomeModal.jsx:279-296`).
- `.env.example` defines `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`, `GOOGLE_GEOCODING_API_KEY` and `GOOGLE_ROUTES_API_KEY`.
  - **Missing:** `RENTCAST_API_KEY`, `APPLE_TEAM_ID`, `CAP_SERVER_URL`.

### C. My Homes
- `homes`, `favorites`, `archive` and `tour` pages all render `HomesBoard` with a `mode`.
- `constants.js:476` defines `STATUS_OPTIONS = ['Saved','Want to Tour','Toured','Archived']`. Legacy statuses are kept only for colour.
- `homesCollection.js:14-21`: six sort orders; filters at `:32`.
- Delete exists only in archive mode (`HomesBoard.jsx:344`, `:663`).
- Photos (`HomeModal.jsx:28, 380, 384-387`): file input `accept="image/jpeg,image/png,image/webp"`, 5 MB cap, Supabase storage.
- `PostTourModal.jsx`: a verdict (love / considering / not_for_me), four 3-point ratings and an optional note. No photo.

### D. Match / Compare / Map
- `src/lib/matching.js:281` `computeMatch`. Unknown values are excluded from the denominator (`:454-457`); a historical `false` is treated as unknown (`:429-442`).
- Tiers (`constants.js:493-498`): 4 / 2 / 1 / 0.
- `DetailMatchPanel.jsx:35-61` explains must-haves and shows "Unknown details never count against a home".
- `CompareBoard.jsx:14` `MAX_COMPARE = 4`. The collaborator perspective is shown separately (`:183-187`).
- `/api/commute`:
  - requires sign-in;
  - `MAX_IDS = 25`;
  - Routes `computeRouteMatrix`, DRIVE, TRAFFIC_UNAWARE;
  - persists geocodes;
  - client-session cache only (`useCommuteObserver.js`).
- `PlacesEditor.jsx`: name, address, max drive. **No rank field.**

### E. Collaboration
- **Invitations:**
  - created by a direct client insert (`collaboration.js:695-705`) under RLS `search_invitations_owner_insert`, so owner-only;
  - token is a UUID, expiry `now() + 7 days`.
- **Acceptance:** `accept_invitation`, latest version in `2026-10-07-invitation-acceptance-conflict-targets.sql`.
  - Single use: row lock plus a `status <> 'pending'` check.
  - Refusal codes: `wrong_account`, `self_invite`, `expired`, `relationship_conflict`, `confirmation_required`.
  - The migration header records that acceptance failed with 42702 between the 09-16 migrations and the 10-07 fix.
- **Revocation:** `revoked` is a valid status, but there is no UPDATE policy, RPC or UI that sets it.
- **One co-buyer assumption:** `limit 1` "other participant" selection in:
  - `resolve_cobuyer_compare_perspectives`;
  - `resolve_collaborator_search_context`;
  - the map collaborator places;
  - the shared-search contract;
  - and `addCoBuyerPersonalSignals` hardcodes `coBuyerArchivedCount: 1`.
  - **No constraint stops a second co-buyer invitation from being created and accepted.**
- **Leave / remove:** a `search_members` delete. RLS allows the owner or the member themself. Personal rows remain afterwards.
- **Realtime:** zero `.channel(` / `postgres_changes` usages in `src/`.
- **Shared vs personal data:**
  - Shared: notes, pros and cons live on `homes`.
  - Personal: `home_member_state` and `search_member_priorities`.

### F. Realtor
- **Role:** `search_members.role in ('co_buyer','realtor')`; helpers `is_search_realtor` and `is_search_decision_maker`.
- **Routes:** `/realtor`, `/people`, `/people/start`, `/people/[searchId]` (+ `homes/[homeId]`, `compare`).
- **Suggestions:** `create_realtor_suggestion`, `promote_realtor_suggestion`, `dismiss_realtor_suggestion` (dismissed only once every decision-maker dismisses).
- **Notes and tours:** `realtor_notes` (one note per Realtor per home, 2000 characters) and `suggest_home_tour`. There is no scheduling.
- **Prospective searches:** `prospective_searches` + `create_prospective_search` → `invite_prospective_client` → `/invite/[token]/confirm` → `claim_prospective_search`.
- No billing code.
- Docs: `realtor-role-permission-foundation.md` (#78) and `realtor-notes-tours-invitations.md` (#82). Docs were used for context only; the code was checked.

### G. Onboarding
- `onboardingFlow.js`: `CURRENT_ONBOARDING_VERSION = 1`; the live steps are basics, what_matters and rank.
- `ONBOARDING_FLOWS[2]` defines the step keys: welcome, collaboration, collaboration_intro, basics, locations, priorities, rank, tour_discoveries, import_lesson. **No screens exist for the V2-only keys.**
- `Onboarding.jsx:346-349` renders the screens; the Ready screen offers "Add your first home" and "View My Search".
- Resume: `beginOnboarding` (server side) plus a save when the app goes to the background (`Onboarding.jsx:299-307`).

### H. FLH+
- `grep -rniE "storekit|in-app purchase|entitlement|paywall|stripe|revenuecat"` over `src`, `supabase` and `ios` matches only:
  - comments stating no entitlement exists (`AccountSettings.jsx:12`, `HomesTogetherCallout.jsx:11`, `2026-10-07-onboarding-state.sql:23-24`);
  - reserved analytics event names (`analytics.js:35-39`).

### I. Native iOS
- `project.pbxproj`:
  - `DEVELOPMENT_TEAM = QCQYKZVAC8`;
  - `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`;
  - `TARGETED_DEVICE_FAMILY = "1,2"`;
  - deployment target iOS 15.0;
  - bundle IDs `app.feelslikehome.mobile` and `app.feelslikehome.mobile.share`.
- `App.entitlements`: only `applinks:feelslikehome.app`.
- `Info.plist`:
  - **no** `NSCameraUsageDescription`, `NSPhotoLibrary*` or `ITSAppUsesNonExemptEncryption` (grep count 0);
  - `UIRequiredDeviceCapabilities = armv7`.
- `PrivacyInfo.xcprivacy`: not found.
- `capacitor.config.js`: `server.url = CAP_SERVER_URL || https://feelslikehome.app`, `cleartext:false`.
- Plugins: `@capacitor/app` only. `ios/debug.xcconfig` sets `CAPACITOR_DEBUG = true`.
- AASA comes from the `src/lib/aasa.js` route. `details` is empty when `APPLE_TEAM_ID` is unset.
- The Share Extension opens `https://feelslikehome.app/homes?url=…`.

### J. Design
- Landing page `PublicLanding.jsx`:
  - "Create a free account";
  - claims Match Scores, comparison, commute times, and buyers/co-buyers/Realtors. All of these exist in code;
  - no legal links, App Store badge or pricing.
- No `prefers-color-scheme` in `globals.css`.

### K. Notifications
- No email SDKs (resend, nodemailer, sendgrid, postmark), no push and no `supabase/functions`.
- Invitations are copy-link only (`InviteCoBuyer.jsx`, `InviteBuyer.jsx`, `ConnectBuyer.jsx`).

### L. Infrastructure & security
- RLS is enabled on every table in `schema.sql`. No `grant … to anon` was found.
- `resolve_display_name(p_user_id)` has no relationship check. Membership helper functions accept any `p_user_id` and are executable by `authenticated`.
- Several suggestion RPCs only `revoke … from public`; anon is not revoked explicitly. They check `auth.uid()`, so this is low risk.
- `schema.sql` does not contain the 2026-09-19 objects (`grep -c resolve_display_name` = 0). `test/support/supabaseDb.mjs` applies the migrations missing from the snapshot.
- `next.config.mjs` is empty: no CSP or security headers. There is no `vercel.json`.
- Middleware refreshes the Supabase session and does no rate limiting.
- `src/lib/analytics.js` has a sink only in development (`:107-108`).
- `BETA_FEEDBACK_ENABLED = true` (`src/lib/betaFeedback.js:5`).
- No `.github/` directory, so no CI.

## Production checks the owner should run (read-only)

These are needed to move any row from NEEDS VERIFICATION or `?` to verified.
All the files already exist on `main`.

1. **`supabase/production-migration-inventory.sql`.** Every repair object should now report `true`. Expected flips since Section 0:
   - prospective searches
   - display-name
   - realtor-started
   - people-workspace
   - tour-evaluations
   - 09-19
   - conflict targets
   - onboarding state
2. **`supabase/production-function-fingerprints.sql`.** Compare against the repository definitions, for example the collaborator-context return type with `display_name`.
3. **`supabase/cobuyer-journey-production-check.sql`** and **`supabase/cobuyer-onboarding-placement-check.sql`**. These check the incident accounts' state without changing anything.
4. **`supabase/beta-feedback-verification.sql`.** `all_checks_pass = true` is required before a build with `BETA_FEEDBACK_ENABLED = true` should be live.
5. **Vercel production environment variables** (names only, never values): confirm these are set:
   - `RENTCAST_API_KEY`
   - `GOOGLE_ROUTES_API_KEY`
   - `GOOGLE_GEOCODING_API_KEY`
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
   - `NEXT_PUBLIC_GOOGLE_MAP_ID`
   - `APPLE_TEAM_ID`
6. **AASA.** `curl -s https://feelslikehome.app/.well-known/apple-app-site-association`. Expect `QCQYKZVAC8.app.feelslikehome.mobile` in `details`.
7. **Supabase Auth settings.**
   - Custom SMTP on or off.
   - Site URL and redirect allow-list include `https://feelslikehome.app/auth/callback`.
   - Backups / PITR enabled.
8. **Google Cloud.** Browser key restricted to the Maps JS API and the `feelslikehome.app` referrers. Quotas or budgets set on the Routes and Geocoding APIs.
9. **RentCast.** Plan quota and alerting.

## Reproducing the status count

```sh
grep -E "^\| [A-Z]+-[0-9]{3} " docs/product-audit/feature-inventory.md \
  | awk -F'|' '{print $11}' | sed -E 's/⟳ in flight//; s/^ +| +$//g' | sort | uniq -c
```

## Limitations

- Static reading cannot prove runtime UX quality, copy clarity, performance or visual polish.
- The test-file classification is heuristic.
- Production-state statements depend on the owner's reports. Where the owner reported something (repairs applied, paid plan and backup), it is labelled "owner reports" and not treated as verified.
- Three read-only sub-agent passes gathered parts of the evidence. Key claims were spot-checked directly:
  - iOS plist and pbxproj values;
  - `schema.sql` staleness;
  - invitation revocation;
  - payment absence;
  - API auth.


## Decision-lock pass (2026-10-09)

The original evidence above is unchanged and traceable to `main` @ `9032151`. This
pass adds the following.

### Baseline

- `main` @ `3651f7e` ("Merge pull request #138"). `git diff --stat 9032151 3651f7e` shows **only** the 11 `docs/product-audit/` files (1219 insertions). **No application, SQL or native change since the audit.**
- PR #138 is merged; its merge commit is in `main`'s history. Note: the GitHub API's `merged` field read `false` for #136–#138, although their merge commits are on `main`. Git history was treated as authoritative.
- **Multi-search fix `4168309`** (`claude/charming-bell-i0xo4w`):
  - `git merge-base --is-ancestor 4168309 origin/main` → **not an ancestor**, so **not merged**;
  - no open PR exists for it;
  - **therefore not deployed from `main`.** Production deployment is unverifiable here; with N-10 unresolved, whether a branch deploy ever served production is unknown.
  - The owner's report that "Claude has fixed the multi-search bug" is accurate for the **code on the branch**. It is not merged, not production-verified, and not QA'd on real accounts.
- Documentation branch: `claude/product-decisions-lock` from `3651f7e`. It is a new branch because #138 is merged. Nothing was force-pushed.

### Commands run

| Command | Result |
|---|---|
| Full suite on `main` @ `3651f7e` with the real-Postgres harness | **710/710 pass** |
| Full suite on `4168309` in a separate worktree, real-Postgres harness | **719/719 pass** (incl. `multi-search-invitation-db`) |
| `npm run build` on `4168309` | **Success** (exit 0) |

> The first `4168309` run reported 41 failures, all `connection refused`: the local
> test Postgres had stopped. It was restarted (`pg_ctl … start`) and both suites were
> re-run green. The local test cluster only; no production system was touched.

### New code evidence (used by the conflicts doc)

| Ref | Check | Result |
|---|---|---|
| N-1…N-3 | FK definitions in `supabase/schema.sql` | `searches.user_id` cascade (`:81`); `homes.user_id` cascade (`:111`); `homes.search_id` set null (`:112`); `search_members`, `search_member_priorities`, `search_invitations`, `commute_destinations`, `realtor_suggestions` cascade from `searches` |
| N-4 | `on delete restrict` | `realtor_suggestions.suggested_by` (`:2236`), `realtor_notes.author_id` (`:2395`), `tour_suggestions.suggested_by` (`:2407`) |
| N-5 | Realtor select policies | `smp_participant_or_realtor_select`, `hms_participant_or_realtor_select`, `commute_destinations_participant_or_realtor_select` (`:1573-1596`) |
| N-6 | `accept_invitation` locking | `select … from search_invitations … for update` only (`2026-10-07-invitation-acceptance-conflict-targets.sql`) |
| N-7 | One-search lookups | `grep -noE "from public\.searches s where s\.user_id ?= ?(caller\|auth\.uid\(\))\|searches where user_id ?= ?(caller\|auth\.uid\(\)\|new\.id)" supabase/schema.sql supabase/migrations/*.sql \| wc -l` → **13**; `from('searches')` with `.eq('user_id'` in `src/lib/supabase/collaboration.js` → **5** |
| N-8 | `resolve_display_name` callers | 7 internal call sites in `2026-09-19-account-name-capture-and-realtor-home.sql` (lines 117, 153, 172, 188, 209, 260, 295); 0 client callers on `main`; 1 client caller added by `4168309` |
| N-9 | Legacy shared status | `homes.status text not null default 'Considering'` (`schema.sql:133`) |
| N-10 | Vercel bot comment on PR #138 (2026-10-09 17:25 UTC) | "Preview" link shown as `feelslikehome.app`. Unverified |
| Onboarding gate | `src/app/(app)/layout.js:25` | Redirects `onboarding_complete = false` to `/onboarding` |
| Leave/remove | `schema.sql:382-387` | Owner or self may delete the `search_members` row |

### Documentation consistency checks

See the PR description for the final run:
- the inventory status count is unchanged (150 rows; same counts);
- every D-01…D-18 is marked APPROVED;
- all 10 locked rules are present;
- internal links resolve to existing files;
- the diff touches only `docs/product-audit/`.
