# Safe pasted listing suggestions (Auto Enrichment PR 1)

Pasted listing text used to write the buyer's personal Match answers without
asking (`derivePriorityCheckPatch` in `src/lib/importReview.js`). It also got
some wrong: "Does not have a finished basement" became **Finished basement:
Yes**, and "Fireplace is decorative only" became **Fireplace: Yes**. Several
rules were keyed to older labels (`First-Floor Laundry`, `Patio / Deck /
Outdoor Living`, `Primary Ensuite`, `Pantry`), so today's purchase criteria
never matched them.

This PR removes that silent writer. Pasted text now produces **suggestions**,
each with the sentence it came from. Only a suggestion the buyer confirms
becomes their own Yes or No.

No migration, no new provider, no RentCast call, and no change to how Match
scores or weights anything.

## What changed

| | Before | After |
|---|---|---|
| Personal Match answers from pasted text | Written into `checks` without asking | Suggested. Each one needs **Confirm** or **Leave Unknown**. |
| Negation | Only "no X" | "no", "not", "doesn't", "does not have", "without", "lacks", "none", "Fireplace: none", "0" |
| Hedged or optional wording | A short word list, checked on the matching line only | Hypothetical, optional, partial, non-working, past and "-ready" wording, checked across the sentence |
| Community amenities | "community", "nearby", "photo" | Amenity words across the sentence; proximity words within their clause |
| Criterion keys | Old labels, so today's purchase criteria were missed | Keyed by the label the buyer actually selected, so current and older labels both work |
| Evidence | Not kept | Stored on the shared snapshot as pasted listing text (`listing_text` / `user_paste`) |
| Realtor "Suggest a Home" | Answers worked out from the owner's priorities, then dropped by the server | No suggestions are made |

Shared fields filled from pasted text (price, beds, the rental Pets / Utilities
/ In-Unit Laundry facts …) behave as before: they fill only empty fields, and
the buyer reviews them before saving.

## How the text is read (`src/lib/listingTextAnswers.js`)

The text is split into sentences. A contrast word ("but", "however", "though",
"while", "except") ends a negation's reach. For each concept, three kinds of
pattern are checked:

- **Yes patterns.** These state the feature: "private in-ground pool",
  "fully fenced backyard", "bedroom on the main level". A Yes counts only when
  all of these hold:
  - no negation appears earlier in the sentence or later in the same clause
  - no hedge appears ("could", "optional", "room for", "decorative",
    "partially", "hookups", "flex", "-ready" …)
  - for amenities a community can share (pool, patio, fence, laundry,
    fireplace), no community wording appears
- **No patterns.** These state the absence outright: "unfinished basement",
  "unfenced", "laundry in the basement", "all bedrooms upstairs", "window units
  only".
- **Mentions.** A mention preceded directly by a negation, with only joining
  words in between, counts as No: "no pool", "does not have a finished
  basement", "Fireplace: none". So "no carpet in the basement" is not "no
  basement".

When a concept has both Yes and No evidence, it's a conflict and nothing is
suggested. A concept the text doesn't mention stays Unknown, never No.

A bare "pool" doesn't suggest Yes, because it is so often a community amenity.
The pool must be the home's own: private, in-ground, above-ground, backyard,
heated, saltwater, or plunge.

### Criteria covered

| Category | Criteria |
|---|---|
| Features | Finished basement, Walkout basement, Fireplace, Central air, Home office, Primary ensuite, First-floor laundry, Second-Floor Laundry, First-Floor Bedroom, First-Floor Primary, Guest Bedroom, Guest / In-Law Suite, Walk-in Pantry |
| Exterior | Pool, Fenced yard, Privacy Fencing, Unfenced Yard (answered the other way round), Patio / deck |
| Older and rental labels | Basement, Pantry, Mudroom, Walk-In Closet, Dishwasher, Additional Living Space, Separate Utilities, Attached Garage, Driveway / Off-Street Parking, Parking, Elevator |

Never suggested:
- Garage, which Match reads from garage spaces.
- The shared rental facts: Pets Allowed, Utilities Included, In-Unit Laundry.
- In-person criteria and ratings.
- Anything the buyer typed themselves.
- Location criteria.

