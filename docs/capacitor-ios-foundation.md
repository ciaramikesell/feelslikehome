# Capacitor / iOS native app foundation

Phase 1 of the native iOS effort: an implementation-readiness audit plus the
minimal safe Capacitor foundation. This is **not** the native app — it's the
scaffolding and documented decisions the next phases build on.

## 1. Architecture recommendation

**Remote-hosted Capacitor.** The native iOS app is a thin native shell whose
WebView loads the real, live production app (`https://feelslikehome.app`)
over HTTPS, exactly as a browser would. It is not a static bundle of
pre-built HTML/JS shipped inside the app binary.

This confirms the prior mobile-readiness audit's conclusion — re-verified
against the current repository, not assumed. Two facts about this codebase
make a static bundle impractical without a much larger rearchitecture:

- **Auth is enforced server-side, per navigation.** `src/app/(app)/layout.js`
  is an async Server Component that calls `supabase.auth.getUser()` and
  redirects to `/auth/sign-in` or `/onboarding` as needed, on every request.
  `src/middleware.js` runs on nearly every request to refresh the session
  cookie via `@supabase/ssr`. Both require a live Next.js server.
- **Two API routes hold server-only secrets.** `/api/import-listing`
  (RentCast) and `/api/commute` (Google Routes/Geocoding) read
  `RENTCAST_API_KEY`, `GOOGLE_ROUTES_API_KEY`, `GOOGLE_GEOCODING_API_KEY` from
  server-side environment variables that are never bundled client-side. A
  static app has no server to hold these.

`next.config.mjs` is still unmodified boilerplate (no `output: 'export'`) —
nothing in the intervening mobile-web work changed this calculus.

**What this buys us:** ~100% code, data, and business-logic reuse. Auth,
Match, collaboration, import/enrichment, and every route work identically on
native and web because it's the same server serving the same app. The native
project only adds shell chrome (icon, launch screen, status bar) and native
capabilities (Share Extension, Universal Links, native Maps handoff) on top.

**What this costs:** the app requires network connectivity to function at
all (no offline mode) and is subject to Apple App Store Review Guideline 4.2
("Minimum Functionality") scrutiny — see §10 below.

## 2. Capacitor configuration added

- `capacitor.config.js` (plain CommonJS, matching this project's all-JS
  convention — no TypeScript introduced):
  - `appId: 'app.feelslikehome.mobile'` — **a placeholder.** The real bundle
    ID must be chosen and reserved in the Apple Developer portal before any
    TestFlight/App Store build; changing it later is a one-line config edit,
    not a rewrite.
  - `appName: 'Feels Like Home'`
  - `webDir: 'ios-shell-placeholder'` — required by Capacitor's tooling, but
    **never shown to a user**: once `server.url` is set, the native shell
    navigates straight to that URL and ignores local web assets. The
    directory holds one inert `index.html` with a comment explaining why it
    exists.
  - `server.url: process.env.CAP_SERVER_URL || 'https://feelslikehome.app'`
    — dev/prod separation without maintaining two config files. Set
    `CAP_SERVER_URL` to point a local Capacitor build at a dev server (see
    §"Local setup" below); leave it unset for a release build, which then
    always points at production with no extra step.
  - `server.cleartext: false` — HTTPS only, always, including for
    `CAP_SERVER_URL` (see setup notes on getting a local dev server onto
    HTTPS rather than flipping this on).
- `ios/` — the native Xcode project scaffold, added via `npx cap add ios`.
  Standard Capacitor template: `AppDelegate.swift`/`SceneDelegate.swift` with
  no custom logic yet, stock `Info.plist`, stock (unbranded) launch image
  placeholders, a Swift Package Manager manifest for Capacitor's runtime
  (no CocoaPods needed — this Capacitor version defaults to SPM). Capacitor's
  own `ios/.gitignore` already excludes derived/build artifacts (`Pods`,
  `DerivedData`, `xcuserdata`, the synced `capacitor.config.json` snapshot,
  the copied `public/` web assets) — only the actual project structure is
  committed.
- `src/lib/platform.js` — native-environment detection helper (§5).
- `src/components/InstallPrompt.jsx` — gated off inside the native shell
  (§5) — the one behavior change in existing app code.
- `test/capacitor-foundation.test.js` — regression coverage for the above.

Nothing else in the existing application changed.

## 3. Native-environment detection (`src/lib/platform.js`)

