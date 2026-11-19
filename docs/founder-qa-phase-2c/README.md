# Founder QA Phase 2C — Guided Desktop Onboarding

Base is `6f9a97881125ba0e8610cdcc4759c9db2fcc063d`, the merge of PR #201. V3 uses the same category step and the same photo cards at every width. The live panel appears at 1024 CSS px. It reads the participant’s ranked preferences and opens the existing importance picker. Back, Skip, Continue, and Review use the existing progress document. A Review edit records its return destination in that document so it survives refresh.

## Desktop screenshots

| Home to Buy at 1440px | Screenshot |
| --- | --- |
| Home Layout, empty priorities | [Open](1440-home_buy-cat_layout-empty.jpg) |
| Home Layout, populated | [Open](1440-home_buy-cat_layout-populated.jpg) |
| Kitchen | [Open](1440-home_buy-cat_kitchen-populated.jpg) |
| Living Room | [Open](1440-home_buy-cat_living-populated.jpg) |
| Bathroom | [Open](1440-home_buy-cat_bath-populated.jpg) |
| Garage, with type choices | [Open](1440-home_buy-cat_garage-populated.jpg) |
| Exterior & Property | [Open](1440-home_buy-cat_exterior-populated.jpg) |
| Location & Neighborhood | [Open](1440-home_buy-cat_neighborhood-populated.jpg) |
| Editing a tier from the sidebar | [Picker](sidebar-picker.jpg) · [Updated group](sidebar-after-edit.jpg) |

| Path | Category screenshots at 1440px |
| --- | --- |
| Home to Rent | [Rental Essentials](1440-home_rent-cat_essentials-populated.jpg) · [Layout](1440-home_rent-cat_rent_layout-populated.jpg) · [Rental Features](1440-home_rent-cat_rent_features-populated.jpg) · [Exterior and ranked lot size](1440-home_rent-cat_exterior-populated.jpg) · [Neighborhood](1440-home_rent-cat_neighborhood-populated.jpg) |
| Apartment to Rent | [Rental Essentials](1440-apartment_rent-cat_essentials-populated.jpg) · [Unit](1440-apartment_rent-cat_apt_unit-populated.jpg) · [Property](1440-apartment_rent-cat_apt_property-populated.jpg) |

| Width | Living Room | Exterior & Property |
| --- | --- | --- |
| 320px | [Open](320-home_buy-cat_living-populated.jpg) | [Open](320-home_buy-cat_exterior-populated.jpg) |
| 375px | [Open](375-home_buy-cat_living-populated.jpg) | [Open](375-home_buy-cat_exterior-populated.jpg) |
| 390px | [Open](390-home_buy-cat_living-populated.jpg) | [Open](390-home_buy-cat_exterior-populated.jpg) |
| 430px | [Open](430-home_buy-cat_living-populated.jpg) | [Open](430-home_buy-cat_exterior-populated.jpg) |
| 768px | [Open](768-home_buy-cat_living-populated.jpg) | [Open](768-home_buy-cat_exterior-populated.jpg) |
| 1024px | [Open](1024-home_buy-cat_living-populated.jpg) | [Open](1024-home_buy-cat_exterior-populated.jpg) |
| 1280px | [Open](1280-home_buy-cat_living-populated.jpg) | [Open](1280-home_buy-cat_exterior-populated.jpg) |
| 1440px | [Open](1440-home_buy-cat_living-populated.jpg) | [Open](1440-home_buy-cat_exterior-populated.jpg) |

## Verification

- Chromium checked the eight requested widths for horizontal overflow, image decoding, sidebar visibility, and two desktop photo columns. Phone and tablet checks also covered computed input sizing and stable viewport scale on focus.
- The cross-device browser rehearsal used the real UI with a temporary local-storage-backed development fixture. A mobile context saved two priorities and reached Living Room. A fresh desktop context loaded the saved fixture, edited tiers from the sidebar by keyboard, removed a choice, checked focus after moving or removing a row, and added a normalized custom feature. It resized through 1023px, 1024px, and 390px, reloaded the saved category, and reloaded during a Review edit before returning to Review. It also checked Back, Skip, Continue, garage importance and type, and buyer lot size. The fixture was used locally for verification.
- Desktop rental walkthroughs verified both step counts, pets, ranked Home to Rent lot-size editing, and one advancement per double activation. As I Go finished from Basics. Signed-out entry redirected to sign-in. A short desktop viewport kept the pane in normal document flow, and resizing with the picker open returned focus to the category heading.
- The isolated PostgreSQL run verified the real progress read and write, exact-category resume during Review editing, saved priority identities, and co-buyer separation. Browser sessions used development fixtures. Shared-search setup retains its existing in-session position behavior and saves the participant’s own preferences. Physical devices and hosted authentication were outside this local run.
- The production build passed. The focused onboarding and desktop suite reported 127 passed, 0 failed and 2 optional skips. The focused PostgreSQL run reported 29 passed, 0 failed and 0 skips. The full suite with isolated PostgreSQL reported 1,667 passed and 0 failed. Two live RentCast tests were skipped because sanitized fixtures were unavailable.

## Founder checklist

- [ ] Start a desktop V3 personalized search. Check the headline, step count, two photo columns, empty sidebar and Back / Skip / Continue. At the last category, continue to the unnumbered Review.
- [ ] Pick all three ranked tiers across categories. Open a prior choice from the sidebar with both a click and the keyboard. Check the preselected tier, move it, and then choose Not important. Confirm the card state and sidebar counts update and focus returns to the row or panel heading.
- [ ] Check the Phase 2B card order, No HOA suggestions, Ideal Lot Size, and garage importance and type. Go Back and confirm answers remain. Open a category from Review, refresh, and use **Back to review**.
- [ ] Start on a phone and resume on desktop with the same QA account. Edit an earlier priority, then reopen on the phone. Confirm the category, tiers, and search participant are still correct.
- [ ] Try both rental paths, pets, ranked Home to Rent lot size, As I Go, and a shared co-buyer search. Confirm independent priorities and find geographic preferences in My Search.
- [ ] Check tablet landscape and desktop browser zoom around 1024 CSS px. On a physical iPhone, check the keyboard and scroll behavior while editing a numeric or custom field.
