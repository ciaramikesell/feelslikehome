# Draft PR #204 — mobile website carousel amendment

Branch remains `ux/homepage-final-four-columns`; this amends #204 without replacing its approved illustrations, hero, divider, copy, account CTA or navigation. No merge/readiness/deployment action is performed.

## Founder changes

“How it works” restores #203’s small uppercase terracotta eyebrow styling: 12px base size, 700 weight, sans font, .14em tracking, `--brick-deep` color. Its placement remains centered.

Below 640px, the **mobile website** presents one large 4:3 illustration with its original HTML heading/caption, a 24px glimpse of the next slide, four subtle pagination dots, and previous/next buttons. Touch uses browser-native horizontal scrolling and CSS scroll snap. The focused slide track accepts Left/Right, Home and End; native buttons support Enter/Space and expose labels/current state. A polite status announces slide changes. Reduced-motion requests use immediate scrolling. No autoplay or carousel dependency is introduced. The 640–1199px two-column and ≥1200px four-column layouts remain unchanged. Without JavaScript the mobile content remains a readable static stack.

## Native-runtime exclusion

Carousel activation requires **all three**: the mobile media query, `!isNativeApp()` from the existing platform helper, and absence of the existing bridge-driven `data-flh-native` attribute. The shared `ensureNativeShellFlag()` helper is reused, not reimplemented. A MutationObserver disables the carousel if the native flag arrives after hydration; CSS independently excludes flagged native shells. Navigation handlers also refuse native runtime/flagged execution. Carousel-only scroll initialization runs only when enabled.

Regression tests install the actual iOS bridge-shaped `webkit.messageHandlers.bridge` before page parsing and verify the existing head script marks the runtime native, native welcome is visible, and the mounted marketing component has no carousel state or navigation. The test then unhides the marketing entry **only in the test page** to confirm the underlying content still uses a static stack; hiding it behind native welcome cannot conceal a regression. A separate late-flag test verifies teardown after hydration. No native welcome, platform helper, iOS/signing configuration, onboarding, Match or collaboration functionality was modified.

## Verification

- Production build passed (Next 15.5.29, unchanged dependency lockfile).
- 47 focused public landing, native exclusion, native welcome and desktop-auth tests passed.
- Full unit suite: 1,417 passed, zero failures; 255 DB-dependent tests skipped in unit mode.
- Full PostgreSQL-enabled suite: 1,670 passed, zero failures; two optional sanitized live RentCast fixtures skipped.
- Production browser QA: 100 assertions passed at 320, 375, 390, 430, 768, 1024, 1280 and 1440px. Includes real CDP touch swipe, buttons/dots, keyboard navigation, reduced motion and ordinary smooth scrolling, resizing, heading styling, signup flow, overflow checks and explicit native exclusion. [Results](browser-results.json).
- Artwork SHA-256 and all four image files are unchanged from the existing draft. Existing hero/divider/footer/metadata/routing and application logic are untouched.

Captures use Chromium/touch emulation and deterministic fallback fonts; physical iPhone/VoiceOver review remains founder QA. Native screenshots emulate the existing bridge, not an installed TestFlight binary.

## Founder screenshots

- [320px website](screenshots/website-320.png)
- [375px website](screenshots/website-375.png)
- [390px website](screenshots/website-390.png)
- [430px website](screenshots/website-430.png)
- [768px website](screenshots/website-768.png)
- [1024px website](screenshots/website-1024.png)
- [1280px website](screenshots/website-1280.png)
- [1440px website](screenshots/website-1440.png)

[390px slide 1](screenshots/slide-1-390.png) · [390px slide 2](screenshots/slide-2-390.png) · [390px slide 3](screenshots/slide-3-390.png) · [390px slide 4](screenshots/slide-4-390.png)

[Native welcome with iOS bridge](screenshots/native-welcome-390.png).

## Founder checklist

- [ ] Confirm the smaller centered terracotta heading and retained hero/divider.
- [ ] On mobile Safari, swipe all four slides, check next-slide peek, dots and arrow controls.
- [ ] With keyboard/VoiceOver, check navigation labels, current slide and slide-change announcements.
- [ ] Enable Reduce Motion and confirm controls navigate without smooth animation.
- [ ] On installed iOS/TestFlight, confirm native welcome remains unchanged and no website carousel appears.
- [ ] Confirm tablet/desktop grid layout, illustrations/copy and signup behavior; leave draft until final approval.

Reproduce against a local production build and the test Supabase stand-in: `node scripts/qa/homepage-final-four-columns.mjs <baseUrl> <outputDir>`.
