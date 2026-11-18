# Founder QA Phase 1C

The public homepage retains the cottage hero and signup-first entry. It pairs four feature selectors with product previews on a warm peach background, followed by the sage collaboration section. The desktop preview follows hover or keyboard focus until a visitor selects a feature. A click, tap, Enter, or Space keeps that selection until another feature is activated.

## Before and after

The comparisons use CSS viewport widths. The before capture preserves the old walkthrough frame. Its third-party player was replaced by a blank frame during screenshot capture so both runs remained local.

| Width | Full homepage |
| --- | --- |
| 320 px | [Before and after](320.jpg) |
| 375 px | [Before and after](375.jpg) |
| 390 px | [Before and after](390.jpg) |
| 430 px | [Before and after](430.jpg) |
| 768 px | [Before and after](768.jpg) |
| 1440 px | [Before and after](1440.jpg) |

[Four desktop preview states](previews-desktop.jpg) · [Four touch preview states](previews-mobile.jpg)

## Asset inventory

| Surface | Source |
| --- | --- |
| Hero and brand | Existing approved `public/images/Warm Cottage.png` and shared `BrandMark`. |
| Set Your Preferences | HTML/CSS cards reflecting existing importance tiers. Local onboarding photos `home-office.webp`, `fenced-yard.webp`, and `soaking-tub.webp`. |
| Bring Homes From Anywhere | Original HTML/CSS fictional listing cards using `front-porch.webp`, `mature-trees.webp`, and `garden-space.webp` from local onboarding assets. Portal names are plain text labels. |
| Compare What Matters | Existing approved `public/images/FLH Example.png` in its original aspect ratio with illustrative Match scores. |
| Search Together | Original HTML/CSS product composition with the local `front-porch.webp` photo, separate buyer rows, and a labeled Realtor suggestion. |
| Collaboration examples | Original copy and HTML/CSS. The street address and commute examples are illustrative. Whitney's note and the specified commute times are founder copy. |

Only the displayed panel loads its artwork. The initial preferences example is rendered into the page before hydration. The visuals use local assets, existing fonts, and the existing icon package.

## Founder review

- [ ] Check the desktop hero line break after “lot,” highlighted copy, and account button. Check the natural headline wrap and cottage crop on a 320 px phone.
- [ ] Try all four previews with a mouse, keyboard, and touch. Select one and move across the others to confirm the selection holds.
- [ ] Review the approved Match image and the distinction between a shared shortlist, individual priorities, and Whitney's suggestion.
- [ ] Check the navigation menu, logo, How it works, footer, and For Realtors links. Confirm mobile uses the dedicated account pages and desktop opens the existing forms.

## Verification

- Production build passed. The full suite on local PostgreSQL reported **1,663 passed, 0 failed, 2 skipped**. Both skips require sanitized live RentCast fixtures. All 44 focused homepage, authentication-entry, Realtor-entry, and native welcome checks passed after the final CSS adjustment.
- Chromium checked all four preview states at every requested width. Desktop hover and focus changed the preview before selection. Space selected a feature, mouse movement left that selection in place, and touch taps changed it. Figure height stayed constant across all selections at each tested width.
- The default preferences example was visible with hydration bundles blocked. The first preview and selectors fit at 320 px with the root text size doubled. Focus outlines were visible and the screenshots used reduced motion.
- The mobile account links led to the existing signup and sign-in destinations. Desktop opened the existing signup and sign-in dialogs and restored focus after Escape. The How it works anchor, Realtor destination, and home logo were checked. The browser flows made no write requests and loaded no YouTube player on the redesigned page.
