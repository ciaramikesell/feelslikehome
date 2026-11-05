# Listing import automation: feasibility audit

Research and planning only. No production code, migrations, provider calls,
paid model calls or vendor sign-ups were made. The work was done on latest `main`
(`393508e`, after #169), in an isolated container on its own branch. It does not
touch the Match Reveal work.

Assumptions that were **not verified** are marked **[unverified]**. Every
vendor price below is one; check it before budgeting.

---

## 1. Current import architecture and gaps

### 1.1 Flow: pasted URL → saved home → personalized Match

```
Find bar / Share Sheet / /homes?url=
  │  isLikelyListingUrl()                        src/lib/listingUrl.js:149
  │  findHomeByListingUrl() → existing home       (exact-URL duplicate guard)
  ▼
extractAddressFromListingUrl()                  src/lib/listingUrl.js:172
  │  string-only, never fetches the page
  │  Redfin / Realtor.com → confidence 'high'
  │  Zillow / Homes.com / generic → 'low' (flat-slug heuristic)
  │  apartments: extractApartmentIdentityFromListingUrl() → name only, asks for address
  ▼  (no address → "We couldn't get much from that link" + manual address / paste)
HomeModal.lookupAddress()                       src/components/HomeModal.jsx:850
  │  POST /api/import-listing { address, mode }
  ▼
route.js (auth required, ≤200 chars)             src/app/api/import-listing/route.js
  ▼
lookupRentCast()                                 src/lib/rentcastLookup.js
  │  parallel: /v1/properties + /v1/listings/{sale|rental/long-term}
  │  8 s timeout each (fetchWithTimeout), no cache, no rate limit
  │  failure reasons: rate_limited / timeout / invalid_address / unavailable
  ▼
normalizeRentCastFields()                        src/lib/rentcast.js
  │  address-match check (drops a record for a different house)
  │  documented fields only (PR #161); Active listing only for price / DOM
  │  → findings (AUTHORITATIVE) → resolveImport → fieldPatch
  ▼
mergeImportFields(form, fields)                  src/lib/importDomain.js:519
  │  fills EMPTY fields only; false / 0 / buyer values always win
  ▼
ImportFoundCard ("We found your home") → Add to My Homes
  │  listingImportSnapshot() → homes.listing_import (jsonb)   src/lib/importSnapshot.js
  │  importedCoordinatePatch() → trusted RentCast map point
  ▼
Home Facts (provenance "From listing" / "Added by you" / Unknown)   src/lib/homeProvenance.js
  ▼
computeMatch() → resolveCriterionAnswer()        src/lib/matching.js, src/lib/homeFactCriteria.js
     buyer's own Yes/No  >  exact Home Fact reading (#167)  >  Unknown (not counted)
```

Fallback path: **"Can't find the home? Paste listing details instead"** (a
collapsed disclosure in Add Home). `runAutofill()` (`HomeModal.jsx:780`) does
four things:

1. `parseListingTextFindings()` (`matching.js:312`) fills empty **shared**
   fields from the text.
2. `resuggestListingAnswers()` (#165, `listingTextAnswers.js`) makes
   **personal** Match-answer suggestions, each with its evidence sentence. Each
   one needs Confirm or Leave Unknown.
3. `extractEnrichmentSuggestions()` (`importReview.js`) makes **Property
   Notes** suggestions: roof year, water/sewer, financing, HOA text and similar.
4. `listingTextEvidence()` stores the evidence in the snapshot as
   `descriptionFeatures`.

### 1.2 What is filled today, by source

| Fact | RentCast (auto-fill) | Pasted text (auto-fill shared field) | Pasted text (suggestion only) | Otherwise |
|---|---|---|---|---|
| Address, price, beds, baths, sq ft, lot, year built, property type, DOM | ✅ (price/DOM only from an Active listing) | ✅ | – | manual |
| Coordinates | ✅ (address-matched, ≤250 m agreement) | – | – | Google geocode |
| Garage spaces | ✅ `features.garageSpaces` | ✅ "2-car garage" / "Garage: 2" | – | manual |
| Garage type | ✅ only an unambiguous Attached/Detached | ❌ | personal "Attached garage" (legacy label only) | manual |
| HOA fee /mo | ✅ `hoa.fee` (0 = $0, never "No HOA") | ❌ | **Notes** line "HOA: …" | manual |
| Property tax + year | ✅ | ❌ | – | manual |
| Heating / cooling / exterior / roof | ✅ descriptive strings only | ❌ | – | manual |
| Basement condition (finished/unfinished) | ❌ not documented by RentCast | ❌ | **personal** "Finished basement" Yes/No | manual |
| Basement style (walkout) | ❌ | ❌ | **personal** "Walkout basement" Yes | manual |
| Laundry location | ❌ | ❌ | **personal** "First-floor laundry" Yes | manual |
| Primary bedroom location | ❌ | ❌ | **personal** "First-Floor Primary" Yes/No | manual |
| Primary ensuite | – (no shared field) | – | **personal** Yes | manual |
| Fenced yard | – (no shared field yet; planned for the "second PR" of #167) | – | **personal** Yes/No | manual |
| Home condition (new / move-in ready / renovation) | ❌ (`listingType` not used yet) | ❌ | – | manual |
| Rental: pets / utilities / in-unit laundry | – | ✅ | – | manual |
| Photo | ❌ (deliberately; licensing) | an image URL inside the pasted text only | – | upload |

✅ = written into the empty form field, which the buyer reviews before saving. ❌ = no extractor.

### 1.3 Gaps (ranked by Match impact)

1. **The facts with the most Match value end up in the wrong place.** Since
   #167, Home Facts answer Finished basement, Walkout basement, First/Second-
   floor laundry, First-Floor Primary, Garage and No HOA for **every** buyer.
   When pasted text says "finished walkout basement" or "first-floor laundry",
   the importer already understands the sentence, but it only offers a
   *personal* Yes for the current buyer:
   - the shared Home Fact stays Unknown;
   - a co-buyer has to answer the same thing again;
   - the Home Facts page still shows Unknown;
   - a buyer who hasn't selected that criterion gets no suggestion, so the fact
     is lost.

   This is the largest gap, and it costs nothing to fix: no provider, no
   network call, no migration.
2. **RentCast cannot supply** basement, laundry, primary-bedroom location,
   fencing, ensuite, condition or remarks. Its documented schema has none of
   them (`docs/rentcast-import-accuracy.md`). Any automatic source for these
   needs listing *content*, not the property record.
3. **HOA fee in pasted text** ("HOA $250/month") becomes a Notes line, not
   `hoaFeeMonthly`. So "No HOA" stays Unknown even when the text gives an
   explicit fee above $0.
4. **Garage type in pasted text** ("attached 2-car garage") fills spaces but
   not type.
5. **No quota protection.** Each lookup costs 2 billable RentCast requests,
   with no per-user limit and no cache (open since #161 as audit item T-03).
   Any automation that adds lookups makes this worse.
6. **Second lookup in one session.** Fields filled by the first lookup survive
   a second address, because imports only fill empty fields. This was noted in
   #161 and is still unfixed.
7. **The Share Sheet drops page text.** The iOS extension takes the URL only
   (`docs/ios-share-extension.md`). Whatever title or text came with it is
   discarded.
8. The paste fallback is labelled "Can't find the home?". A buyer whose
   RentCast import *succeeded* is never invited to paste the description, even
   though that is where the high-value facts are.

---

## 2. Extraction approaches compared

| | A. Licensed structured data (RentCast today; other MLS/IDX feeds) | B. Server fetch of HTML / JSON-LD / OG metadata | C. Headless-browser render + screenshot | D. AI extraction (from permitted text or screenshots) | E. Buyer-pasted listing text (exists) |
|---|---|---|---|---|---|
| **Coverage of high-value facts** | Basics, tax, HOA fee, garage spaces/type. **No** basement, laundry, primary location, fence or remarks in RentCast. MLS/IDX feeds carry `BasementYN`, `LaundryFeatures`, `Fencing`, `MainLevelBedrooms`, `PublicRemarks` (RESO fields) **[unverified per vendor]** | Portals' JSON-LD is mostly name / address / price / photo / beds / baths. Remarks and feature lists usually live in app-state JSON, which is scraping | Everything visible on the page, including the feature lists | Depends on input. On full listing text, good for every fact in §3 | Whatever the buyer copies. Usually the description, often the "Facts & features" list too |
| **Reliability / confidence** | High; authoritative, address-checked | Low–medium. Portals return bot challenges with HTTP 200, block data-centre IPs and change markup often | Low. Same blocking as B plus layout drift. Screenshots crop or hide collapsed sections | Medium–high on explicit text with evidence quotes. Lower on screenshots (OCR, cropped sections). Never use for photos-of-rooms inference | High where text is explicit. Rule-based, deterministic, already guarded against negation/hedges |
| **Legal / terms** | Clear under contract. Display/storage terms apply | **High risk** for Zillow/Redfin/Realtor/Homes. Their terms generally prohibit automated access **[unverified current wording]**. Needs per-site legal review (already a condition in `import-enrichment-v1` audit §7) | **Highest risk.** Automated rendering is "automated access" under typical portal terms and invites anti-bot circumvention. Out of policy for this task | Only as permitted as its input. Fine on buyer-pasted text or licensed data. Inherits B/C's risk if fed scraped pages. Data goes to a model provider (privacy note needed) | Lowest. The buyer's own copy, for personal use. Already the documented, accepted path |
| **Maintenance** | Low (one schema) | High (per-site parsers, block handling, SSRF hardening) | Very high (browser infra, per-site breakage) | Medium (prompt, schema, eval set, model version drift) | Low (regex rules + fixtures, already tested) |
| **Latency** | ~0.5–2 s (two parallel calls, 8 s cap) | 1–5 s + failures | 5–20 s | +1–4 s per call (small model, short text) **[unverified]** | instant (client-side) |
| **Cost per imported home** | RentCast: 2 requests per lookup. Roughly $0.05–$0.40 per import, depending on plan and overage **[unverified]**. MLS/IDX: monthly licence + broker sponsorship | ~$0 compute; legal/ops cost dominates | Hosted browser ~$0.01–0.05/page **[unverified]** + vision tokens | Text: Haiku 5.5 ~$0.0006 / Sonnet 5.5 ~$0.01. Screenshots: Haiku ~$0.002 / Sonnet ~$0.03 (see §6) | $0 |
| **Fits Next.js / Vercel / Capacitor** | Yes (exists) | Possible in a route handler, but needs DNS/redirect/SSRF guards. Vercel IPs are commonly blocked | Poor. Chromium exceeds comfortable Vercel function size/time. Needs an external browser vendor (new vendor = out of scope) | Yes: a server route calling the Anthropic API; key stays server-side like `RENTCAST_API_KEY` | Yes (exists, client-side, pure) |
| **New buyer actions** | None | None | None | None beyond reviewing suggestions | One copy + paste (exists) |

**Conclusion.** For the facts that move Match, B and C would require scraping
portals FLH has no permission to automate, so they are not recommended. A is
already used to its documented limit. **E is under-used**: it reads the right
sentences but sends the answers to personal checks instead of shared Home
Facts. D adds value mainly as a **fallback interpreter for pasted text** the
rules can't read ("Facts & features" lists, unusual wording). It is not needed
for the first PR. AI interpretation of **screenshots** adds nothing over pasted
text: it needs a screenshot source (C, ruled out, or a buyer-uploaded
screenshot, which is more work for the buyer than pasting) and reads less
reliably.

One permitted way to reduce buyer actions further, later: **Safari Share
Extension JavaScript preprocessing** (`NSExtensionJavaScriptPreprocessingFile`).
When the buyer shares from Safari, a small script runs in the page *they* are
viewing and returns `document.title` plus the visible description text with the
URL. This is buyer-initiated, single-page and in their own session, much like
copy/paste. It still needs legal review, and it only works from Safari, not
from portal apps. Treat it as phase 3.

---

## 3. High-value facts: what can be stated, suggested or not determined

Sources: R = RentCast documented field, T = explicit pasted text (existing
`listingTextAnswers.js` concepts unless marked *new*).

| Fact (shared field) | Match criteria it answers (#167) | Explicit and reliable enough to fill | Suggest, buyer confirms | Unknown / never inferred |
|---|---|---|---|---|
| Garage spaces (`garageSpaces`) | Garage | R `garageSpaces`; T "2-car garage" (already auto-filled) | – | "Garage" with no count; "1-2"; "2 + carport"; "No garage, 2 carport" (`garageSpacesCount`) |
| Garage type (`garageType`) | none today (legacy "Attached Garage" only) | R unambiguous Attached/Detached | T *new*: "attached garage" → attached, "detached garage" → detached, using `attachedGarage` guards | bare "garage"; "attached/detached"; carports; "oversized garage" |
| Basement condition (`basementCondition`) | Finished basement | – | T "finished basement / basement is finished" → finished; "unfinished basement" → unfinished; "partially finished basement" → partially_finished *new*; "no basement" → none (explicit statement only) | "basement" alone; "lower level" alone; hedged ("could be finished", "ready to finish", "roughed-in bath"); crawl space; a basement bedroom/apartment wording |
| Basement style (`basementStyle`) | Walkout basement | – | T "walkout / walks out / exterior entrance from basement" → walkout | "daylight windows" (gardenview is not determinable from text with confidence); absence of "walkout" never means traditional |
| Laundry location (`laundryLocation`) | First- / Second-floor laundry | – | T "first-floor / main-level laundry" → first_floor; "second-floor / upstairs laundry" → second_floor (upstairs ≠ always second floor; keep the existing `UPPER` rule); "laundry in basement" → basement | "laundry hookups"; "laundry room" with no floor; two locations named; "in-unit" (rental field) |
| Primary bedroom location (`primaryBedroomLocation`) | First-Floor Primary | – | T "primary suite on the main level" → Main Floor; "primary bedroom upstairs / all bedrooms upstairs" → Upstairs | "main-level bedroom" (a bedroom ≠ the primary); "guest suite on main"; "flex room" |
| HOA fee (`hoaFeeMonthly`) | No HOA (fee > $0 ⇒ No) | R `hoa.fee` | T *new*: "HOA $250/mo", "HOA dues: $1,200 annually" → monthly only when the period is explicit ($100/mo; annual ÷ 12 shown to the buyer) | "No HOA" → **not** $0 and not set. It stays a Notes suggestion, because $0 ≠ no HOA. "Voluntary HOA", "HOA fee TBD", a fee with no period |
| Primary ensuite | Primary ensuite (personal) | – | T (existing personal suggestion, no shared field) | "Jack-and-Jill", "hall bath", "shared bath" |
| Fenced yard | Fenced yard (personal) | – | T (existing personal suggestion; becomes a shared fact only after the planned fence column) | "partially fenced", invisible/electric fence, community fencing |
| Home condition (`homeCondition`) | Home Condition | – | R `listingType = New Construction` → "New Construction" (needs schema re-confirmation; #161 follow-up) | "move-in ready", "turnkey", "needs TLC", "investor special": marketing words, never mapped |
| First-floor bedroom (any) | – (`homeLayout`/no shared field) | – | T (existing personal suggestion) | – |

Rules that hold for every row:
- A fact is never inferred from a missing mention.
- Unknown never becomes No.
- A non-empty field is never overwritten, including a buyer-confirmed answer
  and `0`/`none`.
- The Match scorer and `homeFactCriteria.js` are not changed. Shared facts
  feed Match only through the existing #167 readings.

---

## 4. Recommended minimum viable improvement

**"Pasted listing text suggests shared Home Facts."** The importer already
classifies the right sentences (`classifyListingText`). Map that evidence onto
**shared Home Facts fields that already exist**, instead of only onto personal
checks.

How it works:
1. `runAutofill()` keeps everything it does today.
2. It also produces **Home Facts suggestions** (`HOME_FACT_FROM_TEXT`, a new
   pure module, e.g. `src/lib/listingTextHomeFacts.js`): basementCondition,
   basementStyle, laundryLocation, primaryBedroomLocation, garageType,
   hoaFeeMonthly.
3. They appear in the existing review area as "Listing says: *Finished walkout
   basement* → Basement: Finished · Walkout [Use] [Leave Unknown]", with the
   quoted sentence.
4. **Use** writes the canonical token into the **empty** form field only
   (`mergeImportFields` semantics). It is saved with the home, and the evidence
   goes into the `listing_import` snapshot (`source: 'pasted_text'`), so Home
   Facts shows it as *From listing* via the existing provenance logic.
5. Match picks it up automatically through #167 for every buyer who hasn't
   overridden it. No change to scoring, weights or the SQL scorer.
6. **De-duplication.** When a Home Facts suggestion covers a criterion (e.g.
   Finished basement), don't also show the personal answer suggestion for it.
   The shared fact answers it, and the buyer can still override in Match.
   Personal suggestions stay for criteria with no shared field (ensuite, fenced
   yard, fireplace…).
7. Change the disclosure copy so it also appears **after a successful
   RentCast import**: "Paste the listing description to fill in basement,
   laundry and layout." This is one optional paste, no new required step.

### Evidence and confidence model (no migration)

Reuse `importDomain.js` strengths and the existing ephemeral `ImportFinding`
shape:

| Strength | Meaning | Behaviour |
|---|---|---|
| `authoritative` | Licensed structured field (RentCast) | Auto-fill empty field (today) |
| `explicit` | Structured or numeric statement in pasted text (price, beds, "2-car garage") | Auto-fill empty field; buyer reviews before save (today) |
| `candidate` (**use for the new facts**) | Explicit prose statement mapped to a canonical choice | **Suggest only; written only on buyer "Use"** |
| `forbidden` | Hedged, negated-ambiguous, community, conflicting | Never shown; stays Unknown |

Each finding keeps `evidence` (the sentence, ≤240 chars), `sourceType:
'listing_prose'` and `sourceProvider: 'user_paste'`. Conflicting statements
in the same text ("finished basement… unfinished storage area" resolving to
two values) produce no suggestion, matching `resolveFindings` 'conflict'.

### Fallback behaviour

- No text, or nothing explicit: nothing changes; fields stay Unknown.
- Field already filled (RentCast, the buyer, or a co-buyer): no suggestion. A
  disagreeing statement shows as "Listing text says Unfinished · you have
  Finished" (read-only), and nothing is written.
- Edit Home on an existing home: out of scope for PR 1 (Add Home only). It
  could be phase 2 with the same module.

### Why not AI or screenshots first

The deterministic rules already exist, are tested against negation, hedging
and community wording, cost nothing, run on the device, and send no listing
text to a third party. AI extraction (D) is worth an **offline evaluation**
first:
- build a fixture set of real pasted descriptions the rules miss, collected
  with buyer consent or written as synthetic ones;
- measure precision per field;
- only then propose a Haiku-class fallback behind a flag, still emitting
  `candidate` findings with quoted evidence.

Screenshot analysis is not recommended: it needs a screenshot source (scraping
or extra buyer work) and adds nothing that pasted text doesn't.

---

## 5. Estimated buyer time saved [assumptions]

- Manually setting one Home Facts choice (open Home Facts, find the section,
  pick a value) takes about **10–20 s** **[assumption, not measured]**.
- PR 1 covers up to 6 fields: basement condition, basement style, laundry,
  primary location, garage type, HOA fee. Pasted descriptions typically state
  2–4 of them **[assumption]**. That is about **30–80 s per home**, plus about
  **10–20 s per co-buyer per criterion** they no longer re-answer.
- For a search of 15–25 homes: roughly **10–30 minutes per buyer**, more for
  co-buyer searches.
- Cost to the buyer: one paste (~5–10 s) when they choose to. That is zero new
  *required* actions.

A beta metric would validate this: suggestion shown / used / left Unknown rates
per field (`src/lib/analytics.js`, no listing text in events).

---

## 6. Ongoing costs and operational risks

| Item | Cost | Risk |
|---|---|---|
| **PR 1 (recommended)** | $0 per import; no infra | False positives in regex. Mitigated by quoted evidence, buyer confirmation, existing guard tests and new fixtures |
| RentCast (unchanged) | 2 requests per lookup. Plan-dependent, ~$0.05–0.40/import **[unverified; check the current RentCast plan]** | No per-user limit or cache. Fix separately (§7 follow-up) before any automation adds lookups |
| AI text fallback (future, D) | Per call ≈ 3k input + 0.5k output tokens. Haiku 5.5 ($0.10/$0.50 per MTok) ≈ **$0.0006**; Sonnet 5.5 ($2/$10) ≈ **$0.011** (list prices, cached 2026-10-06) | Listing text sent to the model provider (privacy copy); model drift (pin model, keep eval set); must emit only `candidate` findings |
| AI screenshot (not recommended) | ~6 page tiles × ~1.6k image tokens ≈ 10k input. Haiku 5.5 ≈ **$0.0014**, Sonnet 5.5 ≈ **$0.03**, plus a hosted browser ~$0.01–0.05/page **[unverified]** | ToS / anti-bot exposure, a new vendor, 5–20 s latency, cropped or collapsed sections read as "absent" |
| Server JSON-LD fetch (B) | ~$0 compute | Legal review per site, SSRF hardening, blocked IPs. Low payoff for Match facts |

---

## 7. Recommended first implementation PR

**Title:** Pasted listing text: suggest shared Home Facts (basement, laundry,
primary bedroom, garage type, HOA fee)

**Scope**
- New pure module `src/lib/listingTextHomeFacts.js`:
  - `homeFactSuggestions(text, form)` maps `classifyListingText()` evidence
    plus two new explicit readers (garage type, HOA fee with an explicit
    period) to `candidate` findings on existing canonical destinations
    (`CANONICAL_CHOICE_FACTS`, `primaryBedroomLocation` 'Main Floor' /
    'Upstairs', `hoaFeeMonthly` number);
  - `applyHomeFactSuggestion(form, suggestion)` writes empty fields only;
  - plus an "undo" for a suggestion still owned by the import.
- `HomeModal.jsx`: call it from `runAutofill`, show it in the existing review
  area (small `HomeFactSuggestionReview` component), and drop the personal
  suggestion when a shared suggestion covers the same #167 criterion. Update
  the disclosure copy so the paste option is offered after a successful import
  too.
- Snapshot: add the used suggestions to `listing_import.fields` (pasted_text
  source), so provenance shows "From listing". Unused suggestions are not
  persisted.
- Tests: `test/listing-text-home-facts.test.js` covering every row of §3.
  Positive, negation, hedge, community, conflict, "No HOA" ≠ $0,
  "upstairs" ≠ second floor, hookups, partially finished, never overwriting a
  filled field or `none`/`0`, idempotent re-run.
- Doc: `docs/listing-text-home-facts.md`.

**Out of scope:**
- migrations, new columns (fence, ensuite);
- `matching.js`, `homeFactCriteria.js` and the SQL scorer;
- RentCast changes, network calls, AI, screenshots;
- the Edit Home path, the Realtor Suggest a Home flow (no personal answers;
  shared suggestions could follow later).

**Acceptance criteria**
1. Pasting "Finished walkout basement. Laundry on the main level. Primary
   suite on the first floor. Attached 2-car garage. HOA $85/month." into Add
   Home offers suggestions for Basement Finished · Walkout, Laundry First floor,
   Primary bedroom Main Floor, Garage Attached, and HOA $85/mo. Each shows its
   quoted sentence, and nothing is written until **Use**.
2. After Use and save, Home Facts shows each value as *From listing*. Match
   shows "From Home Facts: Yes" for Finished basement, Walkout basement,
   First-floor laundry and First-Floor Primary, and "No" for No HOA, for every
   buyer without an override.
3. "No HOA", "laundry hookups in basement", "basement could be finished",
   "community pool and fenced dog park", and "bedroom on main level" produce
   **no** Home Facts suggestion.
4. A field that is already filled (by RentCast, the buyer or a co-buyer,
   including `none` and `0`) is never changed and never offered for that
   field.
5. A personal suggestion and a shared suggestion are never both offered for
   the same #167 criterion. Personal suggestions for criteria with no shared
   field are unchanged.
6. Match score, weights and the database scorer are byte-for-byte unchanged
   (existing parity tests pass untouched).
7. `npm test` and `next build` pass. Browser QA on iPhone, iPad and desktop
   covers the review area.

**Follow-ups, in order:**
1. RentCast per-user rate limit and short normalized-address cache (T-03).
2. Clear untouched fields from an earlier lookup when a second address is
   looked up.
3. The same suggestions in Edit Home.
4. Offline AI-fallback evaluation (no paid calls until approved).
5. Shared fence/ensuite fields: needs a migration and new #167 readings, so a
   Match change and its own review.
6. Safari share preprocessing (legal review first).

---

## 8. Dependencies and conflicts with the Match Reveal PR

No Match Reveal branch or PR is visible on GitHub at the time of writing. The
only open PR is #166 (floor-plan POC). So the following is based on the shape
of the feature and the code on `main`:

- **No logic conflict.** PR 1 changes no Match readings, weights or
  completeness rules. It only fills shared fields that #167 already reads. It
  will make more criteria *evaluated*, so homes will reach the 90%
  completeness threshold sooner. The Reveal's tests should not hard-code
  "Unknown" for basement, laundry or layout on homes imported from pasted text.
- **Likely file overlap: `src/components/HomeModal.jsx`.** In particular
  `ImportFoundCard` and the Add Home landing, where a first-home "Match reveal"
  could sit (`onboardingFlow.js` already mentions one). Keep PR 1's change
  there small: one call in `runAutofill` and one review component. Rebase it
  after the Match Reveal PR merges, rather than in parallel.
- **Do not touch** `src/lib/matching.js`, `src/lib/homeFactCriteria.js`,
  `src/lib/homeCardPresentation.js`, `MatchCriteria.jsx` or the compare SQL
  while the Reveal is in flight.
- Copy coordination: a Reveal message like "answer 2 more to see your Match"
  could point to the new "Paste the listing description" prompt. That is a
  product decision for after both PRs land.

---

### Method notes

- Code read: `listingUrl.js`, `rentcastLookup.js`, `rentcast.js`,
  `importDomain.js`, `importReview.js`, `importSnapshot.js`,
  `homeProvenance.js`, `listingFacts.js`, `listingTextAnswers.js`,
  `homeFactCriteria.js`, `homeFacts.js`, `matching.js` (parser + scorer
  header), `HomeModal.jsx` (import flow);
- prior docs read: `import-enrichment-v1-technical-product-design-audit.md`,
  `listing-autofill-v2-audit.md`, `rentcast-import-accuracy.md`,
  `pasted-listing-suggestions.md`, `home-facts-match-parity.md`,
  `share-intake-contract.md`, `ios-share-extension.md`;
- not done: no listing site, RentCast endpoint or model was called. Site terms
  were not re-read in this audit; §2's legal column is a risk flag, not a
  legal opinion.
