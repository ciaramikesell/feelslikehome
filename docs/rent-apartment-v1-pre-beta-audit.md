# V1 pre-beta rent / apartment product and architecture audit

**Audit date:** 2026-09-09  
**Scope:** repository state on the current branch; application, schema, and tests inspected.  
**Constraint:** audit artifact only. No runtime code, database object, migration, or UI was changed.

## 1. Executive summary

1. Rental support is real but narrow. Both rental modes use rental-aware budget/price labels, `/mo` on Home cards, and the rental RentCast endpoint. Apartment mode additionally substitutes apartment criteria and hides lot, layout, and condition questions (`src/lib/constants.js`, `src/components/onboarding/Onboarding.jsx`, `src/components/HomesBoard.jsx`, `src/components/HomeModal.jsx`, `src/app/api/import-listing/route.js`).
2. `searchType` is not a relational column or database enum. It is an unconstrained string inside each participant's `priorities` JSONB document. The recognized runtime values are `buy`, `rent_home`, `rent_apartment`, and `investment` (`src/lib/constants.js:213-217`; `supabase/schema.sql:36-43,168-186,325-333`).
3. Home-to-rent and apartment-to-rent are mutually exclusive presentation modes, but not distinct domain models. They share the same search, home, lifecycle, Match, Compare, map, commute, and collaboration infrastructure. Their meaningful differences are onboarding/My Search visibility and curated criteria (`src/lib/constants.js:100-180,226-248`).
4. Homes do **not** store property type or unit number. A search cannot explicitly express a mixed set of apartment/house/townhome/condo types, and a home cannot identify which it is. Apartment-ness is inferred only from the participant's search mode when choosing criteria/UI, not recorded on the home (`src/lib/constants.js:120-180`; `supabase/schema.sql:66-126`).
5. Match is mostly search-type-agnostic and already has true/false/unknown semantics for check criteria. A custom `Dogs allowed` check can be a Must Have and score correctly if explicitly answered Yes/No. Unknown is excluded from the denominator. A false Must Have lowers the weighted percentage and appears as a confirmed mismatch; there is no separate disqualification state (`src/lib/matching.js:165-193,195-350`).
6. The most serious rental leaks are not structural: `est_monthly` and “Estimated monthly payment” remain visible/editable for rentals; Compare calls rent “Price,” computes `$ / sq ft`, and shows lot/garage/year/DOM/HOA/property tax; Detail and Map omit `/mo`; and listing-text parsing sends `$X/mo` to `estMonthly` rather than rental `price` (`src/components/HomeModal.jsx:79-131`; `src/components/CompareBoard.jsx:26-40,131`; `src/components/HomeDetail.jsx:123-135`; `src/components/SavedHomesMap.jsx:90-96`; `src/lib/matching.js:120-150`).
7. **Recommendation:** approve Model B, one canonical Rent journey, but deliver it additively. Stop new writes of `rent_apartment`, continue reading it through a compatibility normalizer, add first-class per-home `property_type`, and preserve all JSON priorities and homes. Do not mass-reclassify legacy apartment homes unless product accepts an explicit, conservative backfill rule.
8. Lean beta should include base monthly rent, property type, correct rental formatting/copy, and a curated rental priority bank. Availability date is the only other plausible first-class V1 fact; lease details, fee matrices, detailed pet restrictions, and amenity catalogs should be deferred or handled by custom criteria/notes.

## 2–4. Current rental experiences and exact differences

### Shared onboarding flow

| Stage | Both rental modes |
|---|---|
| Step 1 | Choice chips under “What are you searching for?”; rental budget copy is **Maximum Monthly Rent** with placeholder `2,200`; asks minimum square footage, bedrooms, bathrooms; everything is skippable (`src/components/onboarding/Onboarding.jsx:62-85,114-172`; `src/lib/constants.js:266-272`). |
| Step 2 | “What matters most to you?”; Schools relevance gate; Location, Home Features, Exterior & Property, Home Feel; selected priorities use Must have / Important / Nice to have; nothing is required (`src/components/onboarding/Onboarding.jsx:178-219`). |
| Step 3 | Identical generic copy: bring a listing from Zillow, Realtor.com, “a builder website,” or elsewhere; CTA “Add my first home” (`src/components/onboarding/Onboarding.jsx:249-264`). |
| Persistence | The complete normalized priorities object is saved to the participant-specific priority document. Owners retain a legacy copy in `searches.priorities`; member/owner current storage is `search_member_priorities.priorities` (`src/components/onboarding/Onboarding.jsx:269-284`; `src/lib/supabase/collaboration.js:93-148`; `supabase/schema.sql:325-359`). |