```js
import { Capacitor } from '@capacitor/core';
export function isNativeApp() {
  return Capacitor.isNativePlatform();
}
```

`Capacitor.isNativePlatform()` resolves against `globalThis`/`global` with
optional chaining internally and falls back to `"web"` when no native bridge
(`window.webkit.messageHandlers.bridge` on iOS, `window.androidBridge` on
Android) is present. That means it **never throws in Node/SSR** and always
resolves to `false` there — verified directly (not just asserted) by a test
that imports and calls it in the plain Node test environment.

**Scope, deliberately narrow:** this exists to gate a handful of small
presentation details that only make sense one way or the other — e.g. the
PWA "Add to Home Screen" prompt makes no sense inside a shell that's already
installed natively. It must **never** gate routing, data fetching, Match
calculation, or any business logic — the entire point of remote-hosted mode
is that native and web run the exact same application. Narrow-viewport
mobile web already has its own CSS-driven presentation throughout the app
(bottom nav, mobile card layouts, etc.), entirely independent of this helper
and untouched by it.

**Current usage:** `InstallPrompt.jsx` now returns early inside
`isNativeApp()` before registering the PWA service worker or showing the
install banner. This is the only behavior change to existing code in this
PR, and it's inert on every existing web session (`isNativeApp()` is `false`
there) — confirmed by the full existing test suite and production build
passing unchanged.

## 4. Distinguishing desktop web / mobile web / native shell

Three states, two independent axes — don't conflate them:

| | Desktop web | Mobile web (Safari/Chrome) | Native iOS shell |
|---|---|---|---|
| `isNativeApp()` | false | false | **true** |
| Viewport width | wide | narrow | narrow (always, it's a phone) |
| Presentation driver | CSS `min-width` | CSS `max-width` (~700px boundary) | same CSS **plus** `isNativeApp()` where needed |

Responsive presentation (bottom nav, card layout, mobile Map, mobile tour,
etc.) is **already** entirely CSS/viewport-driven from the earlier mobile-web
phases and needs no native-specific fork — a phone is a phone whether it's
Safari or the installed app. `isNativeApp()` is reserved for the narrower
set of things that are true *only* inside the installed shell regardless of
viewport (PWA install prompt today; later: hiding a "share via link"
web-only affordance in favor of the native Share Extension entry point,
routing "Open in Maps" to `MapKit`/`Apple Maps` instead of a web link, etc.).
Keeping these two axes independent is what keeps native from quietly
forking into a second product.

## 5. Auth / session-persistence considerations

No auth code changed in this PR — this section documents what to verify
once real device/Simulator testing is possible (this sandbox cannot run
Xcode; see §11).

- **Session storage is cookie-based.** The browser Supabase client
  (`src/lib/supabase/client.js`) uses `@supabase/ssr`'s
  `createBrowserClient`, which stores the session in cookies specifically so
  the server-rendered layout can read the same session. In remote-hosted
  mode, the native `WKWebView` loading `https://feelslikehome.app` gets the
  same cookie jar behavior as mobile Safari would for that origin — this is
  the single biggest thing to verify empirically on a real device once
  possible: force-quit the app, relaunch after a day, confirm the session is
  still valid. If it doesn't hold up, the fix is a small persistence
  adapter, not a rewrite of how auth works today.
- **No OAuth/social login exists today** — email/password only
  (`supabase.auth.signInWithPassword`/`signUp`/`resetPasswordForEmail`).
  Sign in with Apple (guideline 4.8) is only required if a third-party
  social login is ever added; not currently triggered.
- **Password-reset/signup-confirmation emails are plain HTTPS links**
  (`src/app/auth/callback/route.js` exchanges `?code=` server-side and
  redirects) — not custom URL schemes. Making these open directly in the
  native app instead of mobile Safari is a Universal Links concern (§7),
  not an auth-logic concern.
- **No auth code needs to change for remote-hosted mode to work** — the
  WebView is just another HTTPS client hitting the same endpoints.

## 6. Safe-area handling

**Already present, should need nothing new.** The mobile-web foundation
work already added `viewportFit: 'cover'` to `src/app/layout.js`'s viewport
export and uses `env(safe-area-inset-*)` throughout `globals.css` (bottom
nav padding, map/tour overlay clearance, etc.). `WKWebView` — which is what
Capacitor uses under the hood — respects the same `viewport-fit=cover` +
CSS `env()` safe-area mechanism as Safari, since it's the same WebKit engine
underneath. This should carry over into the native shell without changes,
but is explicitly on the list to **verify empirically** on first real
Simulator/device run (§11) rather than assumed. If the shell's native
`contentInset` configuration ever needs tuning (Capacitor's iOS config
supports a `contentInset` setting — `'automatic'`/`'always'`/`'never'` — that
affects how far the WebView extends under the status bar/notch), that's a
one-line addition to `capacitor.config.js`, deliberately not guessed at here
without the ability to see the result.

## 7. Deep links / Universal Links plan (not implemented in this PR)

Two existing routes are the deep-link candidates, both already plain HTTPS
paths with no custom scheme: `/homes/[homeId]` (a specific home/property) and
`/invite/[token]` (collaborator invite acceptance). Nothing about them needs
to change on the Next.js side.

What Universal Links require, later, natively:
1. **Associated Domains entitlement** on the iOS app target (Xcode capability
   `applinks:feelslikehome.app`) — requires an Apple Developer account.
2. **An `apple-app-site-association` file** hosted at
   `https://feelslikehome.app/.well-known/apple-app-site-association`,
   listing which paths (e.g. `/homes/*`, `/invite/*`) should open the native
   app instead of Safari. This is a small, additive Vercel deployment change
   (a new static file/route) — not a change to existing architecture, but
   it **is** a production deployment change, so it should be proposed and
   approved as its own small PR when this phase is reached, not bundled
   into native work silently.
3. Once both exist, tapping an invite/home link (from email, SMS, or
   anywhere) opens the native app directly when installed, and falls back to
   the web page otherwise — "same product, complete on either device"
   exactly.

## 8. Share Extension architecture recommendation (not built in this PR)

This is intentionally **documented, not implemented** here, per explicit
scope. Two things already exist and should not be reimplemented in Swift:

- **`src/lib/listingUrl.js`** — pure, synchronous URL parsing (no network
  call) that already recognizes Zillow, Realtor.com, Redfin, Homes.com
  (address extraction) and Zillow apartments, Apartments.com, Rent.com
  (apartment-identity extraction).
- **`HomeModal.jsx`'s `findInput`/`handleFind`** — the existing Add
  Home/Property entry point already accepts a pasted URL or address and
  routes it through this same parser, then to `/api/import-listing`
  (RentCast) for enrichment.

**Recommended contract:** the iOS Share Extension should be as thin as
possible — grab the shared URL, then hand it to the *web app*, which already
owns all of the parsing/matching/enrichment logic server-side. Concretely:

1. Build (in a later phase) a small Next.js entry point —
   e.g. `/add?url=<encoded>` — that opens the existing Add flow prefilled
   with that URL and reuses `handleFind()`'s existing branching (URL vs.
   address vs. apartment-community-name) exactly as today. This is pure
   Next.js work, requires no native code, and is useful standalone (a
   shareable "add via link" URL that works from any browser) before any
   Capacitor work touches it.
