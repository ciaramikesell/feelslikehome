# Rental Foundations: Mobile Rental Onboarding Spec and Compatibility Audit

**Status: documentation only. Architecture approved by the founder with
decisions D1–D8 (§10). Implementation has not started.** Nothing in `src/`,
`supabase/`, `public/`, the database, Match scoring, Floor Plans or PR #166 is
changed by this document. Implementation follows the staged plan in §9, and
each stage stops for founder review where marked. Do not merge or deploy.

Baseline audited: `main` at `c18f837`. This is PR #181 (Mobile Priority
Onboarding V3, flow version 4, behind `FLH_ONBOARDING_V3`, off in Production)
plus the founder's 11 rental photos.

> Guiding rule: **FLH does the homework. The renter makes the decisions.**

---

## 1. The approved specification

The **Founder Pet Requirement Update** replaces the earlier pet proposal
("Decision B": pet type and count, a separately ranked pet priority, stored pet
facts). The **final founder decisions** (D1–D8, §10) are applied throughout.

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
| 4 | **Rental Essentials** | One optional question: *Will pets be moving with you?* Yes / No / Not sure yet (with the `pet-friendly` photo) | | Pet type, breed, size, weight, count, names |
| 5 | Layout & Living Spaces | First-Floor Bedroom, Home Office, Finished Basement, Primary Ensuite Bathroom | First-Floor Laundry, Extra Bedroom, Front Porch | Guest Bedroom |
| 6 | Rental Features | Kitchen Countertop Seating, Stainless Steel Appliances, Fireplace, Central Air, Garage | Kitchen Island, High Ceilings, **In-Unit Laundry, Dishwasher, Utilities Included, Off-Street Parking** (D6) | |
| 7 | Exterior & Property | **Ideal Lot Size (acres) with optional importance** (D4), Deck/Patio, Fenced Yard | Mature Trees, Pool, Landscaping | Large Backyard, Privacy Fence |
| 8 | Location & Neighborhood | Low-Traffic Street, Walkable Neighborhood | Cul-de-sac, Parks Nearby, Reputable Schools | Walkable Schools, Near Water, Bustling Street, Walkable to Town, Quiet Street. Dead-End Street is not reintroduced. |
| 9 | Editable Review | | | |

### Apartment to Rent: screen order

| # | Screen | Main cards | Suggestions | Removed from new onboarding |
|---|---|---|---|---|
| 1 | Search Type | | | |
| 2 | Apartment Basics | Maximum Monthly Rent, Bedrooms, Bathrooms, Ideal Square Footage | | |
| 3 | Geography | Existing, unchanged | | |
| 4 | **Rental Essentials** | Same single optional pets question | | |
| 5 | The Unit | In-Unit Laundry, Home Office Space, Central Air | **Private Garage** (D1), Outdoor Space, Dishwasher, **Utilities Included** (D6) | Updated Interior |
| 6 | The Property | Fitness Center, Pool, **Garage Parking** (D1) | Elevator, Sufficient Parking, Secure Entry | Pet-Friendly (now covered by the pets question), Outdoor Space, Quiet Community, Privacy |
| 7 | Editable Review | | | |

**Order rule.** Rental Essentials comes immediately after Geography in both
rental flows, before the optional photo-card screens. V3 already uses this
order (`onboardingFlow.js`, flow 4: `search_type → basics → locations →
cat_essentials → …`), so no reordering is needed. Only the screen's contents change.

**Suggestions stay optional.** No new screens. Nothing is preselected, and no
suggestion is mandatory (D6).

### Pets: approved behavior (both rental flows)

1. One optional question on Rental Essentials: **"Will pets be moving with you?"**
   **Yes / No / Not sure yet.** The whole screen can be skipped.
2. **Yes** makes the existing canonical `features:Pets Allowed` priority
   ("Pet-Friendly") a **Must Have** automatically. The renter is not asked to
   rank it separately (D2). The earlier level is kept so it can be restored, and
   a status line with **Undo** says what changed.
3. **No** and **Not sure yet** create no anti-pet requirement, assign no
   mismatch, and imply nothing about whether pets are prohibited.
4. FLH collects no pet type, breed, size, weight, count or names.
5. There is no separate Pet-Friendly ranking card anywhere in onboarding.
   Review and My Search explain when Pet-Friendly was set to Must Have by the
   pets answer (D8).
6. The answer can be edited later, on Review and in a **Rental Essentials row in
   My Search** (D7). Both use the same safe write function (§7). Any explicit
   manual edit to Pet-Friendly ends FLH's automatic ownership of it (D2 refinement).
7. A Must Have is not an automatic failure. A missing or uncertain pet policy
   is **Unknown**, never **No**. (Verified: this is already how Match works. See §6.)
8. Saved priorities and each co-buyer's own preferences are preserved. Match
   weights and scoring logic do not change.

---

## 2. How renters are onboarded today (three paths)

| | **Live flow (version 1)** | **Unreleased six-step flow (version 3)** | **V3 (version 4, flag off in Prod)** | **Approved spec** |
|---|---|---|---|---|
| Who sees it | Everyone (Production) | Dev preview only | Preview with `FLH_ONBOARDING_V3=on` | — |
| Basics, Home to Rent | Rent, beds, baths, sq ft, **lot size**; Home preferences: **Home type** (House/Townhome/Condo) + **Garage** | Same Basics | Rent, beds, baths, sq ft. Lot size moved to Exterior (unranked). No home type/layout. | Rent, beds, baths, sq ft. Lot size on Exterior **with optional importance**. |
| Property type preset | **Yes**: `applySearchChoice` writes `preferredPropertyTypes = ['house']`, Important | No | No | No (Rental Type removed) |
| Layout for Home to Rent | Not asked (`basicsFieldsFor('home_rent').layout === false`) | Not asked | Not asked | Not asked. The removal is already true in code. |
| Essentials | Chips: Pet-friendly, In-unit laundry, Utilities included, Parking, Central air, Dishwasher | Same chips, first section | Photo/illustration cards for the same six + Off-Street Parking, Storage Unit, Package Room suggestions | **Pets question only.** The other essentials become optional suggestions on later screens (D6). |
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
- **Rental Essentials** shrinks to the single pets question. The former essential
  cards remain available as optional suggestions (D6). The table below lists
  where each one goes.