Default objective tiers are budget Important, beds Important, square footage Nice, baths Nice, and lot/layout/condition/bedroom-placement Don't care. Item-list criteria are available but not selected by default; selecting one assigns Important (`src/lib/constants.js:280-328`; `src/components/PriorityBoard.jsx:62-85`). “Core” means always offered, **not selected by default**.

### Home to rent (`rent_home`)

- Step 1 shows Home Condition, Preferred Home Layout, bedroom sub-preferences via layout, and Minimum Lot Size. This is effectively the buy-home basics set with rental price terminology (`src/components/onboarding/Onboarding.jsx:63-67,133-166`; `src/lib/constants.js:231-248`).
- Location: Schools (check), Commute and Neighborhood (ratings), plus Walkability, Immediate Street / Surroundings, Parks Nearby, Proximity to Family / Friends, Dog Parks Nearby, Groceries Nearby, Restaurants / Coffee / Shopping Nearby (`src/lib/constants.js:13-23,125-135`).
- Home Features: core Basement, Fireplace, Primary Ensuite; suggestions Central Air, Home Office, Finished Basement, Walkout Basement, First-Floor Laundry, Mudroom, Pantry, Storage, Updated Kitchen, Updated Bathrooms, Walk-In Closet, Additional Living Space, Guest / In-Law Suite, Basement Bedroom, plus rental-only Pet Policy and In-Unit Laundry (`src/lib/constants.js:35-37,138-151`).
- Exterior & Property: core Yard, Garage, Privacy; suggestions Fenced Yard, Sidewalks, Exterior Condition, Landscaping, Patio / Deck / Outdoor Living, Attached Garage, Driveway / Off-Street Parking, plus rental-only Parking (`src/lib/constants.js:28-33,157-166`).
- Home Feel: Overall Condition and Layout / Flow, shared suggestions, plus rental-only Maintenance Responsibility and Lease Terms, both rating-kind (`src/lib/constants.js:25-26,168-178`). Treating lease terms and maintenance responsibility as post-tour-like ratings is conceptually weak: they are listing/contract facts, not feelings.

### Apartment to rent (`rent_apartment`)

- Step 1 hides lot size, Home Layout, bedroom placement, and Home Condition. It retains rent, square footage, beds, and baths (`src/components/onboarding/Onboarding.jsx:63-66,114-166`; `src/lib/constants.js:231-248`).
- Location is shared, plus apartment-only **Floor / Location in Building** as a check (`src/lib/constants.js:125-135`).
- Home Features is replaced: core In-Unit Laundry, Pet Policy, Utilities Included; suggested Pet Rent / Fees, Building Amenities, Storage, Central Air, Updated Kitchen, Updated Bathrooms, Walk-In Closet (`src/lib/constants.js:100-103,138-156`).
- Exterior & Property is replaced: core Parking (check), Outdoor Space (rating), Privacy (rating); suggestions Noise Level (rating), Elevator (check) (`src/lib/constants.js:100-103,153-157`).
- Home Feel is shared but does **not** include Home-to-rent's Maintenance Responsibility or Lease Terms (`src/lib/constants.js:168-178`).

### Difference verdict

The two modes differ meaningfully in questions and priority vocabulary, but not in entities or workflows. Apartment mode is a UI/criteria preset. Home-to-rent contains numerous house/purchase-oriented concepts (lot, home condition, layout, basement, fireplace, ensuite, yard, garage), while apartment mode has actual rental criteria absent from home-rent (utilities, fees, building amenities, elevator, floor). This asymmetry—not a domain requirement—is the principal current reason they behave differently.

## 5. Search-type architecture

| Question | Finding |
|---|---|
| Storage | `priorities.searchType` in JSONB, now participant-private in `search_member_priorities`; owner fallback remains `searches.priorities` (`src/lib/supabase/collaboration.js:93-148`; `supabase/schema.sql:36-43,325-359`). |
| Values | `buy`, `rent_home`, `rent_apartment`, `investment` (`src/lib/constants.js:213-217`). |
| DB restriction | None on the JSON value. `priorities` is merely non-null JSONB; there is no JSON-schema/check constraint (`supabase/schema.sql:36-43,325-333`). |
| Can it change later? | Not through My Search: the summary displays the label, but edit mode does not render search-type chips. It can only be selected/toggled during onboarding or changed outside current UI (`src/components/MySearchPanel.jsx:143-205`; `src/components/onboarding/Onboarding.jsx:73-81`). |
| Conditional runtime behavior | Option label/terminology; rental classification; apartment “simple rental” visibility; home layout/condition visibility; criteria catalog; `/mo` on cards; rental vs sale import endpoint (`src/lib/constants.js:120-180,213-272`; `src/components/HomesBoard.jsx:143-145`; `src/components/HomeModal.jsx:297-313`). |
| Permanent/exclusive assumption | A single scalar selects exactly one catalog and import mode. Existing priorities may still contain labels from a prior mode, but only labels known to the current catalog/custom list participate. There is no multi-property-type structure (`src/lib/constants.js:120-180`; `src/lib/matching.js:272-323`). |
| Per-home property type | Absent (`supabase/schema.sql:66-126`; `src/lib/constants.js:287-308`). |
| Mixed rental search today | Homes of any physical type can be saved and compared because rows are generic, but they are indistinguishable by type. Under `rent_home`, apartment criteria are unavailable except as custom checks; under `rent_apartment`, house fields/criteria are hidden. No structural crash is expected, but fit and display are incomplete/misleading. |

