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
| Set Your Preferences | Founder-supplied `warm_home_preferences_dashboard.png` → `priorities.webp`. |
| Bring Homes From Anywhere | Founder-supplied `all_your_favorite_listings_together.png` → `listings.webp`. |
| Compare What Matters | Founder-supplied `feels_like_home_match_gallery.png` → `compare.webp`. |
| Search Together | Founder-supplied `feels_like_home_shared_search.png` → `collaborate.webp`. |
| Collaboration examples | Original copy and HTML/CSS. The street address and commute examples are illustrative. Whitney's note and the specified commute times are founder copy. |

The full compositions are preserved at 1448 × 1086. Lossy WebP conversion reduced the four supplied PNGs from about 7.6 MiB to 650 KiB combined. The shared 4:3 frame reserves space before the active image loads. The after captures and all preview-state screenshots show the refined artwork.

The illustrations depict existing FLH priority tiers, adding listing links, personal Match views, and shared searches with Realtor suggestions. Their navigation is conceptual. For example, `Blog` and a dedicated `Search Together` tab are absent from the buyer shell. The visible caption explains that navigation and details may differ and that the listing-site logos indicate neither affiliation nor direct integration. Addresses, prices, commute times, and Match percentages are illustrative.

## Founder review

- [ ] Check the desktop hero line break after “lot,” highlighted copy, and account button. Check the natural headline wrap and cottage crop on a 320 px phone.
- [ ] Try all four previews with a mouse, keyboard, and touch. Select one and move across the others to confirm the selection holds.
- [ ] Review the approved Match image and the distinction between a shared shortlist, individual priorities, and Whitney's suggestion.
- [ ] Check the navigation menu, logo, How it works, footer, and For Realtors links. Confirm mobile uses the dedicated account pages and desktop opens the existing forms.

## Refined artwork verification

- Production build passed. The standard suite reported **1,412 passed, 0 failed, 253 skipped**. The optional PostgreSQL and live fixture tests were skipped for this artwork-only revision.
- Chromium decoded all four responsive images at 320, 375, 390, 430, 768, and 1440 px. The initial page requested only the default image. Both the frame and figure height stayed constant through all four selections at each width.
- Touch selection worked at phone widths. Desktop and tablet verified hover and keyboard focus before selection, activation with Space, and selection persistence while hovering another feature. Images retain their full framing and use panel-specific alt text.

## Original Phase 1C verification

- Production build passed. The full suite on local PostgreSQL reported **1,663 passed, 0 failed, 2 skipped**. Both skips require sanitized live RentCast fixtures. All 44 focused homepage, authentication-entry, Realtor-entry, and native welcome checks passed after the final CSS adjustment.
- Chromium checked all four preview states at every requested width. Desktop hover and focus changed the preview before selection. Space selected a feature, mouse movement left that selection in place, and touch taps changed it. Figure height stayed constant across all selections at each tested width.
- The default preferences example was visible with hydration bundles blocked. The first preview and selectors fit at 320 px with the root text size doubled. Focus outlines were visible and the screenshots used reduced motion.
- The mobile account links led to the existing signup and sign-in destinations. Desktop opened the existing signup and sign-in dialogs and restored focus after Escape. The How it works anchor, Realtor destination, and home logo were checked. The browser flows made no write requests and loaded no YouTube player on the redesigned page.
