# Smart Listing Details Paste

Buyers still start Add Home with a listing URL. After the lookup runs, FLH
offers an **optional** place to paste more from the listing: the description,
the property features or the school details. FLH reads the text and proposes
shared Home Facts. Each proposal comes with the sentence that stated it, and
the buyer chooses which ones to use.

This follows the recommendation in `docs/listing-import-automation-feasibility.md`.
It adds no migration, no new provider, no network or model calls, and no
change to Match scoring.

| Piece | File |
|---|---|
| Reader, suggestions, Use / Undo, rerun, de-duplication, snapshot | `src/lib/listingTextHomeFacts.js` |
| Shared sentence guards it reuses (exports only, no behaviour change) | `src/lib/listingTextAnswers.js` |
| Snapshot keeps `pastedFacts` / `pastedFields` | `src/lib/importSnapshot.js` |
| Paste area, Home Facts review, wiring | `src/components/HomeModal.jsx`, `.flh-listing-paste` / `.flh-fact-review` in `globals.css` |
| Tests | `test/listing-text-home-facts.test.js` (20), `scripts/qa/smart-listing-paste-e2e.mjs` (browser) |
| Screenshots | `docs/smart-listing-details-paste-screenshots/` (`before-*` = `main`) |

## Where it appears

* **The found card**, in every lookup outcome: the lookup found the home, it
  failed (rate limited, timed out, unavailable), or it came back empty.
  "Add more from the listing" sits above **Add to My Homes**, marked
  *Optional*, with the copy: "Copy the listing description or property
  features and paste them here. We'll fill in what we can. School details work
  too."
* **Before a lookup** (no link): the existing disclosure, retitled
  "No link? Paste the listing details" (it was "Can't find the home?"). Once
  the found card shows, this disclosure is hidden, so there is only ever one
  paste box.
* **Apartments and Realtor Suggest a Home** use the full editor. The Home
  Facts review appears there, in the review step, when text was pasted before
  the editor opened. There is no second paste box inside the editor (see
  Limitations).
* Pasting is never required. **Add to My Homes** works the same with or
  without it.
* **Beside #171's Notes / Pros / Cons.** The found card reads, top to bottom:
  1. Add more from the listing (optional);
  2. Home Facts from the listing;
  3. Possible answers from the listing;
  4. Add notes, pros, or cons (optional, collapsed);
  5. Add to My Homes.

  Pasting never reads or writes Notes, Pros or Cons. What the buyer typed
  there is saved exactly as typed (unit test and browser QA).

### Pasting after a successful lookup no longer replaces it

Before this change, pasting text after RentCast found the home replaced the
RentCast import result with a pasted-text one. That lost the snapshot's
listing status and sources and turned the found card back into "Where is this
home?". The lookup is now kept separately (`providerResult`), and the text
adds to it (`combineImportResults`):

* RentCast's fields keep precedence;
* text fills only what RentCast left empty, and those fields are listed in
  `pastedFields`;
* the text's evidence joins RentCast's.

### Counts stay truthful

* **"N listing details came with it"** (found card) counts only what the
  lookup returned (`lookupResult`). Pasted text is reported separately, in the
  paste area: "Filled in N details … N Home Facts and N possible answers to
  review below."
* **Rerunning** always combines with the original lookup, never with an
  earlier combination, so repeated pasting can't inflate anything.
* **No double counting.** In the saved snapshot (Home Facts header) and the
  editor's "N listing details found":
  * a field that both RentCast and the text supplied is counted once,
    because RentCast's value wins;
  * a used Home Fact and the pasted evidence sentence for the same concept
    (Basement: Finished and "Finished basement") count as one detail
    (`FEATURE_FIELD_COVERAGE` in `listingFacts.js`).

## Supported fields

Every suggestion is a **candidate**. Nothing is written until the buyer
chooses **Use** (or **Use all**), and only into a field that is still empty:
`null`, `undefined` or `''`. Values that are never replaced and never get a
suggestion:

* `'0'` garage spaces;
* `'none'` basement;
* a `$0` HOA fee;
* anything RentCast filled;
* anything a person typed.

