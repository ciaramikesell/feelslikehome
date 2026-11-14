# Mobile Priority Onboarding V3

A mobile-first, category-based priority onboarding: one category per screen,
visual cards, an importance bottom sheet, optional everything, an editable
review. Implemented as **onboarding flow version 4** and released only behind
`FLH_ONBOARDING_V3=on`. With the flag unset (the default) production behaves
exactly as before.

> Naming: "V3" is the product name. Flow versions 1 (live), 2 (an earlier
> plan) and 3 (the unreleased six-step "V2") already exist in
> `src/lib/onboardingFlow.js`, so this flow is version **4** in code and in
> `profiles.onboarding_version`.

## 1. Audit (before any product change)

| Area | What exists today | Compatibility with V3 |
|---|---|---|
| Live onboarding | Flow 1: Basics (search type + budget/beds/baths/sqft/lot + optional Home preferences) → What Matters (chips) → Rank. `CURRENT_ONBOARDING_VERSION = 1`, pinned by tests. | Left untouched. V3 is a separate flow version, selected per request by a server flag. |
| Unreleased six-step flow | Flow 3 (preview only): Basics → Where are you looking? → Your People → What Matters → Rank → Review. | Untouched. Its "Where are you looking?" screen is **reused as-is** in V3. |
| Priority schema | One JSON document per participant per search (`search_member_priorities`): `location / features / exterior / homeFeel` each `{ customItems, tiers, order, hiddenCore }`; identity is `category:label`; tiers `must / important / nice / dontcare`. | No change. V3 categories (Kitchen, Bathroom, …) are a presentation layer over existing identities. |
| Custom criteria | `{ label, kind: 'check', source: 'custom' }`, answered Yes / No / Unknown per buyer (`isYesNoCriterion`); Unknown is unscored. | Reused. One additive field, `group`, records the screen a custom item was added on. Unknown fields on items were already preserved by every reader. |
| Match | `computeMatch` (JS) and `resolve_cobuyer_compare_perspectives` (SQL) iterate tiers generically; weights 4 / 2 / 1; Unknown never scored; `Garage` scored from `garageSpaces` when known. | No change to either scorer. Real-Postgres test shows JS = SQL for V3-written documents. |
| Grouped preferences | `preferredPropertyTypes`, `homeLayout`, `homeCondition` (alternatives, one importance each). | **Not asked** by V3 (per the brief). Saved values are kept, shown read-only on Review, editable in My Search; Home Add / Home Facts keep asking them about homes. |
| Garage | `exterior:Garage` criterion + `exterior.garagePreference` (`any / attached / detached`, informational). | Reused. "Not important" = the existing deselected tier (`dontcare`); no home is ever written. |
| Co-buyers | Each member owns their own priorities document; shared-search setup writes only the caller's row. | Unchanged; V3 runs inside the same `Onboarding` orchestrator and services. |
| Progress | `profiles.onboarding_version/state`; state normalised on read (unknown keys dropped). | Additive: `answers.searchType` (drives branching) and `skipped` (Review lists skipped screens). |
| Images | At first: brand/landing art only. Since `f7fd834`, `main` has the founder's 37 onboarding photos in `public/images/onboarding/`. | Photos are the card visuals through an explicit manifest, served as card-sized derivatives (see §5). |

### Identity mapping (no duplicates, no new semantics)

Existing catalog identities are reused wherever the idea already exists, so
earlier selections, Home Facts answers and both scorers line up:

| Screen | Uses existing identity | New buyer-owned custom item (`source: 'custom'`) |
|---|---|---|
| Layout & Living | First-Floor Bedroom, `Home office`, `Finished basement`, `Primary ensuite`; suggestions `First-floor laundry`, `Walkout basement`, `exterior:Front porch` | — |
| Kitchen | Stainless Steel Appliances, Walk-in Pantry; suggestions Eat-in Kitchen, Kitchen Island, Formal Dining Room | Countertop Seating |
| Living Room | Fireplace, High Ceilings | Built-in Shelving, Large Windows |
| Bathroom | Double Vanity, Soaking Tub | Separate Shower / Tub, Private Toilet, Linen Closet |
| Garage | `exterior:Garage` + `garagePreference` | Workbench, Garage Extension, Door to Backyard |
| Exterior & Property | `lotSizeTarget`, `Patio / deck`, `Fenced yard`; suggestions `location:Mature Trees`, Garden Space, Pool | — |
| Location & Neighborhood | Low-Traffic Street, Sidewalks, **`Tree-lined street`** (historical identity, still counted), No HOA; suggestions Cul-de-Sac, `Walkable schools` | — |

