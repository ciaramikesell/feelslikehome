# UX: Simplify Home Details & Home Facts

Independent branch from verified `main` `94bfd86` (PR #203). PR #204 is untouched and is not a dependency. No schema, RLS, migrations, native configuration, onboarding, import mapping or scoring changes.

## Result

The photo stays left on desktop, with identity, saved year-built / annual tax metadata (including the saved tax year), and the participant's existing Your Match summary beside it. Phones stack the summary below the image. Missing metadata is omitted; absent photos retain the existing fallback. The summary reads the existing `computeMatch` result and `matchProgress` count; no household score or second scoring path is introduced.

Home Facts now uses open sections: Basic Details (estimated payment and one explicitly monthly HOA amount), Schools (District and Notes), Garage, Basement and Laundry. Pros & Cons remain their own editable section, with previously saved generic notes still available. Existing apartment/rental detail access is retained. The retained controls and their parsers/writers are unchanged.

The detailed section is Match Breakdown. View Match Details and legacy `?section=match` links focus and scroll the dialog's own scroll surface, with reduced-motion handling. This avoids moving the locked page behind the dialog.

## Data-flow audit and preservation

Reviewed `home-facts-match-parity.md`, `home-facts-match-fulfillment.md`, `home-facts-redesign.md`, `rentcast-import-accuracy.md`, the shared-field writer/mappers, import normalization, Match criteria resolution and both participants' projections before changing the form.

- The shared writer still updates only changed columns. Removing a control does not send a null, remove a mapper, or rewrite import snapshots.
- Cooling, heating, year/tax data, property type/layout/condition and HOA status remain stored and imported through existing paths. Central Air still uses accepted cooling evidence. Unknown remains distinct from No, and an explicit participant answer still wins.
- Ranked Type, Layout and Condition facts can be edited in Match Breakdown, using existing choices, layout patching and shared writes. The UI explicitly identifies these as shared facts. No HOA and Central Air retain their existing personal Yes / No / Home Facts controls. Co-buyers keep independent answers and scores.
- School-name inputs previously reappeared because each rendered whenever its corresponding saved column was truthy. District and Notes already have independent mappings; neither needs a fallback to a legacy name. Those name inputs are now absent unconditionally, including after clears and refresh. Legacy elementary/middle/high values are preserved in storage. There is no destructive cleanup or automatic migration into Notes.
- Hidden HOA/cooling evidence remains explained in Match without linking to a removed editor. Existing Garage/Basement/Laundry evidence links still work.

## Verification

- Production `npm run build`: passed (Next 15.5.29).
- Full `npm test` with real local PostgreSQL 17: **1,668 passed, 0 failed, 2 skipped** (optional sanitized live RentCast fixtures).
- New database regression exercises co-buyer retained-field edits and school clearing; proves hidden facts/import snapshots/legacy school columns survive, owner Central Air No overrides imported Central cooling, and the co-buyer's separate Match still reads that shared evidence.
- Browser runner: `scripts/qa/saved-details-refinement.mjs`. Real Chromium, production build, local Supabase HTTP stand-in backed by real PostgreSQL/RLS. Tests retained text and select edits through reload, hidden-data preservation, ranked type editing, keyboard focus/jump, legacy Match URL, and co-buyer/Realtor view boundaries.
- Screenshots: [index](saved-details-refinement-screenshots/README.md). Before/after overview, complete scroll surface and Home Facts closeups at **390, 768, 1024, 1440px**, populated and missing-data examples.

The full screenshots temporarily expand the dialog's scroll surface only during capture; overview screenshots show its actual live viewport. QA data is disposable test data, not a live listing or a score promised to buyers. Photography is the existing FLH cottage asset. Google Fonts requests are blocked in this environment: the browser runner serves genuine Fraunces, DM Sans, Cormorant Garamond, Source Serif 4 and Plus Jakarta Sans files locally for captures. No fallback fonts are substituted and no production font configuration changes.

## Founder QA

- [ ] Review desktop photo/summary balance and phone stacking, including missing photo/price/taxes and unknown Match.
- [ ] Edit monthly payment, HOA fee, District, Notes, Garage, Basement, Laundry, Pros and Cons; close, reopen and refresh.
- [ ] Clear school notes/district and verify legacy school inputs stay absent while previously saved names remain stored.
- [ ] Follow View Match Details by keyboard; check the breakdown heading and focus. Try an older `?section=match` URL.
- [ ] With Type/Layout/Condition ranked, edit their facts from Match Breakdown. Verify No HOA and Central Air personal overrides and co-buyer independence.
- [ ] Review a shared home as a Realtor: facts remain read-only.

## Limits and review safeguards

No Production services were contacted for QA, and no live RentCast lookup was made. The HTTP stand-in cannot prove hosted-service delivery or physical iOS behavior. Historical school-name data is intentionally retained but no longer editable in routine Home Facts. Heating/cooling/year/tax controls are intentionally absent here; existing imported/stored evidence stays active. Review and approve before merging or deploying.