All four flows share onboarding shell, objective priorities, persistence, add/edit, cards, detail, lifecycle, map, commute, Match, Compare, and privacy. Investment alone adds investment property types and living plan. Buy and home-rent show layout; all but apartment show condition; only apartment hides lot (`src/components/onboarding/Onboarding.jsx:62-179`).

## 6. Current rental criteria inventory

### Present explicitly

| Concept | Exact stored/display label and mode | Representation |
|---|---|---|
| Monthly rent/budget | `budget.value`; “Maximum Monthly Rent”; per-home `price` labeled “Monthly rent” | First-class search value and shared home field; Match threshold. |
| Lease | `homeFeel:Lease Terms` (home-rent only) | Suggested rating/custom-like evaluation; no structured term. |
| Utilities | `features:Utilities Included` (apartment only) | Check: Yes / No / Unknown. |
| Pets | `features:Pet Policy` (both rent modes) | Check only; no species/restriction structure. |
| Pet charges | `features:Pet Rent / Fees` (apartment only) | Check only, despite monetary label. |
| Laundry | `features:In-Unit Laundry` (both); `features:First-Floor Laundry` (home-rent) | Checks. |
| Parking | `exterior:Parking` (both); home-rent also Driveway / Off-Street Parking, Attached Garage, Garage | Checks plus `garage_spaces` fact. |
| Storage | `features:Storage` | Check. |
| Air conditioning | `features:Central Air` | Check. |
| Outdoor/yard | Apartment: Outdoor Space rating; home-rent: Yard rating, Fenced Yard and Patio / Deck / Outdoor Living checks | Evaluation/check. |
| Elevator | `exterior:Elevator` (apartment only) | Check. |
| Floor preference | `location:Floor / Location in Building` (apartment only) | Check, not actual floor. |
| Building amenities | `features:Building Amenities` (apartment only) | Check. |
| Maintenance | `homeFeel:Maintenance Responsibility` (home-rent only) | Rating. |
| Walkability/noise/neighborhood | Walkability shared rating; Noise Level apartment rating; Neighborhood shared rating | Ratings. |
| Commute | `location:Commute` plus private destination records and optional max drive minutes | Runtime objective when thresholds exist; otherwise legacy/personal rating path. |
| Schools | `location:Schools`; relevance gate and personal note; shared `schools_notes` is descriptive only | Check with suppression; Yes/No/Unknown. |

Exact catalogs are centralized in `src/lib/constants.js:13-37,100-180`.

### Absent as named capabilities

Lease length/month count, move-in/availability date, dogs allowed, cats allowed, pet rent amount, pet deposit, breed restrictions, weight restrictions, assigned parking, parking cost, furnished status, dishwasher, fitness center, pool, package handling, secure entry, application fee, security deposit, recurring fees, unit number, and transit have no named first-class fact or suggested criterion. “Garage” and “Storage” are present; “Air Conditioning” is not exact, but Central Air is. Users can type any absent preference as a custom criterion, but that does not create structured shared facts (`src/components/PriorityBoard.jsx:69-85`; `src/lib/constants.js:312-328`).

## 7 and 15. Missing rental facts and data-model classification

Classification: **A** already cleanly representable; **B** generic/custom criteria or notes are adequate; **C** likely first-class for lean Rent V1; **D** defer.

| Fact | Current | Class | Rationale |
|---|---|---:|---|
| Base monthly rent | Shared `homes.price`; rental label/import available | A | Reuse; do not add `monthly_rent`. |
| Property type | Absent | C | Needed to support and identify mixed-type rental comparisons. |
| Unit number | Only as part of free-form `address` | B/D | Address can preserve it; separate field is not required for comparison beta. |
| Availability/move-in date | Absent | C (borderline) | Time-sensitive shared listing fact and likely tour-decision input; include only if beta research confirms it. |
| Lease term/length | Only rating “Lease Terms” in home-rent | B/D | Custom check/note is enough initially; structured terms rapidly become complex. |
| Security deposit | Absent | D | Notes/custom criterion. |
| Application fee | Absent | D | Notes/custom criterion. |
| Utilities included | Apartment check | B | Existing tri-state check supports fit; details can remain notes. |
| Recurring fees | Pet Rent / Fees check only | D | Avoid premature fee schema; notes. |
| Parking cost | Absent | D | Parking presence can be a check; cost in notes. |
| Pet rent/deposit | Generic fee check only / deposit absent | D | Pet Policy/Dogs allowed custom checks capture decision fit. |
| Laundry type | In-Unit Laundry check | B | Enough for beta fit. |
| Pet policy | Check | B | Supports Yes/No/Unknown, though label is vague. |
| Furnished | Absent | B | Add as curated/custom check if needed, no column. |
| Building amenities | Check | B | Keep coarse or use custom checks. |
| Detailed amenity catalog | Partial checks | D | Not a discovery product. |

