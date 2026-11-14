# Rental Foundations: Mobile Rental Onboarding Spec and Compatibility Audit

**Status: documentation only, for founder review.** Nothing in `src/`, `supabase/`,
`public/`, the database, Match scoring, Floor Plans or PR #166 is changed by this
document. Do not implement until the founder has reviewed §9 (plan) and §10
(open decisions). Do not merge or deploy.

Baseline audited: `main` at `4751fee` (merge of PR #181, Mobile Priority
Onboarding V3, flow version 4, behind `FLH_ONBOARDING_V3`, off in Production).

> Guiding rule: **FLH does the homework. The renter makes the decisions.**

---

## 1. The approved specification (with the pet amendment applied)

The later **Founder Pet Requirement Update** replaces the earlier pet proposal
("Decision B": pet type/count, a separately ranked pet priority, stored pet
facts). Only the amended behavior is specified below.

### Core rule (all three search types)

All three search types use the V3 mobile frame: the same headings, progress bar,
**Back · Skip · Continue**, photo feature cards, the bottom-sheet importance
choices (Must Have / Important / Nice to Have / Not important), Add-your-own
with autocomplete, and immediate importance ranking. Each co-buyer's priorities
stay independent, and existing saved data is preserved.

### Home to Rent: screen order

| # | Screen | Main cards | Suggestions | Removed from new onboarding |
|---|---|---|---|---|
| 1 | Search Type | Home to Buy / Home to Rent / Apartment to Rent | | |
| 2 | Rental Basics | Maximum Monthly Rent ($, commas), Bedrooms, Bathrooms, Ideal Square Footage | | Rental Type (Home, Condominium); Layout (Ranch, Two Story, Split Level, First-Floor Primary) |
| 3 | Geography | Existing city + school district flow, unchanged | | |
| 4 | **Rental Essentials** | One optional question: *Will pets be moving with you?* Yes / No / Not sure yet | | Pet type, breed, size, weight, count, names |
| 5 | Layout & Living Spaces | First-Floor Bedroom, Home Office, Finished Basement, Primary Ensuite Bathroom | First-Floor Laundry, Extra Bedroom, Front Porch | Guest Bedroom |
| 6 | Rental Features | Kitchen Countertop Seating, Stainless Steel Appliances, Fireplace, Central Air, Garage | Kitchen Island, High Ceilings | |
| 7 | Exterior & Property | Ideal Lot Size (acres), Deck/Patio, Fenced Yard | Mature Trees, Pool, Landscaping | Large Backyard, Privacy Fence |
| 8 | Location & Neighborhood | Low-Traffic Street, Walkable Neighborhood | Cul-de-sac, Parks Nearby, Reputable Schools | Walkable Schools, Near Water, Bustling Street, Walkable to Town, Quiet Street. Dead-End Street is not reintroduced. |
| 9 | Editable Review | | | |

### Apartment to Rent: screen order

| # | Screen | Main cards | Suggestions | Removed from new onboarding |
|---|---|---|---|---|
| 1 | Search Type | | | |
| 2 | Apartment Basics | Maximum Monthly Rent, Bedrooms, Bathrooms, Ideal Square Footage | | |
| 3 | Geography | Existing, unchanged | | |
| 4 | **Rental Essentials** | Same single optional pets question | | |
| 5 | The Unit | In-Unit Laundry, Home Office Space, Central Air | Garage *(private)*, Outdoor Space, Dishwasher | Updated Interior |
| 6 | The Property | Fitness Center, Pool, Garage *(shared garage parking)* | Elevator, Sufficient Parking, Secure Entry | Pet-Friendly (now covered by the pets question), Outdoor Space, Quiet Community, Privacy |
| 7 | Editable Review | | | |

**Order rule.** Rental Essentials comes immediately after Geography in both
rental flows, before the optional photo-card screens. V3 already uses this
order (`onboardingFlow.js`, flow 4: `search_type → basics → locations →
cat_essentials → …`), so no reordering is needed. Only the screen's contents change.

### Pets: amended behavior (both rental flows)

1. One optional question on Rental Essentials: **"Will pets be moving with you?"**
   **Yes / No / Not sure yet.** The whole screen can be skipped.
2. **Yes** makes the existing canonical `features:Pets Allowed` priority
   (shown as "Pet-Friendly") a **Must Have** automatically. The renter is not
   asked to rank it separately.
3. **No** and **Not sure yet** create no anti-pet requirement, assign no
   mismatch, and imply nothing about whether pets are prohibited.
4. FLH collects no pet type, breed, size, weight, count or names.
5. Pet-Friendly is not a separate card on the Apartment Property screen, so
   the question is never asked twice.
6. The answer can be revisited later. §7 covers how the automatic priority and
   later edits stay in sync without overwriting the renter's manual changes.