| Field (column) | Suggested from (examples) | Never from |
|---|---|---|
| Basement condition (`basement_condition`) | "finished basement", "basement is fully finished" → Finished. "unfinished basement" → Unfinished. "partially finished basement" → Partially finished. "No basement", "Basement: none" → None | "not finished" (could be partial); "could be / ready to finish"; "future"; a basement apartment / unit / rental; crawl space |
| Basement style (`basement_style`) | "walkout basement", "lower level walks out", "basement … exterior entrance" → Walkout | "daylight windows" (Gardenview isn't determinable); no mention never means Traditional |
| Laundry (`laundry_location`) | "first-floor / main-level laundry" → First floor. "laundry on the second floor" → Second floor. "laundry in the basement" → Basement | "upstairs" / "upper level" (not necessarily the second floor); hookups; community laundry |
| Primary bedroom (`primary_bedroom_location`) | "primary suite on the first floor", "main-level primary" → Main Floor. "primary bedroom upstairs", "all bedrooms upstairs" → Upstairs | "bedroom on the main level" (a bedroom is not the primary); "optional"; "no first-floor primary" (not proof it's upstairs) |
| Garage type (`garage_type`) | "attached (2-car) garage" → Attached. "detached (2.5 car) garage" → Detached | carports; "attached garage and detached garage" |
| Garage spaces (`garage_spaces`) | "2-car garage", "two car attached garage", "Garage spaces: 3", "3 garage stalls", a "Garage: 2" line. "No garage" / "Garage: none" → 0 | "garage 24x30" (never 24 spaces); "room for a 3-car garage"; "converted garage"; shared / rented / deeded garage space; "no garage door opener" |
| HOA fee (`hoa_fee_monthly`) | "HOA $85/month", "HOA dues of $1,200 per year" (→ $100/mo), "$450 quarterly association fee" (→ $150/mo), "Annual HOA dues: $600" | "No HOA" (that is not $0, and $0 is not "No HOA"); a fee with no period; special assessments; transfer, initiation or one-time fees; "approximately", "estimated", "voluntary", "proposed", "TBD" |
| School district (`school_district_name`) | A named district: "Rochester Community Schools", "Novi Community School District", "the Plymouth-Canton school district", a "School district: …" line | See Schools |
| Elementary / middle / high school | Labelled lines only: "Elementary school: Lakewood Elementary School" (grades, distance and ratings trimmed) | Unlabelled school names in prose |

Basics that pasted text already filled (price, beds, baths, sq ft, lot,
year built, days on market, property type and the rental facts) behave as
before. They fill empty fields and are reviewed before saving. **Garage
spaces moved** from that auto-fill to the reviewed suggestions above. The old
pattern read "Detached garage 24x30" as 24 spaces.

### Confidence rules (all fields)

1. **Explicit only.** The same sentence guards as the personal answers
   (`listingTextAnswers.js`): negation, hedges (could, possible, optional,
   ready for, future, as-is, partially …), and community or nearby wording.
   A fact the text doesn't mention stays Unknown. Absence is never evidence.
2. **One value per field.** Two different values for a field (two fees, two
   laundry locations, attached and detached) suggest nothing.
3. **Contrary wording cancels.** Any statement of a different value anywhere
   in the text, even a hedged or "as-is" one, leaves the field Unknown. For
   example, "Finished basement … the basement is unfinished and sold as-is",
   or "No basement … laundry in the basement".
4. **No contradictions with the home.** A basement suggestion that would
   contradict the home's other basement field (None vs Walkout) is not
   offered and can't be used.
5. **Evidence is the listing's own sentence**, shown in quotes. It is kept in
   the snapshot only for facts the buyer used.

## Schools

* **Storage.** `school_district_name`, `elementary_school`, `middle_school`
  and `high_school` are shared text columns that already existed. Home Facts
  shows and edits them under School details. They were never import targets
  and never answer Match.
* **What is suggested.** Only a district or school the listing names: the
  capitalised name before a district suffix ("… Public Schools", "… Community
  Schools", "… School District", "ISD", "USD" …), a "School district:" line,
  or labelled school lines. Leading praise is trimmed ("award-winning",
  "top-rated" …).
* **What is not suggested:**
  * praise or rankings with no name ("top-rated schools");
  * nearness ("minutes from", "close to", "walking distance to");
  * "schools of choice";
  * private, charter, parochial or academy names;
  * "buyer to verify", boundaries or "subject to change" wording;
  * placeholders (TBD, Unknown, N/A);
  * two different districts in the same text.
* **Never inferred.** FLH never guesses a district from the city, ZIP or
  address, and never checks boundaries.
* **Never verified.** Each school suggestion says: "As named in the listing
  text you pasted. FLH hasn't verified it or checked school boundaries."
* **Reputable Schools / Walkable schools are untouched.** No district name,
  ranking or praise becomes anyone's Yes. These stay personal answers with no
  text concept. A test checks that they stay Unknown after a district is used.
* **Existing school information is kept.** A school field that already holds
  anything gets no suggestion. Free-text School notes are not read or
  written.

## Review experience

* **Home Facts from the listing** (shared). One card per fact, with the field,
  the proposed value, the quoted sentence and **Use** / **Skip**. There is
  **Use all N** when two or more are pending. A used fact shows "Added to Home
  Facts" with **Undo**. In a collaborative search, the card says the facts
  describe the home for everyone in the search.
* **Possible answers from the listing** (personal, unchanged from #165).
  These are for this buyer's own Match.
* **No duplicate prompts.** A personal suggestion is dropped when its
  criterion is one Match reads from Home Facts (#167: Finished / Walkout
  basement, First/Second-floor laundry, First-Floor Primary) and either a
  shared suggestion covers it or the home's facts already answer it. Criteria
  with no shared field keep their personal suggestions: Primary ensuite,
  Fenced yard, Fireplace, Pool, the legacy Attached Garage and others.
* **Undo** removes only what Use wrote. A value the buyer changed after Use is
  never reverted.
* **Rerun.** Pasting new text re-reads every used fact. A fact the new text
  still states is kept. Any other used fact goes back to Unknown, and the
  buyer is told, matching #165's behaviour for personal answers. Typed values
  are never touched.
* Nothing saves until **Add to My Homes** or **Save**.

## Persistence and provenance (no migration)

`homes.listing_import` (jsonb) gains two optional keys:

* `pastedFacts: [{ field, value, evidence, sourceType: 'listing_text', sourceProvider: 'user_paste' }]`.
  These are the used facts and their sentences. Their values are also in
  `fields`, so Home Facts shows them as *From listing* through the existing
  `fieldProvenance`. A used fact the buyer later changed is not claimed.
* `pastedFields: [...]`: basics that pasted text filled beside a RentCast
  lookup.

`source` stays `rentcast` when there was a lookup, and is `pasted_text`
otherwise. Older snapshots read exactly as before.

## Match and Match Reveal

* **Match.** No change to scoring, weights, Unknown handling or the SQL
  scorer. A used fact is an ordinary shared Home Fact. Match reads it through
  the existing #167 table, and the buyer's own Yes / No still overrides it.
  Pasting never writes `checks`; only Confirm on a personal suggestion does,
  as before. A test checks that a used suggestion scores exactly like the same
  fact typed into Home Facts.
* **Match Reveal (#170)** is unchanged: no reveal code is touched, and Add
  Home still has no reveal path. Using facts at Add Home does affect when the
  reveal can happen:
  * The overlay takes its baseline from the persisted home. A home whose
    pasted facts take it to 75% or more of the buyer's pre-tour criteria
    arrives already unlocked, so it **never shows a reveal**. #170 never
    triggers from Add Home by design.
  * A home that arrives below 75% still reveals on the buyer's own later save
    that crosses 75%.

  Both cases are tested in `test/listing-text-home-facts.test.js`. Product
  may want to revisit this if Smart Paste makes most homes arrive complete
  (see Risks).

## Seller concessions: follow-up, not in this PR

"Seller offering $5,000 toward closing costs" is a useful Notes line, but
there is no safe path for it through existing logic today:

* the existing Notes rules (`extractEnrichmentSuggestions` in
  `importReview.js`) match "seller offering a closing credit" or a rate
  buydown, not a dollar amount toward closing costs;
* those Notes suggestions aren't shown anywhere in Add Home today. They are
  computed, but no UI uses them.

Surfacing them means a new review UI that appends to #171's Notes. That
should be its own small PR: one "Add to Notes" suggestion per explicit term
(concession amount, financing, possession, special assessment), each with its
sentence, never written without a tap. A test pins today's behaviour: nothing
reaches Notes.

## Limitations

* English-language listing wording only, rule-based. Unusual phrasing is left
  Unknown rather than guessed.
* No paste box inside the full editor (apartments, Realtor suggestions) or in
  Edit Home. Text pasted before the editor opens is reviewed there.
* Fence, ensuite, fireplace and pool have no shared column. They stay
  personal suggestions. No columns were added.
* "Gardenview" basement and an "upstairs" laundry are never suggested,
  because the text can't establish them.
* Skipping a shared basement or laundry fact also removes the duplicate
  personal question for that criterion. The buyer can still answer it in
  Match.

## Risks

* **Match Reveal reach.** Homes completed at Add Home skip the one-time
  reveal (see above). This is #170's rule, but Smart Paste makes it common.
* **Shared facts in collaborative searches.** A used fact is visible to the
  co-buyer and the Realtor, like any Home Fact the buyer types. The card says
  so.
* **False positives.** Regex rules can misread unusual sentences. Mitigations:
  every suggestion needs a Use, shows its sentence, and can be undone or
  edited in Home Facts.
