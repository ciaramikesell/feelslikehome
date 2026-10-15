# Buyer search criteria & priority catalog refinement

Beta feedback pass on The Basics, What Matters, Rank Priorities, My Search and
Add/Edit Home. This document is the audit, what changed, and the work that is
**deferred pending approval** because it needs schema or Match changes.

## 1. Audit of `main` before this change

| Area | What existed |
| --- | --- |
| Live onboarding (flow 1: Basics → What Matters → Rank) | Basics had a low-emphasis native `<select>` ("I’m looking for [choose one]"), Continue disabled until chosen. Two accordions: **Garage preferences** (an importance question, Not set / Nice / Important / Must, plus Any/Attached/Detached) and **More about the home** (kinds of homes, layout, condition). Choosing a type went through `chooseSearchType(..., { presetPropertyType: true })`, which **preset House/Apartment** and silently reset curated picks from the other type. Layout/condition chosen there were stored with tier `dontcare`, so they were neither ranked nor scored. |
| Inactive six-step V2 (flow 3) | Same Basics component with `homeDetails=false`; home type/layout/condition/garage were Step 4 chips. Switching type used `switchSearchType` (keeps compatible picks, lists removals, Undo). |
| Basics storage | One participant priorities JSON document (`search_member_priorities`). Grouped preferences `preferredPropertyTypes`, `homeLayout`, `homeCondition` = `{ values[], tier }` (alternatives, one importance). Criteria = `category.tiers[label]` + `customItems`. Garage qualifier in `exterior.garagePreference` (informational, not scored). |
| Priority ranking | `priorityLevels` (criteria only); V2 Rank used `priorityLevelsWithGroups` (groups as one item each). Live Rank and My Search Rank Priorities showed criteria only. |
| Match (`computeMatch`, and SQL `resolve_cobuyer_compare_perspectives` which must stay in parity) | Groups: met when any chosen value is in the home's array; empty home value = Unknown. Garage: `homes.garage_spaces` (>0 met, 0 = No, empty = Unknown). Other check criteria: participant's own Yes (`true`) / No (`'no'`) / Unknown. Retired purchase built-ins (e.g. `features:Mudroom`, `features:Pantry`, `exterior:Sidewalks`) are skipped by both scorers. |
| Add/Edit Home | `homes.home_layout` and `homes.home_condition` are `text[]` but the editor offered a single-select. `garage_spaces` free text. Personal Yes/No/Unknown for every selected check criterion. No structured basement or yard columns (`basement_notes` is free text). |
| Import | `parseListingText` → garage spaces, property type, etc.; `derivePriorityCheckPatch` fills explicit Yes/No for a few selected criteria (finished/walkout basement, fenced yard, …). `listingFacts` notes attached/detached garage as evidence only. |
| Renters | Home to Rent used the purchase catalog minus No HOA; Apartment to Rent its own; both get Rental essentials first. |

### Requested choices mapped to support

| Choice | Status |
| --- | --- |
| Home type: Single Family / Condominium / Multi-Family | Supported (`preferredPropertyTypes`, `homes.property_type`). |
| Layout: Ranch / Two-Story / Split Level | Supported (`homeLayout`; Split Level already a home value). |
| Layout: First-Floor Primary | Supported as its own criterion `features:First-Floor Primary` (so it combines with Two-Story). |
| Condition: all three | Supported (`homeCondition`, alternatives; a home may have several). |
| Garage: Any / Attached / Detached | Garage presence scored; Attached/Detached stored as the existing qualifier, **not scored** (no home field). |
| Garage: No Garage; Garage size 1 / 2 / 3+ | **Needs Match + SQL change** — deferred. |
| Basement: Finished, Walkout | Supported (existing criteria; both may hold). |
| Basement: Unfinished, Daylight, Traditional | **Needs new structure** — deferred (see 3b). |
| Yard: Fenced, Privacy Fence | Supported (existing criteria; both may hold). |
| Yard: Unfenced | New check criterion `exterior:Unfenced Yard`; never chosen with a fenced option. |
| What Matters catalog (33 of 34) | New or existing check criteria — generic Yes/No/Unknown path in both scorers, no Match change. |
| What Matters: Mudroom | **Retired in both scorers** — deferred (see 3c). |

## 2. Implemented (no schema, no Match-engine change)

- **Search type**: three visible choices (radio group on the warm track) with a
  short note each ("Purchase budget" / "Monthly rent"). Nothing preselected;
  Continue shows inline validation and focuses the choices. A saved type is
  shown chosen; choosing it again changes nothing. Both flows now switch via
  `switchSearchType` (keeps compatible choices, explains removals, Undo) and
  **neither presets a property type**. Budget label follows the type.
- **The Basics**: one optional **Home preferences** accordion (collapsed, with a
  summary and count) replaces Garage preferences + More about the home. Compact
  rows (label left, options right on desktop; stacked with 44px pills on
  phones). Rows: Home type, Layout, Condition, Garage, Basement, Yard for Home
  to Buy; Home type + Garage for Home to Rent; none for Apartment to Rent.
  Data model per row is in `src/lib/homePreferences.js` (alternatives vs
  combinations; Garage single choice that can be cleared; Unfenced exclusive).
- **Ranking**: every Home preference starts **Important** (never Must-Have).
  The separate garage importance question is gone. Live Rank, My Search's Rank
  Priorities and the My Search overview now include grouped Basics (one item
  each, e.g. "Layout — Ranch or Two-Story"). My Search "Add a priority" has a
  Home Preferences group (contradictory yard choices are not offered).
