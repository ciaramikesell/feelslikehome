# Native iOS welcome + interactive share tutorial (Milestone 1)

Inside the installed iOS app, a signed-out person now sees one short, warm
welcome instead of the long public marketing homepage, and can optionally
practise sharing a listing into Feels Like Home. Desktop and mobile Safari are
unchanged (verified pixel-for-pixel, §6a). Milestones 2 and 3 are documented
only (§8, §9).

Screenshots and QA output: `docs/native-welcome-share-tutorial-screenshots/`.

## 1. Audit — native detection, first paint and deep links

**Architecture (unchanged).** Remote-hosted Capacitor 8.5: the WebView loads
`https://feelslikehome.app` (`capacitor.config.js`). The signed-out root `/`
is a Server Component (`src/app/page.js`) that renders `<PublicLanding />`
and redirects signed-in people (`/homes`, `/onboarding`, or the Realtor
workspace). Protected routes redirect to `/auth/sign-in?redirect=<full path>`
from `(app)/layout.js`; `/invite/[token]` does the same for signed-out
visitors. Universal Links (cold and warm) arrive through `DeepLinkBridge`
(`appUrlOpen`, retained by Capacitor until a listener exists) and are applied
with `router.replace`. The Share Extension opens
`https://feelslikehome.app/homes?url=<listing>` (#76), consumed once by
`HomesBoard` (#73).

**The existing detection, `isNativeApp()`** (`src/lib/platform.js`), is
`Capacitor.isNativePlatform()`: true only when Capacitor's native bridge
exists (`window.webkit.messageHandlers.bridge` on iOS). It never reads the
user agent, viewport or URL — good — but it only runs after hydration. Every
current consumer (`AuthShell`, `AppShell`, `NativeBootScreen`) therefore
paints the web version first. For the root route that would mean a frame (or
more) of the public homepage inside the app: exactly the flash this
milestone must avoid. Today, in fact, the native app shows the *whole* public
homepage to signed-out users; nothing swaps it.

**What decides the first paint now.** The server cannot know it is talking
to the app (and must not guess from the user agent), so both signed-out
entries are server-rendered and **CSS** picks one before first paint:

1. `NATIVE_SHELL_FLAG_SCRIPT` (in `src/lib/platform.js`, next to
   `isNativeApp()`) is inlined in `<head>` by the root layout. It performs the
   same bridge check as `@capacitor/core`'s `getPlatformId()` and sets
   `<html data-flh-native>`. Capacitor's iOS shell registers the `bridge`
   message handler and injects its globals as `WKUserScript`s at
   `.atDocumentStart` (`JSExport.swift`), so the handler exists before this
   script runs. The script reads no user agent, width, or URL (unit-tested,
   including Safari's `window.webkit` without a bridge).
2. `src/app/page.js`, signed-out only: `<NativeWelcome />` +
   `<div className="flh-web-entry"><PublicLanding /></div>`.
3. CSS: `html:not([data-flh-native]) .flh-welcome { display: none !important }`
   and `html[data-flh-native] .flh-web-entry { display: none !important }`.

**Why the bridge exists before the head script runs (Capacitor 8.5.2 iOS
source, `node_modules/@capacitor/ios/Capacitor/Capacitor/`):**

1. `CAPBridgeViewController.loadView()` creates `WebViewDelegationHandler()`.
   Its `init` calls `contentController.add(self, name: "bridge")`
   (`WebViewDelegationHandler.swift`, `handlerName = "bridge"`).
2. `prepareWebView(…)` builds the `WKWebView` with
   `webConfig.userContentController = delegationHandler.contentController`.
   The handler is therefore part of the WebView's configuration from creation.
3. `CapacitorBridge.init` then adds the Capacitor globals and plugin headers
   as `.atDocumentStart` user scripts (`JSExport.swift`).
4. Only afterwards does `viewDidLoad()` → `loadWebView()` call
   `webView.load(URLRequest(url: appStartServerURL))`, i.e. the remote
   `server.url`.

A script message handler is exposed on `window.webkit.messageHandlers` in
every main-frame document of that WebView from the moment the document
exists, for any origin. The app has no `WKAppBoundDomains` or
`limitsNavigationsToAppBoundDomains`, which could restrict injection. So the
inline `<head>` script sees `bridge` on the very first parse. This is the
same object that `isNativeApp()` already checks after hydration.

**Proving it in the real shell, and a safety net.** Source reading and a
browser emulation are not proof (see §6). Two console lines make the real
behaviour visible in Xcode, because Capacitor forwards `console` output to the
Xcode console in Debug builds:

- The head script logs `[FLH Native QA] native flag set before first paint`
  when it sets the flag, and only then.
- `NativeShellFlagCheck` (root layout; renders nothing; native-only) runs
  `ensureNativeShellFlag()` after hydration. It logs `[FLH Native QA]
  first-paint native flag confirmed` if the flag was already there. If the
  head script missed, it sets the flag late and warns `[FLH Native QA]
  first-paint native flag was MISSING; set after hydration`. In that case the
  welcome still appears, a moment late, rather than never. **That warning
  means "do not merge"**: the first-paint guarantee would not hold, and the
  detection needs correcting first.

The browser QA includes a failure drill for that path: the bridge is
installed only after `<head>`, and the check warns and repairs.

`<html>` gets `suppressHydrationWarning` for that one attribute. The flag is
presentation-only: routing, auth and redirects are untouched and still
server-side.

**Why this is safe for deep links.** The welcome is not a route and not a
redirect: it is what `/` paints for a signed-out person *instead of* the
homepage, and it owns no navigation, timers, storage or auto-opening. Every
deep link either never touches `/` (invitations, `/homes?url=`, Universal
Links opened warm) or replaces it exactly as it replaced the homepage before
(a cold-start Universal Link: the shell loads `/`, then `DeepLinkBridge`
navigates). `DeepLinkBridge`, `deepLink.js`, `(app)/layout.js`, the invite
routes, auth routes, middleware, AASA and Share Extension code are unchanged.
Pending imports, co-buyer invitations and Realtor permissions are therefore
on exactly the paths they were.

**Not changed:** bundle identifiers, signing, entitlements, `Info.plist`,
`capacitor.config.js`, the Share Extension target.

## 2. The welcome

`src/components/NativeWelcome.jsx`: the hero photo, the brand, then

- **A little closer to home.**
- Save homes you've found, see what matches, and decide together.
- **Get Started** → `/auth/sign-up` (existing).
- **Already have an account? Sign in** → `/auth/sign-in` (existing).
- A quiet **See how saving a home works** link that opens the tutorial (optional).

**Exact desktop hero asset:** `public/images/Warm Cottage.png`, the image in
`PublicLanding`'s `.pl-hero-visual`. The welcome uses the same `src` **and the
same `sizes`** as the homepage hero, and deliberately no `priority`. Inside
the app, it reuses the homepage's existing preload (one download). In a
browser, the hidden welcome image is lazy and never fetched. An earlier draft
gave the welcome its own `priority` preload, and the pixel comparison caught
it: desktop Safari/Chrome chose a different hero resolution. That is fixed and
regression-tested.

The layout is a full-height column: the photo flexes and fades into the paper
colour, then brand, headline, lede and actions. Get Started and Sign in are
fully on screen without scrolling at 320×568, 375×667, 390×844 and 430×932
(measured: the Sign in bottom edge is at 502/568, 601/667, 746/844 and
801/932). Every target is at least 44 px.

Signed-in people never see it: the server redirect runs before anything
renders (verified frame by frame in the browser emulation, §6a; to be confirmed in the Simulator, §6b).

## 3. The share tutorial

`src/components/ShareTutorial.jsx`: an optional, replayable, three-step
practice run, labelled "Practice run · a pretend Share Sheet":

1. **Found a home you like? Tap Share.** A fictional listing (14 Linden Lane,
   Maple Hollow, $485,000), photographed with existing FLH feature photography
   (`public/images/onboarding/front-porch.webp`). Its Share button is
   highlighted.
2. **Now tap Feels Like Home.** A simulated sheet slides up: the listing
   preview, a row of destinations (FLH, highlighted with its own mark, then
   neutral, generic "Message / Mail / Notes / More" tiles), and Copy / Add
   Bookmark rows. A wrong tile gives a one-line nudge. **More** explains
   "More → Edit … Favorites". Nothing is a copy of iOS's or any app's artwork.
3. **Saved to Feels Like Home.** A small check pops in, then: "In the app,
   Add Home opens with the listing ready for you to review." (That is what
   #73/#76 do.) Four short facts follow:
   - Works from Safari and supported listing apps.
   - Its spot in the Share Sheet varies by app and iOS version.
   - Don't see it? Swipe the app row to More, tap Edit, and add Feels Like
     Home to Favorites.
   - This is the app's share option — not an Add to Home Screen shortcut.

   Then **Done** or **Practice again**.

**Back** (step-by-step; on step 1 it closes) and **Skip** are always in the
header (on the last step, Skip gives way to the Done button below the facts). Escape closes it. It is a
`role="dialog"` with `aria-modal` and a Tab trap. Focus moves to each step's
one-line instruction, so screen readers announce what to do, and returns to
the opener on close. Nothing is stored, so it can be replayed any time and
never blocks sign-in, sign-up or a deep link.

**Entry points:** the native welcome (optional link), and **Account → Help →
Practice sharing a home** for signed-in people (no sign-out). The Help card
appears only inside the app (`.flh-native-only`, the same first-paint flag),
because the Share Extension does not exist in a browser. Nobody is ever sent
through it automatically.

## 4. Native feedback — haptics and motion

**Plugin audit.** Installed: `@capacitor/core`/`ios` 8.5.2, `@capacitor/app`
8.1.1 (SPM, no CocoaPods). No haptics plugin existed. Added
**`@capacitor/haptics` 8.0.2** (official, Capacitor 8 line, released March
2026). `npx cap sync ios` changed one native file,
`ios/App/CapApp-SPM/Package.swift` (Capacitor-managed), adding
`CapacitorHaptics`. The plugin uses `UIImpactFeedbackGenerator`: no
permission, `Info.plist` key, entitlement or privacy-manifest change.

**Remote-hosted caveat, handled.** The live web code reaches installed builds
that predate this plugin. `src/lib/haptics.js` therefore calls only after
`isNativePluginAvailable('Haptics')` (a new `platform.js` helper:
`Capacitor.isPluginAvailable`) and swallows any failure. Old builds, browsers
and System Haptics = off all get silence, and the tap still works. A new
native build is needed for the haptics themselves.

**Where they fire** (and only there): a light impact on the highlighted
**Share** and **Feels Like Home** taps; a selection tick on the other tiles;
one **success** notification when "Saved" appears. There are none on
navigation, Get Started, Sign in, opening or closing.

**Motion:** a springy `scale(.97)` press on real buttons (`.flh-press`), a
beckoning ring that runs **twice** (never infinite), a 0.38 s sheet slide and
a check "pop". Reduce Motion is honoured by the app-wide rule
(animations/transitions → 0.01 ms, measured), and the press scale is removed
too. The tutorial completes identically under Reduce Motion.

## 5. Files

| File | Change |
|---|---|
| `src/lib/platform.js` | `NATIVE_SHELL_FLAG_SCRIPT`, `NATIVE_SHELL_ATTRIBUTE`, `ensureNativeShellFlag()`, `isNativePluginAvailable()` |
| `src/app/layout.js` | Inline flag script in `<head>`; `suppressHydrationWarning` on `<html>`; mounts `NativeShellFlagCheck` |
| `src/components/NativeShellFlagCheck.jsx` | New: post-hydration confirm/repair + QA console line (native only) |
| `src/app/page.js` | Signed-out: welcome + homepage wrapper (no new redirect) |
| `src/components/NativeWelcome.jsx` | New |
| `src/components/ShareTutorial.jsx` | New |
| `src/lib/haptics.js` | New |
| `src/components/AccountSettings.jsx` | Native-only Help card → tutorial |
| `src/app/globals.css` | One scoped section (`flh-welcome`, `flh-st-*`, `flh-press`, flags) |
| `package.json`, lock, `ios/App/CapApp-SPM/Package.swift` | `@capacitor/haptics` |
| `test/native-welcome-share-tutorial.test.js` | 21 tests |
| `test/public-landing.test.js` | Root-page assertion updated for the wrapper |
| `scripts/qa/native-welcome-qa.mjs`, `scripts/qa/homepage-unchanged-qa.mjs` | Browser QA |

`FLH_ONBOARDING_V3` stays off by default. No SQL, Match, scoring, catalog,
paywall or Floor Plans change. PR #166 is untouched.

## 6. Verification

There are two different kinds of evidence. Only the second can approve the
merge.

| | Browser-emulated native QA (done here) | Real Xcode / iOS Simulator / iPhone QA (founder, required) |
|---|---|---|
| Runs in | Chromium (Playwright) on Linux, against a local production build | The installed Capacitor shell: `WKWebView` inside `CAPBridgeViewController` |
| "Native" means | Scripts that **imitate** what the shell injects (a fake `bridge` handler, Capacitor's real `native-bridge.js`, plugin headers) | The real shell, real WebKit, real launch sequence |
| Can prove | Our code's logic: CSS selection, routing, focus, a11y tree, haptic *call* sequence, fallbacks, that the website is unchanged | That the bridge really exists before first paint, the real launch-to-paint timing, real haptics, VoiceOver, Universal Links, the Share Extension, SPM package resolution, signing |
| Cannot prove | Anything about the installed app's actual timing or WebKit behaviour; Chromium is not WebKit | — |

**The browser suite is not a substitute for running the installed
Capacitor shell.** The first-paint detection in particular must be confirmed
in the Simulator (checklist step E) before merging.

### 6a. Done here (automated, no Xcode)

- **Unit/contract:** `npm test`: 1,365 pass, 0 fail (246 database tests
  skip without Postgres). With the real-Postgres harness: 1,609 pass, 0 fail,
  2 skipped.
- **Production build:** `next build` passes.
- **Browser-emulated native QA** (`scripts/qa/native-welcome-qa.mjs`,
  production build + `scripts/qa/supabase-standin.mjs`): **60/60 checks
  pass** (`results.json`). "Native" pages are given, at document start, a
  stand-in `webkit.messageHandlers.bridge`, the `window.Capacitor` global,
  Capacitor's real `native-bridge.js` from `node_modules/@capacitor/ios`, and
  App + Haptics plugin headers. A fake native side records plugin calls and
  delivers `appUrlOpen` the way `AppPlugin.swift` does. Covered:
  - signed-out cold launch: welcome painted **before hydration** (all JS
    chunks held back); the public homepage is visible on **0 sampled frames**;
  - the QA console lines: `native flag set before first paint` →
    `first-paint native flag confirmed`; none in a browser;
  - **failure drill:** the bridge is installed only after `<head>` → the
    check warns `MISSING`, sets the flag, and the welcome is shown;
  - welcome at 320/375/390/430 (actions above the fold, ≥ 44 px, exact hero);
  - Get Started → `/auth/sign-up`, Sign in → `/auth/sign-in` (native auth
    shell), and a real sign-in to My Homes;
  - returning signed-in launch → `/homes`, with welcome and homepage on 0
    frames;
  - deep links: a signed-out invitation keeps `?redirect=/invite/<token>`; a
    signed-out shared listing keeps the full `/homes?url=…`; a cold-start
    Universal Link over the welcome reaches the invitation; a signed-in Share
    Extension link opens Add Home with "41 Maple St, Troy, MI 48084" parsed
    from the shared Zillow URL;
  - tutorial: Share, wrong tile, More, Back, FLH, success, Practice again,
    Skip, focus return, Escape; keyboard-only completion and focus trap;
    accessibility tree (`tutorial-saved-aria.txt`); Reduce Motion; 320/430
    with no horizontal overflow;
  - haptic call sequence `impact:LIGHT, selectionChanged, selectionChanged,
    impact:LIGHT, impact:LIGHT, notification:SUCCESS`, with nothing else;
  - Account → Help in the app, absent in mobile Safari; no unexpected console
    errors.
- **Public homepage unchanged** (`scripts/qa/homepage-unchanged-qa.mjs`):
  production builds of `main` (the #187 merge) and this branch, served side by
  side. Full-page signed-out screenshots and image requests were compared at
  desktop 1440 and 1024, iPhone 13 and iPhone SE (mobile Safari emulation)
  and 320 px. All are **byte-identical, with identical image requests**, in
  two runs on the final code (`homepage-unchanged/homepage-unchanged.json`).
  An earlier commit's runs had one non-reproducible iPhone SE capture
  difference.

### 6b. Founder QA checklist: Mac checkout with local Xcode signing changes

The checklist never touches your existing checkout or its local signing
edits: no `reset`, `restore`, `clean`, `stash` or `checkout` there. Everything
happens in a **separate git worktree** (a second folder that shares the same
repository).

**A. Look, don't touch.** In your existing checkout (adjust the path):

```bash
cd ~/feelslikehome
```

```bash
git status
```

Your signing changes (e.g. `ios/App/App.xcodeproj/project.pbxproj`) show as
modified. Leave them; nothing below changes this folder's files.

**B. Get PR #188 into its own folder** (next to your checkout):

```bash
git fetch origin claude/native-welcome-share-tutorial
```

```bash
git worktree add --detach ../flh-pr188 origin/claude/native-welcome-share-tutorial
```

```bash
git -C ../flh-pr188 log -1 --format=%H
```

The last command should print the PR head SHA given in the PR description.
`--detach` creates no local branch.

**C. Install and sync, pointing the app at the PR preview.** By default the
app loads **production** (`https://feelslikehome.app`), which does not
contain this PR. Without this step you would be testing the old site.

```bash
cd ../flh-pr188
```

```bash
npm ci
```

```bash
CAP_SERVER_URL=https://feelslikehome-git-claude-native-welcome-share-tutorial-tbd-fcfc.vercel.app npx cap sync ios
```

```bash
grep '"url"' ios/App/App/capacitor.config.json
```

The `grep` must show the preview URL. That file is git-ignored, so this
changes nothing tracked. The sync also registers the new
`CapacitorHaptics` Swift package.

First open the preview URL in Safari on the Mac. If Vercel asks you to log in
(Deployment Protection), the app's WebView would be stopped the same way. In
Vercel → this deployment → **Share**, copy the shareable link (it ends in
`?_vercel_share=…`), and rerun the sync with that full link in quotes as
`CAP_SERVER_URL`. Capacitor loads `server.url` as given, query included. I
could not check the preview's protection setting from this environment.

**D. Build and run in Xcode.**

```bash
open ios/App/App.xcodeproj
```

1. Wait until **Package Dependencies** finishes resolving. It should list
   `CapacitorHaptics` beside `CapacitorApp`.
2. Choose the **App** scheme and a current iPhone Simulator (e.g. iPhone 16).
3. Simulator builds normally need no team. If Xcode says "Signing for 'App'
   requires a development team", choose your Team under **Signing &
   Capabilities** for the **App** and **ShareExtension** targets. That edits
   only this worktree's copy. Don't commit it.
4. Start fresh and signed out (this removes only the Simulator's copy of the
   app and its cookies):

   ```bash
   xcrun simctl uninstall booted app.feelslikehome.mobile
   ```

5. **Product → Run** (⌘R).

**E. First-paint native detection. This is the merge gate.**

1. In Xcode's console (**View → Debug Area → Activate Console**), filter for
   `FLH Native QA`. On launch you must see, in this order:
   - `[FLH Native QA] native flag set before first paint`
   - `[FLH Native QA] first-paint native flag confirmed`
2. You must **not** see `first-paint native flag was MISSING; set after
   hydration`. If you see it, or see neither line, **stop: do not merge**.
   Send me the console output; the detection needs a correction first.
3. Watch the screen: the launch screen should go straight to the welcome
   photo and "A little closer to home." There should never be any frame of
   the long homepage (its "How it works" / "For Realtors" header). Repeat
   three cold launches (⌘. to stop, then ⌘R).
4. Optional, stronger: in Mac Safari → **Settings → Advanced → Show features
   for web developers**, then **Develop → [your Simulator] → the FLH page →
   Console**, and run
   `document.documentElement.hasAttribute('data-flh-native')`. It should
   return `true`.
5. Optional: Xcode's **Network Link Conditioner** (Additional Tools) set to
   3G makes any flash easier to see.

**F. Product flows in the Simulator.**

1. **Get Started** opens the app-style sign-up. **Already have an account?
   Sign in** opens sign-in. Sign in with a real account (the preview uses
   whatever Supabase project its Vercel Preview environment is configured
   with).
2. Quit and relaunch: you land on My Homes, with no welcome or homepage.
3. Account → **Help → Practice sharing a home**: Share → Feels Like Home →
   Saved. Try Back, Skip, Practice again and Done. Tap Message/More for the
   hints.
4. Haptics can't be felt in the Simulator. The Xcode console shows
   Capacitor's `To Native` lines for `Haptics` on the Share, Feels Like Home
   and Saved taps only.
5. Reduce Motion: Simulator **Settings → Accessibility → Motion → Reduce
   Motion** on, then repeat the tutorial. There should be no slide or pop, and
   it still completes.
6. Accessibility: **Xcode → Open Developer Tool → Accessibility Inspector**
   on the tutorial. Each tile and Back/Skip are buttons with names.

**G. Deep links and website (Simulator).**

1. Invitation, signed out (use a real pending invitation token):

   ```bash
   xcrun simctl openurl booted "https://feelslikehome.app/invite/<token>"
   ```

   It should reach sign-in with the invitation kept, never the welcome.
   Universal Links in the Simulator need a signed Associated Domains build.
   If the link opens Safari instead of the app, that is a Simulator/signing
   limitation; check it on the iPhone (step H).
2. Share Extension: in the Simulator's Safari, open any listing page → Share
   → Feels Like Home (it may be under More → Edit). Add Home should open with
   that listing.
3. Website: open the preview URL in Mac Safari and in the Simulator's
   Safari. Both show the **normal homepage**, not the welcome.

**H. On your iPhone (recommended before merge).** Same worktree, select
your iPhone, and choose your Team if asked. Repeat E (the console works the
same with the phone connected), feel the haptics in the tutorial, try
VoiceOver, and repeat the invitation and Share Extension links with the app
terminated. Note that this install replaces whatever build is currently on
the phone.

**I. Afterwards.**

```bash
cd ~/feelslikehome
```

```bash
git worktree remove ../flh-pr188
```

If git refuses because of the Team selection made inside that folder, just
leave the folder; nothing in your main checkout depends on it. The Simulator
app is now the PR build pointing at the preview. Run your usual build from
your main checkout to go back.

**Vercel:** see the PR description for the preview deployment status.
Nothing is deployed to production or merged by this PR.

## 7. Known limits / follow-ups

- `AuthShell`'s native layout is still hydration-gated, and a regression test
  pins its exact `useEffect` pattern. A cold launch straight onto
  `/auth/sign-in` could show the two-column layout for a frame. The new
  first-paint flag could fix this with CSS in a small follow-up, if you want
  it.
- `NativeBootScreen` (signed-in boot) is likewise hydration-gated (also
  pinned by tests). It could adopt the flag the same way.

## 8. Milestone 2 — architecture (document only, not implemented)

**Approved:** two entry paths after the welcome — **A. "Let's personalize your
search"** (the V3 basics and category screens) and **B. "I'll figure it out as
I go"** (minimum setup, then Add Home) — plus a reusable **Explore My
Priorities** walkthrough from My Search.

### Audit: how V3 creates searches and stores progress

- **Searches are never created by onboarding.** `handle_new_user()`
  (`supabase/schema.sql`) inserts the person's one owned `searches` row at
  sign-up. `/onboarding` only *resolves* the search
  (`resolveOnboardingSearch`: the owned search, or the shared search an
  invited co-buyer joined). Neither path can create a duplicate search.
- **Priorities:** one JSON document per member per search,
  `search_member_priorities(search_id, user_id)`. It is written only by
  `savePriorities()` (an upsert on that key, always the caller's own row;
  RLS also enforces `user_id = auth.uid()`). A co-buyer's document is a
  separate row, so there is no crossover. `normalizePriorities()` keeps
  unknown top-level keys, so additive fields survive every reader.
- **Unknown vs Not important:** in flow 4, an unanswered feature is simply
  absent from the document, so it is unscored and never "No". "Not
  important" is the explicit `dontcare` tier. Skip writes nothing to the
  document. This already satisfies "skipped priorities must remain Unknown."
- **Account onboarding progress:** `profiles.onboarding_version` /
  `onboarding_state` (`{ step, answers.searchType, skipped, … }`), and the
  gate `profiles.onboarding_complete`. Shared-search setup uses an
  *ephemeral* progress object and never touches account progress.
- **Required inputs today:** `search_type` (it decides the branches). Basics
  fields are all skippable. Flow 4 can complete with only a search type.

### Proposed design

1. **Path choice:** one new flow-4 screen after `search_type`,
   `setup_path` (`personalize | as_i_go`), stored as
   `onboarding_state.answers.setupPath` (an additive key, like `searchType`).
   Add a `when` to every `cat_*` step: `state.answers.setupPath !==
   'as_i_go'`. Path B then runs `search_type → basics (skippable) → finish`,
   and completion routes to `/homes?add=1` (the existing auto-open of Add
   Home). Path B skips review, so nothing implies Not important. People can
   switch from B to A later through Explore.
2. **Explore My Priorities** is a new route, `/search/explore`, inside
   `(app)` (signed-in, onboarding complete). It renders the existing
   `PriorityFlow` in an `explore` mode:
   - Data: `resolveActiveSearch` + `resolvePriorities` (the same document My
     Search edits). Writes go through the same `savePriorities` with the same
     search ID, so there is no copy and no second document. Every existing
     answer is prefilled because the cards read the document.
   - Steps: the same category list as flow 4 for the document's
     `searchType`, minus `search_type`/`basics` (those stay in My Search
     quick-edit), plus a category index screen for jumping in.
   - Progress: **not** in `profiles.onboarding_state` (that is account
     onboarding, and re-using it could reset or confuse the gate). Store it
     per member per search, inside the priorities document under a
     namespaced, non-scoring key such as `explore: { lastStep, visited[],
     updatedAt }`. It is already preserved by `normalizePriorities`, it is
     ignored by both scorers (they iterate tiers only — add a parity test),
     and it is naturally separate for co-buyers and per search. "Pick up
     where you stopped" = `explore.lastStep`.
   - Exit: every screen has Done → `/search`. There is no completion gate,
     and `onboarding_complete` is never written.
3. **My Search:** add an "Explore My Priorities" card linking to
   `/search/explore` (and per-category "Edit" links to
   `/search/explore?step=cat_kitchen`). Existing quick-edit controls
   (`RankPrioritiesEditor`, Places, Basics) stay as they are.
4. **Refactor needed:** `PriorityFlow` currently receives its navigation from
   `Onboarding.jsx` (`moveOn`, skip, review). Extract a small adapter
   interface (`steps`, `onNext`, `onBack`, `onSkip`, `persist`) so onboarding
   and explore can both drive it. The onboarding adapter stays byte-for-byte
   in behaviour (its tests pin this).
5. **Tests to add:** path B never writes `dontcare` and lands on Add Home;
   explore never writes `profiles.*`; the co-buyer edits only their own row
   (real-Postgres); the `explore` key does not change JS/SQL Match parity; a
   flag-off build is unchanged.

## 9. Milestone 3 — category polish (document only, not implemented)

Applies to the existing flow-4 category screens (`PriorityFlow` →
`CategoryStep`, `FeatureCard`, `ImportanceSheet`). Separate pages stay:
Kitchen, Living, Bath, Garage, Exterior, Neighborhood (plus the rental and
apartment equivalents per search type).

- **Headlines:** short, friendly and per category (e.g. Kitchen: "Where do
  you love to cook?"). Keep the existing step eyebrow ("Step n of N ·
  Kitchen") as the progress text.
- **Photography:** the existing approved `public/images/onboarding/*.webp`
  via the current manifest. No new assets.
- **Progress:** a visible segmented bar in the shared footer, the same
  pattern as the tutorial's `flh-st-progress`.
- **Motion and haptics:** reuse `.flh-press` and `src/lib/haptics.js`. Use
  `selectionHaptic()` when an importance level is chosen in
  `ImportanceSheet`, and `confirmHaptic()` on Continue only if it saved a
  change. No haptic on Back, Skip or page change. A subtle 200–250 ms spring
  on the chosen card's badge only, with Reduce Motion handled by the global
  rule.
- **Immediate feedback:** the card shows its level in words the moment the
  sheet closes (it already does); add a brief badge "pop" (one shot).
- **Skip/Back:** these are already in the sticky footer. Keep them; enlarge
  the targets to 44 px where they are smaller.
- **Responsive cards:** a two-column grid down to 320 px, one column below
  300 px (the zoom rule that already exists).
- **Guardrails:** no new required questions and no educational slides. Skip
  must still write nothing, and "Not important" must still be the explicit
  `dontcare`. The existing onboarding visual safety net
  (`npm run visual:onboarding`) must pass at 320/375/390/430.
