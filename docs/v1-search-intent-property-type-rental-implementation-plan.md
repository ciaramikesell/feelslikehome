# V1 pre-beta search intent, property type, and Rental implementation plan

## Scope and safety contract

This is an implementation plan derived from the current `main` architecture. It does not change application behavior, the database schema, production data, Vercel, Supabase, environment variables, RLS, or grants. Every later database change in this plan is additive and manually operated; committing SQL does not apply it to production.

The safe release boundary is six small passes. Pass A can ship independently. Pass B establishes dormant, nullable shared fields and privacy controls before any client can address them. Passes C–E activate behavior in separately reviewable application PRs. Pass F is a no-schema release gate and regression exercise.

## Decisions to carry into every pass

### Canonical intent model

Store these exact values for newly created or explicitly re-saved searches:

| Canonical intent | Stored value | Display label |
| --- | --- | --- |
| Purchase | `purchase` | Purchase |
| Rental | `rental` | Rental |
| Investment Property | `investment` | Investment Property |

`investment` is retained because it is already the current stable value and changing it adds no product value. `purchase` and `rental` clearly distinguish the new model from raw historical values. Search intent remains inside each participant's private `search_member_priorities.priorities` JSON document; no `searches` column or enum is needed.

Create one pure compatibility module (recommended: `src/lib/searchIntent.js`) with:

- `normalizeSearchIntent(rawSearchType)`, returning a canonical intent or `null`;
- `searchIntentCapabilities(rawSearchType)`, returning booleans such as `isPurchase`, `isRental`, `isInvestment`, `showsRentalFacts`, `showsPurchaseFinancials`, and the applicable preferred-property options;
- `canonicalSearchTypeForWrite(rawSearchType)`, used only when a participant saves onboarding/My Search;
- display terminology derived from normalized intent, not comparisons scattered through components.

Exact normalization map:

| Raw value | Normalized intent | Next explicit save |
| --- | --- | --- |
| `buy` | `purchase` | `purchase` |
| `purchase` | `purchase` | `purchase` |
| `rent_home` | `rental` | `rental` |
| `rent_apartment` | `rental` | `rental` |
| `rental` | `rental` | `rental` |
| `investment` | `investment` | `investment` |
| empty, null, unknown | `null` | do not invent a selection |

The raw `priorities.searchType` must remain available for legacy catalog hydration during the transition. Normalization must not mutate an object on read. When a legacy participant opens and saves My Search, write the canonical intent while merging the complete existing priority document, including hidden core items, custom items, tiers, ordering, schools relevance, and any criteria no longer suggested. Never replace the document with a fresh default. A `rent_apartment` value may preselect `apartment` in the editor as a non-persisted hint only when no preferred-property selection exists; it must not write that preference until the participant confirms/saves, and it must never infer a home's actual type.

### Property type model

Use the following exact actual-home values:

`apartment`, `house`, `townhome`, `condo`, `multifamily`, `other`.

Use `NULL` for unknown. Do not add an `unknown` string. `other` means a participant affirmatively selected Other; `NULL` means no trustworthy answer. Add a nullable `homes.property_type text` with a check constraint permitting only those six values. In application objects map it to `propertyType`.

Preferred types remain private in `search_member_priorities.priorities` under:

```json
"preferredPropertyTypes": {
  "values": ["apartment", "townhome"],
  "tier": "important"
}
```

This reuses the existing multiselect-plus-tier Match pattern without confusing an actual shared fact with a preference. Purchase offers `house`, `condo`, `townhome`, `multifamily`; Rental offers `apartment`, `house`, `townhome`, `condo`. Selection is optional and never filters Add Home, cards, lists, Map, or browsing.

Investment keeps `investmentPropertyTypes` and `planningToLiveIn` unchanged in this pass. Those values describe the participant's investment strategy and include unit-configuration concepts (`Duplex`, `Triplex`, and so on) that do not map losslessly to the universal actual type. Investment Add/Edit may store `homes.property_type` when a trustworthy broad type is known, but the new preference question and Match criterion are not enabled for Investment. Do not synchronize or overwrite either representation. A future audited convergence may map `Single-Family` to `house` and multi-unit choices to `multifamily`; V1 must merely avoid presenting contradictory duplicate preference controls.

### Shared Rental V1 columns

Add exactly these nullable columns to `public.homes`:

