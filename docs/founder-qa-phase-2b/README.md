# Founder QA Phase 2B — Onboarding headings and feature cards

Based on `34903942e9b1c91cf2165daa8d9bfe3f060ec2e1`, the merge of PR #200. The changes apply to the V3 mobile Home to Buy personalized walkthrough. Shared-search screens keep their existing owner-context eyebrow. The feature catalog and preference storage remain shared with the existing desktop board and Explore.

## Before and after screenshots

Before is on the left. After is on the right. The 390px column covers all ten steps. The remaining mobile columns cover the full category sequence. Sticky navigation appears at its viewport position in the full-page captures.

| Step | 320px | 375px | 390px | 430px |
| --- | --- | --- | --- | --- |
| 1 · Search type | | | [View](390-search_type.jpg) | |
| 2 · Getting started | | | [View](390-setup_path.jpg) | |
| 3 · Basics | | | [View](390-basics.jpg) | |
| 4 · Home Layout | [View](320-cat_layout.jpg) | [View](375-cat_layout.jpg) | [View](390-cat_layout.jpg) | [View](430-cat_layout.jpg) |
| 5 · Kitchen | [View](320-cat_kitchen.jpg) | [View](375-cat_kitchen.jpg) | [View](390-cat_kitchen.jpg) | [View](430-cat_kitchen.jpg) |
| 6 · Living Room | [View](320-cat_living.jpg) | [View](375-cat_living.jpg) | [View](390-cat_living.jpg) | [View](430-cat_living.jpg) |
| 7 · Bathroom | [View](320-cat_bath.jpg) | [View](375-cat_bath.jpg) | [View](390-cat_bath.jpg) | [View](430-cat_bath.jpg) |
| 8 · Garage | [View](320-cat_garage.jpg) | [View](375-cat_garage.jpg) | [View](390-cat_garage.jpg) | [View](430-cat_garage.jpg) |
| 9 · Exterior & Property | [View](320-cat_exterior.jpg) | [View](375-cat_exterior.jpg) | [View](390-cat_exterior.jpg) | [View](430-cat_exterior.jpg) |
| 10 · Location & Neighborhood | [View](320-cat_neighborhood.jpg) | [View](375-cat_neighborhood.jpg) | [View](390-cat_neighborhood.jpg) | [View](430-cat_neighborhood.jpg) |

[Unobstructed exterior grid](exterior-grid.jpg) · [Importance sheet](importance-sheet.jpg) · [1440px desktop board comparison](1440-cat_living.jpg)

## Reused card photos

The existing card renderer continues to use the responsive 400px and 800px WebP variants under `public/images/onboarding/cards`. The image framing and card styles are shared across the walkthrough.

| Card | Existing priority identity | Asset filename stem |
| --- | --- | --- |
| Built-in Shelving | `features:Built-in Shelving` (existing custom suggestion) | `built-in-shelving` |
| Large Windows | `features:Large Windows` (existing custom suggestion) | `large-windows` |
| Pool | `exterior:Pool` | `pool` |
| Front Porch | `exterior:Front porch` | `front-porch` |
| Mature Trees | `location:Mature Trees` | `mature-trees` |
| Cul-de-Sac | `location:Cul-de-Sac` | `cul-de-sac` |

No HOA remains available as a suggestion with its existing identity. Saved picks use the same levels and remain editable from Review.

## Verification

- Chromium checked headline, eyebrow, subtitle, text color, image decoding and card order across the mobile screenshot matrix. The document fit each tested width, and focusing numeric or custom text fields kept the viewport at scale 1. The before and after desktop board screenshots had zero differing pixels.
- The buyer browser walkthrough opened the importance sheet for all six promoted cards, selected tiers including Not important, confirmed Back retained choices, selected No HOA through suggestions, checked garage auto-advance, and edited a section from the unnumbered Review. As I Go bypassed the photo categories, and Home to Rent and Apartment to Rent kept their eight- and six-step counts.
- The focused test run passed 105 tests. The separate onboarding and co-buyer database run passed 25 tests on an isolated PostgreSQL 18.6 socket. It covered saved spelling variants, round-trip writes, Match parity, tenant isolation and resuming saved progress.
- The full suite with the isolated PostgreSQL cluster passed 1,666 tests with zero failures. Two live RentCast fixture tests were skipped because sanitized captures were unavailable.
- The production build passed.

## Founder checklist

- [ ] From signup, choose Home to Buy and **Let’s personalize your search**. Follow all ten numbered steps. Confirm Review has no extra step number. Only “feels like home?” uses terracotta in the headlines.
- [ ] Check the four Living Room cards, six Exterior cards below Ideal Lot Size, and four Location & Neighborhood cards. Open each promoted card, choose a tier, and confirm the label updates right away.
- [ ] Select **No HOA** from suggestions. Choose **Not important** for one promoted item and confirm it leaves the ranked priorities. Confirm an existing saved preference stays selected and can be edited.
- [ ] Use Back, Skip, and Continue. Exit and reopen mid-flow to check resume. Edit one answer from Review, then return to Review.
- [ ] Repeat with **As I Go**, **Home to Rent**, **Apartment to Rent**, and a co-buyer invitation in the QA environment. Find cities, school districts, and Places That Matter in My Search.
- [ ] On a physical iPhone, focus budget, Ideal Lot Size, and Add your own, then dismiss the keyboard. Confirm there is no unexpected zoom or sideways clipping. Check that the final exterior photo row is fully visible when scrolled above the sticky footer. Chromium emulation did not exercise the iOS keyboard or TestFlight WebView.
