# PR #204 — approved prototype implementation

Implements the [founder’s approval and finishing requirements](https://github.com/ciaramikesell/feelslikehome/pull/204#issuecomment-7060535763), read in full, from base `3bc8460cb9bc57eb41080bc6a0505df1ed282fcb`. The visual source is the approved static prototype at `/workspace/prototypes/flh-homepage-layout/`, including its 1440px desktop and 390px mobile captures. Existing branch: `ux/homepage-final-four-columns`; no rebase was needed.

## What changed

The borderless 40/60 desktop composition, warm paper background, enlarged layered photo cards and typography follow the approved prototype. All four feature concepts use the original artwork and exact approved copy. Mobile places the artwork above its title/caption. Navigation now belongs to the stationary copy column, immediately below the description, rather than sitting below a large combined stage. Swiping moves the artwork; the current title/caption, progress and announcement update together while controls keep their DOM/focus identity.

The three finishing adjustments:

1. **Desktop rhythm:** section padding is 36px above/below versus 46px/48px in the prototype; the eyebrow-to-cluster gap is 20px versus 30px. The cluster moves upward without adding another frame or ornamental elements.
2. **Mobile controls:** visible Previous/Next buttons and `01/04` share one compact navigation row, with a 12px counter gap. Four subtle progress indicators remain directly beneath, retaining 44px targets; main buttons are 46px high. They do not stretch apart across the entire phone width.
3. **Disclaimer:** one shared note remains, now 10px, subtly muted and 12px/10px from the content on desktop/mobile instead of 28px/24px. Its foreground still meets normal-text contrast on the paper background.

All four slides reuse the existing approved source-photo windows and HTML artwork module. There is no new or regenerated image, photo modification, dependency, fake browser frame or outer cream card. Layered importance/Match cards preserve readable labels. Narrow listing-source tiles wrap safely at 320px. Ciara’s Location/Home Office/Garage hearts remain filled; Andrew’s Garage/Home Office remain filled and Finished Basement outlined; illustrative 92%/76% Match results remain separate.

## Preserved behavior and scope

Existing touch swipe/scroll snap, Previous/Next and progress buttons, visible keyboard focus, Left/Right/Home/End navigation, polite announcements, reduced-motion handling and responsive resize anchoring are reused. There is no autoplay. Controls remain outside the moving artwork so navigating does not remove the focused button.

Native exclusion still uses the canonical `isNativeApp()`, `ensureNativeShellFlag()` and `data-flh-native` bridge flag at every width, including a late flag. The installed app retains its welcome and non-carousel fallback/original assets. Native welcome/platform/configuration/signing, onboarding, Match, co-buyer/Realtor permissions, data/schema/RLS and other app features are untouched.

The hero, branding, navigation, CTA, signup-first routing, divider and footer are unchanged. [Preservation evidence](preservation.json) records a matching hash for the protected homepage CSS rules; the corresponding component and source-image diff is empty.

## Verification

- Production build passed with unchanged Next 15.5.29 dependencies/lockfile.
- Focused landing/native/auth checks: **48 passed**.
- Full unit-only run: **1,418 passed**, zero failures; 255 DB-dependent checks skipped in that mode.
- Full PostgreSQL-enabled suite: **1,671 passed**, zero failures; **two optional sanitized live RentCast fixture checks skipped**. Local test databases only.
- Production browser QA: **446 assertions passed**, zero failures; 2 Next SSR-wrapper observations recorded separately. The updated runner checks all four slides at **320, 375, 390, 430, 768, 1024, 1280 and 1440px**. It verifies exact visible copy, artwork placement, source/tier/Match/participant label bounds and overlap, stationary focus, controls immediately below copy, grouped mobile counter, 44px targets, keyboard focus and navigation, real touch swiping, reduced/ordinary motion, resizing, muted note, no outer frame/overflow and signup/Realtor routing. [Browser results](browser-results.json).
- Full Capacitor native-bridge welcome/share/tutorial regression: **61/61 passed**. [Native results](native-regression-results.json). Additional showcase tests inject an iOS bridge at phone and desktop widths, expose the normally hidden marketing entry and verify that it remains static; a late flag removes website interaction.

### No-JavaScript scope

The feature’s static four-item fallback is present and tested with JavaScript disabled. Next’s existing async root can deliver it inside a hidden streamed `S:n` wrapper that Next normally reveals with an inline script. The isolated fallback test completes that framework wrapper before checking the component. **This does not claim full-page no-JS support**; the dynamic root still depends on JavaScript to reveal its stream. Root routing/loading were deliberately not changed. The two framework observations are recorded separately from assertions in the results.

## Fonts and capture method

Review captures load the genuine Source Serif 4 and Plus Jakarta Sans files from the approved prototype, through test-only Playwright routes. Their loaded status is asserted; no fallback fonts are used for the website screenshots. Production font declarations are unchanged. Set `FLH_PROTOTYPE_FONTS` to the approved font folder when reproducing elsewhere.

Section captures show all four states in the interactive production build. Full-page captures show the first slide with the unchanged hero/footer. The capture helper freezes only horizontal snap during whole-document painting to avoid a Chromium off-screen re-snap artifact, then restores the original CSS and offset. All interaction assertions run against the real mandatory snap behavior.

Native regression uses Capacitor’s actual native bridge JS/plugin headers with a mock native side. Chromium emulation is not a physical TestFlight/VoiceOver run; those remain founder review items.

## Final screenshots

Full homepage: [1440px desktop](screenshots/website-1440.png) · [390px mobile](screenshots/website-390.png).

| Feature state | 1440px desktop section | 390px mobile section |
| --- | --- | --- |
| Set Your Preferences | [Desktop](screenshots/slide-1-1440.png) | [Mobile](screenshots/slide-1-390.png) |
| Import Homes from Anywhere | [Desktop](screenshots/slide-2-1440.png) | [Mobile](screenshots/slide-2-390.png) |
| Compare What Matters | [Desktop](screenshots/slide-3-1440.png) | [Mobile](screenshots/slide-3-390.png) |
| Search & Decide Together | [Desktop](screenshots/slide-4-1440.png) | [Mobile](screenshots/slide-4-390.png) |

Other responsive overviews: [320px](screenshots/website-320.png) · [375px](screenshots/website-375.png) · [430px](screenshots/website-430.png) · [768px](screenshots/website-768.png) · [1024px](screenshots/website-1024.png) · [1280px](screenshots/website-1280.png). [Native welcome](screenshots/native-welcome-390.png).

## Founder checklist

- [ ] Compare the first slide with the approved prototype: same composition, larger cards, tighter rhythm and no extra frame.
- [ ] Review the other three states, especially source labels, fictional Match badges and correct separate Ciara/Andrew heart states.
- [ ] Check mobile button/counter grouping and the smaller shared note.
- [ ] Try swipe, buttons, progress controls, keyboard focus/arrows/Home/End and Reduce Motion.
- [ ] Confirm hero/CTA/footer and signup/Realtor routes remain unchanged.
- [ ] On installed iOS/TestFlight, confirm welcome, tutorial, deep links and saved-home flows remain unchanged; check VoiceOver and physical-phone legibility.
- [ ] Keep draft and unmerged until final founder approval. No merge/deployment command was run.

Reproduce: `node scripts/qa/homepage-final-four-columns.mjs <productionBaseUrl> <outputDir>` against the local stand-in, with the approved prototype font directory available. The native runner additionally uses the usual PostgreSQL variables and `NEXT_PUBLIC_SUPABASE_URL` matching the build. See [proposed PR description](PR_DESCRIPTION.md).