| Column | PostgreSQL type | Meaning |
| --- | --- | --- |
| `property_type` | `text` + allowed-value check | Universal actual property type; null is unknown |
| `available_on` | `date` | Rental availability date; null is unknown/not supplied |
| `pets_allowed` | `boolean` | Shared Yes/No; null is Unknown |
| `utilities_included` | `boolean` | Shared Yes/No; null is Unknown |
| `in_unit_laundry` | `boolean` | Shared Yes/No; null is Unknown |

`date` is preferable to text for `available_on`: the approved fact is a calendar date, HTML date controls round-trip it without timezone ambiguity, PostgreSQL rejects malformed values, and it remains sortable/formatable later without introducing availability history. The UI should allow clearing it and display a locale-formatted date. If a listing only says “available now,” leave the column null and preserve that phrase in Notes rather than fabricate a date.

Reuse `homes.price` for Purchase price and Rental monthly rent. Do not add `monthly_rent`. Retain `est_monthly`, HOA, property-tax, lot, and other valid columns for Purchase and legacy readability, but suppress inappropriate Rental presentation. Reuse `garage_spaces` and the existing Parking/Garage criteria; do not add parking schema.

### Shared facts, private importance, and legacy precedence

For `Pets Allowed`, `Utilities Included`, and `In-Unit Laundry`:

1. The participant's tier in their own priorities decides whether the criterion is selected and its weight. No other participant's tier is exposed.
2. A non-null new shared column is the authoritative factual answer for every participant: `true` is satisfied, `false` is a confirmed mismatch.
3. If the shared column is null, Match returns Unknown. It must not fall back to a participant-private legacy check, because doing so would recreate separate realities and could reveal different Match outcomes based on an obsolete personal assertion.
4. Legacy checks remain stored and readable in `home_member_state.checks`; they are never deleted or rewritten. When no shared fact exists, legacy checks may be displayed in a clearly personal, legacy-only section (“Your previous note: Yes/No; confirm as a shared property fact”) but must not silently populate or score the shared fact.
5. Once a shared value exists, Add/Edit and Match use it; the legacy check is hidden from normal first-class controls but retained. If surfaced for migration assistance, it is labelled historical and never overrides the shared value.
6. Editing the shared value updates one `homes` row and is immediately shared with collaborators. Clearing it returns all participants' Match state for that criterion to Unknown.
7. New first-class controls must never write these three keys to `home_member_state.checks`. All other legacy/custom checks remain private and continue through the existing path.

Label aliases should recognize exact historical `features:Pet Policy` as the legacy predecessor of `features:Pets Allowed` only for the confirmation affordance; do not rename JSON keys in bulk. Existing selected `Pet Policy`, `Lease Terms`, `Maintenance Responsibility`, or catalog-specific criteria remain in `customItems`/tiers and continue to render. New Rental suggestions use `Pets Allowed`, omit `Pet Policy`, `Lease Terms`, `Maintenance Responsibility`, and `Pet Rent / Fees`; Notes and “+ Add your own” remain available. Optional `Dogs Allowed`/`Cats Allowed` suggestions are deferred until beta evidence requests them.

### Rental criteria bank

Build one `rental` catalog in `getItemlistCategories` by reusing exact existing labels before adding only absent approved labels. Preserve category-key and label identity where it already exists, including the display-only Privacy overrides. Recommended new-user bank:

- **Location:** existing Schools, Commute, Neighborhood, Walkability, Immediate Street / Surroundings, Parks Nearby, Proximity to Family / Friends, Dog Parks Nearby, Groceries Nearby, Restaurants / Coffee / Shopping Nearby.
- **Home Features:** existing Basement, Fireplace, Primary Ensuite, Central Air, Home Office, Finished Basement, Mudroom, Pantry, Storage, Updated Kitchen, Updated Bathrooms, Walk-In Closet, Guest / In-Law Suite; first-class shared-check criteria Pets Allowed, Utilities Included, In-Unit Laundry; add Dishwasher only if absent after the implementation audit.
- **Exterior & Property:** reuse Garage, Fenced Yard, Patio / Deck / Outdoor Living, Driveway / Off-Street Parking, Parking, existing two Privacy concepts; carry Outdoor Space, Elevator, Noise Level; add Building Amenities only once and do not duplicate Parking/Garage/Driveway.
- **Home Feel:** existing Overall Condition, Layout / Flow, Natural Light, Character / Charm, Room Sizes and experiential Privacy; expose experienced Noise using the existing `exterior:Noise Level` identity rather than creating a second identical label. Keep experiential classification centralized in `isExperientialCriterion`.