Kitchen Island, Soaking Tub, Fire Pit and Cul-de-Sac stay out of scope. That
was already a documented decision in
`test/buyer-search-criteria-refinement.test.js`.

## Where buyers review

- **Add Home → "Paste listing details instead":** the "Where is this home?"
  card lists **Possible answers from the listing**. Each entry shows the
  criterion, "Listing suggests Yes/No", the quoted sentence and its source. Its
  buttons are **Confirm Yes/No** and **Leave Unknown**. After confirming, an
  entry shows "Your answer: …" with **Undo**.
- **Apartment Add Home editor:** the same list appears at the top of
  Personalized Match.

Nothing is saved until **Add to My Homes** / **Save home**. That saves the
buyer's own `home_member_state.checks`, exactly as a manual answer would.

## Provenance and permissions

- **Listing evidence:** stored in `homes.listing_import.descriptionFeatures`
  as `{ concept, stated: 'yes'|'no', label, evidence, sourceType:
  'listing_text', sourceProvider: 'user_paste' }`. It is worked out from the
  text alone, so it carries no criterion keys, tiers or answers. The snapshot's
  `source` stays `pasted_text`.
- **Buyer confirmation:** stored only as the buyer's own answer in
  `home_member_state.checks` (`true` / `'no'`), like any manual answer. It is
  never labelled as coming from the listing or from RentCast.
- **Existing answers:** never overwritten. A criterion already answered,
  including under an older alias, gets no suggestion. Confirming checks again
  before writing. Undo only removes the value that the suggestion wrote.
- **Owner and co-buyer:** suggestions come from the viewing buyer's own
  priorities and write only that buyer's checks.
- **Realtor:** `RealtorSuggestHome` passes `personalAnswers={false}`.

## Evidence

- **Unit tests:** `test/listing-text-answers.test.js` (20 tests). They cover
  the named phrases, every negation form, hedges, marketing, community
  wording, conflicts and absence, current and older labels, Unfenced Yard,
  never overwriting, undo, owner/co-buyer separation, Match parity, the
  snapshot, and static checks that nothing writes answers or reaches a
  database.
- **Full suite:** `npm test` against real PostgreSQL 16 (1142 tests).
- **Browser QA:** `scripts/qa/pasted-listing-answers-e2e.mjs`. It runs the
  real app against the Postgres-backed stand-in on desktop 1440, iPad 820 and
  iPhone 390, as owner, co-buyer and Realtor, and checks the database after
  each save. Screenshots are in `docs/pasted-listing-suggestions-screenshots/`.

## Rental shared facts from pasted text (safety correction)

Pasted rental text also fills the shared **Pets Allowed**, **Utilities
Included** and **In-Unit Laundry** fields, which Match reads directly. The old
patterns misread several phrases. `parseRentalSharedFacts`
(`src/lib/matching.js`) now reads each sentence on its own.

| Pasted text | Before | After |
|---|---|---|
| "In-unit laundry hookups." / "In-unit washer/dryer hookups." | In-Unit Laundry: Yes | Unknown: hookups are where a washer could go, not working laundry |
| "In-unit laundry is not available." / "In-unit laundry: no" | Yes | No |
| "In-unit laundry possible." / "…available for an additional fee." / "Washer/dryer in unit not included." | Yes | Unknown |
| "No utilities included." / "Utilities included: none" | Utilities Included: Yes | No |
| "Utilities included except electric." / "Water and trash utilities included." / "Gas utilities included." | Yes | Unknown (only some are included) |
| "Pets allowed? Ask landlord." | Pets Allowed: Yes | Unknown (a question) |
| "Pets allowed: no" | Yes | No |
| "Close to pet-friendly parks." / "Pet-friendly neighborhood." | Yes | Unknown (nearby places, not the home) |
| "Pets allowed. No pets over 25 lbs." | No | Yes (a size limit is not a ban) |
| A Yes and a No in different sentences | No | Unknown (conflict) |

Explicit statements are read as before ("Pets allowed", "No pets", "All
utilities included", "Tenant pays all utilities", "In-unit washer and dryer",
"Shared laundry only"). Missed negatives that stay Unknown, such as "Pets are
not permitted", are left unchanged here because Unknown is the safe outcome.
Regression tests: `test/rental-shared-facts-text.test.js`.