- The **Home to Buy** flow is unaffected and must stay byte-for-byte the same
  (screens, identities, images, the unranked lot size).

| Former Rental Essential | Home to Rent | Apartment to Rent |
|---|---|---|
| Pet-Friendly | Pets question | Pets question |
| In-Unit Laundry | Rental Features suggestion | The Unit main card |
| Utilities Included | Rental Features suggestion | The Unit suggestion |
| Parking | Off-Street Parking suggestion (its own existing identity, see A7) | Sufficient Parking suggestion (The Property) |
| Central Air | Rental Features main card | The Unit main card |
| Dishwasher | Rental Features suggestion | The Unit suggestion |
| Storage Unit, Package Room (V3 custom suggestions) | Not offered (kept if saved) | Not offered (kept if saved) |

---

## 3. Identity mapping: every approved item against the canonical catalog

Legend:
- **Existing**: a catalog identity. It is reused, so earlier selections, Home Facts answers and both scorers (JS `computeMatch`, SQL `resolve_cobuyer_compare_perspectives`) already line up.
- **Existing custom**: a buyer-owned item V3 already defines (`source: 'custom'`).
- **New custom**: a new buyer-owned Yes/No/Unknown item.
- **How Match answers it**: shared fact = the shared Home Facts field on `homes`; Home Fact = an exact reading in `homeFactCriteria.js`; own Yes/No = each renter's own check (Unknown until answered).
- **Picture**: 📷 founder photo, 🎨 existing FLH illustration, 🔣 icon.

Home to Rent keeps the stored labels V3 and the live flow already use for it (the
purchase-cased `HOME_RENT_CATALOG` identities, e.g. `Home office`). Apartment to Rent
keeps V3's rental-catalog labels (e.g. `Home Office`), resolved by
`resolveDefinition` in `priorityCategories.js`. Card text is set per card, so
wording can change without changing a stored identity. Every rental essential
(Pets Allowed, In-Unit Laundry, Utilities Included, Central Air, Dishwasher) uses
**one** identity in both rental flows. That avoids double scoring if a renter
switches between Home to Rent and Apartment to Rent.

### Home to Rent