7. A Must Have is not an automatic failure. A missing or uncertain pet policy
   is **Unknown**, never **No**. (Verified: this is already how Match works. See §6.)
8. Saved priorities and each co-buyer's own preferences are preserved. Match
   weights and scoring logic do not change.

---

## 2. How renters are onboarded today (three paths)

| | **Live flow (version 1)** | **Unreleased six-step flow (version 3)** | **V3 (version 4, flag off in Prod)** | **Approved spec** |
|---|---|---|---|---|
| Who sees it | Everyone (Production) | Dev preview only | Preview with `FLH_ONBOARDING_V3=on` | — |
| Basics, Home to Rent | Rent, beds, baths, sq ft, **lot size**; Home preferences: **Home type** (House/Townhome/Condo) + **Garage** | Same Basics | Rent, beds, baths, sq ft. Lot size moved to Exterior. No home type/layout. | Rent, beds, baths, sq ft. Lot size on Exterior. |
| Property type preset | **Yes**: `applySearchChoice` writes `preferredPropertyTypes = ['house']`, Important | No | No | No (Rental Type removed) |
| Layout for Home to Rent | Not asked (`basicsFieldsFor('home_rent').layout === false`) | Not asked | Not asked | Not asked. The removal is already true in code. |
| Essentials | Chips: Pet-friendly, In-unit laundry, Utilities included, Parking, Central air, Dishwasher | Same chips, first section | Photo/illustration cards for the same six + Off-Street Parking, Storage Unit, Package Room suggestions | **Pets question only** |
| Home to Rent screens after essentials | One "What Matters" chip list (`HOME_RENT_CATALOG`) | Neighborhood / The home / Outdoor space / Property type | Layout, Kitchen, Living Room, Bathroom, **Garage** (with attached/detached), Exterior, Neighborhood | Layout, **Rental Features**, Exterior, Neighborhood |
| Apartment screens after essentials | The Unit / The Property / Living There chips | The unit / Building & amenities / Building type / After you tour | Layout, Kitchen, Living Room, Bathroom, Exterior (Balcony/Patio, Pool, Fitness, Secure Entry, Elevator), Neighborhood | **The Unit**, **The Property** |
| Ranking | Separate Rank step | Rank step | Immediate (importance sheet) | Immediate |
| Review | Rank summary | Review step | Editable Review | Editable Review |

**Differences between V3 and the spec**

- **Home to Rent loses** the Kitchen, Living Room, Bathroom and Garage screens.
  Their relevant items move onto one new **Rental Features** screen. Bathroom
  items (Double Vanity, Soaking Tub, etc.), Walk-in Pantry, Eat-in Kitchen,
  Formal Dining, Built-in Shelving, Large Windows, Walkout Basement and the
  Garage details (attached/detached, Workbench, Garage Extension, Door to
  Backyard) are no longer offered to renters. Sidewalks, Tree-Lined Street and
  Walkable to Schools leave the rental Neighborhood screen.
- **Apartment to Rent loses** the Layout, Kitchen, Living Room, Bathroom,
  Exterior and Neighborhood screens. Two new screens, **The Unit** and **The
  Property**, replace them.
- **Rental Essentials** shrinks from six cards plus three suggestions to the
  single pets question. In-Unit Laundry, Central Air and Dishwasher move to the
  Apartment Unit screen, and Central Air also moves to Home to Rent Rental Features.
  **Utilities Included is no longer asked in either flow.** Parking is asked
  only for apartments ("Sufficient Parking"). For Home to Rent, In-Unit Laundry,
  Utilities Included, Parking and Dishwasher are no longer asked. See decision D6.
- The **Home to Buy** flow is unaffected and must stay byte-for-byte the same
  (screens, identities, images).

---

## 3. Identity mapping: every requested item against the canonical catalog

Legend:
- **Existing**: a catalog identity. It is reused, so earlier selections, Home Facts answers and both scorers (JS `computeMatch`, SQL `resolve_cobuyer_compare_perspectives`) already line up.
- **Existing custom**: a buyer-owned item V3 already defines (`source: 'custom'`).
- **New custom**: a new buyer-owned Yes/No/Unknown item.
- **How Match answers it**: shared fact = the shared Home Facts field on `homes`; Home Fact = an exact reading in `homeFactCriteria.js`; own Yes/No = each renter's own check (Unknown until answered).

Home to Rent keeps the stored labels V3 and the live flow already use for it (the
purchase-cased `HOME_RENT_CATALOG` identities, e.g. `Home office`). Apartment to Rent
keeps V3's rental-catalog labels (e.g. `Home Office`), resolved by
`resolveDefinition` in `priorityCategories.js`. Card text is set per card, so
wording can change without changing a stored identity.

### Home to Rent