If product approves both C items, likely schema additions are exactly: nullable `homes.property_type text` (with an application-owned canonical set, preferably no destructive legacy constraint initially) and nullable `homes.available_on date`. The corresponding shared-column allowlists, mappers, save payload, database column grants, privacy verification, shared-fact-awareness mapping, import normalizer, and Compare/display handling would also require updates (`src/lib/supabase/collaboration.js:17-24,198-215,518-596`; `supabase/schema.sql:1214-1333`). If availability is deferred, only `property_type` is likely required.

## 8. Add/Edit Home rental readiness

### Current fields and classification

| Field | Type/source | Conditional behavior |
|---|---|---|
| Address (required), nearby cross streets, listing URL, photo/photo URL | Shared facts; manual; address/listing facts may import | Find/import and crossroads are Add-only; edit has no re-check (`src/components/HomeModal.jsx:382-388,521-546`). |
| Price | Shared/import/manual; rental fact by terminology only | Label is Monthly rent for both rental modes; visibility is driven by shared-priority awareness (`src/components/HomeModal.jsx:79-131`). |
| Estimated monthly payment | Shared/import/manual | Always available and missing-message shown regardless of rental mode: incorrect for rentals. |
| Beds, baths, sq ft | Shared/import/manual | Capture eligibility follows current/co-buyer priorities. |
| Lot size | Shared/import/manual | Awareness-driven, but rental search mode does not itself suppress it in HomeModal; apartment priorities normally make it ineligible. |
| Garage spaces, year built, days on market | Shared/import/manual | Always editable when facts grid opens. |
| HOA/month and property tax/year | Shared/imported informational facts | Summary only; not manually editable here; purchase-oriented rental leak. |
| Home layout, Home condition, primary/secondary bedroom placement | Shared/manual | Shown only if search-mode visibility permits and relevant priority selection exposes them. |
| Basement, school, condition notes | Shared/manual descriptive facts | Optional More Home Details. |
| Item-list checks | Personal participant evaluation in `home_member_state.checks` | Only selected check-kind criteria; explicit Yes/No/Unknown. This is a privacy mismatch for facts such as utilities/pet policy because collaborators may legitimately see different personal answers to what is actually a shared listing fact. |
| Ratings, Overall Feeling | Personal participant evaluation | Post-tour/experiential. |
| Pros, cons, notes | Shared home fields | UI explicitly says shared in collaborative mode (`src/components/HomeModal.jsx:801-809`). |
| Status, touredAt, favorite, reaction/rejection | Personal lifecycle state | Stored in `home_member_state`. |

Requested fact verdict: property type **absent**; unit number **absent**; monthly rent **present via `price`**; availability date **absent**; lease term **only an unstructured rating criterion**; security deposit **absent**; application fee **absent**; utilities included **personal tri-state criterion, not shared fact**; recurring fees **absent**; parking cost **absent**; pet rent **only vague Pet Rent / Fees check**; pet deposit **absent**; laundry type **only In-Unit Laundry check**; pet policy **check**; furnished **absent**; building amenities **check**.

### Import behavior

- URL parsing attempts to extract an address; then the app performs one property lookup and one current listing lookup. Rental modes pass `mode: rental`, selecting RentCast `/v1/listings/rental/long-term`; shared structural properties still come from `/v1/properties` (`src/components/HomeModal.jsx:297-345`; `src/app/api/import-listing/route.js:34-100`).
- RentCast normalization is not sale-only: it takes listing price plus beds/baths/square footage/DOM and structural facts. It can, however, import HOA and property tax into rental homes and has no property type/unit/availability/lease/pet/laundry/fee normalization (`src/lib/rentcast.js:64-132`).
- Paste-text parser is sale-biased. “list price/price” or a non-`/mo` dollar figure becomes `price`; `$X/mo` becomes `estMonthly`. Thus a typical rental price may incorrectly populate estimated payment and leave monthly rent empty (`src/lib/matching.js:120-150`).
- Generic terms “home,” “property,” and “listing” dominate and generally work. Confusing apartment copy includes “Find this home,” “Home photo,” “Exterior of…,” builder-site onboarding copy, estimated payment, basement/roof/taxes examples, and any house fact rows surfaced (`src/components/HomeModal.jsx:478-488,551-579,690-701`; `src/components/onboarding/Onboarding.jsx:249-264`).

