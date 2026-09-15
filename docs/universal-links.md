# Universal Links / deep-link bridge (#74 in the native sequence)

Phase 1 outcome: connect ordinary production `https://feelslikehome.app/...`
URLs to the installed iOS app via Apple Universal Links, with the native
layer contributing zero product logic. #75 (Share Extension) and future
Realtor/helper invitation flows should be able to reuse this bridge as-is.

## 1. Audit findings (pre-implementation state)

- **Capacitor**: `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` all
  `8.5.2` (locked via `package.json`). No `@capacitor/app` — the plugin that
  provides the `appUrlOpen` JS event — was installed; this PR adds it
  (`8.1.1`).
- **Capacitor config** (`capacitor.config.js`): remote-hosted mode.
  `appId: 'app.feelslikehome.mobile'`, `server.url` points at
  `https://feelslikehome.app` in production. No custom URL scheme, no other
  capabilities configured.
- **iOS app target**: `ios/App/App.xcodeproj`. Bundle identifier
  `app.feelslikehome.mobile`, confirmed identical in both the Debug and
  Release `XCBuildConfiguration` blocks and in `capacitor.config.js` — not
  changed by this PR.
- **Apple signing**: no `DEVELOPMENT_TEAM` is set anywhere in
  `project.pbxproj`, and no `.xcconfig` sets one either. This means **no
  Apple Developer Team ID is available anywhere in this repository or
  buildable from source** — it's account-specific and was never committed.
  This blocks constructing a real `TEAMID.BUNDLEID` application identifier
  from this environment. See §2.
- **Entitlements**: none existed. No `CODE_SIGN_ENTITLEMENTS` build setting,
  no `.entitlements` file anywhere under `ios/`.
- **AppDelegate/SceneDelegate**: both are stock Capacitor 8 SPM-mode
  boilerplate. Critically, `SceneDelegate.swift` already proxies
  `scene(_:openURLContexts:)` and `scene(_:continue:)` (the Universal Link
  entry point) to `SceneDelegateProxy.shared` — Capacitor's own
  `CAPSceneDelegateProxy`, part of `@capacitor/ios`. **No native Swift
  changes were needed**; the scene-level plumbing Universal Links need was
  already present, just unused because no plugin was listening.
- **`@capacitor/app`'s native implementation** (read directly from
  `node_modules/@capacitor/app/ios/Sources/AppPlugin/AppPlugin.swift` after
  installing it): its `appUrlOpen` event is emitted with
  `notifyListeners(..., retainUntilConsumed: true)` for both
  `capacitorOpenURL` and `capacitorOpenUniversalLink` notifications. This is
  Capacitor's own "hasn't launched a JS listener yet" queue — the event is
  retained and replayed to the first listener that registers, regardless of
  whether that's before or after the OS actually delivered it. This directly
  solves the cold-start race (see §8) without any custom native code or a
  separate `getLaunchUrl()` call.
- **Next.js routing**: App Router, no route-name assumptions needed —
  confirmed directly:
  - Home Detail: `src/app/(app)/homes/[homeId]/page.js`.
  - Invite: `src/app/invite/[token]/page.js` (outside the `(app)` group; has
    its own `redirect=` preservation).
  - `/homes?url=` intake: `HomesBoard.jsx`, hardened in #73
    (`docs/share-intake-contract.md`).
  - Auth-gated routes live under `src/app/(app)/`, gated by
    `(app)/layout.js`, which already preserves the original destination
    through sign-in/onboarding via `?redirect=` (built in #73, reused
    unchanged here — see §10).
  - `src/app/page.js` (bare `/`) always redirects server-side to
    `/auth/sign-in`, `/onboarding`, or `/homes` with no query preserved. This
    is the app's default boot landing; see §8 for how a deep-link
    destination survives it.