| Screen | Card | Stored identity | Status | How Match answers it | Picture |
|---|---|---|---|---|---|
| Layout | First-Floor Bedroom | `features:First-Floor Bedroom` | Existing | Own Yes/No | 📷 `first-floor-bedroom` |
| Layout | Home Office | `features:Home office` | Existing | Own Yes/No | 📷 `home-office` |
| Layout | Finished Basement | `features:Finished basement` | Existing | Home Fact (basement condition), else own Yes/No | 📷 `finished-basement` |
| Layout | Primary Ensuite Bathroom | `features:Primary ensuite` (card text "Primary Ensuite Bathroom") | Existing | Own Yes/No | 📷 `primary-ensuite` |
| Layout (sugg.) | First-Floor Laundry | `features:First-floor laundry` | Existing | Home Fact (laundry location, Yes only), else own Yes/No | 📷 `first-floor-laundry` |
| Layout (sugg.) | Extra Bedroom | `features:Extra Bedroom`. Hint: "An extra bedroom beyond the minimum you entered in Basics." | **New custom** (D3) | Own Yes/No. Never derived from the bedroom count. | 📷 `extra-bedroom` (new) |
| Layout (sugg.) | Front Porch | `exterior:Front porch` | Existing | Own Yes/No | 📷 `front-porch` |
| Rental Features | Kitchen Countertop Seating | `features:Countertop Seating` (card text "Kitchen Countertop Seating") | Existing custom (V3 Kitchen) | Own Yes/No | 📷 `countertop-seating` |
| Rental Features | Stainless Steel Appliances | `features:Stainless Steel Appliances` | Existing | Own Yes/No | 📷 `stainless-appliances` |
| Rental Features | Fireplace | `features:Fireplace` | Existing | Own Yes/No | 📷 `fireplace` |
| Rental Features | Central Air | `features:Central Air` (see A1) | Existing | Own Yes/No | 🔣 `AirVent` |
| Rental Features | Garage | `exterior:Garage` | Existing | Home Fact (`garage_spaces`), else own Yes/No | 🔣 `Warehouse` (see §5) |
| Rental Features (sugg.) | Kitchen Island | `features:Kitchen Island` | Existing | Own Yes/No | 📷 `kitchen-island` |
| Rental Features (sugg.) | High Ceilings | `features:High Ceilings` | Existing | Own Yes/No | 📷 `high-ceilings` |
| Rental Features (sugg.) | In-Unit Laundry | `features:In-Unit Laundry` | Existing | **Shared fact** `homes.in_unit_laundry` | 🎨 `in-unit-laundry` |
| Rental Features (sugg.) | Dishwasher | `features:Dishwasher` | Existing | Own Yes/No | 📷 `dishwasher` (new) |
| Rental Features (sugg.) | Utilities Included | `features:Utilities Included` | Existing | **Shared fact** `homes.utilities_included` | 🔣 `PlugZap` |
| Rental Features (sugg.) | Off-Street Parking | `exterior:Driveway / Off-Street Parking` (card text "Off-Street Parking") | Existing (V3 Essentials suggestion) | Own Yes/No | 🔣 `Car` |
| Exterior | Ideal Lot Size (acres) + optional importance | `lotSizeTarget.value` + `lotSizeTarget.tier` | Existing | Threshold, **only when an importance is chosen** (D4) | n/a (input) |
| Exterior | Deck/Patio | `exterior:Patio / deck` | Existing | Own Yes/No | 📷 `deck-patio` |
| Exterior | Fenced Yard | `exterior:Fenced yard` (see A1) | Existing | Own Yes/No | 📷 `fenced-yard` |
| Exterior (sugg.) | Mature Trees | `location:Mature Trees` | Existing | Own Yes/No | 📷 `mature-trees` |
| Exterior (sugg.) | Pool | `exterior:Pool` | Existing | Own Yes/No | 📷 `pool` (a house's pool, so it fits here) |
| Exterior (sugg.) | Landscaping | `exterior:Landscaping` (kind `check`). Hint: "A well-kept, landscaped yard." | Existing (see A6) | Own Yes/No | 📷 `landscaping` (new) |
| Neighborhood | Low-Traffic Street | `location:Low-Traffic Street` | Existing | Own Yes/No | 📷 `low-traffic-street` |
| Neighborhood | Walkable Neighborhood | `location:Walkable Neighborhood` | Existing (new to renters) | Own Yes/No | 🔣 `Store` |
| Neighborhood (sugg.) | Cul-de-sac | `location:Cul-de-Sac` | Existing | Own Yes/No | 📷 `cul-de-sac` |
| Neighborhood (sugg.) | Parks Nearby | `location:Parks nearby` (**not** `location:Parks Nearby`; see A2) | Existing | Own Yes/No | 📷 `parks-nearby` (new) |
| Neighborhood (sugg.) | Reputable Schools | `location:Reputable Schools` | Existing | Own Yes/No | 🔣 `School`. Do **not** reuse `walkable-to-schools`. |
| Rental Essentials | Pets question → Pet-Friendly | `features:Pets Allowed` (tier written by `setPetsMoving` only) | Existing | **Shared fact** `homes.pets_allowed` (null = Unknown) | 📷 `pet-friendly` (new), shown with the question, not on a ranked card |

### Apartment to Rent

| Screen | Card | Stored identity | Status | How Match answers it | Picture |
|---|---|---|---|---|---|
| The Unit | In-Unit Laundry | `features:In-Unit Laundry` | Existing | **Shared fact** `homes.in_unit_laundry` | 🎨 `in-unit-laundry` |
| The Unit | Home Office Space | `features:Home Office` (card text "Home Office Space") | Existing | Own Yes/No | 📷 `home-office` |
| The Unit | Central Air | `features:Central Air` | Existing | Own Yes/No | 🔣 `AirVent` |
| The Unit (sugg.) | Private Garage | `exterior:Private Garage`. Hint: "A garage for your unit only." | **New custom** (D1) | Own Yes/No only. **Never inferred** from a building's garage count. | 🔣 `Warehouse` |
| The Unit (sugg.) | Outdoor Space | `exterior:Patio / Deck / Outdoor Living` (card text "Private Outdoor Space") (see A4) | Existing (V3 "Balcony / Patio") | Own Yes/No | 📷 `apartment-balcony` (new) |
| The Unit (sugg.) | Dishwasher | `features:Dishwasher` | Existing | Own Yes/No | 📷 `dishwasher` (new) |
| The Unit (sugg.) | Utilities Included | `features:Utilities Included` | Existing | **Shared fact** `homes.utilities_included` | 🔣 `PlugZap` |
| The Property | Fitness Center | `exterior:Fitness Center` | Existing | Own Yes/No | 📷 `fitness-center` (new) |
| The Property | Pool | `exterior:Pool` | Existing | Own Yes/No | 🔣 `Waves`. **Never** the house-pool photo. |
| The Property | Garage Parking | `exterior:Garage` (card text "Garage Parking") | Existing (D1) | Home Fact (`garage_spaces`), else own Yes/No (see M3) | 📷 `apartment-parking-garage` (new; see §11 Q1) |
| The Property (sugg.) | Elevator | `exterior:Elevator` | Existing | Own Yes/No | 📷 `elevator` (new) |
| The Property (sugg.) | Sufficient Parking | `exterior:Parking` (card text "Sufficient Parking") | Existing | Own Yes/No | 📷 `sufficient-parking` (new) |
| The Property (sugg.) | Secure Entry | `exterior:Secure Entry` | Existing | Own Yes/No | 📷 `secure-entry` (new) |
| Rental Essentials | Pets question → Pet-Friendly | `features:Pets Allowed` | Existing | **Shared fact** `homes.pets_allowed` | 📷 `pet-friendly` (new), with the question |

### New custom criteria (complete list)

| Identity | Flow | Why it is not an existing identity | Decision |
|---|---|---|---|
| `features:Extra Bedroom` | Home to Rent | No catalog equivalent. `Guest Bedroom` is the removed item, and the bedroom *count* is a separate Basics threshold. The two never write each other. | D3 |
| `exterior:Private Garage` | Apartment | Unit-level private garage access. It stays separate from the building-level `exterior:Garage` ("Garage Parking"), which `garage_spaces` answers. | D1 |

`features:Countertop Seating` is already a V3 custom suggestion and is reused, not
re-created. Every other approved item, including the D6 suggestions, maps to an
existing identity. No new catalog identity, `constants.js` catalog entry,
database column or SQL change is needed.

Like every V3 custom item, the new ones are stored as `{ label, kind: 'check',
source: 'custom', group }` in the participant's own `customItems`. They are
answered Yes / No / Unknown by each renter, never inferred, and Unknown is never
scored. The SQL scorer iterates the participant's `tiers`, so it scores them
identically (PR #181 already proves JS = SQL for custom items).

---

## 4. Duplicate and ambiguous identities (resolved)

| # | Issue | Resolution (approved) |
|---|---|---|
| **A1** | **Case-variant pairs in rental documents:** `features:Central Air` / `Central air`, `exterior:Fenced Yard` / `Fenced yard`, `features:Home Office` / `Home office`. The purchase alias fold runs only for purchase searches, so a document with both variants selected is **scored twice** (JS and SQL both iterate per key). | Each card writes exactly one identity (§3). V3 dedupe (`normalizeFeatureKey`) already stops typed duplicates. The implementation adds a guard: a card is shown as already chosen if *either* case variant is selected, and choosing a level then updates the variant **already stored**, never adds the other. Existing duplicates are counted read-only in Stage 0 (§9). Merging any found is a separate, founder-reviewed data task. |
| **A2** | **Parks Nearby** exists as `location:Parks nearby` (check) and `location:Parks Nearby` (rental catalog, **rating**, not a tour criterion, so it can never be evaluated). | Use `location:Parks nearby`. The rating identity is never offered or created by onboarding (A8). |
| **A3** | **Extra Bedroom** vs Bedrooms count vs removed Guest Bedroom. | Keep (D3): its own Yes/No, described as "beyond the minimum you entered in Basics". It never changes `bedsMin`, and `bedsMin` never answers it. |
| **A4** | **Outdoor Space**: `exterior:Outdoor Space` is an after-tour rating. | The Unit's "Outdoor Space" is `exterior:Patio / Deck / Outdoor Living` (pre-tour Yes/No). The after-tour rating stays out of onboarding and is kept for existing users. |
| **A5** | **Two garage concepts for apartments.** | Two identities (D1): `exterior:Private Garage` (unit, renter-evaluated, never inferred) and `exterior:Garage` shown as "Garage Parking" (building). |
| **A6** | **Landscaping** is vague as a Yes/No. It is a *rating* in the investment catalog. | Keep `exterior:Landscaping` with kind `check` (as `HOME_RENT_CATALOG` stores it) and the hint "A well-kept, landscaped yard." |
| **A7** | **Parking concepts.** `exterior:Parking` (Sufficient Parking, apartments), `exterior:Driveway / Off-Street Parking` (Off-Street Parking, Home to Rent) and `exterior:Garage` are three existing identities. Each is answered from its own source and none infers another, which matches the established rental rule (`docs/onboarding-v2-rental.md`). | No two cards in one flow share an identity, so nothing is double-scored. A renter who chose Parking earlier keeps it. On Home to Rent it shows under "More of your priorities". |
| **A8** | **Add-your-own can select an unanswerable identity.** Typing "Walkability", "Groceries Nearby" or "Dog Parks Nearby" matches a rental-catalog rating that is not a tour criterion and can never be evaluated. | `catalogMatches` excludes, for rental searches, catalog items that are neither Yes/No nor tour criteria (`!isYesNoCriterion && !isExperientialCriterion`). Typed text then becomes a Yes/No custom item or matches an offered card. This is a dedupe change, not a Match change. Existing selections are untouched. |
| **A9** | `Mature Trees` is stored under Location but shown on Exterior. | Presentation only, as in V3 today. |

---

## 5. Photo inventory (current `main`)

All 11 new founder uploads were checked on `main` (`c18f837`,
`public/images/onboarding/`) and viewed in a contact sheet. **Nothing is
invented, generated as a photo, or fetched from listings.** In implementation they
go through the existing pipeline: the explicit manifest in
`src/lib/onboardingImages.js` and 400w/800w card derivatives made by
`scripts/visual/onboarding-card-images.mjs`. The originals are kept untouched.

| Upload | Size | Subject (as viewed) | Card(s) |
|---|---|---|---|
| `extra-bedroom.webp` | 679×451 | Bright room with a reading chair and built-in cabinetry | Extra Bedroom (Home to Rent) |
| `landscaping.webp` | 1024×681 | Landscaped garden with flowering shrubs and lawn | Landscaping (Home to Rent) |
| `parks-nearby.webp` | 678×452 | Park path with autumn trees | Parks Nearby (Home to Rent) |
| `fitness-center.webp` | 547×365 | Residential fitness room | Fitness Center (Apartment) |
| `elevator.webp` | 554×361 | Elevator doors in a hallway | Elevator (Apartment) |
| `secure-entry.webp` | 547×365 | Gated community entrance | Secure Entry (Apartment) |
| `sufficient-parking.webp` | 678×452 | Aerial view of an apartment complex parking lot | Sufficient Parking (Apartment) |
| `dishwasher.webp` | 738×411 | Open dishwasher in a kitchen | Dishwasher (both rental flows). Replaces the FLH illustration. |
| `apartment-balcony.webp` | 610×327 | Apartment living room opening onto a balcony | Outdoor Space (Apartment) |
| `apartment-parking-garage.webp` | 546×366 | Apartment building with ground-floor garage doors | Garage Parking (Apartment). See §11 Q1. |
| `pet-friendly.webp` | 1024×683 | Cat resting on a bed | The Rental Essentials pets **question** (not a ranked card). Replaces the FLH illustration. |

**Manifest keys to add in implementation** (key → file): `extra-bedroom`,
`landscaping`, `parks-nearby`, `fitness-center`, `elevator`, `secure-entry`,
`sufficient-parking`, `dishwasher`, `apartment-balcony`,
`apartment-parking-garage`, `pet-friendly`. `dishwasher` and `pet-friendly` then
leave `ONBOARDING_ILLUSTRATIONS`, and the matching FLH SVGs leave
`scripts/visual/feature-art.mjs`, the same way PR #181 retired illustrations
replaced by photos. The existing test that every upload is used and every
manifest file exists covers the new entries.

**Apartment cards never use house photography.** The apartment Outdoor Space card
uses `apartment-balcony` (not `deck-patio`). The apartment Pool card uses an icon
(not `pool`). Home to Rent keeps `deck-patio` and `pool`.

**Still icon-only** (missing or abstract, per D5): Central Air (`AirVent`),
Home to Rent Garage (`Warehouse`), Private Garage (`Warehouse`), Walkable
Neighborhood (`Store`), Reputable Schools (`School`), Utilities Included
(`PlugZap`), Off-Street Parking (`Car`), apartment Pool (`Waves`). In-Unit Laundry
keeps its existing FLH illustration. Adding a photo later is one manifest line plus
re-running the derivative script.

**Known limitation:** nine of the new uploads are narrower than 800 px, so their 800w
derivative is an upscale. This is the same limitation documented in PR #181,
and no worse than the browser scaling the 400w. `apartment-balcony` is wide
(about 1.87:1), so its 4:3 centre crop must be checked in the contact sheet during
implementation.

---

## 6. Match: findings and how each is handled

Match weights (4 / 2 / 1), algorithms and Unknown semantics are **not changed**
(JS `computeMatch` and SQL `resolve_cobuyer_compare_perspectives`).

| # | Finding | Status |
|---|---|---|
| **M0** | **Pet-Friendly Must Have with an unknown pet policy.** JS reads `homes.pets_allowed` (`SHARED_BOOLEAN_FACT_FIELDS`): `true` = Yes, `false` = No, `null` = not evaluated. SQL (`2026-11-02-home-facts-match-parity.sql`, around line 275) skips a null value as unevaluated. The Must-Have summary reports "N Must-Haves still unknown", not a miss. | ✅ Correct today. Pinned by new JS and SQL tests (§9 Stage 2). |
| **M1** | **Ideal Lot Size** defaulted to tier `dontcare` and was never scored from onboarding. | Resolved by D4 for Home to Rent: the optional importance writes the existing `lotSizeTarget.tier`. With no importance chosen, the tier stays `dontcare` and Match ignores the acreage, exactly as today. Home to Buy is unchanged. |
| **M2** | A rating-kind Parks Nearby would never be evaluated. | Resolved (A2). |
| **M3** | `exterior:Garage` reads `garage_spaces` for every search type. A building's garage count could otherwise mark a private garage Yes. | Resolved by D1: Private Garage is a custom item that is never inferred. Garage Parking (building level) keeps `exterior:Garage` and its Home Fact. |
| **M4** | Outdoor Space as an after-tour rating would be unanswerable before a tour. | Resolved (A4). |
| **M5** | Double counting from case-variant duplicates already in rental documents. | No new duplicates (A1 guard). Existing ones are counted read-only in Stage 0. Nothing is rewritten without review. |
| **M6** | Add-your-own reaching unanswerable rating identities. | Resolved (A8). |
| **M7** | Live-flow Home to Rent documents carry `preferredPropertyTypes = ['house']` at Important. | Preserved as saved. Shown read-only under "Saved from earlier" and editable in My Search. Out of scope. |
| **M8** | The pets **answer** (Yes / No / Not sure) is not a Match input. Only the Pet-Friendly tier it sets is, and No / Not sure write nothing Match reads. | ✅ By design. |
| **M9** | D6 adds **In-Unit Laundry** and **Utilities Included** as Home to Rent suggestions. Both are shared facts on the home (one answer per property, visible to co-buyers), as they already are for every rental search. | ✅ Same identities and fields as today. No new scoring path. |

---

## 7. Pets: storage, provenance and synchronization

### Where the answer lives

In the **participant's own priorities document** (`search_member_priorities`,
one row per member per search), inside `features`, next to the criterion it
drives. This follows the `exterior.garagePreference` precedent:

```jsonc
"features": {
  "customItems": [ … ], "tiers": { "Pets Allowed": "must", … },
  "petsMoving": "yes",               // 'yes' | 'no' | 'not_sure'; absent = not answered / skipped
  "petsAuto": {                      // present only while FLH owns the Must Have
    "previousTier": null,            // the level before Yes (null = not selected)
    "setAt": "2026-11-14T…Z"
  }
}
```

- **Co-buyers stay independent.** Each member has their own document. One
  co-renter's answer never changes another's priorities. The shared fact
  `homes.pets_allowed` (the property's policy) is never written by this feature.
- **Per search, not per profile.** `profiles.onboarding_state` is per person and
  is normalized on read (unknown keys dropped), so it is not used.
- **No migration.** `normalizePriorities` keeps unknown keys inside `features`.
  The SQL scorer reads only `features.tiers`. Both additive keys are invisible
  to Match in JS and SQL.
- **Privacy.** Only a three-way answer and a provenance marker are stored. Neither
  is written to `homes`, shown to a co-buyer, or sent to an import or AI provider.
  Both sit under the existing row-level security (own row only).

### The one write path for the answer: `setPetsMoving(priorities, answer)`

| Answer | Writes |
|---|---|
| **Yes** | `petsMoving = 'yes'`. If Pet-Friendly is already Must Have and **no** `petsAuto` exists, the Must Have is the renter's own choice: nothing else changes and no marker is set. Otherwise, record `petsAuto.previousTier` (current level, or `null`) and set the tier to `must`, **promoting the item into `customItems` exactly as `addCriterion` does** but through this function's own internal write, so it is not treated as a manual edit. |
| **No / Not sure yet** | `petsMoving = 'no' / 'not_sure'`. **Only if `petsAuto` is present**, restore `previousTier` (`null` → `dontcare`, the existing "not selected" state) and remove `petsAuto`. With no marker, Pet-Friendly is not touched. |
| **Skip / not answered** | Nothing is written. A previous answer stays. |

**Never written in any case:** a `'no'` on any home, an anti-pet or "No Pets"
criterion, `homes.pets_allowed`, or any other priority.

Every call returns `{ priorities, change }`. `change` is `'set_must'`,
`'restored'` or `null`. The screen uses it for the status line ("Pet-Friendly
is now a Must Have." / "Pet-Friendly is back to Important.") with **Undo**. Undo
restores the exact snapshot of `features.tiers['Pets Allowed']`, `customItems`,
`petsMoving` and `petsAuto` taken before the call.

### Manual edits clear automatic ownership (D2 refinement)

Provenance does **not** rely on the tier still equalling Must Have. Any explicit
manual edit to Pet-Friendly's level removes `petsAuto`, so FLH never again
changes that level on the renter's behalf.

These are the existing user-facing tier writes (audited on `main`). Each gets one
shared helper, `clearPetsAuto(catState, categoryKey, label)`, which drops
`petsAuto` when the key is `features:Pets Allowed`:

| Write path | Used by | Change |
|---|---|---|
| `moveCriterion` (`src/lib/searchProfile.js`) | My Search ranking (`RankPrioritiesEditor` → `RankBoard`), V3 importance sheet (`setFeatureLevel`), Home preferences, garage helpers | Call `clearPetsAuto` |
| `addCriterion` → `selectPriorityItem` (`src/lib/matching.js`) | Adding a priority anywhere (My Search, onboarding, `toggleCriterion`) | Call `clearPetsAuto` in `addCriterion`. `selectPriorityItem` stays unchanged because Match imports it. |
| `CriteriaPicker.jsx` `setTier` / add (direct `tiers` write) | **Not imported by any screen on `main`** (dead code) | No change now. If it is ever reused, route it through `moveCriterion` / `addCriterion`. A test pins that nothing imports it. |
| `applyOnboardingSelections` (`src/lib/onboarding.js`) | Live flow 1 only (no pets question) | None needed: flow 1 never sets `petsAuto`. A test still pins that a flow-1 write clears it. |

**System writes keep provenance:** `setPetsMoving` itself, the search-type switch
(below), and Undo. A contract test drives every user-facing path above and asserts
`petsAuto` is gone afterwards. It also asserts no other `features` key changes.

Required test, as specified by the founder: **Yes → manual Important → manual
Must → No**. Yes sets Must with `petsAuto {previousTier: null}`. The manual
Important clears `petsAuto`. The manual Must is the renter's own. No then
changes **nothing** about Pet-Friendly: it stays Must Have, and only
`petsMoving = 'no'` is stored. The screen says "Pet-Friendly stays a Must Have
because you set it yourself."

### Search-type switches

- **Rental ↔ rental** (Home to Rent ↔ Apartment to Rent). The existing
  `switchSearchType` clears curated tiers and re-adds the ones still offered
  through `addCriterion`. That would clear `petsAuto` as if it were a manual edit.
  `switchPrioritySearchType` therefore snapshots `petsMoving` and `petsAuto`
  before the switch and restores them after it. Pet-Friendly keeps its level and
  its provenance.
- **Rental → Home to Buy.** Pet-Friendly is removed as today (listed under
  "removed", with Undo). `petsMoving` and `petsAuto` are cleared in the same switch,
  so a later return to renting shows the question unanswered. Undo restores all
  three together.
- **Home to Buy → rental.** Nothing pet-related is written. The question is unanswered.

### Co-buyers

Tests cover all of these:
- Renter A answers Yes, so A's Pet-Friendly is Must Have. Renter B's document is byte-identical before and after.
- Each member's Match uses their own tier with the shared `pets_allowed` fact. JS = SQL for both, with `pets_allowed` null (Unknown for A's Must Have) / true / false.
- A's manual edit and B's later Yes are independent.
- A shared-setup co-buyer runs the same V3 flow on their own row.

### Where the answer and its provenance are shown (D7, D8)

- **Rental Essentials screen and Review:** the three choices. Review reads "Pets
  moving with you: Yes · Pet-Friendly is a Must Have because of this answer", or
  "…you set this yourself" without `petsAuto`. Editing returns to the question.
  Pet-Friendly is **not** repeated as a card or under "More of your priorities".
  `otherChosenPriorities` excludes `features:Pets Allowed` for rental searches,
  as it already excludes `exterior:Garage`.
- **My Search (D7):** a **Rental Essentials** row for rental searches shows the
  answer with the same three choices and calls `setPetsMoving`. On the ranking
  board Pet-Friendly stays one ordinary, re-rankable priority (no duplicate card).
  While `petsAuto` is present it carries the note **"Must Have because pets are
  moving with you"** (D8). Re-ranking it is a manual edit and clears the note.

### Existing renters

A renter who already chose Pet-Friendly keeps it exactly, and their `petsMoving`
is unanswered. If they later answer Yes, an existing Important becomes Must Have
with `previousTier: 'important'`, so No / Not sure restores Important unless they
edit it by hand in between.

---

## 8. Preserving historical values

Nothing is deleted, renamed or migrated. Items removed from the new onboarding
remain:

- in each person's stored document at their saved level, and **still counted in
  Match** (rental searches have no retired-built-in filter);
- visible and editable on V3 Review under **"More of your priorities"**
  (`otherChosenPriorities`) and in My Search;
- offered for new selection in My Search where they are today. This spec removes
  them from onboarding only.

This covers:
- Guest Bedroom, Large Backyard, Privacy Fencing;
- Walkable Schools, Near Water, Bustling Street, Walkable to Town, Quiet Street;
- Updated Interior, Outdoor Space (rating), Quiet Community (`exterior:Noise Level`), Privacy (`homeFeel:Privacy`);
- Parking for Home to Rent, Storage Unit, Package Room;
- every V3 Kitchen / Living / Bath / Garage item not listed in §3;
- Dead-End Street.

**Rental Type** values (`preferredPropertyTypes`) and **Layout** values
(`homeLayout`, `features:First-Floor Primary`) stay saved, are shown read-only
under "Saved from earlier", and remain asked about **homes** in Add Home / Home
Facts (`HomeModal`, `HomeFacts`). A saved `exterior.garagePreference`
(attached/detached) is kept, although Home to Rent no longer asks it. A saved
`lotSizeTarget.tier` is shown as the chosen importance.

---

## 9. Staged implementation plan

Rules for every stage:
- Rental onboarding stays **behind `FLH_ONBOARDING_V3`, off by default**.
- Live flow 1, the six-step preview (flow 3) and Home to Buy in V3 do not change.
  The live-flow screenshot regression must show **0 pixels changed**, and the V3
  buyer screens must be identical.
- No change to `src/lib/matching.js` scoring, `src/lib/homeFactCriteria.js`, any SQL
  function or migration, `constants.js` catalogs or weights, Add Home / Home
  Facts, Floor Plans, PR #166, or Production flags.
- No data writes or migration without founder review.

### Stage 0: read-only data count (stop for review)

Counts only, run by the founder or an operator with read access. Output is
aggregate numbers, with no user IDs or document contents. Rental documents are
those where `priorities->>'searchType'` is `rental`, `rent_home` or
`rent_apartment`. "Selected" means the tier is `must`, `important` or `nice`.

```sql
-- READ ONLY. Aggregate counts; returns no user data.
with rental as (
  select id, priorities p from public.search_member_priorities
  where priorities->>'searchType' in ('rental','rent_home','rent_apartment')
), sel as (
  select id, p, cat, label from rental,
    lateral (values ('location'),('features'),('exterior'),('homeFeel')) c(cat),
    lateral jsonb_each_text(coalesce(p #> array[cat,'tiers'], '{}'::jsonb)) t(label, tier)
  where t.tier in ('must','important','nice')
)
select 'rental documents' metric, count(*) n from rental
union all select 'case-variant duplicate pairs', count(*) from (
  select id, cat, lower(label) from sel group by id, cat, lower(label) having count(*) > 1) d
union all select 'docs with any case-variant duplicate', count(distinct id) from (
  select id from sel group by id, cat, lower(label) having count(*) > 1) d
union all select 'location:Parks Nearby (rating) selected', count(*) from sel where cat='location' and label='Parks Nearby'
union all select 'exterior:Outdoor Space (after-tour) selected', count(*) from sel where cat='exterior' and label='Outdoor Space'
union all select 'unanswerable rental ratings selected (Walkability, Groceries/Dog Parks/Restaurants Nearby, Parks Nearby)', count(*) from sel
  where cat='location' and label in ('Walkability','Parks Nearby','Dog Parks Nearby','Groceries Nearby','Restaurants / Coffee / Shopping Nearby')
union all select 'features:Pets Allowed selected', count(*) from sel where cat='features' and label='Pets Allowed';
```

The query was checked under `default_transaction_read_only=on` against a local
Postgres 16 with sample rows (a case-variant pair, a `dontcare` variant that must
not count, a purchase document that must be excluded). It returned the expected
counts. The findings go into this document. Any cleanup is proposed separately and reviewed first.

### Stage 1: catalog, identities and images (pure logic, behind the flag)

- `src/lib/priorityCategories.js`:
  - Add rental categories using the existing `only` mechanism: `cat_rent_layout` and `cat_rent_features` (Home to Rent), `cat_apt_unit` and `cat_apt_property` (Apartment).
  - Restrict `exterior` and `neighborhood` to the Home to Rent lists for renters. Buyer lists stay byte-identical.
  - Add `Extra Bedroom` and `Private Garage` as `custom: true` with their hints.
  - Add the A1 case-variant guard and the A8 `catalogMatches` filter.
  - Make the essentials screen a question screen with no cards.
- `src/lib/onboardingFlow.js`, flow 4 steps per search type:
  - Buy: unchanged.
  - Home to Rent: `search_type, basics, locations, cat_essentials, cat_rent_layout, cat_rent_features, cat_exterior, cat_neighborhood, review`.
  - Apartment: `search_type, basics, locations, cat_essentials, cat_apt_unit, cat_apt_property, review`.

  Preview sessions on a step that no longer applies resume at the first unfinished step (`resumeOnboardingStep`).
- `src/lib/onboardingImages.js`: the 11 manifest entries (§5). Generate derivatives with the existing script, after a contact-sheet crop check. Retire the `dishwasher` and `pet-friendly` illustrations.
- Tests:
  - Exact screen order and contents per rental type, with buyer screens unchanged.
  - Every card's stored identity (§3).
  - D6 suggestions are optional and unselected. No two cards in one flow share an identity.
  - A1, A2, A4, A5 and A8.
  - Removed items are absent from onboarding but kept and counted when saved.
  - The image manifest is complete, and apartment cards never use `pool` or `deck-patio`.

### Stage 2: pets write path and provenance (pure logic)

- `src/lib/rentalPets.js` (new): `PETS_ANSWERS`, `petsMovingAnswer`,
  `setPetsMoving`, `clearPetsAuto`, and snapshot/restore for search-type switches.
- Wire `clearPetsAuto` into `moveCriterion` and `addCriterion` (§7). `selectPriorityItem` and Match are unchanged.
- `switchPrioritySearchType`: rental↔rental keeps pets state. Rental→buy clears it, with Undo.
- Tests (`test/rental-pets-onboarding.test.js`):
  - Every row of §7, including **Yes → manual Important → manual Must → No**.
  - An existing Important → Yes → No restores Important.
  - Skip writes nothing. Undo is exact. Nothing writes `'no'` or anti-pet data.
  - The contract test over every manual write path.
  - Switch cases: rent→apartment→rent and rent→buy→Undo.
  - Co-buyer independence.
- Real-Postgres test (extend `test/mobile-priority-onboarding-v3-db.test.js`):
  JS = SQL for rental documents, with Pet-Friendly Must Have and `pets_allowed`
  null / true / false (null stays Unknown). Additive `petsMoving` / `petsAuto`
  round-trip and do not change either score. Co-renters are independent.

### Stage 3: onboarding UI (behind the flag)

- `PetsQuestion` (three radio buttons, `pet-friendly` photo, status line with Undo)
  on the essentials screen, in the same frame (Back · Skip · Continue).
- Home to Rent Exterior: the lot-size field gets an optional importance control
  (D4) reusing the importance sheet: Must Have / Important / Nice to Have /
  Not important. It is enabled once acreage is entered and writes
  `lotSizeTarget.tier`. No importance means `dontcare`, so the acreage is not in
  Match. Home to Buy keeps today's unranked field.
- Review: the pets answer with provenance. The lot size shows with its importance.
  Pet-Friendly is not duplicated.
- QA (`scripts/qa/mobile-priority-onboarding-v3-qa.mjs`): both rental flows at
  375 / 390 / 430, desktop and 200% zoom; keyboard; image fallbacks; only
  derivatives fetched. Live-flow regression shows 0 pixels changed.

### Stage 4: My Search (D7, D8)

- A Rental Essentials row for rental searches, calling `setPetsMoving`.
- The provenance note on Pet-Friendly while `petsAuto` is present.
- Tests and QA for both. No Pet-Friendly duplicate on the board.

### Stage 5: docs and founder Preview QA (stop for review)

Update `docs/mobile-priority-onboarding-v3.md` and this document, with
screenshots. The founder tests on a Preview with `FLH_ONBOARDING_V3=on`. The flag
stays off in Production until the founder decides otherwise.

---

## 10. Founder decisions (approved)

| # | Decision |
|---|---|
| **D1** | **Two garage identities.** Private Garage (`exterior:Private Garage`) is a unit-level, renter-evaluated priority. Garage Parking (`exterior:Garage`) is a building-level preference. Private garage access is never inferred from a building's garage count. |
| **D2** | **Automatic Pet-Friendly Must Have** when pets are moving. The prior level is preserved, with clear status and Undo. **Any explicit manual edit clears automatic ownership.** Provenance never relies on the tier equalling Must Have. Tested: Yes → manual Important → manual Must → No, search-type switches, and co-buyers. |
| **D3** | **Keep Extra Bedroom**, described as an extra bedroom beyond the minimum entered in Basics, separate from the numeric bedrooms threshold. |
| **D4** | **Rankable Ideal Lot Size for Home to Rent.** Acreage with an optional Must Have / Important / Nice to Have. With no importance it is not in Match. Home to Buy is unchanged. |
| **D5** | **Use the founder's rental photography** (11 uploads, §5) through the existing pipeline and manifest. `pet-friendly.webp` goes with the pets question, not a ranked card. Icons for missing or abstract choices. No invented photos and no house-pool photo for apartment amenities. |
| **D6** | **Former rental basics become optional suggestions.** Home to Rent Rental Features adds In-Unit Laundry, Dishwasher, Utilities Included and Off-Street Parking. Apartment The Unit adds Utilities Included. No extra screens, nothing mandatory, and canonical answerable identities with no double scoring. |
| **D7** | **Pets answer editable after onboarding.** A Rental Essentials row in My Search uses the same write function. Review stays editable. |
| **D8** | **Show provenance** when Pet-Friendly is Must Have because of the pets answer. No duplicate Pet-Friendly ranking card. |

---

## 11. Small confirmations for implementation review (non-blocking)

| # | Item | Default if not changed |
|---|---|---|
| **Q1** | `apartment-parking-garage.webp` shows **ground-floor garage doors** on an apartment building. Some viewers may read that as private garages. | Use it for **Garage Parking**, as its filename says. Private Garage keeps the icon. Swap only if the founder prefers. |
| **Q2** | `extra-bedroom.webp` shows a reading chair and built-ins rather than a bed. | Use as supplied. The card label and hint carry the meaning. |
| **Q3** | Card wording: "Private Outdoor Space" (apartment), "Garage Parking", "Private Garage", "Off-Street Parking", and the hints in §3. | Use as written. |

---

## 12. Scope of this change

- Edits this document only. PR #182 stays documentation-only.
- No change to live onboarding, V3 code, the database, Match scoring, images,
  flags, Floor Plans or PR #166. Draft PR for founder review. Not merged or deployed.
