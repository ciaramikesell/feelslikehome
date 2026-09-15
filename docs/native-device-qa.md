# Native device QA handoff (#77)

## Status and scope

**READY FOR CIARA ACCEPTANCE QA.** This is an engineering-readiness status,
not certification. Xcode, signing, installed-device, Universal Link, Share
Extension, and consumer acceptance validation remain required. #77 stays open;
the consumer baseline is not certified and #78 must not begin.

This pass made no schema, RLS, Supabase, Match, collaboration, identity,
importer, lifecycle, Realtor/helper, TestFlight, or App Store changes.

## Current-main audit

The product is a Next.js 15 application wrapped by a thin Capacitor 8 iOS
shell. The shell remotely loads `https://feelslikehome.app`; it does not ship a
static product bundle. Consequently native boot, authentication, data loading,
and imports require the production deployment and network. The local
`ios-shell-placeholder` exists only because Capacitor requires `webDir`.

The main UIKit target (`App`, `app.feelslikehome.mobile`) creates a
`CAPBridgeViewController` from `SceneDelegate`. Next.js supplies a native-only
hydration/loading fallback while server-side Supabase auth and app data resolve.
Supabase cookies persist in the WebView data store; the protected layout sends
signed-out users to sign-in and incomplete profiles to onboarding while carrying
a sanitized same-origin destination. Session persistence across termination is
therefore expected but can only be proven on a device.

The root `DeepLinkBridge` registers one Capacitor `appUrlOpen` listener. Both URL
contexts and Universal Link activities are forwarded by `SceneDelegateProxy`.
The bridge accepts only HTTPS links on the exact `feelslikehome.app` host,
preserves path/query/hash, and uses `router.replace`. Capacitor's retained event
supplies the cold-start handoff; the listener supplies warm handoffs. The web
intake then consumes `/homes?url=`, exact-matches an existing listing URL or
opens the existing Add Home/import flow, and clears the query.

The embedded `ShareExtension` target
(`app.feelslikehome.mobile.share`, iOS 15 minimum) accepts one URL, web page, or
plain-text attachment. It selects the first defensible HTTP(S) URL, constructs
the canonical production `/homes?url=` Universal Link, asks iOS to open it, and
completes only on success. It has no App Group, entitlements, credentials,
provider logic, or private app-opening API.

Mobile presentation remains centralized in `AppShell` and shared CSS: a native
root class, safe-area-aware header/bottom navigation/tour callouts, `100dvh` map
layout, native bottom sheets with bounded height and internal scrolling, a
native boot fallback, responsive detail/compare/map/My Search layouts, image
error fallbacks, and web-vs-native external affordances. The app supports phone
portrait and landscape; there is no code-level orientation lock.

Repository TODO/FIXME review found no active native implementation marker.
Existing native docs consistently record the unvalidated boundaries: Linux
cannot prove Xcode/SPM resolution, signing, actual AASA association, OS handoff,
safe areas, keyboard/sheet behavior, lifecycle/session persistence, or source
apps' `NSItemProvider` payloads.

## Native polish findings and changes

Static review found one reproducible lifecycle defect: the shared one-shot
intake guard remained set after the first query was consumed. A second share
while the Homes board stayed mounted could therefore be ignored. The guard now
resets only after all auto-open query parameters have been removed, retaining
duplicate-event protection while allowing a later handoff. Regression coverage
locks this behavior.

No code evidence justified redesigning safe areas, navigation, keyboard,
sheets, touch targets, viewport, orientation, images, external navigation, or
loading/error/empty states before device observation. Native Apple Maps uses
the existing external-link behavior and remains a physical-device check.

Privacy-safe diagnostics now distinguish:

- native scene connection and native web hydration;
- URL-context or Universal-Link receipt and forwarding;
- JS deep-link receipt, rejection, acceptance, and route replacement;
- Share Extension load, extraction failure/success, and OS handoff result;
- web share-intake receipt, existing-home match, import start, or manual entry.

These are console/OSLog messages only, not analytics or user UI. They never log
URLs, tokens, credentials, headers, or item-provider contents. Existing Add Home
and API error messages identify import failure after intake.

## Build and signing readiness

Static project-contract and plist checks confirm two targets, the extension
dependency/embed phase, matching version/build numbers, automatic signing,
extension-safe APIs, iOS 15 deployment targets, and the main target's
`applinks:feelslikehome.app` entitlement. No Apple Development Team is committed
and none should be guessed. Both targets need the same real Team selected in
Xcode; the Developer account must permit the explicit main and extension bundle
IDs. Only the main target needs Associated Domains. Do not add an App Group.