## 9. Homes, lists, and map previews

Homes, Want to Tour, Favorites, and Archive all reuse `HomesBoard` with a mode filter; therefore card data and rental behavior are the same across lists (`src/components/HomesBoard.jsx:354-381,542-620`; page files under `src/app/(app)/`).

- Cards display `home.price`; both rental types append `/mo`, so `1895` renders `$1,895/mo`. They also display `estMonthly` as `$X/mo est.` if populated, which creates a nonsensical second monthly financial number for rent (`src/components/HomesBoard.jsx:143-145`).
- Beneath price: beds, baths, square footage, and lot. Separate descriptive facts can include garage, basement, schools. Year built and DOM are not in the primary card facts. Match and tradeoffs use the shared Match engine; unknown appears as not confirmed rather than failure (`src/components/HomesBoard.jsx:73-102,143-234`).
- Missing price renders `—`, not “rent not added” (`src/lib/matching.js:9-12`).
- Map preview displays the same raw `price` but does **not** append `/mo`; it shows beds/baths/sq ft, Match, status, and “View home” (`src/components/SavedHomesMap.jsx:79-101`).

## 10. Home Detail rental readiness

Home Detail is structurally reusable. It includes hero identity, Match, lifecycle status, Favorite, Original listing, Edit, commute, participant-specific Want to Tour/Favorite/Archive/Restore, toured state, Overall Feeling, Liked/Didn't like experiential criteria, post-tour reflection, co-buyer perspective, and shared Pros/Cons/Notes (`src/components/HomeDetail.jsx:121-158`).

Rental gaps:

- Hero uses raw `$price` with no `/mo` and no “Monthly rent” label (`src/components/HomeDetail.jsx:123-130`).
- Property facts assume home ownership/house relevance: lot, garage, year built, HOA, property tax, home layout/condition, bedroom placement. They are omitted if empty, which limits harm, but are not search-type filtered (`src/components/HomeDetail.jsx:54-61,123-137`).
- No first-class property type, unit, availability, lease, deposits, fees, shared pet/laundry/utility facts.
- Match and personal lifecycle sections do not branch by search type and are suitable for rentals. “Tour,” “Favorite,” “Overall feeling,” “Liked,” “Didn't like,” Pros/Cons/Notes, and “Original listing” are universal.

## 11. Match rental readiness

`computeMatch` is catalog-driven rather than buy-driven. Search type chooses the catalog, while scoring handles:

- numeric thresholds (budget, square footage, lot, beds, baths), with partial credit;
- multiselect/singleselect shared facts;
- ratings (score `rating/5`, satisfied at `>=3`);
- checks with exact states Yes=`true`, No=`'no'`, Unknown=absent or legacy `false`;
- Garage auto-evaluation from `garageSpaces`;
- optional runtime commute evaluation (`src/lib/matching.js:195-323`).

Unknown selected criteria are included in `selectedCount` but excluded from score numerator and denominator. If all are unknown, Match percent is null (“Not enough information yet”). Tier weights are Must 4, Important 2, Nice 1 (`src/lib/constants.js:196-211`; `src/lib/matching.js:325-350`; `src/components/CompareBoard.jsx:80-89`).

**Dogs allowed question:** yes, technically. Add it as a custom criterion in Home Features (default kind `check`), select Must Have, then answer Yes/No per home. Known true scores 1, known false 0, and unknown is excluded. However, it is stored as a participant's check/evaluation rather than a shared property fact, so two collaborators could hold inconsistent “facts.” That is usable for beta but not ideal ontology/privacy.

**Dealbreaker semantics:** onboarding calls Must Have “A dealbreaker if it's missing,” but scoring does not disqualify. A false Must Have receives weight 4, lowers the percentage, and appears in Must-Haves/confirmed mismatch. The 90% filter explicitly states that a Must-Have does not disqualify (`src/components/onboarding/Onboarding.jsx:19-23`; `src/components/HomesBoard.jsx:566-576`; `src/components/CompareBoard.jsx:319-343`). There is no rental-specific dealbreaker path or property-type scoring.

## 12. Compare rental readiness