Omitted from onboarding as requested (still in the catalog, still counted for
anyone who chose them): Second-Floor Laundry, Basement Storage, Fire Pit, Room
for Entertaining, Walkable Neighborhood, Near Water. **Dead-End Street** was
removed from the suggestions (founder decision); a buyer who already added it
keeps it — it still shows on the Neighborhood screen and on Review as their own
priority (or under "More of your priorities" if saved without a screen).

### Search-type branching

| | Home to Buy | Home to Rent | Apartment to Rent |
|---|---|---|---|
| Screens | Type, Basics, Where, Layout, Kitchen, Living, Bath, Garage, Exterior, Neighborhood (10) | + **Rental Essentials** (11) | Rental Essentials, no Garage (10) |
| Differences | No HOA offered | No HOA hidden (landlord's concern, as today) | No lot size, fenced yard, basement, first-floor items; apartment identities reused (`Home Office`, `Patio / Deck / Outdoor Living` "Balcony / Patio"); Fitness Center / Secure Entry / Elevator as suggestions |

Rental Essentials (pets, laundry, utilities, parking, A/C, dishwasher) was
already the first thing renters were asked. **Approved**: it stays renter-only
(never shown to buyers), with the Home to Rent / Apartment to Rent differences
above.

## 2. Implementation plan (as built)

1. `src/lib/priorityCategories.js` — the category catalog, identity
   resolution per search type, dedupe, level writes, garage, rename, review
   helpers. Pure; shared by every surface.
2. `src/lib/onboardingFlow.js` — flow 4, `answers.searchType`, `skipped`,
   `skipOnboardingStep`, `setOnboardingSearchType`. Flow 1/2/3 unchanged.
3. `src/lib/featureFlags.js` — `onboardingV3Enabled()`; `/onboarding` picks
   flow 4 for new **and in-progress** sessions only when it is on.
4. `src/components/onboarding/priority/*` — one `CategoryStep` for every
   category, `FeatureCard`, `FeatureVisual`, `ImportanceSheet` (on the existing
   `Sheet` primitive), `AddOwnFeature`, `PriorityReview`, `PriorityFlow`.
5. `Onboarding.jsx` renders `PriorityFlow` for version 4 and keeps all saving,
   resume, shared-setup and finish logic. The live flow's navigation function
   is byte-for-byte unchanged; flow 4 has its own (`moveOn`).
6. Development preview: `/dev/onboarding?flow=v3&step=…&state=…&search=…`.

## 3. Behaviour

- **One frame everywhere**: eyebrow "Step n of N · Category", heading, lead,
  content, then one sticky footer **Back · Skip · Continue** (Search type has
  no Skip — it decides which screens follow; the first screen has no Back).
- **Nothing is preselected and nothing is inferred.** Tapping a card opens the
  importance sheet; closing it changes nothing. Skip changes nothing. An
  unanswered feature is simply not on the board — never No, never Must Have.
- **Importance sheet**: Must Have / Important / Nice to Have / Not important
  (Remove), as buttons (arrow keys never change an answer). The level stays on
  the card in words plus a check badge.
- **Add your own** on every category: free text + that category's suggestion
  chips (narrowed as you type). Adding a suggestion or text opens the sheet
  immediately. Dedupe ignores case, spacing and punctuation and searches every
  screen, the person's document and the catalog ("front porch" typed on Kitchen
  selects the existing Front Porch and says where it lives). Own features can be
  renamed in the sheet.
- **Garage**: overall importance first. **Not important moves straight on**
  to the next screen (recorded like Continue, not Skip; stored as the existing
  "don't care" tier, so a home with or without a garage is never marked down).
  Back returns to the garage screen with Not important shown chosen and
  changeable; any level brings Attached / Detached / Either and the garage
  details back. Editing it from Review returns to Review.
- **Back/forward and resume** preserve every answer (answers live in the
  priorities document, saved as they change; position and skipped screens in
  `onboarding_state`, saved on every move and when the app is backgrounded).
- **Review**: Basics, Where you're looking, every category (chosen features by
  level, skipped screens marked), "More of your priorities" (chosen earlier,
  not on any screen), "Saved from earlier" (home type/layout/condition,
  read-only). Every priority opens the same sheet in place; Edit/Add opens the
  screen, whose Continue becomes "Back to review".