Production must define `APPLE_TEAM_ID` as the ten-character Team ID used to sign
the app. The live, redirect-free
`https://feelslikehome.app/.well-known/apple-app-site-association` response must
then advertise `<APPLE_TEAM_ID>.app.feelslikehome.mobile`. Server/API operation
also depends on the application's existing Supabase, RentCast, and Google
configuration; #77 adds no values. `CAP_SERVER_URL` is optional and should stay
unset for production/device acceptance so the shell uses the production origin.

Linux validation cannot establish that Xcode opens the project, resolves SPM,
signs/builds either target, embeds the signed extension, or installs it. There
is no committed manual Xcode setting other than selecting the real Team; Xcode
may require account/App-ID provisioning repair, which must be recorded rather
than silently changing bundle IDs or capabilities.

## Ciara: exact Mac/Xcode/iPhone install runbook

1. Confirm the intended production Vercel deployment is current, set its
   `APPLE_TEAM_ID` to the Apple Developer Team ID that will sign the build,
   redeploy, and verify the live AASA URL returns JSON containing exactly
   `<TEAM_ID>.app.feelslikehome.mobile` without a redirect.
2. On the Mac, install/open a current Xcode, sign in to the matching Apple
   Developer account under **Xcode > Settings > Accounts**, connect and unlock
   the iPhone, trust the Mac, and enable Developer Mode on the phone if prompted.
3. Check out this PR commit, run `npm ci`, then run
   `npx cap sync ios`. Leave `CAP_SERVER_URL` unset.
4. Open `ios/App/App.xcodeproj` (not the extension's standalone Swift package).
   Allow Swift Package Manager resolution to finish.
5. Select the project, then **App > Signing & Capabilities**. Select the real
   Team with automatic signing enabled. Confirm bundle ID
   `app.feelslikehome.mobile` and **Associated Domains** contains only
   `applinks:feelslikehome.app`.
6. Select **ShareExtension > Signing & Capabilities**, select the same Team with
   automatic signing, and confirm bundle ID
   `app.feelslikehome.mobile.share`. It should have no App Group or Associated
   Domains capability. If provisioning fails, register/enable that explicit App
   ID in the Developer portal and refresh profiles.
7. Select the connected iPhone as the run destination and the **App** scheme.
   Use **Product > Clean Build Folder**, then **Product > Build**. Also select
   the **ShareExtension** scheme and build it explicitly; return to **App**.
8. Press Run to install/launch. If iOS requests developer trust, approve it in
   device settings and relaunch. Confirm the installed app opens production and
   the Share Sheet's **More/Edit** list can enable Feels Like Home.
9. Stop if either target fails, the app shows a persistent blank/white screen,
   AASA association is absent, or the extension says handoff was rejected.
   Capture the evidence below; do not certify or begin #78.

ChatGPT will guide the separate acceptance protocol. This runbook deliberately
does not replace it.

## Failure evidence to capture

Record iPhone model, iOS version, Mac/Xcode version, build commit, signed-in/out
state, source app, cold/warm/background state, network conditions, exact steps,
expected/actual result, timestamp, and a screenshot or screen recording. In
Xcode choose **Window > Devices and Simulators > Open Console**, or use the macOS
Console app for the connected device, and filter for `FLH Native QA`,
`NativeLifecycle`, `ShareHandoff`, or `app.feelslikehome.mobile`. Capture a short
window around the timestamp. Do not paste auth/invite tokens, full private
listing URLs, credentials, sensitive headers, or unrelated device logs.

## Remaining device risks / exit gate

Physical QA must still prove safe areas/Dynamic Island/home indicator,
status-bar contrast, keyboard focus/dismissal, sheet and nested scrolling,
touch targets, landscape, image/overflow behavior, browser/native back and
external/Apple Maps behavior, poor-network recovery, no native white screen,
cold/warm/foreground transitions, force-quit session restoration, auth
continuation, sequential/duplicate deep links, real AASA interception, and
Safari/Zillow/Realtor.com/Apartments.com Share Extension payloads and handoff.

Xcode validation: **not performed**. Physical-device validation: **not
performed**. Universal Link and Share Extension physical validation: **not
performed**. Human consumer and desktop/mobile-web acceptance: **not
performed**. Migrations: none. Supabase impact: none. Vercel impact: production
`APPLE_TEAM_ID` remains required; no new #77 environment variable was added.