- **Middleware** (`src/middleware.js`): matcher was
  `/((?!_next/static|_next/image|favicon.ico|...).*)`, which *would* have
  matched `/.well-known/apple-app-site-association` and run the Supabase
  session-refresh logic against it — wasted work against an unauthenticated,
  machine-fetched file. Narrowed with one additional exclusion; see §5.
- **Canonical hostname**: no `next.config.mjs` redirect, no `vercel.json`,
  and no other repo-visible evidence that `www.feelslikehome.app` is used or
  redirects anywhere. **This cannot be confirmed from code** — Vercel's own
  domain/alias configuration isn't visible from this environment. Per the
  explicit instruction to only add `www` if the repo/production behavior
  demonstrates it's intentionally supported, **it is deliberately excluded**
  from both the Associated Domains entitlement and the JS-side hostname
  allowlist. Add it to both, together, once confirmed.

No architectural conflict was found that required stopping before
implementing — the one real gap (Apple Team ID) has an explicit, non-invented
fallback described in §2.

## 2. Apple identity

- **Bundle ID**: `app.feelslikehome.mobile` — already set consistently
  everywhere it appears; not changed by this PR.
- **Apple Developer Team ID**: **not available from this environment.**
  Nothing in the repository, in any `.xcconfig`, or in any committed config
  encodes it — it's tied to a real, paid Apple Developer Program enrollment
  and is normally set by Xcode's Signing & Capabilities UI while signed into
  that account, which requires Xcode and an authenticated Apple ID (neither
  available in this sandbox). **No value was invented or guessed.**
- **AASA application identifier**: `src/lib/aasa.js` builds
  `${APPLE_TEAM_ID}.app.feelslikehome.mobile` from an environment variable,
  read at request time by the route handler
  (`src/app/.well-known/apple-app-site-association/route.js`). With
  `APPLE_TEAM_ID` unset, the endpoint still serves a fully spec-valid
  document (200, JSON, no redirect) with `details: []` — inert (grants no
  app association) rather than wrong.
- **What's required to finish this**: someone with access to the Apple
  Developer account needs to (a) find the Team ID (developer.apple.com →
  Membership, or `xcrun altool` with real credentials), (b) set
  `APPLE_TEAM_ID` in Vercel's environment variables for the production
  deployment, and (c) in Xcode, open the App target's Signing & Capabilities
  tab, sign in with that team, and add the Associated Domains capability
  (Xcode will register it with Apple's developer portal — a step that can't
  happen headlessly). The entitlement file this PR adds
  (`ios/App/App/App.entitlements`) already declares
  `applinks:feelslikehome.app`; Xcode adding the capability through its UI
  should reconcile against it rather than conflict.
- **Do not repeatedly redeploy chasing a "team ID not set" AASA** — see §21
  on Apple's own caching behavior.

## 3. Associated Domains

`ios/App/App/App.entitlements` (new file):

```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:feelslikehome.app</string>
</array>
```

Wired into **both** the Debug and Release `XCBuildConfiguration` blocks for
the `App` target via `CODE_SIGN_ENTITLEMENTS = App/App.entitlements;` in
`project.pbxproj`. No wildcard domain, no `www` (see §1), and no other
capability (no Handoff, App Clips, push notifications, Share Extension, App
Groups).

The file is not registered as a `PBXFileReference`/`PBXGroup` entry, so it
won't appear in Xcode's Project Navigator sidebar until someone adds it there
manually — that's purely cosmetic and has no effect on the build; the
`CODE_SIGN_ENTITLEMENTS` build setting alone is what code signing reads.

## 4. AASA

`src/lib/aasa.js` (pure, tested) builds the document;
`src/app/.well-known/apple-app-site-association/route.js` (a Next.js Route
Handler) serves it at the exact required path with no extension.

