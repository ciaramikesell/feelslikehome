# Launch readiness

**Verdict (2026-10-09, `main` @ `9032151`): not ready for App Store submission.**

The product is plausibly ready for a **web private beta and TestFlight internal
testing**, once production verification (below) has been done.

The core buyer loop is built and covered by automated contracts:
- add or import a home;
- set priorities;
- see Match;
- compare;
- map and commute;
- tour and archive.

What is missing is mostly launch infrastructure, not features:
- account deletion;
- a privacy policy and support URL;
- a privacy manifest and plist keys;
- production verification;
- device QA.

## Launch definitions used

| Milestone | Meaning |
|---|---|
| **L0 — Web private beta** | Invited users on `feelslikehome.app` (web/PWA) |
| **L1 — TestFlight internal** | Up to 100 App Store Connect users. No Beta App Review |
| **L2 — TestFlight external** | Requires Beta App Review. Needs a privacy policy URL and test account |
| **L3 — App Store public (free)** | Full review. Account deletion, privacy label and 4.2 risk all apply |
| **L4 — FLH+ monetized** | IAP, entitlements, restore, terms, paywall |

## Blockers by milestone

### L0 — Web private beta

| # | Blocker | Evidence | Effort |
|---|---|---|---|
| L0-1 | Production schema verified after the drift repair (inventory + fingerprints all green) | INFRA-003; owner reports applied, output not seen | S |
| L0-2 | Invitation acceptance works in production (it failed 09-16 → 10-07) | COLLAB-002 | S (QA) |
| L0-3 | Multi-search invitation fix merged and deployed, or a known-issue note issued to beta users | ⟳ `4168309`; SEARCH-002, COLLAB-003/004 | S–M |
| L0-4 | Production environment variables present: `RENTCAST_API_KEY`, the Google keys, `APPLE_TEAM_ID` | INFRA-015 | S |
| L0-5 | Spend guards on RentCast and Google (provider quotas or budgets at minimum) | INFRA-010, IMPORT-009 | S |
| L0-6 | Beta-feedback migration verified (the flag is on in source) | INFRA-014 | S |
| L0-7 | Minimal error visibility: Vercel logs reviewed, or crash/error monitoring added | INFRA-007 | S–M |

### L1 — TestFlight internal

Everything in L0, plus:

| # | Blocker | Evidence | Effort |
|---|---|---|---|
| L1-1 | Archive and upload: signing, version/build numbering | RELEASE-006/010 | S |
| L1-2 | `ITSAppUsesNonExemptEncryption = NO` (otherwise every build asks for export compliance) | IOS-007 | S |
| L1-3 | `NSCameraUsageDescription` (and photo-library text if needed) because of the `<input type=file>` photo picker | IOS-007 | S |
| L1-4 | Remove the legacy `armv7` `UIRequiredDeviceCapabilities` | IOS-007 | S |
| L1-5 | `PrivacyInfo.xcprivacy` (App Store Connect rejects uploads without one when required-reason APIs are used) | IOS-006 | S |
| L1-6 | Execute the `native-device-qa.md` checklist on a real iPhone: Universal Links, Share Extension, auth persistence, safe areas, keyboard, photo upload | RELEASE-008 | M |

### L2 — TestFlight external

Everything in L1, plus:

| # | Blocker | Evidence | Effort |
|---|---|---|---|
| L2-1 | Public privacy policy URL | RELEASE-001 | S (writing) + owner/legal review |
| L2-2 | Reviewer demo account + review notes (the app is login-gated) | RELEASE-007 | S |
| L2-3 | Beta App Description and feedback email | RELEASE-004 | S |

### L3 — App Store public (free)

Everything in L2, plus:

| # | Blocker | Evidence | Effort |
|---|---|---|---|
| L3-1 | **In-app account deletion** (Guideline 5.1.1(v)) | AUTH-005 | M (cascades through owned search, memberships, storage, auth user; needs a privileged server path) |
| L3-2 | Support URL | RELEASE-003 | S |
| L3-3 | App Privacy nutrition label | RELEASE-005 | S |
| L3-4 | Screenshots for iPhone **and iPad** (device family 1,2), or restrict to iPhone | IOS-010 | S–M |
| L3-5 | Guideline 4.2 mitigation: a review note explaining the native Share Extension, Universal Links and account-bound workflow; consider one more native affordance | IOS-011 | S–M |
| L3-6 | Terms of service (recommended) | RELEASE-002 | S + review |
| L3-7 | Offline / no-network screen in native, so the reviewer never sees a blank WebView | IOS-009 | S |