| Screen | Card (founder wording) | Recommended stored identity | Status | How Match answers it | Photo |
|---|---|---|---|---|---|
| Layout | First-Floor Bedroom | `features:First-Floor Bedroom` | Existing (V3 already offers it to Home to Rent) | Own Yes/No | ✅ `first-floor-bedroom` |
| Layout | Home Office | `features:Home office` | Existing | Own Yes/No | ✅ `home-office` |
| Layout | Finished Basement | `features:Finished basement` | Existing | Home Fact (basement condition), else own Yes/No | ✅ `finished-basement` |
| Layout | Primary Ensuite Bathroom | `features:Primary ensuite` (card text "Primary Ensuite Bathroom") | Existing | Own Yes/No | ✅ `primary-ensuite` |
| Layout (sugg.) | First-Floor Laundry | `features:First-floor laundry` | Existing | Home Fact (laundry location, Yes only), else own Yes/No | ✅ `first-floor-laundry` |
| Layout (sugg.) | Extra Bedroom | `features:Extra Bedroom` | **New custom** (see A3, D3) | Own Yes/No | ❌ missing |
| Layout (sugg.) | Front Porch | `exterior:Front porch` | Existing | Own Yes/No | ✅ `front-porch` |
| Rental Features | Kitchen Countertop Seating | `features:Countertop Seating` (card text "Kitchen Countertop Seating") | Existing custom (V3 Kitchen) | Own Yes/No | ✅ `countertop-seating` |
| Rental Features | Stainless Steel Appliances | `features:Stainless Steel Appliances` | Existing | Own Yes/No | ✅ `stainless-appliances` |
| Rental Features | Fireplace | `features:Fireplace` | Existing (same label in every catalog) | Own Yes/No | ✅ `fireplace` |
| Rental Features | Central Air | `features:Central Air` (the Rental Essentials identity) | Existing (see A1) | Own Yes/No | ❌ missing (icon today) |
| Rental Features | Garage | `exterior:Garage` | Existing | Home Fact (`garage_spaces`), else own Yes/No | ⚠️ attached/detached photos exist but no neutral one (see §5) |
| Rental Features (sugg.) | Kitchen Island | `features:Kitchen Island` | Existing | Own Yes/No | ✅ `kitchen-island` |
| Rental Features (sugg.) | High Ceilings | `features:High Ceilings` | Existing | Own Yes/No | ✅ `high-ceilings` |
| Exterior | Ideal Lot Size (acres) | `lotSizeTarget` | Existing (V3 already shows it on Exterior) | Threshold, **only when it has a tier** (see M1) | n/a (input) |
| Exterior | Deck/Patio | `exterior:Patio / deck` | Existing | Own Yes/No | ✅ `deck-patio` |
| Exterior | Fenced Yard | `exterior:Fenced yard` | Existing (see A1) | Own Yes/No | ✅ `fenced-yard` |
| Exterior (sugg.) | Mature Trees | `location:Mature Trees` | Existing (stored under Location, as V3 does) | Own Yes/No | ✅ `mature-trees` |
| Exterior (sugg.) | Pool | `exterior:Pool` | Existing | Own Yes/No | ✅ `pool` |
| Exterior (sugg.) | Landscaping | `exterior:Landscaping` (kind `check`, as `HOME_RENT_CATALOG` stores it) | Existing (see A6) | Own Yes/No | ❌ missing |
| Neighborhood | Low-Traffic Street | `location:Low-Traffic Street` | Existing | Own Yes/No | ✅ `low-traffic-street` |
| Neighborhood | Walkable Neighborhood | `location:Walkable Neighborhood` | Existing (purchase catalog; new to renters) | Own Yes/No | ❌ missing |
| Neighborhood (sugg.) | Cul-de-sac | `location:Cul-de-Sac` | Existing | Own Yes/No | ✅ `cul-de-sac` |
| Neighborhood (sugg.) | Parks Nearby | `location:Parks nearby` (**not** `location:Parks Nearby`; see A2) | Existing | Own Yes/No | ❌ missing |
| Neighborhood (sugg.) | Reputable Schools | `location:Reputable Schools` | Existing | Own Yes/No (no school data feeds it) | ❌ missing. Do **not** reuse `walkable-to-schools.webp`: it shows a different idea. |
| Rental Essentials | Pets question → Pet-Friendly | `features:Pets Allowed` | Existing | **Shared fact** `homes.pets_allowed` (null = Unknown) | n/a (question, no card) |

### Apartment to Rent