- **Swipe gestures**: not added. Buttons are the only interaction.

## 4. Migration and compatibility notes

- **No database migration.** No SQL function, policy or column changes.
- **Existing profiles**: completed accounts are never routed to onboarding
  (gate unchanged). Saved priorities are read as-is; V3 never deletes or
  rewrites an item it does not touch. Earlier grouped preferences are shown,
  not cleared.
- **In-progress sessions** when the flag is turned on: carried into flow 4 via
  `legacyKeys` (`basics`, `locations`, `review`); the person lands on the first
  unfinished screen with every answer kept. If the flag is turned off again,
  a flow-4 session restarts flow 1's screens with all answers kept.
- **Additive fields**: `customItems[].group` (screen key) and
  `onboarding_state.answers.searchType` / `skipped`. Older code ignores them.
- **Desktop board**: works from the same document. `group` gives a future
  desktop board the same categories; My Search already shows every V3 item
  (its existing category lists, custom items included).
- **Renaming a custom feature** changes its key (`category:label`). It is
  offered while setting up, before homes are evaluated; answers already given
  on homes under the old name would not follow. (Onboarding accounts and
  shared-setup co-buyers have none for a feature they just created.)

## 5. Images: sourcing, provenance and performance

**Source and provenance.** The card photos are the founder's own uploads to
`main` (`public/images/onboarding/*.webp`, commits `7e3e5fa`, `f7fd834`; 37
files). They are used as supplied and **never modified or deleted** — the app
does not load them directly. They show an example of a feature, never any
particular home; the importance sheet says so.

**Explicit manifest** (`src/lib/onboardingImages.js`): card key → original
file. No filename matching at runtime. Names that differ are mapped by hand:

| Card key | Uploaded file |
|---|---|
| `garage-attached` | `attached-garage.webp` |
| `garage-detached` | `detached-garage.webp` |
| `garage-yard-door` | `garage-backyard-door.webp` |
| `workbench` | `garage-workbench.webp` |
| `formal-dining` | `formal-dining-room.webp` |
| `high-ceilings` | `high-ceiling.webp` |
| `separate-shower` | `separate-shower-tub.webp` |
| `garden` | `garden-space.webp` |
| `walkable-schools` | `walkable-to-schools.webp` |
| all others | same name `.webp` |

A test checks that every upload is used, every manifest file exists, and
every card resolves to a picture.

**Card derivatives** (`public/images/onboarding/cards/<key>-400.webp` and
`-800.webp`, from `scripts/visual/onboarding-card-images.mjs`, ImageMagick):
4:3 centre crop (every subject checked in a contact sheet), metadata stripped,
WebP q74. 400w ≈ 9–35 KB (avg ≈ 20 KB) for 1×/2× phones; 800w ≈ 27–101 KB
for 3× phones and desktop. Examples: `attached-garage.webp` 3.4 MB → 18 KB /
59 KB; `stainless-appliances.webp` 1.4 MB → 9 KB / 27 KB;
`first-floor-laundry.webp` 706 KB → 10 KB / 32 KB. Cards use
`srcset` + `sizes`, fixed `width`/`height` (no layout shift), `object-fit:
cover` in a 4:3 tile, `loading="lazy"` after the first row, `decoding="async"`.
Only the screen being shown renders images, so other categories' photos are
never fetched (QA checks this with the network log).

**Fallbacks** (in order): photo → FLH illustration (only `pet-friendly`,
`in-unit-laundry`, `dishwasher`, `garage-either` — the four cards with no
photo; `scripts/visual/feature-art.mjs` now generates only these) → an icon,
defined for every pictured feature. A missing, 404 or corrupt image switches
to the icon tile, including when it failed before React hydrated. No HOA (and
the apartment amenities and utilities) stay icon-only by design; the person's
own features use a neutral placeholder. The 33 earlier illustrations replaced
by photos were removed.

## 6. Tests and QA

- `test/mobile-priority-onboarding-v3.test.js` (22; adds the photo manifest,
  Dead-End Street removal with history preserved, garage auto-advance): flag off ⇒ live flow;
  steps and branching; skip/resume/back; exact screen contents and omissions;
  every catalog identity counts in Match and every custom one is buyer-owned;
  level writes equal My Search's; Unknown custom never scores; dedupe; rename;
  garage; search-type switch; Review; UI contracts (one CategoryStep, no
  home type/layout/condition, local lazy images with fallback, sheet buttons).