- **What Matters (Home to Buy)**: the four approved groups. Existing identities
  reused where the concept is the same (`Near waterfront` → "Near Water",
  `Walkable schools`, `No HOA`, `Central air`, `Home office`, `First-floor laundry`,
  `Primary ensuite`, `Patio / deck`, `Front porch`, `Pool`, `Fireplace`). Home
  preferences are not repeated here (asked once, counted once).
- **Retired from new buyer selection** (kept on boards and still counted):
  Reputable Schools, Walkable to Town, Parks Nearby, Quiet Street, Bustling
  Street, Guest Bedroom, Large Backyard, Landscaping. Switching away and back to
  buying keeps them.
- **Overlaps handled explicitly**: Low-Traffic Street is new (Quiet Street kept
  for existing users), Walkable Neighborhood is new (Walkable to Town kept),
  Sidewalks is a new `location` identity (`exterior:Sidewalks` stays retired),
  High Ceilings / Walk-in Pantry / Basement Storage are new check identities
  distinct from the retired tour-rated or generic ones.
- **Renters**: Home to Rent keeps its earlier catalog (frozen as
  `HOME_RENT_CATALOG`); Apartment to Rent unchanged; Rental essentials first.
- **Edit Home**: Layout and Condition are multi-select chips with an explicit
  Unknown (empty) — persisted to the existing arrays and already scored by both
  scorers. Garage field labelled "Garage spaces" with "Unknown · 0 = none".
  Shared-fact eligibility and personal Yes/No separation unchanged.

### Evidence source per new preference (no new inference)

| Preference | Evidence today |
| --- | --- |
| Home type, layout, condition | Shared home facts (listing import for property type; manual for layout/condition). |
| Garage | `garage_spaces` (RentCast, listing text, manual). |
| Basement, yard, First-Floor Primary, all 33 What Matters choices | The participant's own Yes / No in Add/Edit Home; existing explicit-phrase import rules for finished/walkout basement and fenced yard. No new parsing was added, so the rest stay Unknown until answered. |
| Location choices (Cul-de-Sac, Low-Traffic Street, Wooded Setting, …) | The participant's own answer only. Never auto-marked. |

Unknown never disqualifies a home, including for Must-Haves.

## 3. Deferred — separate proposals (not in #145)

Each needs schema and/or a Match change made in both `computeMatch` and
`resolve_cobuyer_compare_perspectives` (pinned by `test/match-scorer-parity.test.js`).

| Proposal | Status |
| --- | --- |
| [Mudroom Match parity](proposals/mudroom-match-parity.md) | Built and validated against real Postgres; ready as its own PR. Completes the 34-option catalog once live. |
| [Garage location, size and No Garage](proposals/garage-location-size.md) | Proposal (priority). |
| [Basement finish and access](proposals/basement-finish-access.md) | Proposal (priority). |
| [First-Floor Primary shared-home evidence](proposals/first-floor-primary-evidence.md) | Proposal; only after JS/SQL parity and Unknown behavior are verified. |
| [Add / Edit Home property-fact controls](proposals/add-edit-home-property-facts.md) | Proposal; sequenced after garage and basement. |
| Description-parsing rules for the new What Matters choices | Optional; explicit-phrase, yes-only, never for location choices. |

## 4. Product decisions (approved)

1. **No default Home type.** A new purchase search never starts with Single Family / House selected (both flows).
2. **Quiet Street and Low-Traffic Street** stay separate identities. Quiet Street is retired from new buyer selection; existing preferences are unchanged and keep counting.
3. **Walkable to Town and Walkable Neighborhood** stay separate identities for now (same treatment).
4. **Near Water** and **Privacy Fence** are display labels only; stored identities (`location:Near waterfront`, `exterior:Privacy Fencing`) are unchanged.
5. **Unfenced** means a genuine preference for a yard without fencing. It can be cleared at any time and is never chosen together with Fenced or Privacy Fence (on The Basics and in My Search).
6. **First-Floor Primary**: a reliable shared main-floor fact should eventually count as positive evidence — deferred until JS/SQL parity and Unknown behavior are verified ([proposal](proposals/first-floor-primary-evidence.md)).
7. **Optional Home preferences** all start Important and stay re-rankable in Rank Priorities and My Search.

## 5. QA for #145

- **Database-backed tests:** a disposable Postgres 16 cluster (`FLH_TEST_PGHOST`)
  runs the 71 tests that skip by default. Full suite run serially:
  **all pass, 0 skipped**. Running files in parallel against one cluster can
  fail in `createTestDatabase` with `duplicate key … pg_authid_rolname_index`
  (two files creating the cluster-wide `anon`/`authenticated` roles at once) —
  a race in the shared test harness, independent of this PR, not a product failure; use
  `--test-concurrency=1` or one cluster per file.
- **New DB coverage** (`test/home-preferences-db.test.js`): owner and co-buyer
  save their own Home preferences (never copied between them), they rank
  Important, re-ranking from My Search persists; the co-buyer edits multi-value
  layout/condition facts on the owner's home; clearing returns to Unknown;
  personal Yes/No stays personal; the owner's own Match equals the co-buyer's
  Compare projection (pct, selected, evaluated).
- **Browser QA** (`scripts/visual/onboarding-basics-e2e.mjs`, dev preview, 390 and
  1440px): brand-new user (nothing preselected, inline validation, focus moves,
  live flow completes to "Your search is ready"), returning user (saved type kept,
  re-choosing is a no-op, switching explains with Undo, budget label follows),
  keyboard (arrow keys between types, Space toggles), tap targets, no overflow.
- **Flows:** `CURRENT_ONBOARDING_VERSION` is 1; flow 1 is Basics → What Matters →
  Rank; V2 stays inactive.