This is a suggestion bank, not an onboarding questionnaire. Onboarding asks only intent, optional preferred types, and the existing deliberately small basics/priority flow. CriteriaPicker's custom criterion path remains unchanged. Legacy `rent_home` and `rent_apartment` selected criteria are unioned into the rendered selected set even if no longer suggested.

## PASS A — compatibility layer and characterization tests

### 1. Goal

Introduce pure intent normalization/capabilities and lock current legacy behavior with tests, without changing visible options, stored values, writes, or schema.

### 2. Exact files, components, and functions

- Add `src/lib/searchIntent.js` with the pure functions above.
- Refactor only safe library consumers in `src/lib/constants.js`: `isRentalType`, `isSimpleRentalType`, `showsHomeLayout`, `showsMultiselectCategory`, `searchTypeLabel`, and `terminology` to delegate to capabilities while preserving current output in this pass.
- Characterize `getItemlistCategories`, `defaultPriorities`, `normalizePriorities`, `computeMatch`, and `parseListingText` in a new `test/search-intent-compatibility.test.js` (or focused matching/constants test files).
- Audit direct scalar branches with `rg "rent_home|rent_apartment|buy|investment" src test` and record remaining call sites in the PR description; do not opportunistically alter UI.

### 3. Data-model changes

None. `priorities.searchType` remains raw JSON; no write conversion yet.

### 4. Runtime compatibility

All four legacy raw values normalize as specified, unknown values fail closed, and existing visible behavior remains byte-for-byte equivalent. Legacy catalogs remain callable by raw value.

### 5. Privacy implications

None. The module operates only on the current participant's already-resolved priorities. No RPC, RLS, grants, or projections change.

### 6. Tests

- Table-driven normalization and capabilities for canonical, legacy, empty, and malformed values.
- Legacy catalog snapshot/label assertions for both rental variants.
- `normalizePriorities` preservation tests for unknown/custom keys and old partial documents.
- Existing full `npm test` and `npm run build`.

### 7–8. Migration and production timing

No migration. No Supabase action.

### 9. Preview/manual QA

Use seeded JSON for `buy`, `rent_home`, `rent_apartment`, and `investment`; verify onboarding/My Search/Homes/Compare still render as before. No production data write.

### 10. Merge/deployment gate

May merge and deploy after tests and preview parity. It must precede every later pass so no feature adds more raw scalar branching.

## PASS B — additive shared schema and Pass 3C privacy boundary

### 1. Goal

Install dormant nullable shared columns, exact column privileges, mapper support, sanitized RPC support, verification SQL, and privacy tests before any UI writes them.

### 2. Exact files, components, and functions

- Create one migration at implementation time, e.g. `supabase/migrations/YYYY-MM-DD-rental-v1-shared-facts.sql` (not in this planning task).
- Update the canonical bootstrap `supabase/schema.sql` in the same schema PR.
- Update `src/lib/supabase/collaboration.js`: `HOME_SHARED_COLUMNS`, `SHARED_FIELDS`, `rowToHomeWithOwner`, and `homeToSharedRow`.
- Update `src/lib/constants.js:emptyHome` with null defaults.
- Replace/update `resolve_shared_fact_priority_awareness` and `resolve_cobuyer_compare_perspectives` definitions in the migration and `schema.sql`.
- Add a focused operator verifier such as `supabase/rental-v1-shared-facts-verification.sql`; update `supabase/3c3-production-preflight.sql`, `supabase/3c3-production-preflight-verdict.sql`, and `supabase/3c3-production-verification.sql` wherever their exact shared/private column inventories require it.
- Extend `test/database-privacy-enforcement.test.js`, `test/privacy-foundation-sql.test.js`, `test/application-privacy-cutover.test.js`, and shared-fact awareness/Compare tests (new focused test if clearer).

### 3. Data-model changes

Add the five nullable columns exactly as defined above and a `property_type` check constraint using `NOT VALID`, then `VALIDATE CONSTRAINT` after the add (existing rows are null, so validation is safe). Do not backfill any row. Add all five to authenticated SELECT, INSERT, and UPDATE column grants and the application's shared allowlists. Do not grant table-wide privileges and do not alter identity triggers or row policies.