- Compare supports 2–4 arbitrary homes and does not require common property type (`src/components/CompareBoard.jsx:12,217-287`).
- Header cards show raw formatted price without `/mo` and say “Price not added.” Home fact rows are fixed and buy-oriented: Price, Est. monthly payment, Beds, Baths, Sq ft, $/sq ft, Lot, Garage, Year built, Days on market, HOA, Property tax (`src/components/CompareBoard.jsx:26-41,108-164`).
- Selected priorities come from `computeMatch.allSelected`; Must-Haves are separated; unknown is “Not evaluated”; Differences Only compares meaningful result signatures. Match and Overall Feeling are shown per participant; commute rows show each private destination's drive time (`src/components/CompareBoard.jsx:53-103,217-254,297-424`).
- “What stood out” contains Pros/Cons/Notes (`src/components/CompareBoard.jsx:426-451`).
- Mixed rental types structurally compare today, but there is no property-type row, and apartment-irrelevant fixed rows remain. Criteria are based on one scalar search mode, so one unified set—not per-type criteria—is used across all homes.

## 13. Map and commute rental readiness

- Map has no search-type branches. It requires a home with current resolved coordinates; unresolved homes remain listed with repair copy (`src/components/SavedHomesMap.jsx:34-101`; `src/lib/commute.js:18-34`).
- Commute destinations are participant-private rows with label, address, optional max drive minutes, and their own coordinates. Route results are runtime-only and not stored (`supabase/schema.sql:963-1054`; `src/lib/useCommuteObserver.js:6-24`).
- Thresholded destinations combine into one Commute criterion. Any required unavailable route makes the criterion unknown, not false; all must meet their limits to satisfy (`src/lib/commute.js:36-49`).
- Apartment unit addresses pose no unique model failure because geocoding uses the address/coordinates. Practical risk: unit syntax may reduce geocoder/RentCast match rates; coordinates are address-bound and invalidated when address changes. A dedicated unit field could improve identity/import cleanliness later, but is not required for routing.
- Purchase-specific language is absent. The only rental rendering bug is Map's missing `/mo`.

## 14. Lifecycle rental readiness

The active lifecycle is Saved → Want to Tour, durable `touredAt`, optional post-tour verdict, Favorite, and Archive/Restore. Verdicts are Love It (sets Favorite), Still Considering, and Not for Me (archives after reason); legacy Toured remains readable, and legacy status colors include Considering, Touring, Offer made, Under contract, and Passed (`src/lib/lifecycle.js:1-40`; `src/lib/constants.js:182-193`; `src/components/PostTourModal.jsx`).

No lifecycle transition branches on search type. Tour language is natural for apartments. No active offer/contract UI is offered; “Offer made” and “Under contract” survive only as legacy color-map values and could render if already stored. Rental V1 needs no structural lifecycle.

## 16. Purchase-language leaks

| User-facing location | Leak |
|---|---|
| Add/Edit property summary and grid | “Estimated monthly payment not added,” “Est. monthly pmt,” always visible for rentals (`src/components/HomeModal.jsx:95-131`). |
| Compare | “Price,” “Price not added,” “Est. monthly payment,” `$ / sq ft`, Lot, Garage, Year built, HOA, Property tax (`src/components/CompareBoard.jsx:26-40,131-135`). |
| Detail | HOA and Property tax; unqualified hero price (`src/components/HomeDetail.jsx:54-61,123-135`). |
| Imported facts | HOA and Property tax shown for rental results (`src/components/HomeModal.jsx:496-508`; `src/lib/homeDisplay.js:89-96`). |
| Onboarding finish | “builder website,” mildly buy/build-oriented (`src/components/onboarding/Onboarding.jsx:249-264`). |
| Home-to-rent onboarding/priorities | Home Condition options “New Construction,” “Move-In Ready,” “Renovation Potential”; lot and ownership-style house criteria (`src/lib/constants.js:3-5,28-37`; `src/components/onboarding/Onboarding.jsx:133-166`). |
| Archive reason | Example “no basement, taxes too high” (`src/components/HomeModal.jsx:549-553`). |
| Collaboration CTA | “Buying together? Add a co-buyer” appears globally, including rentals (`src/components/CoBuyerHomesLine.jsx:33-42`). |
| Legacy status palette | “Offer made,” “Under contract” can style historical values but are not selectable (`src/lib/constants.js:182-193`). |

No active runtime “mortgage,” “down payment,” “closing,” “homesite,” or “homeowner” copy was found. Universal terminology already used effectively includes Home, property, listing, option-like comparison, Tour, Favorite, Match, Overall Feeling, Liked/Didn't like, and Pros/Cons/Notes.

## 17. Privacy and collaboration compatibility

Rent can reuse Pass 3C unchanged **if classification is respected**:

- Shared objective/listing facts live on `homes`; current shared allowlist includes address, listing metadata, price/payment, physical facts, notes, coordinates, HOA/tax, and descriptive detail notes (`src/lib/supabase/collaboration.js:17-24,198-215`).
- Personal lifecycle, ratings, and checks live in `home_member_state`; participant priorities live in `search_member_priorities`; commute destinations are own-row-only (`supabase/schema.sql:325-404,971-1007`).
- Co-buyer Match/feeling/differences and lifecycle signals are sanitized RPC outputs rather than raw personal documents (`supabase/schema.sql:758-962`; `src/lib/supabase/collaboration.js:108-139,332-421`).
- Shared-fact awareness exposes booleans, not another participant's tiers/document (`supabase/schema.sql:644-757`).