2. The Share Extension's only job is to open that URL as a **Universal
   Link** (`https://feelslikehome.app/add?url=...`) — reusing the same
   Associated Domains entitlement from §7. If the app is installed, iOS
   opens it natively; if not, it opens in Safari and still works — "sharing
   captures the contender, Feels Like Home finishes the work," entirely in
   the existing web app either way.
3. This keeps 100% of the import/matching logic in one place (the existing
   Next.js/Supabase app), avoids reimplementing RentCast calls or address
   parsing in Swift, and means a future improvement to import quality
   automatically improves the share flow too, with zero native code to
   touch.
4. The three states in the product brief (Ideal/Partial/Unsupported success)
   map directly onto `handleFind`'s existing three outcomes today
   (`extractAddressFromListingUrl` succeeds → look up and show Match;
   `extractApartmentIdentityFromListingUrl` succeeds but no street address →
   ask for it; neither matches → manual property name/address entry) — the
   Share Extension surface is presentation of an already-built decision
   tree, not a new one.

**What requires Xcode/native target configuration later** (not now): adding
a Share Extension target to the Xcode project, its `Info.plist`
`NSExtensionActivationRule` (accept URLs and plain text from the share
sheet), an App Group if the extension ever needs to hand off more than a
URL string, and wiring its "Open in Feels Like Home" action to the
Universal Link above. All of this needs a Mac with Xcode — see §11.

## 9. Apple Developer dependency checklist

