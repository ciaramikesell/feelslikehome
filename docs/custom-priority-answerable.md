# Custom priorities can be answered (Yes / No / Unknown)

## Bug

A buyer added a custom Must-Have, **Desirable Street**. It showed in Home
Details → Your Match as a read-only "— Unknown" with no Yes / No / Unknown
control, so it could not be answered on any saved home.

## Root cause

"Add your own" (My Search → Add a priority, and onboarding) defaults to the
first category, **Location**, whose `defaultCustomKind` was `'rating'`. A
rating priority is answered only after a tour, and only if it is one of the
catalog's tour criteria (`TOUR_CRITERIA`). A typed Location priority fell
between the two:

| Surface | Required | Desirable Street |
|---|---|---|
| Match Yes / No (`answerableCriteriaKeys`) | `kind === 'check'` | `rating`, so skipped |
| Tour Feedback (`inPersonCriteria`) | a tour criterion | not one, so skipped |
| `computeMatch` | read a 1–5 `ratings[key]` | nothing could write it, so always Unknown |

Pre-tour and after-tour criteria differ only by `TOUR_CRITERIA`. A custom
label is never in that list, so a typed priority was always "pre-tour" but
stored with an after-tour kind.

## Fix

* **One classifier**, `isYesNoCriterion(categoryKey, item)` in
  `src/lib/constants.js`. A priority is Yes / No when it is not a tour criterion
  and is either check-kind, or a buyer's own typed priority stored as `rating`
  outside Home Feel. A "buyer's own" label is any label the catalog never offered
  as a rating (`CATALOG_RATING_LABELS`, built from every catalog rating in the
  git history). Match (`answerableCriteriaKeys`), `computeMatch` and the
  Edit Home criteria list all use it.
* **Existing data works in place.** The stored priority (label, category,
  tier, kind `rating`) is not rewritten. No migration and no new columns.
* **At creation:** Location's `defaultCustomKind` is now `'check'`, the same
  kind as every Location suggestion. Home Feel keeps `'rating'` because it is
  judged in person. No new creation step was added.
* **Scoring is unchanged.** Answers go into the buyer's own
  `home_member_state.checks[key]` through `criterionAnswerPatch`, the same as
  any other Yes / No. Weights stay 4 / 2 / 1, and Unknown stays unscored. The
  SQL Compare scorer (`resolve_cobuyer_compare_perspectives`) was not changed:
  it already reads `ratings[key]` and then `checks[key]` for every item. The
  real-Postgres tests show that both scorers agree.
* **Earlier 1–5 ratings are kept.** If a typed priority holds a numeric
  rating from older UI, it keeps scoring, in the same order SQL reads it, until
  the buyer answers Yes or No. The answer patch then removes only that one key
  from `ratings`. Choosing Unknown never deletes it. Match shows
  "Earlier rating: n/5 · counts until you answer".

## Batch review ("Check against my homes")

The upcoming bulk workflow should offer only `answerableCriteriaKeys(priorities)`
and write through `criterionAnswerPatch`. Custom priorities are now included.
Tour criteria and catalog ratings are not.

## Tests

* `test/custom-priority-answerable.test.js`: reproduction (fails on the old
  code), Yes / No / Unknown, weights, earlier ratings, creation in every
  category and search type, preserved tour semantics, preserved board identity,
  and the read-only Realtor view.
* `test/custom-priority-answerable-db.test.js` (real Postgres): owner and
  co-buyer answers stay independent, JS and SQL scorers agree after every step,
  earlier rating then Yes, a new custom priority stored as `check`, archived
  homes keep their answers, and a Realtor write is denied (42501).
* `scripts/qa/custom-priority-answer-e2e.mjs`: browser QA at 1440 and 390
  against real Postgres. Screenshots are in `docs/custom-priority-answer-screenshots/`.

## Remaining risks

* A typed **Home Feel** priority in a rental or investment search still has no
  answer surface, because Home Feel is after-tour and custom labels are not tour
  criteria. It was left unchanged on purpose so after-tour semantics are not
  turned into checkboxes. This needs a product decision.
* Older catalog **rating** criteria that are not tour criteria (for example
  rental `Walkability`, `Proximity to Family / Friends`) are also unanswerable
  today. They are unchanged here because they are catalog items, not custom ones.
* `CATALOG_RATING_LABELS` is a fixed list. A future catalog rating must be added
  to it, or a stored item with that label would show as Yes / No.