Extend shared-fact awareness mappings:

- `propertyType` -> `preferredPropertyTypes`;
- `petsAllowed` -> `features:Pets Allowed`;
- `utilitiesIncluded` -> `features:Utilities Included`;
- `inUnitLaundry` -> `features:In-Unit Laundry`.

`availableOn` is informational and has no priority-awareness row. Awareness output remains only booleans plus public criterion keys. Extend the sanitized co-buyer Compare RPC to score property type and the three shared booleans from `homes`, honoring null as unevaluated. It must not project their raw priority documents, tiers, or legacy checks.

### 4. Runtime compatibility

Old homes map null for every new field. Existing personal `checks` are untouched. During this dormant pass, mapper round-trips nulls but no new UI depends on them. The Compare RPC continues scoring all old criteria and adds new branches only when a participant has new preference keys.

### 5. Privacy implications

All five fields are approved shared reality and visible/editable to accepted search participants under existing `can_access_search`-based homes RLS. They enter restricted column allowlists explicitly. `available_on` and factual booleans need no raw co-buyer-priority exposure. The awareness RPC may reveal only that a fact is worth capturing, as it already does for approved shared facts. The Compare RPC may reveal only sanitized score counts/percentage, never another participant's selected values, tier, or legacy checks. No broad privileges, private checks, priorities, commute destinations, lifecycle state, or evaluations move to `homes`.

### 6. Tests

- Migration text/schema parity and exact five-column type/nullability/constraint checks.
- Authenticated owner and collaborator can select/update allowed new columns on an accessible home.
- Stranger cannot select the row; participant cannot mutate identity; authenticated cannot `SELECT *` or read legacy private homes columns.
- Participant A cannot read Participant B priorities/checks; awareness output is tier-free; sanitized Compare includes shared facts without raw values.
- Null boolean/property type is unevaluated, false is mismatch, true is satisfied in both JS and SQL scoring parity fixtures.
- Existing Pass 3C, lifecycle, commute, save-reliability, full test, and build suites.

### 7. Migration

Yes: one additive, transactional migration containing columns, constraint, column grants, and `CREATE OR REPLACE` RPC bodies. No data rewrite.

### 8. Exact production migration timing

1. Create the migration file only in the dedicated Pass B schema/privacy PR after Pass A is deployed and production Pass 3C.3 is confirmed healthy.
2. Review and merge the Pass B repository PR; this merge alone does not execute SQL and the dormant app version must tolerate both old and new schemas.
3. In a maintenance/observed window, manually run the migration against production Supabase before merging any Pass C, D, or E application PR that selects/writes the new columns.
4. Immediately run the focused rental verifier, updated 3C.3 preflight/verdict/verification SQL, and two-account privacy smoke tests. Confirm PostgREST can explicitly select/upsert all five columns and still rejects broad/private access.
5. Only after verification is green record the production migration version and unlock application PR merges.

Application PRs that reference the columns may merge **only after** the production migration exists and verification passes. The schema PR itself may merge first because it does not activate UI behavior and migrations are manual.

### 9. Preview/manual QA

Against an isolated Supabase preview project: apply the full schema from scratch and the migration over a Pass 3C fixture; open old homes, save an unrelated shared field, collaborate, and verify nulls are not transformed. Do not point previews at production.

### 10. Merge/deployment gate

Gate on migration idempotence in a disposable database, schema/migration parity, all privacy tests, manual production application, post-apply verifier success, and a recorded rollback owner.

### Rollback strategy

Do not drop the columns or erase data. If verification fails inside the transaction, roll back the transaction. If a post-commit RPC/grant defect appears, keep nullable columns, redeploy the previous RPC definitions and previous exact ACL set from a reviewed corrective SQL script, and keep Pass C–E blocked. If application activation later fails, roll back the Vercel deployment; dormant columns remain harmless. Dropping columns is not an approved rollback.

## PASS C — canonical new search UX, unified criteria, and property-type Match

### 1. Goal

Offer Purchase/Rental/Investment Property to new users, add optional private preferred property types for Purchase/Rental, unify the new Rental criteria bank, and score actual-vs-preferred type through existing Match.

### 2. Exact files, components, and functions