### L4 — FLH+

Everything in L3, plus the PAY-001…PAY-007 build. That is XL and not started.
Terms are required at this stage, plus restore purchases and a server entitlement
table. See [roadmap.md](roadmap.md).

## Hidden launch blockers

These are things that are easy to miss because each looks finished.

1. **AASA is silently empty without `APPLE_TEAM_ID`.** Universal Links and the Share Extension handoff then open Safari instead of the app. `.env.example` does not list it.
2. **The import feature fails without `RENTCAST_API_KEY`**, which `.env.example` also omits. A fresh environment builds fine and then fails at runtime.
3. **The camera crash path.** iOS WKWebView offers "Take Photo" for `<input type=file accept=image/*>`. With no `NSCameraUsageDescription`, choosing it is expected to terminate the app. Not observed on a device; verify.
4. **A second co-buyer is not prevented.**
   - The owner can invite and a second person can accept (no DB cap).
   - Collaborator projections then pick an arbitrary "other participant" (`limit 1`).
   - Archive signals assume a count of 1.
   - Data is not lost, but people see the wrong perspective.
   - The fix is either a cap or multi-co-buyer support. That is a product decision (see product-decisions.md, D-07).
5. **Pending invitations cannot be revoked.** A link sent to the wrong address stays valid for 7 days. It is email-bound, which limits the damage.
6. **Removed members' personal rows are retained.** That matters for account deletion and privacy answers.
7. **`schema.sql` is not the full truth.** Rebuilding a database from `schema.sql` alone omits the 2026-09-19 and later objects. Only the test harness knows which migrations to add. That is a disaster-recovery risk.
8. **No CI.** 710 tests exist but nothing runs them on PRs. A merge can go red unnoticed.
9. **The default Supabase mailer** (if custom SMTP is not configured) has low hourly limits. Sign-up confirmation and reset emails will fail under a beta spike.
10. **The beta-feedback flag is `true` in source.** If the 09-09 migration were missing in production, submissions would error. Verify (INFRA-014).
11. **`resolve_display_name` lets any signed-in user resolve any user's name (or email local part) from a UUID.** This is low severity, but it matters for the privacy label: "data linked to user, visible to others".
12. **`npm audit` reports 3 high advisories**, mostly via `next`. Patch before the public launch.
13. **The native app is entirely remote.** A Vercel outage or bad deploy breaks the App Store app instantly, and so does a breaking change shipped to the web. Release discipline (CI + preview checks) matters more than it looks.
14. **The landing page says "Create a free account".** That stays true under the FLH+ plan (the free tier exists), but the paywall copy must match it.

## Launch-readiness scorecard

| Area | Ready for L0? | Ready for L3? |
|---|---|---|
| Auth | Yes (pending QA) | **No:** deletion missing |
| Search management | Conditional: in-flight fix | Conditional |
| Import | Yes, if the env vars are set | Yes, with spend guards |
| My Homes | Yes (pending QA) | Yes (pending QA) |
| Match / Compare / Map | Yes (pending QA) | Yes (pending QA) |
| Co-buyer collaboration | Conditional: production acceptance verification | Conditional + the co-buyer cap decision |
| Realtor | Conditional: production repair verification | Conditional |
| Onboarding | Yes (V1) | Yes (V1); V2 is not a launch requirement |
| FLH+ | n/a | n/a for a free launch |
| Native iOS | n/a | **No:** plist keys, privacy manifest, device QA |
| Notifications | Acceptable (copy-link) | Acceptable; email is a quality gap |
| Infra / security | Conditional: verification + spend guards | **No:** CI, monitoring, advisories |
| App Store assets | n/a | **No:** privacy policy, support, label, screenshots |