| Screen | Card (founder wording) | Recommended stored identity | Status | How Match answers it | Photo |
|---|---|---|---|---|---|
| The Unit | In-Unit Laundry | `features:In-Unit Laundry` | Existing | **Shared fact** `homes.in_unit_laundry` | ⚠️ FLH illustration only (`in-unit-laundry`) |
| The Unit | Home Office Space | `features:Home Office` (card text "Home Office Space") | Existing | Own Yes/No | ✅ `home-office` |
| The Unit | Central Air | `features:Central Air` | Existing | Own Yes/No | ❌ missing |
| The Unit (sugg.) | Garage (private) | **Decision D1**. Recommended: `exterior:Private Garage` | **New custom** | Own Yes/No only, never inferred | ⚠️ `garage-attached` exists but shows a house |
| The Unit (sugg.) | Outdoor Space | `exterior:Patio / Deck / Outdoor Living` (card text "Private Outdoor Space") (see A4) | Existing (V3 "Balcony / Patio") | Own Yes/No | ⚠️ `deck-patio` shows a house deck |
| The Unit (sugg.) | Dishwasher | `features:Dishwasher` | Existing | Own Yes/No | ⚠️ FLH illustration only (`dishwasher`) |
| The Property | Fitness Center | `exterior:Fitness Center` | Existing | Own Yes/No | ❌ missing (icon) |
| The Property | Pool | `exterior:Pool` | Existing | Own Yes/No | ⚠️ `pool` shows a private home's pool |
| The Property | Garage (shared garage parking) | **Decision D1**. Recommended: `exterior:Garage` (card text "Garage Parking") | Existing | Home Fact (`garage_spaces`), else own Yes/No (see M3) | ❌ missing |
| The Property (sugg.) | Elevator | `exterior:Elevator` | Existing | Own Yes/No | ❌ missing (icon) |
| The Property (sugg.) | Sufficient Parking | `exterior:Parking` (card text "Sufficient Parking") | Existing (former Rental Essential) | Own Yes/No | ❌ missing (icon) |
| The Property (sugg.) | Secure Entry | `exterior:Secure Entry` | Existing | Own Yes/No | ❌ missing (icon) |
| Rental Essentials | Pets question → Pet-Friendly | `features:Pets Allowed` | Existing | **Shared fact** `homes.pets_allowed` | n/a |

### New custom criteria (complete list)

| Identity | Flow | Why it is not an existing identity | Decision |
|---|---|---|---|
| `features:Extra Bedroom` | Home to Rent | No catalog equivalent. `Guest Bedroom` is the removed item, and the bedroom *count* is a Basics threshold. | D3 |
| `exterior:Private Garage` | Apartment | Keeps private garage access separate from the shared/any-garage `exterior:Garage`, which `garage_spaces` answers | D1 |

`features:Countertop Seating` is already a V3 custom suggestion and is reused, not
re-created. Every other requested item maps to an existing identity. No new
catalog identity, `constants.js` entry, database column or SQL change is needed.

