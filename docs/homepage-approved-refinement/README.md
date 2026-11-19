# Approved homepage refinement — founder review

Started from main `52e3125`, merged PR #202. Branch: `ux/homepage-approved-refinement`. The attached [CODEX_BRIEF.md](CODEX_BRIEF.md) was read in full and used as the implementation specification under the founder’s request. Artwork was supplied, not regenerated.

## Changes

- Hero opening is now “You’ve saved a lot of options.” in one span. Desktop typography scales to the actual text column using container units; phones wrap naturally. Follow-up remains “Now find the one that Feels Like Home.” with branded italic emphasis. Removed the shaded hero description; retained the cottage, branding, navigation and signup-first CTA.
- Desktop “How It Works” has artwork left, explanation/selectors right. Mobile order is explanation, controls, preview/caption. DOM focus order follows the controls before their preview.
- Removed “Search anywhere. Decide here.” The sole explanatory paragraph is now “Import the homes you’ve already saved. See how they match what matters to you. Then tour, compare, and choose together.”
- Label-only selectors: “Set Your Preferences”, “Import Homes from Anywhere”, “Compare What Matters”, “Search & Decide Together”. Existing hover/focus preview, click/tap/Enter/Space activation, pinned selection, focus styles and aria-pressed/aria-controls behavior remain intact.
- Captions below the active image use all four exact brief strings: “Tell Feels Like Home what matters to you — and how important each priority is to your decision.”; “Keep the listings you’ve found in one place, no matter where you discovered them.”; “See how each home fits your priorities, with your personal Match clearly broken down.”; “Compare your own priorities alongside your co-buyer’s, with suggestions from your Realtor.” Hidden caption alternatives reserve the largest caption height, preventing panel jumps.
- Replaced the repeated disclaimer with one proposed section-level note: **“Illustrative mockups. Listing-source names do not imply affiliation or direct integration.”** Founder review requested for this wording; it acknowledges the supplied logos without changing approved artwork or claiming partnerships.

## Assets

The four supplied PNGs were encoded directly to quality-90 WebP at their original 718×540 / 718×535 dimensions. No resize, sharpen, crop, compositing or regenerated pixels. Combined web asset size is 229,752 bytes (about 224KiB). [Source/output hashes](assets.json) identify each asset. The reserved 4:3 preview uses `object-fit: contain` and lazy image loading with responsive sizes and descriptive alt text. Small source-ratio differences produce minimal letterboxing, never cropping.

## Verification

- Clean lockfile installation; production build passed with Next 15.5.29.
- Full unit mode: 1,414 passed, 255 database-dependent checks skipped.
- Full PostgreSQL-enabled suite: 1,667 passed, zero failures; **two optional sanitized live RentCast fixture checks skipped**. Local throwaway databases only.
- Focused public/Realtor landing tests passed.
- Production Chromium browser QA: **203/203 assertions passed** at 320, 375, 390, 430, 768, 1024, 1280, 1440px: see [assertion results](browser-results.json). Includes actual touch taps, mouse hover, keyboard focus/Enter/Space, persistent selection, accessible pressed state, exact labels/captions, stable panel heights, contain framing, no page overflow, one-line desktop opening, CTA focus restoration, signup-first flow and Realtor navigation.
- Signed-in onboarding, Match, co-buyer permissions, native welcome, For Realtors, schema/RLS and shelved #198 were not modified. Application edits are limited to PublicLanding, PublicFeaturePreviews and homepage-scoped CSS. No merge/deployment.

## Screenshots

- [320px full homepage](screenshots/homepage-320.png)
- [375px full homepage](screenshots/homepage-375.png)
- [390px full homepage](screenshots/homepage-390.png)
- [430px full homepage](screenshots/homepage-430.png)
- [768px full homepage](screenshots/homepage-768.png)
- [1024px full homepage](screenshots/homepage-1024.png)
- [1280px full homepage](screenshots/homepage-1280.png)
- [1440px full homepage](screenshots/homepage-1440.png)

- Feature 1: [390px](screenshots/feature-1-390.png) · [1280px](screenshots/feature-1-1280.png)
- Feature 2: [390px](screenshots/feature-2-390.png) · [1280px](screenshots/feature-2-1280.png)
- Feature 3: [390px](screenshots/feature-3-390.png) · [1280px](screenshots/feature-3-1280.png)
- Feature 4: [390px](screenshots/feature-4-390.png) · [1280px](screenshots/feature-4-1280.png)

## Founder checklist

- [ ] Review desktop headline hierarchy and phone wrapping.
- [ ] Review all four supplied illustrations and feature-specific captions.
- [ ] Approve or revise the single section-level illustration note.
- [ ] Try mobile touch selection and desktop keyboard/mouse selection; confirm pinned selections persist.
- [ ] Review CTA/account creation and For Realtors navigation. Physical iPhone/VoiceOver remains founder QA; captures use Chromium emulation.

Reproduce: serve a production build against the existing local Supabase stand-in, then `node scripts/qa/homepage-approved-refinement.mjs http://127.0.0.1:3140 docs/homepage-approved-refinement` (uses installed Chromium, or PLAYWRIGHT_CHROMIUM_EXECUTABLE).