- `src/lib/constants.js`: `SEARCH_TYPE_OPTIONS`, `defaultPriorities`, `normalizePriorities`, property-type options, `getItemlistCategories`, experiential set, `searchTypeLabel`, terminology, visibility helpers, and whole-app Must Have description constant.
- `src/lib/searchIntent.js`: activate canonical write/display capabilities.
- `src/components/onboarding/Onboarding.jsx`: intent choices; optional multiselect question after Purchase/Rental; tier selector; corrected Must Have copy.
- `src/components/MySearchPanel.jsx`, `PriorityBoard.jsx`, and `CriteriaPicker.jsx`: edit preferred types, canonical intent save, unified Rental bank, legacy selected-item union, and unchanged custom criterion behavior.
- `src/lib/matching.js:computeMatch`: add preferred-property criterion using `home.propertyType`; update parser signature/tests preparation but leave parser behavior for Pass D.
- `supabase/schema.sql:resolve_cobuyer_compare_perspectives` was prepared in Pass B; validate parity rather than introduce another migration.
- Add/update `test/search-intent-compatibility.test.js`, matching tests, onboarding/UX tests, and SQL parity fixtures.

### 3. Data-model changes

No schema change. Add `preferredPropertyTypes` only to the current participant's JSON priority shape. Explicit save canonicalizes `searchType`; reads remain non-mutating.

### 4. Runtime compatibility

New users see only three intents. Existing raw values render under normalized labels/capabilities. Selected legacy criteria remain in their saved categories and never disappear even when removed from new suggestions. Editing and saving merges legacy selections and canonicalizes only the intent. A legacy apartment hint is optional/non-persisted until confirmed. Preferred types never constrain adding or viewing a home. Unknown actual type produces Unknown in Match; disjoint known types produce a weighted mismatch; any overlap satisfies.

Lease Terms and Maintenance Responsibility disappear only from new suggestions, not from stored selections. `Pet Policy` stays visible for a legacy participant who selected it; new users select `Pets Allowed`. Correct Must Have copy everywhere it is explained to “One of your highest priorities.” Do not alter tier weights or disqualify homes.

### 5. Privacy implications

Preferred types remain in `search_member_priorities`, resolved only for the caller. Shared-fact awareness and Compare consume them inside the sanitized RPC prepared in Pass B. Components must not receive a co-participant's priority document.

### 6. Tests

- Three-option new onboarding and exact options per Purchase/Rental; optional empty submission.
- Multiselect/tier persistence, no hard filtering, null/true mismatch Match cases, Must Have remains weight 4 rather than exclusion.
- Legacy edit/save retains custom, hidden, ordered, unique-catalog, Lease Terms, Maintenance Responsibility, and Pet Policy data while writing canonical intent.
- Unified Rental catalog has no duplicate identity/label, keeps “+ Add your own,” and does not show removed contractual criteria to new users.
- JS/SQL sanitized Match parity for the new preference.
- Full test/build and accessibility keyboard/ARIA checks for chips.

### 7–8. Migration and timing

No new migration. Depends on Pass B being manually present and verified in production before this application PR merges.

### 9. Preview/manual QA

Run four fixtures: brand-new Purchase, brand-new Rental, legacy `rent_home`, legacy `rent_apartment`; plus Investment to prove no redesign. Use two users with different preferred types and tiers. Confirm My Search is concise and criteria are opt-in.

### 10. Merge/deployment gate

Merge only after the Pass B production schema gate, normalized-intent tests, legacy edit/save fixtures, and preview approval. Deploy independently of Pass D so search changes can be rolled back alone.

## PASS D — Rental shared facts, Add/Edit, and import

### 1. Goal

Capture/edit the approved shared facts with progressive disclosure, route them through shared mappers, feed Match from shared booleans, and fix rental paste parsing without adding APIs.

### 2. Exact files, components, and functions

- `src/components/HomeModal.jsx`: `PropertyFacts`, form defaults, `set`, paste/import handlers, fact summary, Yes/No/Unknown controls, progressive shared-awareness UI, and Rental/Purchase visibility.
- `src/lib/constants.js:emptyHome` and property option constants.
- `src/lib/supabase/collaboration.js`: validate mapper/read/write and `SHARED_FIELDS` behavior from Pass B.
- `src/lib/matching.js:parseListingText` and `computeMatch` shared-fact branches.
- `src/lib/homeDisplay.js`: intent-aware found-card formatting.
- `src/lib/rentcast.js:normalizeRentCastFields` only for fields with documented trustworthy mappings.
- `src/app/api/import-listing/route.js`: preserve existing sale versus `/v1/listings/rental/long-term` endpoint selection and pass normalized intent/mode safely.
- Tests: extend import/RentCast/matching/save-reliability and HomeModal behavior suites.

