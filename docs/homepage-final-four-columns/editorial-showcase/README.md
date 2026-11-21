# PR #204 — editorial sliding feature showcase

The [latest founder design decision](https://github.com/ciaramikesell/feelslikehome/pull/204#issuecomment-7041478606) was read in full from the public GitHub HTML page after API comment access returned Forbidden. It supersedes the earlier four-column layout and mobile-only carousel. This remains an amendment to `ux/homepage-final-four-columns` / draft #204.

## Final design

One feature is presented at a time at every website width. Desktop/tablet: short serif title and existing description on the left, large floating visual composition on the right. Mobile website: composition above the title/caption. The centered small terracotta HOW IT WORKS eyebrow, tall cottage hero, thin divider, brand/navigation, signup-first CTA, footer and shared illustrative note remain intact.

Navigation includes `01/04` progress, subtle previous/next buttons and dots, browser-native horizontal swipe/scroll snap, Left/Right/Home/End keyboard support, visible focus and polite slide announcements. Targets remain at least 44×44px at 320px. Reduced motion uses immediate navigation; ordinary navigation scrolls smoothly. No autoplay. Responsive resizing keeps the chosen feature. Inactive slide content is hidden from assistive technology while the active feature has a numbered label. Without JavaScript, all four features form a readable static list with no dead showcase controls.

## Accurate artwork, without baked-in backgrounds

The shipped visuals use the founder-approved source photos with **careful DOM/CSS composition**, an option explicitly permitted in the comment. Photo interiors are clipped from unchanged original artwork; the rest is crisp HTML cards, labels, source tiles, Match badges and hearts. The canvas between these elements is genuinely transparent, not a flattened cream rectangle or blend-mode effect. There is no fake browser chrome, extra outer frame or decorative backdrop.

1. **Set Your Preferences** — the original office, yard and tub photos; Must Have / Important / Nice to Have tiers.
2. **Import Homes from Anywhere** — Zillow / Realtor.com / Any Listing Website source tiles, an arrow, and three approved house photos in a saved-home collection. No official integration is implied.
3. **Compare What Matters** — three original approved houses and the exact fictional 92 / 87 / 76% Match values.
4. **Search & Decide Together** — one approved home photo and distinct Ciara/Andrew cards. Ciara: Location, Home Office and Garage hearts filled; 92% Match. Andrew: Garage and Home Office filled, Finished Basement outlined; 76% Match. Scores stay separate.

Existing feature titles/descriptions are unchanged. The original four image files are untouched and remain available to the native fallback. [Asset hashes](asset-provenance.json) and [artwork module](../../../src/components/PublicFeatureArtwork.jsx). Image-generation edits were explored as visual references only; **none of those generated bitmaps are shipped**. No new image editing or carousel dependency is introduced.

## Native protection

The existing `isNativeApp()`, `ensureNativeShellFlag()` and bridge-driven `data-flh-native` attribute remain authoritative. The new interaction refuses native runtime at any width, CSS hides the website showcase in a flagged native shell, and a late native flag removes controls/interaction. Native keeps its original static feature assets/layout beneath its unchanged native welcome. Width is never used as native detection.

Tests install an iOS-shaped bridge at both phone and desktop widths, then deliberately expose the normally hidden marketing entry: the native fallback remains static with original images and no showcase controls. Full Capacitor-native-bridge regression QA additionally verifies first-paint welcome, signed-in/out routes, invitation/shared-listing deep links, Share Extension intake, tutorial keyboard/accessibility/haptics, reduced motion and Account help. No native app code, welcome copy, signing or configuration changed.

The legacy native QA harness was updated for the already-approved current tutorial labels/result and for cookies matching the actual test app/Supabase hostname. Its earlier localhost-only assumption and obsolete tutorial labels were QA issues; application authentication/tutorial code was not changed.

## Verification

- Production build passed using unchanged Next 15.5.29 dependency lockfile.
- Focused landing, artwork/native exclusion, native welcome and desktop auth: **48 passed**.
- Full unit suite: **1,418 passed**, zero failed; 255 DB-dependent checks skipped in unit mode.
- Full PostgreSQL-enabled suite: **1,671 passed**, zero failed; **two optional sanitized live RentCast fixture checks skipped**. Throwaway local databases only.
- Showcase production browser QA: **326/326 assertions passed**. [Results](browser-results.json), at 320, 375, 390, 430, 768, 1024, 1280 and 1440px. Checks every feature’s layout, exact title/caption, stable frame height, numbered progress, accessibility, touch swipe, keyboard, reduced motion, ordinary motion, resizing, no-JS fallback, signup/Realtor navigation and native exclusion.
- Existing full native welcome/share/tutorial regression runner: **61/61 checks passed**. [Native results](native-regression-results.json).
- Protected source diff is empty for PublicLanding/hero, root metadata/routing, native welcome/platform, Match, permissions, schema/RLS, iOS/signing and approved image assets. No merge, readiness change, deployment command or Production operation.

Captures use Chromium/touch emulation with external fonts blocked for deterministic fallback-font comparison. The native runner injects Capacitor’s actual native bridge JS/plugin headers with a mock native side. Physical iPhone/VoiceOver remains founder QA.

## Founder screenshots

| View | Before (head b93cd87) | New showcase |
| --- | --- | --- |
| Desktop 1440px | [Before](../mobile-web-amendment/screenshots/website-1440.png) | [After](screenshots/website-1440.png) |
| Mobile 390px | [Before](../mobile-web-amendment/screenshots/website-390.png) | [After](screenshots/website-390.png) |

- Feature 1: [desktop](screenshots/slide-1-1440.png) · [mobile](screenshots/slide-1-390.png)
- Feature 2: [desktop](screenshots/slide-2-1440.png) · [mobile](screenshots/slide-2-390.png)
- Feature 3: [desktop](screenshots/slide-3-1440.png) · [mobile](screenshots/slide-3-390.png)
- Feature 4: [desktop](screenshots/slide-4-1440.png) · [mobile](screenshots/slide-4-390.png)

- [320px full website](screenshots/website-320.png)
- [375px full website](screenshots/website-375.png)
- [390px full website](screenshots/website-390.png)
- [430px full website](screenshots/website-430.png)
- [768px full website](screenshots/website-768.png)
- [1024px full website](screenshots/website-1024.png)
- [1280px full website](screenshots/website-1280.png)
- [1440px full website](screenshots/website-1440.png)

[Native welcome](screenshots/native-welcome-390.png).

## Founder checklist

- [ ] Review all four large compositions at desktop and mobile, especially the separate Match values and filled/outlined hearts.
- [ ] Check title/copy placement, numbered progress, arrows/dots and single shared illustrative note.
- [ ] Try touch swiping, keyboard focus/Left/Right/Home/End, reduced motion and orientation changes.
- [ ] Confirm the original hero, signup-first CTA, navigation and For Realtors flow.
- [ ] On installed iOS/TestFlight, confirm native welcome, tutorial and saved-home flows remain unchanged.
- [ ] Keep draft/unmerged until approved.

Reproduce: build/start against the local Supabase stand-in, then `node scripts/qa/homepage-final-four-columns.mjs <baseUrl> <outDir>`. Full native QA: `NEXT_PUBLIC_SUPABASE_URL=<same-url-as-build> PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/qa/native-welcome-qa.mjs <standin.json> <outDir> <baseUrl>` with the usual local PostgreSQL environment.