Route policy (current, iOS 13+ `components` format, appropriate for this
app's `IPHONEOS_DEPLOYMENT_TARGET = 15.0`): infrastructure paths are
excluded — `/api/*`, `/_next/*`, `/.well-known/*`, and the same static-asset
extensions middleware already excludes (`.ico/.svg/.png/.jpg/.jpeg/.gif/.webp`)
— then a single catch-all (`{"/": "*"}`) makes every other path eligible.
This is deliberately durable: a new product route (Home Detail, invite, a
future Realtor/helper surface) needs zero changes here, because nothing
route-specific was ever encoded — only the infra exclusions are enumerated.

## 5. Vercel / Next.js serving

Verified locally against a production build + `next start`:

- `GET /.well-known/apple-app-site-association` → `200`, zero redirects,
  `content-type: application/json`, `cache-control: public, max-age=3600`.
- With `APPLE_TEAM_ID` unset: `{"applinks":{"apps":[],"details":[]}}`.
- With `APPLE_TEAM_ID=ABCDE12345`: a full document with
  `appIDs: ["ABCDE12345.app.feelslikehome.mobile"]` and the route policy
  above.
- No `set-cookie` header on the response, confirming middleware's Supabase
  session-refresh path did not run for this request (see the narrow
  `\.well-known/` exclusion added to `src/middleware.js`'s matcher).

No DNS, domain, or unrelated Vercel/env changes were made.

## 6. Capacitor URL handling (the bridge)

`src/lib/deepLink.js` — `resolveDeepLinkPath(rawUrl)`, a pure function:

- Parses with the real `URL` constructor (never a regex/substring check).
- Requires `protocol === 'https:'` — rejects `http:`, `javascript:`, `file:`,
  anything else.
- Requires `hostname === 'feelslikehome.app'` **exactly** — rejects
  subdomains (`sub.feelslikehome.app`), suffix spoofs
  (`feelslikehome.app.evil.com`), and unrelated domains. `www` excluded, see
  §1.
- Returns `pathname + search + hash` untouched — no decoding, no
  re-encoding, no interpretation. This is what preserves #73's nested
  `?url=<percent-encoded listing URL>` byte-for-byte (see §7 below and the
  regression test covering it).

`src/components/DeepLinkBridge.jsx` — the only place this function is used.
Registers exactly one `App.addListener('appUrlOpen', ...)` (from
`@capacitor/app`), gated behind `isNativeApp()` so it's a no-op on
web/desktop/mobile-Safari. On a valid FLH URL, calls `router.replace(path)`
— the existing Next.js client router, not a second router, not a WebView
reload. Mounted once, in the root layout (`src/app/layout.js`), so it's
present no matter which page the app's boot redirect chain lands on (see
§8).

## 7. Nested URL encoding

Covered directly by `resolveDeepLinkPath`'s design (§6): the function never
calls `decodeURIComponent`/`encodeURIComponent` and never inspects the query
string's contents, so
`https://feelslikehome.app/homes?url=https%3A%2F%2Fwww.zillow.com%2F...`
arrives at `/homes` (`HomesBoard.jsx`'s existing `?url=` intake effect) with
its nested encoding intact, letting #73 do exactly what it already does for
that param. Regression-tested directly (`test/universal-links.test.js`).

## 8. Cold start

Sequencing, confirmed by reading `@capacitor/app`'s native source (§1): the
WebView boots by loading `server.url` (`https://feelslikehome.app`, i.e. bare
`/`) regardless of how the app was launched — Capacitor's remote-hosted mode
doesn't intercept the initial load with the deep-link URL. `src/app/page.js`
then runs its own server-side redirect chain
(`/auth/sign-in` → `/onboarding` → `/homes`) before any client JS mounts.

This is safe, not a race, because:

1. `DeepLinkBridge` is mounted in the **root** layout, so it's present
   however that redirect chain resolves.
2. `@capacitor/app`'s `appUrlOpen` is fired with `retainUntilConsumed: true`
   (§1) — if the app was cold-launched via a Universal Link, that event is
   queued by Capacitor's bridge and delivered to `DeepLinkBridge`'s listener
   as soon as it registers, even though registration necessarily happens
   after the OS-level launch.
3. On receiving it, `router.replace(path)` overwrites whatever the default
   boot chain landed on with the actual requested destination — using
   `replace`, not `push`, so the transient default landing page doesn't sit
   in back-button history underneath the real destination.

No custom native "pending URL" storage was written — this is Capacitor's
existing guarantee, used as documented.

## 9. Warm start

While the app is already running/backgrounded, each subsequent Universal
Link tap fires a fresh `appUrlOpen` event; the same listener calls
`router.replace(path)` again. No full app reset, no WebView reload (it's a
router navigation, not a network fetch of a new page), and `replace` avoids
stacking a new history entry per tap. Repeated taps of the same or different
links are safe: `resolveDeepLinkPath` is a pure, stateless function, and a
`router.replace` to an unchanged path is a no-op in the App Router.

## 10. Auth continuation

No native-specific auth logic was added, and none was needed. `DeepLinkBridge`
navigates via the ordinary client router to the ordinary path — exactly like
a user clicking a same-shaped `<Link>` inside the app. That means the
*existing* auth gating already handles it:

- A protected `(app)/...` destination (e.g. `/homes/abc123`) still runs
  `(app)/layout.js` on that client navigation, which redirects a signed-out
  user to `/auth/sign-in?redirect=%2Fhomes%2Fabc123` (via the `x-pathname`
  header + `sanitizeRedirectPath`, both built in #73) — the same mechanism
  any other entry into a protected route already uses.
- `/invite/[token]` has its own, independent `redirect=` preservation
  (unrelated to `(app)/layout.js`, unaffected by this PR).
- No redirect-validation logic was touched; no new open-redirect surface was
  introduced — this bridge only ever calls `router.replace` with a path it
  already validated came from `https://feelslikehome.app`.

## 11. Home Detail

`/homes/[homeId]` requires no bridge-specific handling: a deep link to it is
just `router.replace('/homes/<id>')`, which runs the same authorization the
route already enforces (the home is loaded via `getHomesForUser`, scoped by
RLS and the active search; `notFound()` if it isn't accessible). Universal
Links grant navigation only — nothing about RLS, `home_member_state`, or any
data-access path was touched.

## 12. Collaboration / invitations

`/invite/[token]` needs no invite-specific bridge code either, for the same
reason as §11 — it's an ordinary FLH path. The token, its auth/signup
continuation, and its acceptance logic (`previewInvitation`,
`AcceptInvitationClient`) are all unchanged. The bridge never logs or
inspects the token — `resolveDeepLinkPath` treats `/invite/<token>` as an
opaque path, identically to every other route. This generality is what makes
the bridge reusable, unmodified, by a future Realtor/helper invitation URL of
the same shape — no redesign, because nothing route-specific was ever built
in.

## 13. #73 verification (conceptual)

A supported listing (`/homes?url=<supported, encoded listing URL>`), an
unsupported one, and a duplicate/repeat of the same intake URL all reach
`HomesBoard.jsx`'s existing `?url=` effect completely unchanged — the bridge
only ever computes a path string and calls `router.replace`. Which of those
three outcomes happens is entirely #73's existing logic
(`isLikelyListingUrl`, `findHomeByListingUrl`), not duplicated here.

## 14. Browser fallback

Untouched. Universal Links are opt-in *interception* by iOS at tap time; when
the app isn't installed (or the OS chooses not to intercept), the same
`https://feelslikehome.app/...` URL opens in Safari exactly as before — no
interstitial, no forced scheme redirect, no app-only link was added anywhere
in this PR.

## 15. Safari expectations / correct test methodology

Do not test by typing a URL directly into Safari's address bar — Apple's
Universal Links are only invoked when a link is *tapped* from another app or
context (Notes, Messages, Mail, another app's WebView), not from manual
address-bar entry, and same-domain navigation already in Safari may
deliberately stay in Safari depending on context. Real verification needs a
signed build on a real device with a link tapped from an external app (Notes
is the simplest) — tracked as outstanding for #76 real-device QA (§20).

## 16. No custom URL scheme

Not introduced. `capacitor.config.js` has no scheme configuration change;
`Info.plist` has no `CFBundleURLTypes` entry; nothing in this PR references
`feelslikehome://`. Universal Links (HTTPS) are the only bridge.

## 17. No Share Extension

Not created. No new Xcode target, no `NSExtension` entries, no App Groups, no
extension entitlements — confirmed by regression test
(`test/universal-links.test.js`) asserting `project.pbxproj` contains neither
`ShareExtension` nor the App Groups entitlement key. That's #75.

## 18. Production safety

No Supabase schema/migration, no RLS/ACL, no listing importer/RentCast/Google
Places logic, no Match, no collaboration-permission logic, and no DNS/env
change. The only "infrastructure" touches are: the new AASA route (additive),
one narrowed middleware matcher exclusion (additive, scoped to
`.well-known/`), and the iOS entitlement/Package.swift changes described
above.

## 19. Tests

`test/universal-links.test.js` (19 tests) covers: URL validation/allowlist
(hostname exact-match, protocol, malformed input, nested-encoding
preservation, hash preservation, repeated-call determinism), AASA structure
(empty-team-id inert document, populated document's `appIDs`/route policy/
catch-all ordering), the middleware exclusion, the AASA route's
content-type/caching, `DeepLinkBridge`'s use of the official event +
`router.replace` (never `window.location`) + listener cleanup, its mount
point in the root layout, the entitlement's exact content (no wildcard, no
`www`, no unrelated capabilities), `CODE_SIGN_ENTITLEMENTS` wired on both
build configs, `DEVELOPMENT_TEAM` still absent (nothing invented), the bundle
ID unchanged, no custom scheme, no Share Extension/App Groups, and no
Realtor/helper references anywhere in the new code.

As required: these are JavaScript-level tests, proving the logic and static
configuration are correct — **they are not proof that iOS Universal Links
function on a real device.** See §20/§21.

## 20. Real-device QA

**Not performed.** This sandbox has no Xcode, no iOS Simulator, no signed
build, and no physical device — confirmed (`xcodebuild`/`xcrun`/`pod` are all
absent from `PATH`). Everything in this list is outstanding, explicitly for
#76 (or sooner, whenever a real device + signed build are available):

- Fresh launch from a Universal Link, terminated / backgrounded / foregrounded
- Signed-in state; signed-out → auth → continuation
- `/homes`, Home Detail, `/homes?url=`, collaboration invite
- Repeated same link; sequential different links
- Tapping from an external context (Notes/Messages), not typed into Safari

## 21. AASA endpoint verification

Verified against a local production build only (`npm run build` +
`next start`), not the live `https://feelslikehome.app` deployment (this
environment has no way to reach or redeploy that):

- `GET /.well-known/apple-app-site-association` → `200`, no redirects,
  `content-type: application/json`.
- Content is valid JSON, structurally as described in §4.
- With `APPLE_TEAM_ID` set, `appIDs` resolves to a real-shaped identifier;
  unset, an inert-but-valid empty-details document.

**Apple's own Associated Domains infrastructure (swcdn) caches AASA fetches
independently of any HTTP cache header here, and that cache can take a
meaningful amount of time to refresh** — reinstalling the app or repeatedly
redeploying does not force an immediate re-fetch. Once `APPLE_TEAM_ID` is set
in production, verify the live endpoint once, then allow time before
concluding the association isn't working; don't chase it with repeated
production changes.

## 22-26. Migration / Supabase / Vercel / PR

No migration, no Supabase schema/RLS/data impact. Vercel impact is limited to
the new AASA route (additive) and the `APPLE_TEAM_ID` env var this PR expects
someone to set (not set by this PR). See the PR description for commit/file
details.