### 3. Data-model changes

No new schema beyond Pass B. Store booleans as `true`, `false`, or `null`; date as ISO `YYYY-MM-DD`; actual type as one allowed lowercase value; monthly rent in `price`.

### 4. Runtime compatibility

Rental Add/Edit shows Actual Property Type, Monthly Rent, Available On, and three optional tri-state facts. Purchase shows Property Type and existing Purchase facts, not availability/rental booleans. Investment remains current behavior with optional broad actual type only if product placement is unambiguous; otherwise defer its control while retaining mapper compatibility.

`parseListingText` must accept intent/mode. For Rental, `$X/mo` writes `price` and never `estMonthly`; Purchase monthly-payment phrases may continue to populate `estMonthly`, while a Purchase list-price phrase populates `price`. Existing saved `estMonthly` is retained but hidden in Rental UI. RentCast may populate `property_type` only if its documented source value maps exactly to the six-value vocabulary; otherwise leave null. Populate no availability/pets/utilities/laundry value without an explicit, documented endpoint field and fixture. Unknown beats inference.

On initial shared fact entry, show the shared marker/awareness already used for shared facts. Saving a boolean must remove no private check. Normal controls read the shared column according to the precedence rules above.

### 5. Privacy implications

All five writes use `saveHomePersonalAndShared`; none enter `personalStateFromHome`. Other checks/ratings remain in caller-owned `home_member_state`. Awareness remains sanitized and never says which tier the collaborator selected. The UI must clearly say shared edits are visible to collaborators.

### 6. Tests

- Rental paste `$2,200/mo` -> `price: "2200"`, no `estMonthly`; Purchase list price/payment cases remain correct.
- RentCast mode keeps exact rental endpoint and only maps trustworthy values.
- Tri-state round-trip, clear-to-null, date round-trip/no timezone shift, allowed type values, and optional submission.
- Participant A edits a fact and Participant B reads the same value; each participant's importance and non-first-class checks remain private.
- Shared value precedence over legacy check; null shared value remains Unknown even with old personal check; no legacy data deletion.
- Add a House despite Apartment/Townhome preference and show an honest mismatch rather than blocking.
- Full test/build/accessibility suite.

### 7–8. Migration and timing

No new migration. Pass B must already be manually applied and verified before this PR merges. If Pass B is absent in any environment, do not deploy Pass D there.

### 9. Preview/manual QA

Test Add and Edit separately on mobile and desktop for Purchase and Rental. Verify compact default disclosure, keyboard-accessible Unknown/Yes/No, clear date, import from rental and sale fixtures, collaborator shared marker, and legacy check notice. Confirm Add Home does not become a long application form.

### 10. Merge/deployment gate

Require production schema readiness, parser regression tests, two-user preview, and no untrusted RentCast inference. Can deploy after Pass C; do not couple to presentation cleanup so writes can be isolated.

## PASS E — intent-aware presentation and collaboration language

### 1. Goal

Make every approved display surface consistently Rental-aware while leaving Purchase presentation unchanged except approved labels/type support.

### 2. Exact files, components, and functions

- `src/lib/searchIntent.js` and `src/lib/homeDisplay.js`: central formatters for price label/value/suffix and visible fact rows.
- `src/components/HomesBoard.jsx` (covers Homes, Want to Tour, Favorites, Archive cards): `/mo`, no estimated-payment line for Rental, optional type.
- `src/components/HomeDetail.jsx`: Monthly Rent `/mo`, Rental fact set, Available On, no Purchase financial rows.
- `src/components/CompareBoard.jsx`: replace fixed `HOME_FACT_ROWS` with intent-filtered rows; Monthly Rent; suppress `estMonthly`, `$/sq ft`, HOA, property tax, lot/other rows judged inappropriate for Rental; include shared facts with Unknown display.
- `src/components/SavedHomesMap.jsx`: `/mo` preview and optional property type.
- `src/components/CoBuyerHomesLine.jsx`, `InviteCoBuyer.jsx`, `CoBuyerManagement.jsx`, `SearchSwitcher.jsx`, `AppShell.jsx`, `DecisionNav.jsx`, `src/app/(app)/tour/page.js`, invitation copy, and any copy found by `rg -ni "buy|buyer|purchase|rent|price|payment|hoa|property tax|sq ft" src`: use “collaborator”/“searching together” or intent-aware nouns without changing architecture.
- Pages under `src/app/(app)/homes`, `tour`, `favorites`, `archive`, `compare`, `map`, and `homes/[homeId]` should continue passing the caller's normalized priorities; no duplicate intent logic in pages.
- Extend accessibility/UX, map, and presentation tests.

