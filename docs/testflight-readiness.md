# TestFlight readiness audit (Milestone 5)

**Base:** `main` at `e022b79` (#190 and #191 merged; Production V3 on).

**Scope:** an audit first, then three safe, code-only fixes (§G: P1-1 to P1-3). Nothing about signing, team, bundle IDs, entitlements, remote hosting, V3, the Share Extension or Universal Links was changed. Nothing was archived, uploaded or submitted, and no testers were invited.

## What was checked, and how

- **Repository:** Xcode project, Info.plists, entitlements, asset catalogs, launch storyboard, Swift sources, SPM manifests, Capacitor config and sync, privacy manifests, the web app's auth, photo, analytics and account code.
- **Production (read-only, from this session):**
  - `https://feelslikehome.app`, `/auth/sign-in`, `/auth/sign-up`, `/onboarding`, `/homes`, `/search/explore` → 200;
  - `www` → 308 to the apex domain; HSTS `max-age=63072000`;
  - a signed-out shared-listing link → `/auth/sign-in?redirect=/homes?url=…` (destination kept);
  - `/.well-known/apple-app-site-association` → 200 `application/json` with `appIDs: ["QCQYKZVAC8.app.feelslikehome.mobile"]`. **Apple's CDN** (`app-site-association.cdn-apple.com`) serves the same file, so Apple has already validated the domain.
- **Locally:** `npm test` (1,406 pass, 0 fail), `next build` ✅, `npx cap sync ios` (changes no tracked file), plist parsing, and image checks.
- **Not possible here (Linux, no Xcode or Apple account):** compiling, archiving, signing, Simulator or device runs, uploads. Everything in §B and §C is a founder step; none of it is claimed done.

## A. Readiness matrix

| Area | Finding | Status |
|---|---|---|
| Targets | `App` (`app.feelslikehome.mobile`) + embedded `ShareExtension` (`app.feelslikehome.mobile.share`) | ✅ Ready |
| Team / signing | `DEVELOPMENT_TEAM = QCQYKZVAC8`, Automatic signing, both targets, Debug and Release (committed in #153) | ✅ Ready (founder's account must hold both App IDs) |
| Version / build | `1.0 (1)` on **both** targets; they must always match | ✅ Ready (increment the build number per upload, §B) |
| Deployment target | iOS 15.0; iPhone + iPad (`1,2`) | ✅ Ready; iPad support is a 🟠 founder decision (§G P2-3) |
| Toolchain | Capacitor 8.5.2 (SPM, no CocoaPods) + `@capacitor/app` 8.1.1 + `@capacitor/haptics` 8.0.2. **Uploads require Xcode 26 / iOS 26 SDK** (Apple, since 28 Apr 2026) | 🟠 Requires founder (Xcode 26 on the Mac) |
| Remote hosting | `server.url = https://feelslikehome.app`, `cleartext: false`; the synced config on a fresh `cap sync` has no Preview URL (just verified) | ✅ Ready, but **re-run `npx cap sync ios` without `CAP_SERVER_URL` before archiving** (§B) |
| Universal Links | Entitlement `applinks:feelslikehome.app`; AASA live and on Apple's CDN with the matching app ID | ✅ Ready |
| Share Extension: packaging | Embedded, `com.apple.share-services`, URL/web page/text, no entitlements | ✅ Ready |
| Share Extension: hand-off | Uses `NSExtensionContext.open(_:)`. Apple documents that as supported for Today/iMessage extensions; an Apple engineer states share extensions can't open their app this way | 🔴 **Needs work / founder decision** (§G P1-4) |
| App icon | **Was the Capacitor placeholder** (blue "X") → now FLH's approved home-screen mark, 1024×1024, opaque | ✅ Fixed in this PR |
| Launch screen | **Was the Capacitor placeholder** → paper `#FAF6EF` with the FLH mark at boot-screen size | ✅ Fixed in this PR |
| Display name | "Feels Like Home" (app and Share sheet). Some home-screen layouts may shorten it | ⚪ Later (P3) |
| Permissions | Web photo pickers (`<input type="file" accept="image/…">`) can offer **Take Photo** in WKWebView; **no `NSCameraUsageDescription`** meant iOS would terminate the app → added | ✅ Fixed in this PR |
| Privacy manifest | App/extension Swift uses no required-reason APIs; Capacitor ships its own (`NSPrivacyTracking false`, none declared); no tracking SDKs | ✅ Ready |
| Encryption export | No `ITSAppUsesNonExemptEncryption` key; app uses only HTTPS/OS crypto | 🟠 Founder answers once in App Store Connect (§C) |
| App Privacy labels | No analytics vendor; collects account and user content (below) | 🟠 Founder fills in App Store Connect (§F) |
| Account deletion | **None in the app** (sign out only) | 🔴 Needs work before App Store (§F, §G P1-5) |
| Privacy Policy / Terms | **No page on the site** | 🔴 Founder (legal text) before external testing and release (§G P1-6) |
| Review demo account | Sign-in required to use the app | 🟠 Founder provides a test account (§C) |
| Guideline 4.2 (web wrapper) | Native welcome, Share Extension, Universal Links, haptics. The Share Extension risk (P1-4) weakens this case | 🟡 Moderate risk (§G P2-1) |
| Monetization | No purchase code; analytics reserves `paywall_*` / `flh_plus_*` event names only | ⚪ Later (§H) |

## B. Open, archive and validate on the founder's Mac

These steps keep your existing checkout and its local signing files untouched by using a separate worktree. If you'd rather archive from your main checkout, skip step 1, but **never `git reset` / `restore`** there; just `git pull` on a clean `main`.

1. **Separate folder for the release build:**
   ```bash
   cd ~/feelslikehome
   ```
   ```bash
   git fetch origin
   ```
   ```bash
   git worktree add --detach ../flh-release origin/main
   ```
   ```bash
   cd ../flh-release
   ```
2. **Install and sync for Production.** Make sure `CAP_SERVER_URL` is *not* set, since that's what a Preview test used:
   ```bash
   npm ci
   ```
   ```bash
   env -u CAP_SERVER_URL npx cap sync ios
   ```
   ```bash
   grep '"url"' ios/App/App/capacitor.config.json
   ```
   The last line must print `"url": "https://feelslikehome.app"`.
3. **Xcode 26** (App Store version), then:
   ```bash
   open ios/App/App.xcodeproj
   ```
   Wait for **Package Dependencies** to resolve (`CapacitorApp`, `CapacitorHaptics`, `capacitor-swift-pm`).
4. **Signing check**, without changing anything: select the **App** target → Signing & Capabilities → Team = your team (QCQYKZVAC8), "Automatically manage signing" on, and Associated Domains shows `applinks:feelslikehome.app`. Repeat for **ShareExtension**. If Xcode offers to "fix" signing, it may register the two App IDs; that's expected the first time.
5. **Build number:** first upload `1.0 (1)`. For each later upload, raise **Build** on *both* targets to the same number (e.g. 2), or upload is refused.
6. **Archive:** scheme **App**, destination **Any iOS Device (arm64)** → **Product → Archive**.
7. **Validate:** Organizer → the archive → **Validate App** → App Store Connect distribution → automatic signing. Fix anything it reports before uploading.
8. **Smoke test before uploading:** run the same commit on your iPhone:
   - fresh install → paper launch screen with the FLH mark → welcome photo;
   - the home-screen icon is the FLH house;
   - Add Home → Add photo → **Take Photo**: the system asks for camera permission, with our wording, and doesn't crash;
   - Safari → Share → Feels Like Home (see P1-4);
   - an invitation link opens the app.

## C. App Store Connect: app record and first upload

1. **Certificates, Identifiers & Profiles:** confirm App IDs `app.feelslikehome.mobile` (Associated Domains enabled) and `app.feelslikehome.mobile.share` exist. Automatic signing usually creates them at step 4.
2. **App Store Connect → Apps → + → New App:**
   - Platform iOS, Name "Feels Like Home" (must be unique on the Store), Primary language English (U.S.);
   - Bundle ID `app.feelslikehome.mobile`; SKU e.g. `flh-ios-001`;
   - User Access: Full.
3. **Upload:** Organizer → **Distribute App** → App Store Connect → Upload. Processing takes 5–30 minutes; the build then appears under TestFlight.
4. **Export compliance:** answer the encryption questions once. FLH uses only standard HTTPS and OS cryptography, which is commonly declared exempt. Afterwards you can ask me to add `ITSAppUsesNonExemptEncryption = NO` to Info.plist so the question stops appearing. I didn't add it, because it's your legal declaration.
5. **TestFlight → Test Information:**
   - Beta App Description (e.g. "Compare the homes you've found against what matters to you");
   - Feedback email;
   - **Sign-in information: a working test account** (email + password, onboarding completed, a couple of homes saved) for Beta App Review;
   - a Marketing URL (`https://feelslikehome.app`) and a Privacy Policy URL once it exists (P1-6).
6. **Internal group:** add yourself and team members (App Store Connect users) → they install through the TestFlight app.

## D. Internal vs external TestFlight

| | Internal | External |
|---|---|---|
| Who | Up to 100 members of your App Store Connect team (each needs a role) | Anyone by email or public link, up to 10,000 |
| Review | **None**: available once processed | **Beta App Review** of the first build in a group, against the App Review Guidelines |
| Needs | An uploaded build | Test Information (description, feedback email, **demo account**). Policy and account-deletion gaps are risks (§F) |
| Expiry | Builds expire after 90 days | Same |
| Good for | You, close collaborators, device QA (§B step 8) | Friendly buyers, co-buyers, Realtors |

**Recommendation:** start **internal** right after the first upload. Go **external** once P1-4 (Share hand-off) is verified or fixed and P1-6 (privacy policy) exists. Account deletion (P1-5) is strongly recommended before external testing, and required before App Store submission.

## E. Artwork and metadata

| Item | Requirement | Status |
|---|---|---|
| App icon | 1024×1024 PNG, opaque, no rounded corners (iOS masks it) | ✅ In this PR (`scripts/ios/render-native-art.mjs`, from `public/favicon.svg`, the same art as `apple-touch-icon.png`). **Please approve or replace.** |
| Launch screen | Storyboard + `Splash` image 2732×2732 | ✅ In this PR |
| iPhone screenshots (App Store, not TestFlight) | 6.9″: 1320×2868 (or 1290×2796), 3–10 images | 🟠 Founder; capture on an iPhone 16/17 Pro Max Simulator |
| iPad screenshots (only if iPad stays supported) | 13″: 2064×2752 (or 2048×2732) | 🟠 Founder decision (P2-3) |
| Name / subtitle | ≤ 30 characters each (e.g. "Feels Like Home" / "Decide on the home you found") | 🟠 Founder |
| Description, keywords (≤ 100 chars), support URL, marketing URL | App Store listing | 🟠 Founder |
| Privacy Policy URL | Required for App Store; needed for external review in practice | 🔴 Founder (P1-6) |
| Age rating questionnaire | No objectionable content; user-generated notes are private to a search | 🟠 Founder (likely 4+) |
| Category | Lifestyle (or Productivity) | 🟠 Founder |

## F. Privacy and account deletion (from the code)

**What the app collects** (for App Privacy labels; nothing is used for tracking, and there is no analytics vendor: `src/lib/analytics.js` "FLH has no analytics vendor"):
- **Contact info:** name and email (sign-up). Linked to the user; App Functionality.
- **User content:**
  - homes and addresses, notes, pros and cons, ratings, priorities;
  - **photos** the user uploads (Supabase Storage);
  - commute "Places That Matter" addresses typed by the user.

  All linked to the user; App Functionality.
- **Identifiers:** the account user ID. Linked; App Functionality.
- **Not collected:** device location (no geolocation API is used), contacts, health, financial info, advertising data, crash or diagnostics SDKs.
- **Third parties that process data for the app's function:**
  - Supabase (database, auth, storage) and Vercel (hosting);
  - Google Maps/Places/Routes (typed addresses and commute queries);
  - RentCast (listing address look-ups);
  - YouTube's privacy-enhanced embed on the public homepage (outside the app's signed-in flow).
- **Tracking:** none, so no App Tracking Transparency prompt (none present).

**Account deletion (guideline 5.1.1(v)): ❌ missing.**
- Today Account & Settings offers profile, access and **Sign out** only (`AccountSettings.jsx`).
- Required before App Store submission; risky for external Beta App Review.
- Not a safe code-only fix, because it needs your decisions and a server-side path. The design to decide:
  - what happens to a **shared search** the user owns (transfer to the co-buyer, or delete);
  - the co-buyer's own rows;
  - Realtor relationships and contributions;
  - uploaded **photos and floor plans** in Storage;
  - deleting the Supabase **auth user** (service-role, server-only);
  - a confirmation step;
  - whether a short grace period applies.
- I recommend a dedicated PR with a Postgres function plus a server route, real-Postgres tests, and an in-app "Delete account" in Account & Settings.

**Privacy Policy / Terms: ❌ missing on the site.** You'll need to supply the text. A `/privacy` page is then a small code change.

## G. Risks and blockers (ranked)

| # | Sev | Risk | Action |
|---|---|---|---|
| P1-1 | ~~P1~~ | Placeholder Capacitor **app icon** would ship and could be rejected by external review | ✅ **Fixed** (please approve the art) |
| P1-2 | ~~P1~~ | Placeholder Capacitor **launch screen** | ✅ **Fixed** |
| P1-3 | ~~P1~~ | **Camera crash**: "Take Photo" from any photo picker with no `NSCameraUsageDescription` | ✅ **Fixed** (verify on device, §B step 8) |
| P1-4 | **P1** | **Share Extension can't open the app** on real devices: `NSExtensionContext.open` isn't supported for share extensions, so the extension would show "Feels Like Home couldn't be opened." The #76 design flagged this as needing device verification | **Verify on iPhone first.** If it fails, choose: **(a)** add an **App Group** (an entitlement change on both targets, which needs your approval): the extension saves the link, the app picks it up when it opens, and the extension says "Saved — open Feels Like Home to add it"; or **(b)** a responder-chain `openURL` call: works in practice, undocumented, an App Review (2.5.1) risk. I recommend **(a)**. |
| P1-5 | **P1** (App Store) / P2 (external beta) | **No in-app account deletion** | Founder decisions → a dedicated PR (§F) |
| P1-6 | **P1** | **No Privacy Policy** URL | Founder writes it; then a `/privacy` page |
| P2-1 | P2 | Guideline **4.2** (web wrapper) scrutiny, stronger if the Share Extension doesn't work | Fix P1-4; in review notes mention the Share Extension, Universal Links, haptics and native welcome |
| P2-2 | P2 | **Xcode 26** required for uploads; an older Xcode build is refused | Update Xcode on the Mac |
| P2-3 | P2 | **iPad** is declared (`TARGETED_DEVICE_FAMILY = 1,2`): App Store needs 13″ iPad screenshots and iPad QA. Removing iPad later, after an App Store release, isn't allowed | Decide before the first **App Store** release (TestFlight doesn't lock it). If iPhone-only, I can make that one-line change with your approval |
| P2-4 | P2 | Review **demo account** missing → Beta App Review stalls | Create a dedicated reviewer account (onboarded, sample homes) |
| P2-5 | P2 | A Preview `CAP_SERVER_URL` left over from testing could be synced into a release | §B step 2 check (the synced config is git-ignored, so it only matters on the Mac) |
| P3-1 | P3 | `UIRequiredDeviceCapabilities = armv7` (Capacitor 8's own template default; uploads accept it) | Leave |
| P3-2 | P3 | `www.feelslikehome.app` links redirect to the apex domain but won't open the app (no `applinks:www`) | Later, if `www` links are shared |
| P3-3 | P3 | Home-screen label "Feels Like Home" may be shortened on some layouts | Optional shorter `CFBundleDisplayName` (your call) |
| P3-4 | P3 | Export-compliance question every build | Add `ITSAppUsesNonExemptEncryption` after you answer once (§C step 4) |

## H. Paywall: must it come before external TestFlight?

**No.** There is no purchase code today (only reserved analytics event names), and nothing in the app sells access, so there's nothing to comply with yet. TestFlight testers never pay. **Don't add purchase UI to the iOS app until it's App Store-compliant:**
- Digital features or subscriptions sold **inside the iOS app** must use **In-App Purchase (StoreKit)** (guideline 3.1.1). In a Capacitor app that means a native StoreKit plugin (e.g. RevenueCat or a Capacitor IAP plugin), plus server-side receipt or entitlement sync with Supabase.
- On the **US storefront**, since May 2025 apps may also include buttons or links to an external (web) purchase without an entitlement. Apple has appealed, and reviewers have been inconsistent (e.g. tips). Treat this as a US-only option to revisit with current rules at that time.
- **Recommendation:** run TestFlight (internal, then external) now. Design monetization as its own milestone, with StoreKit as the baseline.

## I. Next steps

1. ☐ Review and approve this PR's **icon and launch art** (or provide final art), and the camera wording.
2. ☐ Merge it, then follow **§B** on the Mac with Xcode 26 → device smoke test → archive → validate.
3. ☐ **Verify the Share Extension hand-off on the iPhone** (Safari → Share → Feels Like Home). If it fails, tell me (a) App Group or (b), and I'll prepare that PR.
4. ☐ **§C:** create the app record → upload `1.0 (1)` → answer export compliance → Test Information with a **demo account** → start **internal** testing.
5. ☐ Write the **Privacy Policy** (and Terms). I'll add `/privacy` and link it in the app.
6. ☐ Decide **account deletion** behaviour (§F). I'll implement it in a dedicated PR with tests.
7. ☐ Decide **iPad** support before the first App Store release.
8. ☐ Then **external** TestFlight (Beta App Review).
9. ☐ Monetization later, StoreKit-first (§H).