| Needed | Requires Apple Developer membership? |
|---|---|
| Choosing/reserving the real bundle ID | Yes (reserved in the Developer portal) |
| Code signing certificates / provisioning profiles | Yes |
| Associated Domains entitlement (Universal Links, §7) | Yes |
| Share Extension target + entitlements (§8) | Yes (a second target needs its own signing) |
| TestFlight distribution | Yes |
| App Store submission | Yes |
| Everything in this PR (config, scaffold, detection helper, docs) | **No** — all completed without one |
| Local Simulator builds once Xcode is available | No membership required for Simulator; a free account is enough to build and run in Simulator, only device/TestFlight/App Store need a paid membership |

## 10. App Store review considerations

A remote-hosted "wrapped web app" is a legitimate, common Capacitor pattern,
but Apple's Guideline 4.2 ("Minimum Functionality") can reject an app that
reads as merely a repackaged website. The mitigation is a genuinely native
surface: the bottom nav, the Share Extension, native Apple Maps handoff, and
standard iOS chrome (status bar, launch screen, safe areas) are not just
polish here — they're what makes this a legitimate native app rather than a
bookmark. Treat the "target native product experience" sections of the
original brief as review-risk mitigation, not only UX nice-to-haves.

## 11. What this sandbox could and could not verify

This is a Linux CI-style sandbox with no Xcode, CocoaPods, or iOS Simulator
(`npx cap doctor` output below, unmodified):

```
💊   Capacitor Doctor  💊

Latest Dependencies:
  @capacitor/cli: 8.5.2
  @capacitor/core: 8.5.2
  @capacitor/android: 8.5.2
  @capacitor/ios: 8.5.2

Installed Dependencies:
  @capacitor/android: not installed
  @capacitor/ios: 8.5.2
  @capacitor/core: 8.5.2
  @capacitor/cli: 8.5.2

[error] Xcode is not installed
```

**Actually performed and passing** in this environment:
- `npx cap init` / `npx cap add ios` / `npx cap sync ios` — all completed
  successfully; the iOS project scaffold exists and syncs cleanly.
- `npm test` — full existing suite (176 tests) plus 4 new tests, all passing.
- `npm run build` — full production Next.js build, unchanged bundle sizes,
  no new warnings.

**Not performed, and not claimed:** compiling, launching, or running the
iOS app in Simulator or on a device; visually confirming safe-area behavior,
status bar appearance, or launch screen inside `WKWebView`; testing session
persistence across a real app restart; anything requiring Xcode. All of
these need a Mac with Xcode installed and are called out as first
next-steps in §12.

## 12. Recommended next steps (not this PR)

1. On a Mac with Xcode: `npx cap open ios`, build for Simulator, confirm the
   app loads `https://feelslikehome.app`, sign-in works, and safe areas /
   bottom nav render correctly (§6, §5).
2. Verify session persistence across a force-quit + relaunch (§5) — the
   single highest-value thing to confirm before investing further.
3. Verify the Google Maps/Places API key's HTTP-referrer restriction (set in
   Google Cloud Console, outside this repo) doesn't block requests
   originating from the WebView's effective origin inside Capacitor; add an
   application-restricted key for iOS if needed. Unrelated to anything in
   this PR — flagged here so it isn't discovered late.
4. Reserve the real bundle ID and start Apple Developer enrollment (§9) —
   has real lead time, worth starting in parallel with step 1.
5. Build the `/add?url=` prefill entry point (§8, item 1) — pure Next.js,
   no native dependency, useful standalone.
6. Only after 1–5: propose the `apple-app-site-association` file (§7) as its
   own small, explicit PR (it's a production deployment change and should
   be reviewed as one), then the Share Extension Xcode target (§8).

## Local setup

- **Web development is unaffected** — `npm run dev` / `npm test` /
  `npm run build` work exactly as before; nothing here requires Capacitor to
  be present to develop the web app.
- **To point a native build at your local dev server** instead of
  production: run `next dev` reachable over HTTPS (e.g.
  `next dev --experimental-https`, or a tunnel like ngrok/Cloudflare
  Tunnel — `cleartext` stays `false`, so `http://` origins won't load), then
  `CAP_SERVER_URL=https://<your-dev-url> npx cap sync ios` before opening
  Xcode. Omit `CAP_SERVER_URL` for a build that should point at production
  (the default).
- **Opening the iOS project** requires a Mac with Xcode:
  `npx cap open ios`. Not possible in this sandbox — see §11.