Like every V3 custom item, the new ones are stored as `{ label, kind: 'check',
source: 'custom', group }` in the participant's own `customItems`. They are
answered Yes / No / Unknown by each renter, never inferred, and Unknown is never
scored. The SQL scorer iterates the participant's `tiers`, so it scores them
identically (V3 PR #181 already proves JS = SQL for custom items).

---

## 4. Duplicate and ambiguous identities

| # | Issue | Where it bites | Recommendation |
|---|---|---|---|
| **A1** | **Case-variant pairs exist in rental documents.** `features:Central Air` (Rental Essentials, rental catalog) vs `features:Central air` (`HOME_RENT_CATALOG`); `exterior:Fenced Yard` (rental catalog) vs `exterior:Fenced yard`; `features:Home Office` vs `features:Home office`. The purchase alias fold (`PURCHASE_LEGACY_LABEL_ALIASES`) runs **only for purchase searches**. | A Home to Rent document holding both cases of one idea at a level is **scored twice** (JS and SQL both iterate per key). V3 dedupe (`normalizeFeatureKey`) prevents *new* duplicates but does not merge existing ones. | One identity per card: **`Central Air`** (it is the identity V3 Rental Essentials writes today) and **`Fenced yard`** / **`Home office`** for Home to Rent (what its live and V3 flows write). Before implementing, run a **read-only** count of rental documents with both variants selected (§9 step 0). Merging any found is a separate, founder-approved data task. This spec changes no stored rows. |
| **A2** | **Parks Nearby has two identities.** `location:Parks nearby` (check; Home to Rent catalog) and `location:Parks Nearby` (rental catalog, **rating**, not a tour criterion). | `Parks Nearby` with kind `rating` is neither Yes/No (`isYesNoCriterion` → false: it is in `CATALOG_RATING_LABELS`) nor an after-tour question, so it can **never be evaluated**. | Use `location:Parks nearby` (display "Parks Nearby"). |
| **A3** | **"Extra Bedroom"** overlaps the Bedrooms threshold (`bedsMin`) and the removed `Guest Bedroom`. | A renter could set 3 bedrooms *and* Extra Bedroom, and the two can disagree on the same home. | Decision D3. Recommended: keep it as a custom card with the hint "a bedroom beyond the number you need (guest room, office, nursery)". Alternative: drop it. |
| **A4** | **"Outdoor Space" has two meanings.** `exterior:Outdoor Space` is an after-tour rating ("Doesn't work / Works / Love it"). The founder removed it from The Property and added "Outdoor Space" to The Unit. | Using the rating identity on The Unit would make a pre-tour card that can only be answered after a tour. | Map The Unit's "Outdoor Space" to `exterior:Patio / Deck / Outdoor Living` (pre-tour Yes/No, V3's "Balcony / Patio"). The after-tour rating stays retired from onboarding and kept for existing users. |
| **A5** | **Garage appears twice for apartments** (The Unit, private; The Property, shared). Both look like `exterior:Garage`. | Two cards writing one key would silently mirror each other. | Decision D1 (two identities; §3 table). |
| **A6** | **"Landscaping" is vague** as a Yes/No (most homes have some landscaping). The same label is a *rating* in the investment catalog. | The Home to Rent identity is stored as `check`, so it is answerable. Only the meaning is unclear. | Keep `exterior:Landscaping` (existing). Suggested card hint: "Well-kept, landscaped yard." Founder may reword. |
| **A7** | **"Sufficient Parking" vs "Parking".** | Not a duplicate once Parking leaves Rental Essentials. | Map to `exterior:Parking`; card text "Sufficient Parking". |
| **A8** | **Add-your-own can select an unanswerable identity.** Typing "Walkability" matches the rental catalog's `location:Walkability` (rating, not a tour criterion). The same applies to "Groceries Nearby", "Dog Parks Nearby", etc. | This is existing V3 behavior (`catalogMatches` reads `getItemlistCategories('rental')`). The renter would get a priority that stays "Not evaluated" forever. | In the implementation, exclude rating-kind non-tour rental catalog items from `catalogMatches` for rental searches, so typing creates a Yes/No custom item or matches "Walkable Neighborhood". This is a dedupe change only, not a Match change. |
| **A9** | `Mature Trees` is stored under **Location** but shown on Exterior. | Presentation only, as in V3 today. | No change. |

---

## 5. Photo assets

The founder's photos (`public/images/onboarding/`, 37 originals with card
derivatives in `cards/`) and the explicit manifest (`src/lib/onboardingImages.js`)
were compared with every card above. **No image is invented, generated as a
photo, or fetched from listings.** A card without a photo uses the existing
fallback chain (FLH illustration where one exists, otherwise an icon tile), which
is already tested.

**Photos that exist and fit:** first-floor-bedroom, home-office, finished-basement,
primary-ensuite, first-floor-laundry, front-porch, countertop-seating,
stainless-appliances, fireplace, kitchen-island, high-ceilings, deck-patio *(Home
to Rent)*, fenced-yard, mature-trees, pool *(Home to Rent)*, low-traffic-street,
cul-de-sac.

**Missing (founder photo needed, or icon fallback):**