### 3. Data-model changes

None.

### 4. Runtime compatibility

One formatter handles raw legacy and canonical intents. Rental uses “Maximum Monthly Price” in search preference copy, “Monthly Rent” for facts, and `$X/mo`. Purchase uses “Maximum Price” and “Price.” Legacy values render identically to their normalized intent. Existing Purchase-only fields remain stored and readable even when suppressed for Rental. Available On is useful but secondary; Unknown shared booleans display as Unknown, not No.

### 5. Privacy implications

Presentation may render shared home facts and sanitized awareness/Compare results only. It must not surface a collaborator's raw tier, check, or priority. Universal collaboration copy changes nouns, not permissions or data flows.

### 6. Tests

- Matrix assertions for canonical plus legacy intents across card, Detail, Compare, and Map price labels/suffixes.
- Rental absence assertions for estimated monthly payment, `$/sq ft`, HOA, property tax, and other approved suppressed rows.
- Purchase presence/regression assertions.
- Unknown/false/true shared-fact display, available-date formatting, property type labels.
- Copy scan: no inappropriate “Buying together?/co-buyer” global CTA and no Rental purchase terminology.
- Full test/build and targeted accessibility/map tests.

### 7–8. Migration and timing

No migration. It still depends on verified Pass B in production because it renders new fields. Merge only after Pass D data-entry behavior is stable in preview (or feature-gate new rows until D is deployed).

### 9. Preview/manual QA

Exercise all listed routes for Purchase, Rental, both legacy rental raw values, and Investment at phone/tablet/desktop widths. Check zero/null/large rents, no-price states, date locale display, Map preview, Compare with mixed known/unknown facts, and universal invite copy.

### 10. Merge/deployment gate

Require surface matrix sign-off and zero Purchase regressions. Deploy independently; Vercel rollback restores prior presentation without touching shared data.

## PASS F — legacy, collaboration/privacy, and beta release gate

### 1. Goal

Prove end-to-end safety using realistic old documents and two-user collaboration before declaring Rental V1 beta-ready.

### 2. Exact files, components, and functions

- No feature files by default. Add regression fixtures/tests under `test/` only when a gap is discovered.
- Run `supabase/rental-v1-shared-facts-verification.sql`, updated Pass 3C preflight/verdict/verification scripts, and the operator steps in `docs/pass-3c3-operator-runbook.md` (update documentation only if the established procedure requires the new fields).
- Validate all route components named in Pass E and both sanitized RPCs.

### 3. Data-model changes

None; no cleanup/backfill/mass conversion.

### 4. Runtime compatibility

Fixture matrix includes pre-collaboration owner data, `buy`, `rent_home`, `rent_apartment`, `investment`, unique old rental criteria, boolean `false`/`true`/`"no"` checks, missing keys, custom criteria, homes with null new facts, and homes with new facts. Edit/save must preserve unknown JSON keys and all old selections.

### 5. Privacy implications

Two authenticated accounts plus a stranger must demonstrate: one shared home truth; separate importance, lifecycle, ratings, checks, favorites, and commute destinations; sanitized awareness and Compare only; no broad grants; stable RLS.

### 6. Tests

- `npm test`, `npm run build`, targeted privacy SQL tests, migration verifier, and schema-from-scratch check.
- End-to-end two-user matrix and all route/surface checks.
- Inspect network payloads: no collaborator priority/check document; shared writes contain only allowlisted homes columns; personal writes target only caller-owned state.
- Vercel preview smoke, import fixture smoke, and accessibility keyboard/screen-reader labels.

### 7–8. Migration and timing

No migration. Re-run production verification read-only after the final deployment; do not apply additional SQL unless a separately reviewed corrective migration is required.

### 9. Preview/manual QA

Complete the final checklist below in an isolated preview first, then a minimal non-destructive production smoke with designated test accounts. Never edit real user homes for QA.

### 10. Merge/deployment gate