- `test/mobile-priority-onboarding-v3-db.test.js` (real Postgres, 2): lossless
  round-trip, owner/co-buyer independence, JS = SQL scorer at each step,
  Unknown unscored, garage Not important never marks a home, progress persists.
- Full suite on real Postgres: **1,449 tests, 1,447 pass, 0 fail, 2 skipped**
  (pre-existing: RentCast live fixtures not captured yet). Baseline on `main`:
  1,425 / 1,423 / 0 / 2.
- `npm run build`: passes.
- Browser QA `scripts/qa/mobile-priority-onboarding-v3-qa.mjs`: **235/235**:
  every screen at 375 / 390 / 430, desktop 1440, 390 at 150% and 200% zoom;
  full mouse walk-through incl. garage Not important → auto-advance → Back
  (still chosen, changeable); keyboard (Enter opens, Escape closes unchanged,
  focus returns); founder photos visible on cards; only derivatives fetched
  (never an original), 800w on a 3× phone and 400w on 1×, each ≤ 120 KB,
  lazy below the first row, no other screen's photos loaded; Cul-de-Sac
  photo; Dead-End Street not suggested; No HOA icon; renter-only
  illustrations; buyers never see Rental Essentials; images missing / 404 /
  corrupt → icon tiles with labels.
- Live-flow regression: `scripts/visual/onboarding-screens.mjs` capture of
  `main` and of this branch (flag off), every live-flow and six-step-preview
  scenario at 390 / 768 / 1024 / 1440: **480 screenshots, 0 pixels changed**.
- Screenshots (`docs/mobile-priority-onboarding-v3-screenshots/`): `before/`
  (live flow and the unreleased six-step flow), `before-photos-illustrated-d859ec0/`
  (this PR's first version, illustrations), `after/` (founder photos; JPEG
  to keep the repo light).

## 7. Known limitations

- Four cards (pet-friendly, in-unit laundry, dishwasher, "either garage")
  still use illustrations — no photo was uploaded for them. Adding a photo is a
  manifest entry plus re-running the derivative script.
- Some uploads are smaller than 800 px wide; their 800w derivative is an
  upscale (no worse than the browser scaling the 400w).
- At 200% zoom the phone grid drops to one column and the footer stacks;
  the shared top bar's step count overlaps the wordmark at that size — a
  pre-existing shell issue, also in the live flow, left unchanged.
- "Large text" was tested as browser zoom; the app sets type in px, so iOS
  Dynamic Type does not scale it (true of the whole app today).
- Your People (co-buyer/Realtor intent) is not in V3, matching the live flow;
  invitations remain in My Search.
- No desktop priority board yet (separate future UI); the schema supports it.
- The dev preview's in-memory services were used for browser QA; real
  persistence is covered by the Postgres tests, not by an end-to-end browser
  run against Supabase.

## 8. Founder decisions

Approved (PR #181 refinement): Dead-End Street removed; founder photos used;
Rental Essentials renter-only; geography stays third; garage Not important
auto-advances; `FLH_ONBOARDING_V3` stays off in Production.

Still open: photos (or an icon) for the four illustrated cards.

## 9. Founder Preview QA

The flag is read on the server per request; no code change is needed to try it.

1. Vercel → Project → Settings → Environment Variables → add
   `FLH_ONBOARDING_V3` = `on`, environment **Preview only** (leave Production
   unset), scoped to this branch (`claude/exciting-tesla-oofmqu`) if you like.
2. Redeploy the latest Preview deployment of this branch (env changes apply on
   the next deployment).
3. On that Preview URL, sign up with a **new test account** (completed
   accounts never re-enter onboarding). Walk: Home to Buy → Basics → Where are
   you looking? (third) → each category → Review → Add my first home.
4. Things to try: tap a photo card and choose a level; add a suggestion and
   your own feature (try typing it twice in different case); garage → Not
   important (moves on) → Back (still chosen); Skip a screen and see it on
   Review; edit from Review; leave mid-way and sign back in (resumes); try a
   Home to Rent and an Apartment to Rent account (Rental Essentials first;
   apartment has no garage); a co-buyer invite (their priorities stay theirs).
5. To switch it off: delete the variable (or set `off`) and redeploy. People
   mid-way continue in the live flow with their answers kept.

Development preview (no sign-in, nothing saved):
`/dev/onboarding?flow=v3&step=search_type|basics|locations|cat_kitchen|…|review&state=empty|populated|legacy&search=home_buy|home_rent|apartment_rent`
(development builds only; Preview and Production answer 404).
