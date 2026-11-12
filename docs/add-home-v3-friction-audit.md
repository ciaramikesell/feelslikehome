# Add Home V3: import automation and friction audit

**Principle: FLH does the homework. The buyer makes the decisions.**

This is research and planning only. No code, migrations, deployments,
provider sign-ups or RentCast calls were made. Floor Plans and PR #166 were
not touched. The audit was done on `main` at `7964384`, after #174.

It builds on earlier audits rather than repeating them:
- `listing-import-automation-feasibility.md` (its PR 1 shipped as Smart Paste, #171–#173);
- `rentcast-import-accuracy.md` (#161);
- `smart-listing-details-paste.md`;
- `import-enrichment-v1-technical-product-design-audit.md`.

**How claims are marked**
- **Verified (code)**: read in this repository at the file and line cited.
- **Search-confirmed**: seen in web-search excerpts of the provider's own
  documentation. This environment's network policy blocks direct page fetches
  to `rentcast.io`, `walkscore.com`, `greatschools.org`, `schooldigger.com` and
  `nces.ed.gov`, so full pages could not be read.
- **[unverified]**: a third-party figure, or my own expectation. Every price is
  one of these until someone checks the vendor's page.
- **Needs API test**: only a real response settles it (see §1.5 for a no-cost
  way to get one).

---

## 0. Summary

The friction has three causes, and only one of them is missing data.

1. **FLH asks permission too many times for the same evidence.** Since #167,
   shared Home Facts already answer Finished/Walkout basement, laundry,
   First-Floor Primary, Garage and No HOA. Yet one pasted description can
   still produce up to three review lists in the found card:
   - **Home Facts from the listing:** Use / Skip on each row, plus **Use all**;
   - **Possible answers from the listing:** Confirm / Leave Unknown on each
     row, with no bulk action;
   - the Notes suggestions, which are computed but not shown.

   The 6–7 approvals the founder sees are mostly the personal-answer list,
   plus Home Facts used one row at a time.
2. **Getting the material into FLH is the real cost.** The buyer has to:
   - copy a URL;
   - for details, go back to Zillow, expand the description, select it, copy
     it, return and paste;
   - for a photo, take a screenshot, open Home Facts, expand *Photo options*
     and pick the file.

   None of these steps is FLH "work". All of them are app-switching.
3. **Data we already pay for is dropped.** RentCast documents fireplace,
   pool, view, listing type, listing history and subdivision. FLH reads none
   of them. Garage, foundation and HOA are read, but conservatively, and that
   is correct.

**Recommendation in one line.**
- Save the home as soon as the lookup succeeds.
- Merge every listing-derived suggestion into **one pre-selected review with a
  single "Add N facts" action**.
- Stop asking personal Match questions during Add Home.
- Fill the remaining gaps quietly in the background, from sources we are
  allowed to use: RentCast fields already returned, free public school
  district boundaries, and optionally Walk Score.
- Put "Add photo" where the buyer already is.

Nothing in the core plan needs a new paid provider or a schema change.

---

## 1. RentCast: what we receive vs. what we use

### 1.1 What FLH calls

Each lookup is two requests, run in parallel:
- `GET /v1/properties?address=`;
- `GET /v1/listings/sale?address=`, or `/v1/listings/rental/long-term` for
  rentals.

Only the first result of each is read (`rentcastLookup.js:15-31`). There is no
cache and no per-user limit (`route.js`). A second lookup in the same Add Home
session keeps fields filled by the first one, because imports fill empty
fields only. Both gaps are known (#161 follow-ups) and are still open.

### 1.2 Field inventory

"Mapped" means the value is written to a `homes` column. "Panel" means it is
shown only in the found panel and snapshot (`listingFacts`). "Dropped" means
it is received and ignored.

| RentCast field | Documented? | FLH today | Opportunity |
|---|---|---|---|
| `formattedAddress`, `bedrooms`, `bathrooms`, `squareFootage`, `yearBuilt`, `propertyType`, `latitude`/`longitude` | Confirmed (#161) | Mapped, with an address-match guard (`rentcast.js:170-200, 262-345`) | — |
| `lotSize` (sq ft) | Confirmed | Mapped as "0.29 acres" / "8712 sq ft" | — (no lot dimensions or frontage exist in the schema) |
| `features.garageSpaces` | Confirmed | Mapped (0 kept) | — |
| `features.garageType` | Confirmed. Values: Attached, Detached, Garage, Carport, Parking Structure, … | Mapped only when exactly one of Attached/Detached is named. Carport/parking parts are set aside (`canonicalGarageType`, `rentcast.js:118-126`) | Unknown values ("Built-in", "Tuck-under", "Basement") stay Unknown. **Needs API test** to get the full enum |
| `features.garage` (bool) | Confirmed | Panel "Yes" only | `true` with no spaces could be a **suggestion** for the Garage criterion. `false` must stay Unknown, because county records omit garages |
| `features.foundationType` | Confirmed. Enum exists; example "Slab / Mat / Raft" (search) | **Panel only** ("Foundation") | Hint on the Basement row: "County records: Slab foundation". **Never** auto-fill Basement = None: county data is old and a slab can sit beside a partial basement. Whether a "Basement" foundation value exists: **needs API test** |
| `features.floorCount` | Confirmed | Panel only ("Stories") | Hint for Layout (1 → "Ranch?"). Suggestion only: a split-level or a finished basement breaks the inference |
| `features.architectureType`, `exteriorType`, `roofType` | Confirmed | Exterior/roof mapped; style panel only | — |
| `features.heatingType` / `coolingType` | Confirmed | Mapped as written | `coolingType` containing "Central" could suggest the **Central air** criterion. Needs a shared column; see §3.4 |
| `features.heating` / `cooling` (bool) | Confirmed | Panel "Yes" only | — (correct: a flag is not a type) |
| **`features.fireplace` (bool), `fireplaceType`** | **Search-confirmed** (Property Data Schema; example `fireplace: true`) | **Dropped** | Panel line, plus a candidate for the **Fireplace** criterion when `true`. `false` = Unknown |
| **`features.pool` (bool), `poolType`** | **Search-confirmed** (example `poolType: "Concrete"`) | **Dropped** | Same as fireplace: candidate **Pool** when `true` |
| **`features.viewType`** | **Search-confirmed** (example "City") | **Dropped** | Panel only. Possibly context for "Near waterfront" when the value is "Water". Suggestion at most; **needs API test** for the enum |
| `features.roomCount`, `unitCount` | Search-confirmed | Dropped | `unitCount > 1` could guard property type (multifamily). Low value |
| `subdivision`, `zoning`, `county` | Search-confirmed | Dropped | Subdivision is useful context ("Woodlake"). Panel only |
| `hoa.fee` (monthly) | Confirmed | Mapped ($0 ≠ no HOA) | — |
| `propertyTaxes` | Confirmed | Mapped (latest plausible year) | — |
| `taxAssessments`, `lastSalePrice`/`Date`, `owner`, `history` (property) | Confirmed | Deliberately not read | Keep it that way: owner data is personal |
| Listing `status`, `price`, `listedDate`, `removedDate`, `lastSeenDate`, `daysOnMarket`, `mlsName`, `mlsNumber` | Confirmed | Mapped / panel | — |
| **Listing `listingType`** (Standard / New Construction / Foreclosure / Short Sale) | Search-confirmed | **Dropped** (a #161 follow-up) | "New Construction" → `homeCondition` suggestion. Foreclosure / Short Sale → panel line (it affects how the buyer offers) |
| **Listing `history`** (keyed by date: event, price, listed/removed dates) | Search-confirmed | **Dropped** | "Price cut $15k on Oct 2", relisted, back on market: high buyer value, **zero extra calls**. Panel/Notes context only, never a Home Fact |
| Listing `listingAgent`, `listingOffice`, `builder` | Search-confirmed | Dropped | Leave dropped for now. It is business contact data, but not needed, and showing it invites "contact agent" features out of scope |
| Listing `hoa.fee` | Confirmed | Fallback for HOA | — |
| **Photos / images** | **Not found** in any documented excerpt | None | Do not plan on RentCast photos (see §5) |
| **Description / remarks** | Not in the confirmed schema (#161 removed the old reads) | None | Pasted text remains the only source of prose |
| **Basement, laundry, fence, schools** | Not documented | None | No RentCast path. See §2 |

### 1.3 Missed mappings, ranked

1. **Fireplace and pool.** Both are documented, county-sourced booleans that
   arrive with every property record we already fetch. Both are common Match
   criteria. Today they are discarded, and the buyer is asked again.
   - `true` is trustworthy.
   - `false` / missing is not: county records are incomplete, so it must
     stay Unknown.
2. **Listing history.** Price drops and relists are exactly the "homework" a
   buyer does by hand on Zillow.
3. **`listingType` → New Construction** for Home Condition.
4. **`foundationType` / `floorCount`** shown as *hints* beside the
   Basement / Layout rows instead of buried in the found panel.
5. **`subdivision`**, shown in the panel.

### 1.4 Unsupported or ambiguous provider values (keep Unknown)

- `garageType: "Garage"` (no attached/detached), "Attached/Detached",
  carports, "Parking Structure".
- `features.garage: false`, `fireplace: false`, `pool: false`: absence in
  county records.
- `heating: true` / `cooling: true` with no type.
- `foundationType` alone → basement condition or style. It never shows
  finished or walkout.
- Any first-result record whose address doesn't match. This is already
  dropped. A same-number unit near-duplicate is still a gap.
- Search excerpts mentioned that listing `latitude`/`longitude` may be
  deprecated in favour of a nested object. This is unconfirmed (it may refer
  to the AVM endpoint). FLH reads top-level coordinates, so this **needs an
  API test**. If it is true, coordinates would silently stop arriving, and
  Google geocoding would cover the gap.

### 1.5 How to verify without paid calls

RentCast's billing docs (search-confirmed) describe a free **Developer plan
with 50 requests/month**.
- Capture about 10 real responses (5 lookups × 2 requests) for addresses the
  team chooses: one with a pool, one new construction, one with a basement
  foundation, one condo with HOA, one recently price-cut.
- Store them as redacted fixtures, with owner fields removed, beside
  `test/support/rentcastDocumentedShapes.js`.

This settles the enums (`garageType`, `foundationType`, `viewType`,
`poolType`), the coordinate question and the `history` shape before any
mapping code is written. **It needs the founder's approval**: it uses a key
and an account even though it is free.

**Cost context [unverified, third-party listing of RentCast prices].**

| Plan | Price | Included requests/mo | Overage |
|---|---|---|---|
| Foundation | $74/mo | 1,000 | $0.06/request |
| Growth | $199/mo | 5,000 | $0.03/request |
| Scale | $449/mo | 25,000 | $0.015/request |

At 2 requests per lookup, that is about $0.03–$0.15 per imported home. A
normalized-address cache, plus not re-running a lookup the found card
already did, removes most repeat cost.

---

## 2. Additional permitted data sources

| Need | Practical lawful source | Reliability / coverage | Licensing & terms | Price | Complexity | Can it be a shared Home Fact? |
|---|---|---|---|---|---|---|
| **Walk Score / Bike Score** | Walk Score API (Redfin-owned) | High for US/Canada addresses; a score is an *index*, not a fact | All calls server-side. Each displayed score must link to Walk Score and follow the branding rules (logo, "?" info link). US/Canada residents only. Caching/storage rules **not found**; read the API terms before storing [unverified] | Free tier ~5,000 calls/day (search-confirmed via two secondary sources). Paid tiers not published | Low: one server route, lat/lng + address, already available after import | **Informational only.** Show "Walk Score 82 · Very Walkable" as context beside "Walkable Neighborhood" / "Walkable to Town". Never auto-answer: walkable-for-me is the buyer's judgement |
| **School district** | **US Census Geocoder** (`geographies` returns Unified/Elementary/Secondary school districts for an address or point), or **NCES EDGE district boundaries** (ArcGIS REST, SY 2024-25 composite) | High: districts are legal geography, updated yearly. Note that some states split elementary and secondary districts | **Public domain** (NCES, search-confirmed). No key | $0 | Low–medium: one server call after import, or a point-in-polygon query. Census geocoder availability **needs test** | **Yes, as a suggestion with provenance:** "School district: Rochester Community Schools · From public district boundaries (2024-25)". Fills the existing `school_district_name`. The buyer accepts in the same bulk review |
| **Assigned schools (attendance zones)** | No free, current national source. NCES SABS was experimental (2013-14 and 2015-16 only). Commercial: GreatSchools NearbySchools, ATTOM, Precisely | Medium: zones change yearly and districts publish "verify with district" disclaimers | Commercial licences, attribution, often no long-term storage [unverified] | GreatSchools NearbySchools tiers reported at **$8,900 / $16,900 / $32,900 per month** (search excerpt of their page) [unverified] | Medium | **No.** At most informational, "Likely assigned (provider, verify with district)". Not worth the cost at FLH's stage. Better: a link to the district's own boundary locator once the district is known |
| **School ratings** | GreatSchools (1–10 ratings need an Enterprise licence; NearbySchools includes only "quality bands"); SchoolDigger (free 1,000 calls/mo, paid from $29/mo for widgets; API tiers not confirmed) | Ratings are opinions/indices built on state test data | Attribution required; redistribution limited. Ratings can carry fair-housing sensitivity in real-estate products [unverified legal note] | GreatSchools: custom. SchoolDigger: low [unverified] | Medium | **Never a Home Fact, and never auto-answers "Great schools".** If shown at all, it is an attributed link-out ("See ratings on GreatSchools"). That costs $0 and has no licence |
| **Listing photographs** | Only via a licensed feed: MLS/IDX through a sponsoring broker, or a vendor whose contract grants display rights. RentCast documents none | High where licensed | Photos belong to the photographer or listing broker. Portal terms prohibit copying. IDX rules govern display, attribution and refresh/removal | Broker sponsorship + vendor fees; out of reach for now | High | Display only, under licence. **Not recommended now.** See §5 for the zero-licence improvements |
| **Basement details** | Assessor data via ATTOM / CoreLogic / similar (basement sq ft, finished sq ft in some counties); RentCast `foundationType` (hint) | Patchy and county-dependent; often stale | Commercial | Per-record fees [unverified] | Medium | Hint only. **Pasted text remains the best source for finished/walkout** |
| **Fencing** | No reliable structured source. Aerial/CV inference is error-prone and violates the "no photo inference" rule (`import-enrichment-v1` §5) | — | — | — | — | Stays a buyer/text fact |

**Verdict.**
- **Do:** the school district via Census/NCES (free, public domain, a real
  fact) and the fireplace/pool fields RentCast already sends.
- **Optional:** Walk Score, as an informational chip, after a terms read on
  storage.
- **Don't:** paid school ratings, assigned-school APIs, photo feeds or
  basement data vendors until FLH has scale that justifies them.

---

## 3. Listing-description extraction

### 3.1 What exists (verified, code)

- **`listingTextHomeFacts.js`** proposes *shared* facts as `candidate`
  findings:
  - basement condition, basement style, laundry, primary bedroom;
  - garage type, garage spaces;
  - HOA fee (with an explicit period);
  - district and labelled schools.

  It uses the same guards throughout: negation, hedges, community wording,
  one value per field, contrary wording cancels, and no contradiction with
  the home.
- **`listingTextAnswers.js`** proposes *personal* Match answers: fireplace,
  central air, office, ensuite, laundry, first-floor bedroom, fenced yard,
  pool, … Each shows its sentence and needs **Confirm** or **Leave Unknown**.
- **De-duplication** (`personalSuggestionStatus`). A personal question is:
  - *settled* when a used or known shared fact answers it;
  - *held* while a shared suggestion is pending.
- **Bulk action:** **Use all N** exists for shared facts only
  (`HomeModal.jsx:518`). Personal answers have **no bulk action**.
- **Notes suggestions** (`importReview.js`: roof year, financing, HOA text)
  are computed and never shown.
- **Persistence:** used facts and their evidence go to
  `listing_import.pastedFacts`. Unused suggestions are never persisted.

### 3.2 What may populate shared Home Facts after one review

Every current shared-fact candidate is already filtered to explicit
statements. These are safe to **pre-select** in a single review, where one
tap adds all of them, as long as:
- each row stays individually deselectable;
- the evidence sentence is one tap away;
- empty fields are the only targets.

Pre-selected, one review:
- Basement condition and style;
- Laundry location;
- Primary bedroom location;
- Garage type and spaces;
- HOA fee, **when the period is explicit**;
- RentCast `fireplace/pool = true` (once they have shared columns; §3.4).

Pre-selected, but labelled "As named in the listing, not verified":
- School district;
- Labelled school names.

Shown **unselected**, the buyer opts in:
- HOA fee converted from an annual or quarterly figure (shows the math:
  "$1,200/yr → $100/mo");
- a shared fact that would contradict something a co-buyer already set. Not
  applicable today, because a filled field never gets a suggestion. Keep it
  that way.

Never shown (stay Unknown):
- hedged, conflicting, community, or absent statements (unchanged);
- marketing words ("move-in ready", "turnkey");
- anything inferred from silence.

### 3.3 Buyer-specific answers that must stay explicit

**Personal Match answers write `checks` in `home_member_state`.** These are
the buyer's own perspective and are never shared.
- Keep them explicit per buyer, never pre-confirmed for a co-buyer.
- Explicit can still be **one action**: "Listing mentions: ☑ Fireplace ☑
  Primary ensuite ☑ Fenced yard → **Add to my Match**". This is a visible
  checklist the buyer can untick, followed by a single confirm.

Better still, **don't ask during Add Home at all**:
- After #167, the high-value criteria are settled by shared facts.
- The remaining personal concepts can wait in the home's Match view as
  inline evidence: "Listing mentions a fireplace · Yes / Not for me".
- The buyer sees each one exactly when they look at Match, and each co-buyer
  sees their own.

**Preserve, unchanged:**
- **Unknown** never becomes No, and Skip writes nothing.
- **An explicit personal answer always wins** over a Home Fact reading (#167
  precedence) and is never overwritten by a re-paste.
- **Conflicting evidence** produces no suggestion. Where the home already has
  a value, show it read-only: "Listing text says Unfinished · Home Facts say
  Finished".
- **Co-buyer independence.** Shared facts are visible to everyone and say so.
  Personal answers come only from the current buyer's own priorities and
  write only their own `checks`.

### 3.4 Avoiding the low-confidence flood

- Cap the review at the facts that **change something**: an empty field
  that a selected criterion of *this* buyer reads, or a core Home Facts row.
  Everything else collapses into "+3 more details from the listing".
- Never show a row whose only action is "Skip".
- Show the evidence quote collapsed by default. A row reads
  "Basement · Finished, Walkout" with a ⓘ that reveals the sentence.
- The biggest structural reducer is a **schema change**: shared columns for
  `fireplace`, `pool`, `fenced_yard` and `primary_ensuite`, read by #167-style
  Match readings. That would let one statement answer every buyer and remove
  the personal-answer list almost entirely. It changes Match readings, so it
  needs its own reviewed PR (PR 10 below). Everything else here works without
  it.

---

## 4. Natural-language Garage / Basement fields

**Today (verified):**
- Home Facts shows two selects per topic: Garage *Type* + *Spaces*; Basement
  *Style* + *Condition* (`HomeFacts.jsx:281-292`).
- These are coupled by `garagePatch` / `basementPatch`: "None" in one sets the
  other.
- On a phone that is about 4 taps per topic, and the buyer has to know that
  "Gardenview" means daylight windows.

**Proposal.** One line per topic, in the same Home Facts slot: a text input
with a live interpretation underneath.

| Typed | Stored (existing columns) | Shown |
|---|---|---|
| "2-car detached garage" | `garageType=detached`, `garageSpaces=2` | Detached · 2 spaces ✓ |
| "attached garage" | `garageType=attached`, spaces unchanged/Unknown | Attached · spaces Unknown |
| "no garage" | `none` / `0` (via `garagePatch`) | None |
| "2.5 car tandem" | `garageSpaces=2.5`, type Unknown | 2.5 spaces · type? |
| "garage and carport" | spaces/type Unknown | "We couldn't tell — choose" (falls back to chips) |
| "Finished walkout basement" | `basementCondition=finished`, `basementStyle=walkout` | Finished · Walkout ✓ |
| "partially finished, daylight windows" | `partially_finished`, style Unknown (gardenview is never inferred) | Partially finished · style? |
| "No basement" / "crawl space only" | `none` / `none` (via `basementPatch`) | None |
| "basement" | nothing | "Finished or unfinished?" (chips) |

**Engineering:**
- **No schema or Match change.**
- The parser reuses the readers that already exist and are tested:
  `canonicalGarageType` / `canonicalBasementFacts` (`rentcast.js`), the
  garage and basement regexes in `listingTextHomeFacts.js`, and
  `garageSpacesCount` (`homeFactCriteria.js`).
- A new pure `parseGarageText` / `parseBasementText` returns
  `{ patch, unresolved[] }`. It never guesses, and it writes through the
  existing patch functions, so the "None" coupling and Unknown handling are
  preserved.
- The raw phrase can go into the existing `basement_notes`. Garage has no
  notes column, and it doesn't need one, because the summary is derived from
  the structured values.

**Honest assessment.**
- Typing beats four selects on mobile.
- It is *worse* than two segmented chip rows for someone who just wants to
  tap "Attached, 2".
- Keep the chips as the fallback for anything `unresolved`. This is a
  medium-priority polish, not the main lever: once V3 import works, most
  homes arrive with these filled.

---

## 5. Photos

### 5.1 Current paths (verified, code)

| Path | Where | Steps |
|---|---|---|
| Add Home found card | `HomeModal.jsx:597` | **Display only.** Shows `form.photoUrl` if one exists. There is no way to add a photo here |
| Pasted text | `matching.js:280` | An image URL inside the pasted text becomes `photoUrl`, which is a hotlink |
| Full editor (apartments, Realtor, Edit Home) | `HomeModal.jsx:393-403` | Upload (staged until Save) or "Paste by URL" |
| Home Facts | `HomeFacts.jsx:111-160` | On a phone it is collapsed under **Photo options**. Then Upload or Photo URL. Copy: "FLH never copies listing-site photos." |
| iOS Share Extension | `ShareExtension/Info.plist` | Accepts **one URL or text only**; images are not accepted. No App Group by design |
| Storage | `homePhoto.js` | **Public** bucket `home-photos`, `getPublicUrl` |

**A typical photo today:**
1. In Zillow, screenshot (1);
2. switch to FLH (1);
3. open the home (1);
4. on a phone, expand Photo options (1);
5. Upload (1);
6. choose the screenshot (1–2);
7. optionally crop.

That is **6–8 actions per home**, done separately from Add Home.

### 5.2 Legal position

- Listing photos are copyrighted by the photographer or listing broker.
  Portal terms prohibit copying them. FLH is right never to fetch or hotlink
  them on its own.
- A buyer uploading their **own** photo (one taken at a showing) is clean.
- A buyer's screenshot of a listing photo is the buyer's personal-use
  decision, but FLH then hosts it.
  - **Risk to flag:** the `home-photos` bucket is **public**, so any such
    upload is reachable by anyone who has the URL.
  - Moving to a private bucket with signed URLs lowers exposure. It needs a
    storage-policy change: a dashboard plus code change, not a schema
    migration.

### 5.3 Smallest compliant improvements, in order

1. **"Add photo" on the found card**, right beside the empty thumbnail.
   - It uses the existing staged-upload code: camera or library on iOS, file
     on desktop.
   - Add **paste an image from the clipboard** on desktop and iPad: ⌘V a
     copied image.
   - This saves 3–4 navigation actions per home, with no new legal surface.
2. **Never show a blank card**, with no buyer action. Two options:
   - a neutral illustrated placeholder, which costs $0;
   - or Google **Street View Static** imagery of the address. This is
     licensed display through our existing Google Maps relationship. It must
     be loaded live and not stored, with attribution. Each load is billed and
     a free metadata check avoids grey "no imagery" tiles [unverified current
     Google pricing and terms; review before use]. Label it as "Street view",
     never "Listing photo".
3. **Later: Share Extension accepts an image.** Sharing a screenshot from
   Photos straight to FLH lands on the home.
   - This needs the extension to hand an image to the app. Either an App
     Group (previously avoided) or uploading from the extension with an auth
     token, and both are real native work.
   - Do this after the in-app path proves people add photos at all.
4. **Not recommended:** fetching `og:image`, server-side copying of portal
   images, or hotlinking portal CDNs.

---

## 6. User journey

### 6.1 Current action counts

Counts are taps and pastes on an iPhone, signed in, for a home with a
supported URL. App switches are counted as actions because they are the
expensive part.

| Task | Current steps | Actions |
|---|---|---|
| **Save a listing URL (lookup succeeds)** | In Zillow: Share → Copy (2) · switch to FLH (1) · Add home (1) · paste into Find (2) · Find (1) · wait · **Add to My Homes** (1) → Home Facts opens | **~8** (or **~3** via the Share Sheet: Share → FLH → Add to My Homes) |
| **Save with missing data (lookup empty or failed)** | As above to Find · "Where is this home?" · type address + pick autocomplete (2–3) · Add (1) · then on Home Facts, each missing fact is a select (2 taps × ~8–12 rows) | **~10 to save, +16–24** to complete facts |
| **Add listing-description details** | Back to Zillow (1) · "See more" (1) · select + copy (2–3) · back to FLH (1) · tap box + paste (2) · Fill in details (1) · Use all (1) or Use × N · **Confirm × M** personal answers (no bulk) | **~10 + M** (M is typically 3–6) |
| **Complete Match answers** | Open home (1) · Match tab (1) · Yes/No per criterion not covered by a fact (5–10) | **~7–12** |
| **Add a photo** | §5.1 | **~6–8** |
| **Total for one fully done home** | | **≈ 30–45 actions, 4–5 app switches** |

### 6.2 Add Home V3 journey

**Step 1. Share or paste a link: the home is saved immediately.**
- After a successful, address-matched lookup, save at once and show a toast:
  "Added 51613 Sass Rd · Undo".
- The duplicate-URL guard stays as is.
- If there is no address (lookup empty), the one required question remains:
  "Where is this home?". Address is the only mandatory field.
- Actions: **Share → FLH (2)**, or **paste → Find (3)**.

**Step 2. FLH does the homework in the background.** This needs no screen.
- RentCast fields, now including fireplace, pool, listing type and price
  history.
- School district from public boundaries.
- Optionally, Walk Score.
- Each lands as *From listing* or *From public records*, or as a pending
  suggestion when it needs a decision.

**Step 3. One optional enrichment prompt, on the home itself.**
- The prompt reads: "Still Unknown: Basement · Laundry · Primary bedroom —
  **Paste the description** to fill these."
- Paste opens **one review sheet**. Facts are pre-selected, evidence is
  collapsed, and a single **Add 5 facts** button applies them. Personal
  answers are not in this sheet.
- Actions: **copy + paste + 1 tap** (the copy itself stays manual; see
  "Later").

**Step 4. Match, when the buyer opens it.**
- Criteria answered by Home Facts show as answered.
- Criteria the listing *mentioned* but that have no shared fact show the
  evidence inline, with Yes / Not for me.
- Unknown stays neutral. Nothing is asked up front.

**Step 5. Photo.**
- "Add photo" on the card or in the found toast: 2 taps.
- Or never, because the placeholder or Street View fills the card.

**Target:** about **3 actions to save** and **about 6 more to fully enrich**,
down from 30–45. There are no new required steps, and Add Home gets one
review surface instead of three.

**Later, needs legal review:** Safari Share Extension JavaScript
preprocessing.
- When the buyer shares from Safari, the extension reads the visible
  description of the page *the buyer is viewing* and sends it with the URL.
- That removes the copy/paste step entirely.
- It works from Safari only, not from portal apps.

---

## 7. What to auto-fill, suggest, or leave Unknown

| Auto-fill (empty fields only, shown *From listing* / *From public records*, editable) | Suggest (pre-selected, one bulk confirm) | Suggest (opt-in) | Personal, explicit per buyer | Leave Unknown |
|---|---|---|---|---|
| Address, price (Active only), beds, baths, sq ft, lot, year, type, DOM, coordinates, HOA fee (RentCast), tax, garage spaces / unambiguous type, heating/cooling/exterior/roof text (all as today) | Pasted-text basement, laundry, primary bedroom, garage, explicit-period HOA; school district (public boundaries or named in text, labelled unverified); RentCast `fireplace/pool = true` (once shared columns exist) | HOA from an annual/quarterly figure; "New Construction" → condition; floorCount → layout hint; foundationType hint | Fireplace, ensuite, fenced yard, pool, central air, office… while they have no shared column; Walkable / Great schools (Walk Score or district only as context) | Anything hedged, conflicting, community, marketing, from silence, from photos, or from `false` county flags; assigned schools; ratings; fencing without text |

---

## 8. Prioritized implementation PRs

Each PR is small, independent where noted, and keeps Match scoring
byte-for-byte unchanged, except PR 10.

| # | PR | Why first | Size | Risk |
|---|---|---|---|---|
| 0 | **Ops, not code: capture ~10 RentCast responses on the free Developer plan** (founder approval) and commit redacted fixtures | Settles every "needs API test" item before mapping code | XS | Uses the free quota only |
| 1 | **Lookup cache + per-user limit + clear the previous lookup's untouched fields** (T-03 and the #161 follow-up) | Prerequisite for any automatic lookup or immediate save | S | Low |
| 2 | **Map dropped RentCast fields:** fireplace/pool/view/subdivision/listingType/history → found panel and snapshot; `listingType` New Construction → condition suggestion; foundation/floors as row hints | Zero new calls; visible "FLH did the homework" | S | Low (display only) |
| 3 | **One review surface:** merge Home Facts and personal answers into a single sheet; facts pre-selected with "Add N facts"; personal answers either one checklist + one confirm, or deferred to Match (product choice); evidence collapsed; cap to rows that matter | Directly removes the 6–7 approvals | M | Medium (UX); tests for co-buyer independence and Unknown |
| 4 | **"Add photo" + clipboard paste on the found card**, plus a neutral placeholder | Removes the separate photo trip | S | Low |
| 5 | **Immediate save after a matched lookup** (toast + Undo), and an enrichment prompt on the home listing what's Unknown | The core V3 change | M | Medium: undo semantics, duplicate guard, offline |
| 6 | **School district from public boundaries** (Census geocoder or NCES query) as a suggestion with provenance | Free, factual, fills an existing column | S–M | Needs a network allowlist and a test; endpoint uptime |
| 7 | **Natural-language Garage / Basement input** in Home Facts, chips as fallback | Polish once most homes arrive filled | S | Low (pure parser, existing patches) |
| 8 | **Walk Score chip** (terms review first) | Context only | S | Terms/branding |
| 9 | **Private photo bucket + signed URLs** | Lower exposure for buyer-uploaded listing screenshots | S–M | Storage policy change; existing URLs |
| 10 | **Shared fireplace / pool / fenced yard / ensuite columns + #167 readings** | Removes most remaining personal questions | M | **Migration + Match change: its own review** |
| 11 | **Share Extension: image intake, then Safari JS preprocessing** | Removes the last copy/paste and screenshot steps | L | Native work; legal review for preprocessing |
| — | AI fallback for unusual text (offline eval first, per the earlier audit) | Only if the rules' miss rate is high | — | Privacy copy, model drift |

**Dependencies:**
- PR 1 before PR 5 and PR 6.
- PR 3 before PR 5: immediate save needs the single review to exist on the
  saved home.
- PR 2 and PR 4 can ship at any time.

---

## 9. Risks and limits

- **Immediate save** creates homes the buyer didn't mean to keep. Mitigate
  with Undo in the toast and an archive that is one tap away.
- **Match Reveal (#170).** Homes completed at Add Home skip the reveal
  (already noted in `smart-listing-details-paste.md`). V3 makes this the
  common case, so product should decide whether the reveal moves to the
  first Match view.
- **County-sourced booleans** (fireplace, pool) can be outdated, for example
  a pool that was filled in. Label them *From public records* and keep them
  editable.
- **Public bucket** exposure (§5.2).
- **Provider facts in this audit come from search excerpts.** Pricing and
  terms for Walk Score, GreatSchools, SchoolDigger, RentCast and Google must
  be read on the vendors' own pages before any sign-up.

### Sources (search excerpts; pages not directly fetchable from this environment)

- RentCast: [Property Data Schema](https://developers.rentcast.io/reference/property-data-schema), [Property Data](https://developers.rentcast.io/reference/property-data), [Property Listings Schema](https://developers.rentcast.io/reference/property-listings-schema), [Property Listings](https://developers.rentcast.io/reference/property-listings), [Billing and Pricing](https://developers.rentcast.io/reference/billing-and-pricing), [2024-09 changelog](https://developers.rentcast.io/changelog/api-release-2024-09), [third-party price listing](https://us.fitgap.com/products/051875/rentcast)
- Walk Score: [API](https://www.walkscore.com/professional/api.php), [Terms](https://www.walkscore.com/terms-of-use.shtml), [walkscore R package README (free tier)](https://rdrr.io/cran/walkscore/f/README.md), [Redfin terms provision summaries](https://conductatlas.com/platform/redfin/redfin-terms-of-use/provision/CA-P-035165/walk-score-api-branding-and-linking-requirements/)
- Schools: [GreatSchools NearbySchools API](https://solutions.greatschools.org/k12-data-solutions/nearbyschools-api), [GreatSchools Enterprise licence](https://solutions.greatschools.org/k12-data-solutions/enterprise-data-license), [SchoolDigger pricing](https://widgets.schooldigger.com/pricing), [SchoolDigger API index](https://api.schooldigger.com/llms.txt), [NCES SABS](https://nces.ed.gov/programs/edge/sabs), [NCES district composites SY 2024-25](https://catalog.data.gov/dataset/school-district-composites-sy-2024-25-tl-25), [Precisely school boundaries](https://precisely.com/?p=36567)
