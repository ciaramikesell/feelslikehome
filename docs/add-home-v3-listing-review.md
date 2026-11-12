# Add Home V3, phase 2: one simple listing review

**FLH does the homework. The buyer makes the decisions.**

The journey stays the same:
1. Find a home.
2. **Save Home** explicitly.
3. Optionally paste the listing description.
4. Review suggested **shared** Home Facts in one compact checklist.
5. Make **personal** Match decisions separately, in the buyer's own Match view.

This builds on phase 1 (`docs/add-home-v3-simple-save.md`). Save Home still
comes first and stays on screen. Everything here sits below it, folded, and is
optional. The constraints:
- no migration, RLS, storage-policy, scoring, provider or paid-API change;
- no automatic save;
- Floor Plans stays off, and #166 is untouched.

## 1. Audit: where suggestions lived on `main` (`1d404b8`)

| | Shared Home Facts (`listingTextHomeFacts.js`) | Personal Match answers (`listingTextAnswers.js`) |
|---|---|---|
| Read from | the pasted text (`suggestHomeFacts` / `resuggestHomeFacts`) | the pasted text (`resuggestListingAnswers`) |
| Shown | `HomeFactReview`: one card per fact with Use / Skip, plus **Use all N** | `ListingAnswerReview`: one card per criterion with **Confirm** / **Leave Unknown**, and no bulk action |
| Where | the found card (inside "Add more from the listing") and the full editor | the found card and the full editor's Match step |
| Written | Use → the form (empty fields only) → Save → `homes` | Confirm → this buyer's `checks` → Save → `home_member_state` |
| Persisted evidence | `listing_import.pastedFacts` (used facts only) | `listing_import.descriptionFeatures`: one stated Yes/No **per concept**, with its sentence, never a conflict. Shared, and holds no buyer's answers |
| After saving | Home Facts | **Gone**: session state only. A buyer who saved without confirming had to paste again |

On the found card, one description produced up to **13 decision buttons**:
- **Use all 5**;
- Use and Skip on each of 5 fact rows;
- Confirm Yes and Leave Unknown on the personal row.

"Use all 5" would also have applied an unverified school district.

## 2. What changed

### One shared-fact checklist (`HomeFactReview`, found card and full editor)

- **One row per fact:** the field and the proposed value. **Why?** reveals the
  listing's own sentence.
- **Pre-selection** (`isPreselectedHomeFact`):
  - Every suggestion is already explicit (the existing reader and guards are
    unchanged), so these start **checked**.
  - Two kinds start **unchecked**: a school or district the listing merely
    names (it keeps the "FLH hasn't verified it or checked school boundaries"
    attribution), and an HOA fee converted from a yearly or quarterly amount
    (the math is shown: "$100/mo ($1,200 per year)").
- **Selection controls:** "N of M selected", any row can be unchecked or
  checked, and one **Add N facts** applies them.
- **The writer is unchanged:** `applyHomeFactSuggestion`, into empty fields
  only, never contradicting the home's other basement field. Unchecked facts
  stay Unknown and stay listed, so they can be checked later.
- **Added facts** show as "N added to Home Facts", each with **Undo**. Undo
  takes back only what the suggestion wrote.