No beta flag until every checklist item passes, production migration/version is recorded, privacy reviewers sign off, and rollback links for Passes C–E are ready. Any privacy failure blocks beta and triggers application rollback; it does not justify broadening grants.

## Migration dependency graph

```text
Pass A (no DB)
  -> Pass B schema/privacy PR merged
  -> Pass B migration manually applied to production
  -> focused verifier + Pass 3C verification + two-user ACL smoke PASS
  -> Pass C application PR
       -> Pass D application PR
            -> Pass E application PR
                 -> Pass F beta gate
```

There is one planned migration-bearing pass: Pass B. Keeping columns, grants, RPC replacements, verifier, and canonical `schema.sql` together prevents a partially private shared-fact model. If operational review requires splitting it, split only into B1 (columns/check constraint/grants) and B2 (RPC replacements), apply and verify B1 then B2 in the same observed window, and prohibit all application merges until both succeed.

## Final beta acceptance checklist

### Intent and legacy

- [ ] New onboarding offers exactly Purchase, Rental, Investment Property.
- [ ] New writes store `purchase`, `rental`, or `investment`; all four legacy values remain readable.
- [ ] Opening a legacy search performs no write; explicit My Search save canonicalizes intent and preserves every priority/custom key/order.
- [ ] `rent_apartment` never infers a historical home's property type.
- [ ] Investment living plan/property preferences behave exactly as before and do not conflict with actual `homes.property_type`.

### Preferences and Match

- [ ] Purchase and Rental preferred types are optional, multiselect, private, tiered, and non-restrictive.
- [ ] Known overlap satisfies, known disjoint type mismatches, and null actual type is Unknown.
- [ ] Shared Rental booleans score Yes/No/Unknown correctly from `homes`, with personal importance.
- [ ] False Must Have strongly affects weighted Match but never hides/disqualifies a home.
- [ ] Whole-app Must Have explanation says “One of your highest priorities.”
- [ ] Unified Rental suggestions contain no accidental duplicates; old selected criteria and custom criteria remain visible.
- [ ] Lease Terms/Maintenance Responsibility are absent from new suggestions but preserved for legacy participants.

### Shared Home experience

- [ ] Purchase Add/Edit supports optional actual property type.
- [ ] Rental Add/Edit supports optional actual type, Monthly Rent, Available On, and three tri-state facts without clutter.
- [ ] Collaborators see the same shared values and clear changes return Unknown.
- [ ] Legacy personal checks remain stored; shared values take precedence; null shared values do not silently score old checks.
- [ ] No historical backfill or destructive conversion occurred.

### Import and presentation

- [ ] Rental `$X/mo` paste populates `price`, never `estMonthly`.
- [ ] RentCast rental endpoint behavior is unchanged and no unsupported inference is made.
- [ ] Rental cards/lists, Detail, Compare, and Map consistently show Monthly Rent/`/mo`.
- [ ] Rental surfaces do not show estimated monthly payment or inappropriate Purchase comparison rows.
- [ ] Purchase surfaces retain expected facts and terminology.
- [ ] Available On and shared facts are informative and secondary; Unknown never looks like No.
- [ ] Collaboration copy works for Purchase, Rental, and Investment without a second collaboration system.

### Privacy, operations, and rollback

- [ ] Five shared columns exist with exact types/nullability and `property_type` constraint; existing rows remain null unless explicitly edited.
- [ ] Exact authenticated SELECT/INSERT/UPDATE grants include them; broad access and private legacy columns remain denied.
- [ ] Application allowlists/mappers round-trip them and identity protection remains active.
- [ ] Awareness and Compare RPCs expose only sanitized results and match JS semantics.
- [ ] Participant-private priorities, checks, ratings, lifecycle, favorites, and commute destinations remain isolated in two-user tests.
- [ ] Focused migration verifier and all updated Pass 3C scripts pass in production after manual application.
- [ ] Full automated tests/build and every manual route matrix pass.
- [ ] Vercel rollback targets are recorded; database rollback is non-destructive (disable app use/restore reviewed RPC+ACL definitions, retain columns/data).

## Explicitly deferred

No pass above implements lease duration/renewal, deposits/fees/concessions, recurring costs, parking costs/entities, pet restrictions/costs, amenity taxonomy, building/unit entities, availability/rent history, rental applications or lease lifecycle, discovery feeds, new lifecycle states, destructive inference/backfill, or a separate Rental Match engine.
