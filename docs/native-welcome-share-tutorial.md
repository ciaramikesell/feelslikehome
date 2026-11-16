# Native iOS welcome + interactive share tutorial (Milestone 1)

Inside the installed iOS app, a signed-out person now sees one short, warm
welcome instead of the long public marketing homepage, and can optionally
practise sharing a listing into Feels Like Home. Desktop and mobile Safari are
unchanged (verified pixel-for-pixel, §6). Milestones 2 and 3 are documented
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
renders (verified frame by frame, §6).

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
| `src/lib/platform.js` | `NATIVE_SHELL_FLAG_SCRIPT`, `NATIVE_SHELL_ATTRIBUTE`, `isNativePluginAvailable()` |
| `src/app/layout.js` | Inline flag script in `<head>`; `suppressHydrationWarning` on `<html>` |
| `src/app/page.js` | Signed-out: welcome + homepage wrapper (no new redirect) |
| `src/components/NativeWelcome.jsx` | New |
| `src/components/ShareTutorial.jsx` | New |
| `src/lib/haptics.js` | New |
| `src/components/AccountSettings.jsx` | Native-only Help card → tutorial |
| `src/app/globals.css` | One scoped section (`flh-welcome`, `flh-st-*`, `flh-press`, flags) |
| `package.json`, lock, `ios/App/CapApp-SPM/Package.swift` | `@capacitor/haptics` |
| `test/native-welcome-share-tutorial.test.js` | 19 tests |
| `test/public-landing.test.js` | Root-page assertion updated for the wrapper |
| `scripts/qa/native-welcome-qa.mjs`, `scripts/qa/homepage-unchanged-qa.mjs` | Browser QA |

`FLH_ONBOARDING_V3` stays off by default. No SQL, Match, scoring, catalog,
paywall or Floor Plans change. PR #166 is untouched.

## 6. Verification

- **Unit/contract:** `npm test`: 1,363 pass, 0 fail, 246 database tests
  skipped without Postgres. With the real-Postgres harness
  (`FLH_TEST_PGHOST`): 1,607 pass, 0 fail, 2 skipped.
- **Production build:** `next build` passes.
- **Browser QA** (`scripts/qa/native-welcome-qa.mjs`, production build +
  `scripts/qa/supabase-standin.mjs`): **56/56 checks pass**
  (`results.json`). "Native" pages are emulated with what Capacitor's iOS
  shell injects at document start: a `bridge` message handler, the
  `window.Capacitor` global, Capacitor's real `native-bridge.js` from
  `node_modules/@capacitor/ios`, and App + Haptics plugin headers. A fake
  native side records plugin calls and delivers `appUrlOpen` the way
  `AppPlugin.swift` does. Covered:
  - signed-out cold launch: welcome painted **before hydration** (all JS
    chunks held back), and the public homepage visible on **0 of ~80 sampled
    frames**;
  - welcome at 320/375/390/430 (actions above the fold, ≥ 44 px, exact hero);
  - Get Started → `/auth/sign-up` and Sign in → `/auth/sign-in` (native auth
    shell), plus a real sign-in to My Homes;
  - returning signed-in launch → `/homes`, welcome and homepage on 0 frames;
  - deep links: a signed-out invitation keeps
    `?redirect=/invite/<token>`; a signed-out shared listing keeps the full
    `/homes?url=…` destination; a cold-start Universal Link over the welcome
    reaches the invitation; a signed-in Share Extension link opens Add Home
    with "41 Maple St, Troy, MI 48084" parsed from the shared Zillow URL;
  - tutorial: open, focus, Share, wrong tile, More, Back, FLH, success,
    Practice again, Skip, focus return, Escape; keyboard-only completion with
    the focus trap; accessibility tree (`tutorial-saved-aria.txt`); Reduce
    Motion; 320/430 layouts with no horizontal overflow;
  - haptic sequence `impact:LIGHT, selectionChanged, selectionChanged,
    impact:LIGHT, impact:LIGHT, notification:SUCCESS`, and no others;
  - Account → Help in the app (no sign-out); absent in mobile Safari;
  - no unexpected console errors.
- **Public homepage unchanged** (`scripts/qa/homepage-unchanged-qa.mjs`):
  `main` (at the #187 merge) and this branch, both built for production and
  served side by side. Full-page signed-out screenshots and the list of image
  requests were compared at desktop 1440 and 1024, iPhone 13 and iPhone SE
  (mobile Safari emulation) and 320 px. In the final runs, all five were
  **byte-identical, with the same image requests**
  (`homepage-unchanged/homepage-unchanged.json`). One earlier run showed a
  whole-page iPhone SE difference that did not reproduce in three reruns, nor
  `main` against itself. It is recorded here as a capture-timing flake.

### Not verified here (needs a Mac / device) — founder checklist

This Linux environment has no Xcode, Simulator or iPhone, and no computer
was attached to the session. Please check:

1. `git pull && npm install && npx cap sync ios`. Xcode resolves the new
   `CapacitorHaptics` package. Build `App` + `ShareExtension` for a current
   Simulator and a device.
2. Signed out, force-quit, then launch: the welcome appears straight from
   the launch screen, with no flash of the homepage. If the WebView shows the
   paper colour briefly before the welcome, that is the existing boot
   behaviour, not the homepage.
3. Get Started and Sign in work; after signing in, a relaunch goes straight
   to My Homes.
4. Tutorial on a device: haptics on Share, Feels Like Home and Saved; none
   elsewhere. Turn on Settings → Accessibility → Motion → Reduce Motion: no
   slide or pop, and it still completes. VoiceOver: each step's instruction
   is read, and the tiles are buttons.
5. With the app terminated, open an invitation link and share a Zillow
   listing via the Share Extension. Each reaches its destination, not the
   welcome.
6. An **older installed build** (without the Haptics plugin) still works
   against this deployment, without haptics.

**Vercel:** see the PR. Nothing is deployed or merged by this PR.

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