- **Not changed** is a read-only note (`homeFactDisagreements`). Nothing is
  written and nothing is guessed:
  - the home already has a different value ("Garage type: the listing says
    Detached; this home has Attached. Kept as is.");
  - the value can't stand with the home's other basement field;
  - the text states the field more than one way ("Left Unknown").
- **A repeated paste is a new review**, as Skip was before. Facts used from
  earlier text that the new text no longer states go back to Unknown, and the
  buyer is told. Typed values are never touched.

### Personal answers wait for the buyer's own Match view

- **The found card no longer reviews personal answers.** It names them in one
  line: "The listing also mentions **Fireplace**. That's for your own Match, so
  nothing is answered here: after you save, it waits in this home's Match view
  for your Yes or No."
- **The line leaves out** a criterion that a known or checked shared fact will
  answer. Unchecking that fact brings it back. This is the same "held" rule as
  before.
- **After saving, nothing needs re-pasting.** `savedListingAnswers` rebuilds
  each viewer's possible answers from `listing_import.descriptionFeatures`,
  which the snapshot already stored. It uses the same rules as the text
  reader: only this buyer's selected, unanswered personal criteria.
- **In the saved home's Match view,** such a criterion shows
  "Listing suggests **Yes** · Why?" under its name. Why? shows the sentence and
  "Choose Yes or No yourself."
- **It is only a pointer:**
  - nothing is answered;
  - a Yes or No the buyer already gave always wins (no pointer);
  - a criterion a Home Fact answers shows "From Home Facts" instead;
  - Unknown stays Unknown (historical `false` reads as Unknown, as Match
    reads it).
- **Each buyer sees only their own criteria,** and answering writes only their
  own `checks` through the existing control.
- **Parking:** without the full text, a No for Parking is never offered from
  saved evidence. The text reader suppresses it when the text mentions a
  garage or driveway, and that check can't run from evidence alone.
- **Two different stated answers** for one concept in a snapshot give no
  pointer.
- **The full editor** (apartments, Edit Home, Realtor suggestions) keeps its
  existing personal review in its own Match step, unchanged. Realtors still
  get none.

### Why no architectural change was needed

The deferred answers needed persistence across save. The snapshot already
keeps exactly the needed evidence: per concept, the stated Yes/No and its
sentence, shared, with no buyer's answers in it. It is written on every save
that followed a paste. So persistence is a pure read of an existing column for
the viewer.

There is no new table, column, write path or permission. Co-buyers could
already read the snapshot (it is part of the shared `homes` row).

## 3. Product behaviour to confirm

These change what buyers see. No permissions change.

1. **Co-buyers now see pointers from text another buyer pasted.**
   - The evidence was already shared data on the home. Before, nothing showed
     it to them as a suggestion.
   - Each buyer sees pointers only for their own criteria, and only they can
     answer them.
2. **Personal answers can no longer be confirmed on the found card.** The
   buyer answers after saving, in the Match view. That is one tap per
   criterion there, the same count as Confirm, but outside Add Home.
3. **Two kinds of fact start unchecked:** a named school or district, and a
   converted HOA fee. Everything else explicit starts checked.
4. **Unchecked facts stay visible** (so they can be re-checked) instead of
   disappearing like Skip did.

## 4. Actual action counts

These were measured in the browser on `main` (`1d404b8`) and on this branch,
with the same data and the same pasted description (QA fixture; a RentCast
lookup already filled garage and HOA).

| On the found card, after pasting | Before | After |
|---|---|---|
| Decision buttons shown | **13** (Use all, 5 × Use/Skip, Confirm/Leave Unknown) | **1** (Add 4 facts) + 5 checkboxes |
| Taps to accept everything suggested | 2 (Use all 5 + Confirm); Use all also applied the **unverified** school | **1** (Add 4 facts); the school needs its own tick |
| Personal decisions demanded on the card | 1 | **0** (named; answered later in the Match view) |
| Review height, iPhone 390 | 1,770 px | **1,346 px** |
| Review height, desktop 1440 | 1,500 px | **1,111 px** |
| Save Home scroll needed (from the top) | 0 px | **0 px** (unchanged) |
| Possible answer still available after saving | **No** | **Yes** ("Listing suggests Yes" on Fireplace) |

## 5. Tests

- **`test/add-home-listing-review.test.js`:** 13 tests, 1 of them on real
  Postgres. It covers:
  - pre-selection rules;
  - Add N facts writes only checked facts, only into empty fields ('0',
    'none' and $0 are never replaced);
  - conflicts named, never resolved;
  - hedged, community and ambiguous wording gives no row;
  - Undo and repeated paste;
  - provenance (`pastedFacts` only for added facts; deferred evidence kept, with
    no answers);
  - saved evidence matching the text reader, per buyer;
  - an existing answer wins, Unknown stays Unknown, Match is unchanged;
  - defensive reading (conflicts, other sources, duplicates, parking No);
  - wiring for the card, checklist, Match view and overlay;
  - **real Postgres:** checked facts shared with provenance; nothing written
    for anyone; the co-buyer's own pointer from the same snapshot; the owner's
    No hides only the owner's pointer and leaves the co-buyer's answers
    untouched.
- **Updated existing pins** for the checklist wording and the card order in
  `listing-text-home-facts` and `add-home-simple-save`.
- **Browser QA, `scripts/qa/add-home-listing-review-e2e.mjs`:** 14 / 14 on
  desktop 1440 and iPhone 390. It covers:
  - checklist defaults, Why?, deselect, Add, Undo;
  - Save Home still on screen;
  - Not changed notes;
  - repeated paste and an empty paste;
  - provenance in Postgres;
  - the owner's pointer and answer;
  - the co-buyer's own pointer and answer, with the owner's untouched.
- **Updated regression scripts:** `smart-listing-paste-e2e` and
  `pasted-listing-answers-e2e` now drive the checklist and the Match-view
  pointers instead of per-row Use/Skip and on-card Confirm. Their guarantees
  are kept.
- **Full suite, real PostgreSQL 16:** 1359 / 1359 pass, 0 skipped.
  `next build` passes.
- **Regression QA on this branch:**

  | Script | Result |
  |---|---|
  | `add-home-simple-save-e2e` | 20 / 20 |
  | `rentcast-import-e2e` | 12 / 12 |
  | `smart-listing-paste-e2e` | 12 / 12 |
  | `pasted-listing-answers-e2e` | 11 / 11 |

## 6. Deferred decisions

- **Show provenance in Home Facts.** A saved house's Home Facts still show no
  "From listing" label (true on `main` too). The data is in the snapshot.
- **Shared columns for fireplace, fence, pool and ensuite.** These would turn
  the most common personal pointers into one shared fact. That needs a
  migration and new #167 readings: its own reviewed PR.
- **A pointer for facts after saving.** Shared facts the buyer left unchecked
  are not offered again after saving. Their sentences are not in the snapshot
  (only used facts are), so offering them would need storing unused
  suggestions. Left out on purpose.
- **Notes suggestions** (roof year, financing, concessions) remain computed
  but not shown. This is unchanged and was flagged in phase 1.