| Flow | Card | Today's fallback |
|---|---|---|
| Home to Rent | Extra Bedroom | icon (to define) |
| Both | Central Air | icon `AirVent` |
| Home to Rent | Garage (neutral) | Decision D5: `garage-attached` photo, the FLH `garage-either` illustration, or a new photo |
| Home to Rent | Landscaping | icon (to define) |
| Home to Rent | Walkable Neighborhood | icon `Store` |
| Home to Rent | Parks Nearby | icon `Leaf` |
| Home to Rent | Reputable Schools | icon `School` |
| Apartment | In-Unit Laundry, Dishwasher | FLH illustrations (already open from PR #181) |
| Apartment | Private Garage, Garage Parking, Fitness Center, Elevator, Sufficient Parking, Secure Entry | icons |

**Existing photos that may mislead for apartments:** `pool` shows a private
house's backyard pool, and `deck-patio` shows a house deck. For Apartment cards
(Pool, Outdoor Space) the recommendation is the **icon fallback** until the founder
supplies apartment-appropriate photos (decision D5). Home to Rent keeps the photos.

Adding a photo later is one manifest line plus re-running
`scripts/visual/onboarding-card-images.mjs`. No code path changes.

---

## 6. Match: what would be scored incorrectly, and what is already correct

Match weights (4 / 2 / 1) and scoring logic are **not changed** by anything in
this spec. Findings:

| # | Finding | Severity | Resolution within "no Match change" |
|---|---|---|---|
| **M0** | **Pet-Friendly Must Have + unknown pet policy.** JS `computeMatch` reads `homes.pets_allowed` (`SHARED_BOOLEAN_FACT_FIELDS`). `true` = Yes, `false` = No, `null` = `notEvaluated`. SQL (`2026-11-02-home-facts-match-parity.sql`, line ~275) does `if v_score is null then continue` (unevaluated). The Must-Have summary reports "N Must-Haves still unknown", not a miss. | ✅ **Correct today** | Requirement 7 is already met. Add a regression test pinning it (§9). |
| **M1** | **Ideal Lot Size is never scored from onboarding.** `lotSizeTarget` defaults to tier `dontcare`, and V3's Exterior input writes only `value`. Match skips it until the renter ranks it in My Search. The same is true for buyers today. | ⚠️ Spec gap | Decision D4. Either keep it as today ("ideal, not ranked") or let the lot-size field open the same importance sheet, which writes the existing `lotSizeTarget.tier` (no scorer change). |
| **M2** | **Parks Nearby** under the rating identity would never be evaluated. | ⚠️ | Use `location:Parks nearby` (A2). |
| **M3** | **Apartment garage from `garage_spaces`.** `exterior:Garage` reads `garage_spaces` for every search type. An apartment listing's garage count can describe a shared structure. That is reasonable evidence for "Garage Parking" but would be a **false Yes for a private garage**. | ⚠️ | Private garage is a custom item that is never inferred (D1). Shared "Garage Parking" keeps `exterior:Garage`. |
| **M4** | **Outdoor Space** on The Unit under the rating identity would be unanswerable before a tour. | ⚠️ | A4 mapping. |
| **M5** | **Double counting** when both case variants of one idea are selected (A1). | ⚠️ existing data | Read-only count first. No rewrite in this work. |
| **M6** | Add-your-own reaching unanswerable rating identities (A8). | ⚠️ existing | Dedupe filter only. |
| **M7** | **Live-flow Home to Rent documents carry `preferredPropertyTypes = ['house']` at Important** (preset by `applySearchChoice`). Match marks a condo or townhome rental "not on your preferred list". V3 never presets, and this spec removes Rental Type. | ℹ️ existing data, unchanged | Preserved as saved, as required. Shown read-only on Review under "Saved from earlier" (V3 behavior), editable in My Search. Founder may later decide whether such a preset should be cleared. That is out of scope here. |
| **M8** | The Pets **answer** itself (Yes / No / Not sure) is **not** a Match input. Only the resulting Pet-Friendly tier is. No / Not sure write nothing that Match reads. | ✅ by design | — |

Everything else in §3 is answered the way it already is for Home to Buy and
existing renters: the renter's own Yes/No (Unknown until answered), a shared
rental fact, or an exact Home Fact reading.

---

## 7. Pets: storage and synchronization (safest minimal design)

### Where the answer lives

Store it in the **participant's own priorities document**
(`search_member_priorities`, one per member per search), next to the criterion
it drives. This follows the `exterior.garagePreference` precedent:

```jsonc
"features": {
  "customItems": [ … ], "tiers": { "Pets Allowed": "must", … },
  "petsMoving": "yes",                       // 'yes' | 'no' | 'not_sure'; absent = not answered / skipped
  "petsAutoMust": { "previousTier": null }   // present only while FLH's automatic Must Have stands
}
```

Why here and not elsewhere:

- **Co-buyers stay independent.** Each member has their own document, so one
  co-renter's "Yes" never changes another's priorities. The shared home fact
  `homes.pets_allowed` (the property's policy) is untouched.
- **Per search, not per profile.** `profiles.onboarding_state` is per person and
  is normalized on read (unknown keys dropped), so it would lose the answer and
  could not follow the search into My Search.
- **No migration.** `normalizePriorities` keeps unknown keys inside `features`
  (`{ ...base.features, ...raw.features }`). The SQL scorer reads only
  `features.tiers`, so both additive keys are invisible to Match in JS and SQL.
- **Privacy.** Only a three-way answer is stored: no pet type, breed, size,
  weight, count or name. It sits under the same row-level security as the rest
  of the member's priorities. It is never written to `homes`, never shown to a
  co-buyer, and never sent to an import or AI provider.

### One pure write path: `setPetsMoving(priorities, answer)`

| Answer | Writes |
|---|---|
| **Yes** | `petsMoving = 'yes'`. If Pets Allowed is **already Must Have**, nothing else changes and no marker is set (it was already the renter's own choice). Otherwise, record `petsAutoMust.previousTier` (its current level, or `null` if unselected) and set Pets Allowed to **must** through the existing `setFeatureLevel`, the same write the importance sheet uses. |
| **No / Not sure yet** | `petsMoving = 'no' / 'not_sure'`. If `petsAutoMust` is present **and** Pets Allowed is still `must`, restore `previousTier` (`null` → `dontcare`, the existing "not selected" state) and remove the marker. If the marker is present but the level has changed since, the renter edited it by hand, so only the marker is removed and the level stays. With no marker, nothing else is touched. |
| **Skip / screen not answered** | Nothing is written. A previous answer stays as it was. |

**Never written in any case:** a `'no'` on any home, an "anti-pet" or
"No Pets" criterion, a change to `homes.pets_allowed`, or any other priority.

### Edits after onboarding

- **Changing the answer later** (Rental Essentials from Review, and later a My
  Search row; decision D7) calls the same `setPetsMoving`, so behavior is
  identical everywhere.
- **Manual edits to Pet-Friendly** (importance sheet on Review, My Search
  ranking) keep using today's write paths **unchanged**. The marker is not
  cleared by them. Instead, it is checked when read: it only applies while the
  level is still `must`. A renter who lowered Pet-Friendly to Important and then
  answers "No" keeps Important. This avoids touching every existing tier-write
  call site.
- **Remaining edge case:** a renter changes the auto Must Have by hand, then
  manually sets it back to Must Have, then answers "No". The marker looks
  untouched, so the Must Have is removed. Mitigation: the screen shows a status
  line with **Undo** whenever the answer removes or adds the Must Have ("Pet-Friendly
  is now a Must Have" / "Pet-Friendly removed from your Must Haves"), so nothing
  changes silently.
- **Switching to Home to Buy** removes Pet-Friendly as today (`switchSearchType`
  lists it under "removed", with Undo). The implementation should also clear
  `petsMoving` and `petsAutoMust` in that switch, so a later return to renting
  shows the question unanswered instead of a stale "Yes" without its Must Have.
  Undo restores all three together.
- **Review** shows the answer under Rental Essentials: "Pets moving with you:
  Yes · Pet-Friendly is a Must Have". Pet-Friendly is not listed again under
  "More of your priorities". (Once no card shows it, `otherChosenPriorities`
  would list it there, so the implementation must exclude `features:Pets Allowed`
  for rental searches, as it already excludes `exterior:Garage`.)

### Existing renters

A renter who already chose Pet-Friendly at any level keeps it exactly. Their
`petsMoving` is simply unanswered. If they later answer Yes, an existing
Important becomes Must Have, with `previousTier: 'important'` recorded so No / Not
sure restores Important.

---

## 8. Preserving historical values

Nothing is deleted, renamed or migrated. Items removed from the new onboarding
remain:

- in each person's stored document at their saved level, and **still counted in
  Match** (rental searches have no retired-built-in filter);
- visible and editable on V3 Review under **"More of your priorities"**
  (`otherChosenPriorities`) and in My Search;
- offered for new selection in My Search where they are today. This spec
  removes them from onboarding only.

This covers Guest Bedroom, Large Backyard, Privacy Fencing, Walkable Schools,
Near Water, Bustling Street, Walkable to Town, Quiet Street, Updated Interior,
Outdoor Space (rating), Quiet Community (`exterior:Noise Level`), Privacy
(`homeFeel:Privacy`), Utilities Included, In-Unit Laundry / Parking / Dishwasher
(for Home to Rent), every V3 Kitchen / Living / Bath / Garage item, and Dead-End
Street. **Rental Type** values (`preferredPropertyTypes`) and **Layout** values
(`homeLayout`, `features:First-Floor Primary`) stay saved, are shown read-only
under "Saved from earlier", and remain asked about **homes** in Add Home / Home
Facts (`HomeModal`, `HomeFacts`). A saved `exterior.garagePreference`
(attached/detached) is kept although Home to Rent no longer asks it.

---

## 9. Smallest safe implementation plan (after founder review)

Everything stays **behind `FLH_ONBOARDING_V3`** (off in Production). The live flow
(version 1), the six-step preview (version 3) and Home to Buy in V3 do not change.

0. **Read-only data check (no writes).** Count rental `search_member_priorities`
   documents that have, selected at a level: both case variants from A1;
   `location:Parks Nearby`; `exterior:Outdoor Space`; `features:Pets Allowed`.
   Report only. This sizes A1/M5 and the D7 My Search work.
1. **`src/lib/priorityCategories.js`**: add the rental screens as categories,
   using the existing `only` mechanism:
   `cat_rent_layout`, `cat_rent_features` (Home to Rent);
   `cat_apt_unit`, `cat_apt_property` (Apartment). Restrict the existing
   `exterior` and `neighborhood` definitions to the Home to Rent card lists above
   (buyer lists untouched). Turn `essentials` into a question screen with no
   cards. Add `Extra Bedroom` and `Private Garage` as `custom: true`
   (subject to D1/D3). Add the A8 filter to `catalogMatches` for rental searches.
2. **`src/lib/rentalPets.js`** (new, pure): `PETS_ANSWERS`, `petsMovingAnswer`,
   `setPetsMoving` (§7), and the switch-to-buy clearing helper.
   `switchPrioritySearchType` calls it.
3. **`src/lib/onboardingFlow.js`**: flow 4 step list per search type:
   - Buy: unchanged.
   - Home to Rent: `search_type, basics, locations, cat_essentials, cat_rent_layout, cat_rent_features, cat_exterior, cat_neighborhood, review`.
   - Apartment: `search_type, basics, locations, cat_essentials, cat_apt_unit, cat_apt_property, review`.

   In-progress Preview sessions on a step that no longer applies land on the
   first unfinished step (existing `resumeOnboardingStep` behavior). Answers are kept.
4. **UI** (`src/components/onboarding/priority/`): a small `PetsQuestion` (three
   radio buttons, status line with Undo) rendered by `CategoryStep` for the
   essentials screen. It keeps the same header, progress, Skip / Back / Continue.
   Review shows the pets answer (§7). No other component changes. The
   importance sheet, cards, Add-your-own and Review are reused.
5. **Images**: manifest unchanged unless the founder supplies photos (D5).
   Apartment Pool / Outdoor Space cards render the icon fallback.
6. **Tests**:
   - Extend `test/mobile-priority-onboarding-v3.test.js`: exact screen order and contents per rental type; buyer screens byte-identical; removed items absent from new onboarding but kept and counted when saved; A1/A2/A4/A5 identity choices; A8 dedupe.
   - New `test/rental-pets-onboarding.test.js`: every transition in §7, including manual-edit preservation, Undo, skip, switch-to-buy, existing Important → Must → restore, and no `'no'` or anti-pet writes.
   - Extend `test/mobile-priority-onboarding-v3-db.test.js` (real Postgres): JS = SQL for rental documents, including Pet-Friendly Must Have with `pets_allowed` null (Unknown) / true / false, and co-renter independence when only one answers Yes.
7. **QA**: extend `scripts/qa/mobile-priority-onboarding-v3-qa.mjs` for both
   rental flows at 375 / 390 / 430 and desktop. Live-flow screenshot regression
   must show **0 pixels changed**. Update `docs/mobile-priority-onboarding-v3.md`.

**Not touched:** `src/lib/matching.js`, `src/lib/homeFactCriteria.js`, any SQL or
migration, `constants.js` catalogs and weights, Add Home / Home Facts, Floor
Plans, PR #166, Production flags.

---

## 10. Open founder decisions

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Apartment garage: two identities (Unit = new custom **Private Garage**, never inferred; Property = existing `exterior:Garage` shown as **Garage Parking**), or a single Garage card on one screen. | Two identities as recommended. Prevents a shared garage count from marking a private garage Yes. |
| **D2** | Pets **Yes** when Pet-Friendly is already selected at Important or Nice: upgrade to Must Have (recording the earlier level so No restores it), or leave the renter's level alone. | Upgrade (it is what "Yes → Must Have" means), with the status line and Undo. |
| **D3** | Keep **Extra Bedroom** (custom Yes/No with a hint) or drop it, given the Bedrooms count in Basics. | Keep, with the hint. |
| **D4** | **Ideal Lot Size**: unranked as today (not scored until ranked in My Search), or offer the importance sheet on the field so it counts from onboarding. | Offer the sheet. It writes the existing `lotSizeTarget.tier`, so it is not a scorer change. Apply to buyers too only if the founder wants. |
| **D5** | Photos: neutral Garage (Home to Rent), Central Air, Extra Bedroom, Landscaping, Walkable Neighborhood, Parks Nearby, Reputable Schools, and apartment-appropriate Pool / Balcony / amenities. Until supplied, icons are used (and existing house photos for Apartment Pool / Outdoor Space are suppressed). | Use icon fallbacks now. Founder uploads later. |
| **D6** | **Utilities Included**, and for Home to Rent **In-Unit Laundry / Parking / Dishwasher**, are no longer asked anywhere in rental onboarding (still in My Search). Confirm, or add any as suggestions. | Confirm the removal. Optionally add Utilities Included as a Rental Features / The Unit suggestion, since it is a shared fact Match already reads. |
| **D7** | Revisiting the pets answer **after onboarding**: in V3 Review only (smallest), or also a Rental Essentials row in My Search (calls the same `setPetsMoving`; small My Search change). | Review now; the My Search row as the next small PR. |
| **D8** | Whether My Search should show Pet-Friendly as "set by your pets answer" (copy only). | Yes, copy only, in the D7 PR. |

---

## 11. Confirmation of what this change does

- Adds this document only.
- No change to live onboarding, V3 code, the database, Match scoring, Floor
  Plans, images, flags or PR #166. Draft PR for founder review. Not merged or deployed.