New `property_type`, `available_on`, rent, fees, deposits, utilities, pet rules, parking facts, and building amenities are shared listing/property facts—not opinions—and should therefore be shared home columns if first-class. The privacy question is not whether they may be shared; it is whether the product trusts one collaborator to edit shared facts. Current design already permits shared-home edits. Conversely, “Dogs allowed,” Pet Policy, and Utilities Included currently stored in personal `checks` blur fact and evaluation; making them first-class later requires an additive shared source while preserving old personal evaluations.

## 18. Backward compatibility

- Old `rent_apartment` values continue rendering today because constants and catalog branches explicitly recognize them. No database constraint blocks either legacy value (`src/lib/constants.js:120-180,213-272`).
- A unified journey does **not** require an immediate data migration. A runtime `normalizeSearchType`/capability mapper could treat `rent_apartment` and `rent_home` as canonical Rent for terminology/import while retaining the raw legacy value to select a legacy criteria preset when necessary.
- New searches can stop writing `rent_apartment`; old values should remain readable indefinitely. Removing the constant/branch immediately would silently replace the apartment catalog with generic/home criteria and hide selected suggested items that were never copied into `customItems`.
- Priorities survive because they are JSON documents keyed by category/label, and normalization fills missing keys without discarding extras (`src/lib/constants.js:330-366`). Homes survive because `search_id` remains unchanged and home rows do not currently encode search type (`supabase/schema.sql:66-126`).
- Property type cannot be reliably inferred for all old homes. A search-level `rent_apartment` provides a reasonable **provisional** apartment default, but that is not evidence per home and fails if a legacy user saved another rental type. Prefer null/Unknown plus optional user confirmation; if backfilling, record only conservative apartment inference and allow correction.
- Each participant has a private priority document and could theoretically retain a different `searchType` on one shared search. Any canonicalization must define whether search intent/property-type preference is personal or shared. Current architecture treats it as personal because the entire document is private.

## 19–20. Model A vs Model B and recommendation

| Dimension | Model A: separate | Model B: unified Rent |
|---|---|---|
| Current architecture | Lowest immediate code change; matches scalar branches | Fits shared entities/workflows, but needs compatibility and a property-type model |
| Onboarding | Preserves duplicate top-level choice and arbitrary criteria split | Fewer top-level choices; one coherent rental priority bank |
| Mixed rentals | Poor: one catalog and no per-home type | Natural with per-home type and optional multi-select preference |
| Match | Works within each preset, no type criterion | Existing engine works; property-type preference needs first-class evaluation or carefully defined criterion |
| Add/Edit/cards/detail/Compare | Existing gaps remain and type stays invisible | One rental formatter; type can appear consistently |
| Compatibility | No work | Additive mapper and legacy preset preservation; no forced migration required |
| Extensibility | Duplicates future rental additions and creates drift | One place for shared rental needs; type-specific progressive fields remain possible |
| Pre-beta risk | Lower if doing nothing, higher product incoherence | Moderate implementation risk, controllable by incremental rollout |

**Recommendation: Model B.** The architecture already has one generic home/workflow and only the criteria catalog distinguishes apartment mode. A canonical Rent intent plus per-home property type reflects actual comparison behavior and enables apartment-vs-townhome comparisons. Treat property types as an optional multi-select desire in My Search and an actual single shared fact on each Home. Preserve `rent_apartment` as a readable legacy preset/value while stopping new writes only after compatibility tests exist.

## 21. MUST HAVE before rental beta

1. Fix rental presentation everywhere: monthly rent label and `/mo` on cards, map, detail, and Compare; suppress estimated monthly payment, `$ / sq ft`, HOA/property tax, and house-only rows where inappropriate.
2. Fix paste parsing so rental `$X/mo` populates `price`, not `estMonthly`; retain rental RentCast mode.
3. Approve and implement one canonical Rent model with a backward-compatible `rent_apartment` reader—not a destructive migration.
4. Add per-home property type if mixed rental types are a beta promise. Provide Apartment, House, Townhome, Condo and Unknown/Other behavior; do not force historical inference.
5. Curate one lean rental criteria bank from existing work: Pet Policy (or species-specific custom-friendly checks), In-Unit Laundry, Utilities Included, Parking, Storage, Central Air, Outdoor Space, Noise Level, Building Amenities, Elevator, commute, walkability, neighborhood, schools. Remove home-rent/apartment asymmetry.
6. Preserve explicit Yes/No/Unknown and validate that rental Must Haves remain honest. Product copy must not promise hard disqualification while engine only weights.
7. Remove renter-visible “Buying together?” and active estimated-payment/purchase examples.

