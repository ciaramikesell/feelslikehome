# iOS Share Extension (#76)

## Repository audit

The current source-of-truth branch already contains the post-#69 native
foundation and the #70–#75 product work. The relevant implementation is:

- Capacitor 8.5.2 (`core`, `ios`, and CLI), with `@capacitor/app` 8.1.1.
- One UIKit/scene-based iOS application target in
  `ios/App/App.xcodeproj`, remotely hosting `https://feelslikehome.app` in a
  `CAPBridgeViewController`. The deployment target is iOS 15.0 and the main
  bundle identifier is `app.feelslikehome.mobile`.
- Automatic signing is configured, but no `DEVELOPMENT_TEAM` is committed.
  The main app has only the Associated Domains entitlement,
  `applinks:feelslikehome.app`; there was no App Group or Share Extension.
- `AppDelegate` creates the existing `SceneDelegate`; the scene delegate
  forwards both URL contexts and Universal Link user activities through
  Capacitor's supported `SceneDelegateProxy`.
- The AASA route is served by Next.js at
  `/.well-known/apple-app-site-association`. It allows product routes and
  excludes infrastructure routes. Its real app identifier is assembled from
  the deployment's `APPLE_TEAM_ID` plus `app.feelslikehome.mobile`.
- #75's root `DeepLinkBridge` listens to Capacitor's retained `appUrlOpen`
  event. It validates the outer HTTPS FLH host, preserves path/query/hash,
  and calls `router.replace`. Capacitor retains a cold-launch event until the
  JS listener exists; the same listener receives warm-launch events.
- #73's `/homes?url=` effect validates the nested URL, consumes the query
  once, exact-matches already-loaded `listingUrl` values, and otherwise
  opens the existing Add Home importer. The protected layout carries the
  complete destination through sign-in/onboarding and back to intake.
- #74 puts bounded timeouts around downstream requests and converts import,
  commute, and collaboration failures into controlled UI/API failures. The
  extension does not bypass any of those paths.

No conflict between the handoff and current code required changing #73,
#74, or #75. No schema, RLS, product surface, or listing parser is changed.

## Extension architecture

`ShareExtension` is an embedded `com.apple.share-services` app-extension
target with bundle identifier `app.feelslikehome.mobile.share`, iOS 15.0,
and application-extension-safe APIs enabled. Its activation rule accepts a
single web URL/web page and plain text. It has no entitlements and no App
Group.

The controller examines input attachments in source order. It makes a first
pass for `UTType.url`, then a fallback pass for `UTType.plainText`. URL,
String, and Data payload forms are normalized. Plain text is accepted when
the whole value is a URL or when it contains exactly one whitespace-delimited
HTTP(S) URL; text containing several URLs is rejected rather than guessed.
Only HTTP and HTTPS URLs with a host are accepted.

`ShareURL.intakeURL` uses `URLComponents` and `URLQueryItem` to produce:

```text
https://feelslikehome.app/homes?url=<encoded original absolute URL>
```

It never decodes the source URL, parses a provider, checks duplicates, or
handles authentication. Query parameters, fragments, percent escapes, and
Unicode encoded in the source URL remain represented in the nested query
value for #73.

The extension asks its public `NSExtensionContext` to open that production
Universal Link and completes only after iOS reports success. This is the
smallest extension-safe bridge to #75: no `UIApplication.shared` (unavailable
to app extensions), custom URL scheme, responder-chain traversal, or private
API. The main app's existing retained `appUrlOpen` path then supplies cold
and warm behavior; its existing web auth continuation owns signed-out users.

If extraction or handoff fails, the extension shows a short explanation and
a Close button. It neither logs the shared URL nor invents/manual-enters a
property.

## Validation boundaries and manual setup

Swift package tests exercise the Foundation-only URL helper on Linux. Node
contract tests also verify target embedding and architectural boundaries.
Neither proves that a source app publishes a particular item-provider shape
or that iOS accepts/opens the Universal Link from the Share extension.

This environment has no macOS, Xcode, simulator, signing identity, or iOS
device. Before merge/release, Ciara must:

1. Open `ios/App/App.xcodeproj` in Xcode and select the real Apple Developer
   Team for both `App` and `ShareExtension`.
2. Register/allow the explicit extension App ID
   `app.feelslikehome.mobile.share` in the Apple Developer account and
   refresh provisioning profiles. No App Group capability should be added.
3. Confirm production `APPLE_TEAM_ID` makes the AASA endpoint advertise the
   signed main app's exact application identifier and that Associated
   Domains remains enabled on the main target.
4. Build both targets, install on a physical iPhone, and verify that
   `NSExtensionContext.open` returns success for this Share extension point.
   Apple controls extension-point handoff behavior, so this must not be
   inferred from pure tests. If the OS returns failure on supported devices,
   stop and reassess with Apple documentation rather than adding a responder
   hack or silently adding shared state.
5. Exercise Safari, Zillow, Realtor.com, Apartments.com, Redfin/builder sites,
   and generic pages while the app is terminated, backgrounded, and open;
   cover signed-in/out, repeat shares, sequential shares, and unsupported
   input. Record the actual `NSItemProvider` representations without logging
   production URLs unnecessarily.

Database migrations: none. Supabase impact: none. Vercel/config impact: none
beyond #75's already-required production `APPLE_TEAM_ID` configuration.