## 22. SHOULD HAVE if low complexity

1. First-class `available_on` if user research says timing decides whether to tour; otherwise defer.
2. A concise optional property-type multi-select in My Search. It is a desire; actual property type belongs on each Home.
3. Add suggested checks for Dogs allowed, Cats allowed, Furnished, Dishwasher, Assigned/off-street Parking only if they are supported by beta evidence. Existing custom criteria architecture needs no schema.
4. Replace vague rating-kind Lease Terms and Maintenance Responsibility with clearer optional criteria/notes rather than creating a contract subsystem.
5. Search-type-aware filtering of fixed Compare/detail/card facts.

## 23. DEFER until after beta

- Structured lease duration/options, renewal terms, deposits, application fees, concessions, recurring-fee ledger, parking price, pet rent/deposit, breed/weight rules.
- Full laundry taxonomy, parking inventory, amenity taxonomy, floor/building/package/security/maintenance-management models.
- A separate unit entity, building entity, availability history, rent history, application workflow, lease lifecycle, or discovery feed.
- Automated property-type backfill beyond conservative legacy hints.
- New rental lifecycle states. Existing tour/feeling/favorite/archive loop is sufficient.

## 24–26. Likely schema additions and reuse

**Likely:** `homes.property_type text null`.  
**Conditional:** `homes.available_on date null`.  
**No duplicate:** do not add monthly rent; reuse `homes.price`. Do not add rental Match tables; reuse priorities + `checks`/`ratings` + `computeMatch`. Do not add rental lifecycle, map, commute, collaboration, photo, URL, address, notes, or compare entities.

Existing rental work worth preserving:

- Both rental search constants and legacy labels.
- Rental terminology helpers and card `/mo`.
- Rental RentCast endpoint selection.
- Apartment-specific criteria catalog and hidden lot/layout/condition behavior.
- Home-rent Pet Policy, In-Unit Laundry, Parking, Maintenance Responsibility, Lease Terms.
- Tri-state checks and unknown-safe Match.
- Custom criteria, tiers, priority editing/unselection, Schools relevance, commute thresholds.
- Generic Home/Detail/Compare/lifecycle/privacy architecture.

## 27. Risks and blockers

1. **Product decision:** whether property type is required per home and preference is multi-select; without it, Model B cannot accurately compare mixed rentals.
2. **Legacy catalog loss:** naïve replacement of `rent_apartment` with `rent_home` can hide apartment suggested/core criteria and change semantics.
3. **Participant divergence:** `searchType` lives inside private participant priorities, not shared search metadata.
4. **Fact/opinion ambiguity:** rental checks that are objectively listing facts currently live in participant-private evaluation state.
5. **Import ambiguity:** paste parser currently misclassifies `/mo`; RentCast output has no unit/property type/availability normalization.
6. **Formatting inconsistency:** only Home cards currently append `/mo`; other prominent surfaces look purchase-oriented.
7. **Dealbreaker promise:** UI says Must Have is a dealbreaker, but no hard-stop presentation exists.
8. **Free-text numeric storage:** price and most physical facts are text, limiting validation and semantic guarantees (`supabase/schema.sql:71-100`).

## 28. Recommended implementation sequence after approval

1. Lock product semantics: canonical stored intent, allowed property types, whether availability is beta-critical, and whether Must Have remains weighted rather than disqualifying.
2. Add unit tests around legacy `rent_apartment` normalization and criteria preservation before changing constants.
3. Introduce an additive runtime compatibility mapper; keep raw legacy values readable; stop new legacy writes only after all surfaces consume normalized capabilities.
4. Add nullable shared `property_type` (and only if approved, `available_on`) through a migration, grants, mappings, privacy verifications, shared-fact awareness, and tests.
5. Unify the rental onboarding/My Search catalog while carrying forward legacy selected criteria and custom items.
6. Make Add/Edit/import rental-aware, including paste parser correction and fact-vs-opinion placement.
7. Apply one rental display formatter/filter to cards, map, detail, and Compare.
8. Run Match parity tests for true/false/unknown, Must Have false, unknown-only, custom Dogs allowed, commute unavailable, and legacy participant perspectives.
9. Run privacy/RLS and collaboration suites, then end-to-end test old apartment users, old home renters, new renters, mixed property types, and co-buyers.
10. Only after beta evidence, consider richer availability, lease, pet, fee, or amenity structure.

## Audit method

The audit used repository-wide ripgrep searches for search/property types, rental concepts, and purchase terminology; direct line-by-line review of constants, onboarding, My Search, Add/Edit, cards, detail, Compare, map/commute, matching, import, persistence, lifecycle, schema, and privacy tests; and the repository's test/build checks. No external product assumptions were treated as implemented functionality.
