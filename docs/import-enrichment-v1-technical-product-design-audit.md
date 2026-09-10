# Import & Enrichment V1 — Technical/Product Design Audit

**Status:** implementation-ready recommendation; no production behavior or schema changed  
**Audit date:** 2026-09-10  
**Product contract:** collect aggressively, promote conservatively; an omitted fact is Unknown, not No; a user correction always wins.

## Executive recommendation

V1 should extend the existing Add Home path, not introduce an import wizard. Keep the current listing-link/address input and server-side RentCast lookup, then add a source-neutral extraction result and deterministic merge layer. The useful minimum is:

1. preserve the pasted URL and extract its candidate address from the URL path;
2. use the authenticated server route to retrieve licensed/contracted property data by that address;
3. optionally make a short, guarded server-side metadata request for allowlisted public listing URLs, treating JSON-LD/Open Graph as opportunistic rather than required;
4. merge only explicit, well-typed values into empty fields;
5. derive answers only for the current participant's selected, objective criteria and only from explicit positive or negative evidence;
6. offer a short-lived, high-signal list of additional facts that the user may append to the existing `notes` field; and
7. fall back to the already-present pasted-listing-text path whenever URL metadata is unavailable.

The first implementation should require **no migration**. Provenance, conflicts, confidence, and candidate findings can live in the import response and Add Home component state until Save. V1 should persist only the accepted canonical home fields, the current participant's accepted/automatic objective answers, and enrichment text the user explicitly adds to Property Notes. Durable refresh/re-import history can wait until it has a demonstrated product need.

---

## 1. Current State

### Add Home and URL handling

`HomeModal` is already the single Add/Edit experience. New homes get one “Listing link or address” input; successful lookups produce a compact summary and the user can reveal the ordinary editable fields. Existing homes go directly to the edit form, so there is currently no re-import action (`src/components/HomeModal.jsx`, `HomeModal`, `handleFind`, `lookupAddress`).

For an HTTP(S) URL, `handleFind` calls `extractAddressFromListingUrl`, stores the original URL, and looks up the extracted address. It does **not** fetch the listing page. An unrecognized URL is retained while the UI asks for an address. A plain address goes directly to lookup (`src/components/HomeModal.jsx`, lines 325–424).

`extractAddressFromListingUrl` is a pure path parser:

- Redfin and Realtor.com have structured path parsers and return `confidence: 'high'`;
- Zillow and Homes.com use a street-suffix heuristic over a flat path blob and return `confidence: 'low'`;
- other hosts get a generic numeric-street-segment heuristic;
- malformed and unexpected shapes return `null` (`src/lib/listingUrl.js`, `parseRedfin`, `parseRealtor`, `parseFlatBlob`, `parseGeneric`, `extractAddressFromListingUrl`).

There is an apparently duplicated root-level `listingUrl.js` with the same implementation as `src/lib/listingUrl.js`. Runtime imports reference `@/lib/listingUrl`; V1 should designate the `src/lib` copy as canonical and separately decide whether to delete the root copy. This audit does not remove it.

### Existing server import

`POST /api/import-listing` is an authenticated Next.js Route Handler. It accepts an address and sale/rental mode, reads the server-only `RENTCAST_API_KEY`, and performs two parallel calls: RentCast `/v1/properties` and either the sale or long-term rental listing endpoint. It tolerates one empty/failed upstream, distinguishes rate limiting, and returns normalized fields (`src/app/api/import-listing/route.js`, `fetchRentCast`, `POST`). There is no cache and no true per-user rate limiter; authentication is the present quota guard.

`normalizeRentCastFields` currently emits address, price, beds, baths, square footage, lot size, year built, garage spaces, days on market, coordinates, monthly HOA fee, and the most recent annual property tax/year (`src/lib/rentcast.js`, `normalizeRentCastFields`). It does **not** currently normalize property type, availability, pets, utilities, in-unit laundry, basement, layout, condition, schools, prose, or a photo, even though several destinations already exist.

On success, `lookupAddress` copies returned entries only into apparently empty form properties and does not save automatically. Note that its predicate is `if (v && !next[k])`: it is safe for today's mostly non-empty string/number response, but it would silently discard meaningful `false` and numeric `0` values if the response begins carrying nullable booleans or raw zeroes. This should be corrected in the future merge helper rather than patched ad hoc (`src/components/HomeModal.jsx`, `lookupAddress`, lines 364–371).

### Raw listing-text fallback

Add Home already offers “Paste listing details instead.” `parseListingText` deterministically recognizes:

- sale price or rental monthly rent, beds, baths, square footage, lot size, garage count, year built, and days on market;
- explicitly labelled property type;
- rental availability with an explicit date;
- explicit positive/negative pets, utilities, and in-unit-laundry phrases;
- a likely address line, a direct image URL, and another URL (`src/lib/matching.js`, `parseListingText`).

`runAutofill` fills only empty form fields and asks the user to double-check. Unlike `lookupAddress`, its eligibility test does retain boolean `false`. It presently reveals the manual form by setting the import phase to `error`, which conflates a successful text fallback with a provider error; treat that as a small UX/state-model issue to address during implementation, not as part of this audit (`src/components/HomeModal.jsx`, `runAutofill`).

### Existing home fields and storage

The `homes` row already has the destinations needed for most V1 facts:

| UI/model property | Database column | Shape / meaning |
|---|---|---|
| `address`, `crossroads` | `address`, `crossroads` | Shared text |
| `listingUrl`, `photoUrl` | `listing_url`, `photo_url` | Shared URLs |
| `price`, `estMonthly` | `price`, `est_monthly` | Shared text; asking price or rent is `price` |
| `beds`, `baths`, `sqft`, `lotSize` | corresponding snake-case columns | Shared text |
| `garageSpaces`, `yearBuilt`, `daysOnMarket` | corresponding snake-case columns | Shared text |
| `homeLayout` | `home_layout` | Shared text array with canonical layout options |
| `homeCondition` | `home_condition` | Shared text array |
| `primaryBedroomLocation`, `secondaryBedroomLocation` | corresponding columns | Shared text |
| `basementNotes`, `schoolsNotes`, `conditionNotes` | corresponding `_notes` columns | Shared descriptive text; not Match inputs |
| `propertyType` | `property_type` | Nullable constrained enum |
| `availableOn` | `available_on` | Nullable rental date |
| `petsAllowed`, `utilitiesIncluded`, `inUnitLaundry` | corresponding columns | Nullable shared booleans; null is Unknown |
| `notes` | `notes` | Existing shared Property Notes destination |
| `hoaFeeMonthly`, `propertyTaxAnnual`, `propertyTaxYear` | corresponding columns | Nullable informational enrichment, excluded from Match |
| coordinates/status/source | corresponding columns | Shared internal location infrastructure |

The complete client default is `emptyHome` (`src/lib/constants.js`), the database definition is `public.homes` (`supabase/schema.sql`), and conversion is centralized in `rowToHomeWithOwner` / `homeToSharedRow` (`src/lib/supabase/collaboration.js`). The Home form exposes the main facts through `PropertyFacts`, the optional property details below “More home details,” rental tri-state controls, and the `notes` textarea (`src/components/HomeModal.jsx`). Photos are either an external URL or a staged JPEG/PNG/WebP upload (5 MB maximum) to the public `home-photos` Supabase bucket on Save; URL import currently only recognizes a directly pasted image URL in raw listing text.

### Shared versus participant-specific state

Property facts, enrichment, Pros/Cons/Notes, and photo/listing URLs are shared on `homes`. Status, toured state, favorite/reaction/rejection, `ratings`, and `checks` live per participant in `home_member_state` (`src/lib/supabase/collaboration.js`, `PERSONAL_FIELDS`, `SHARED_FIELDS`, `getHomesForUser`, `upsertPersonalState`). This is important: a Fireplace or Basement check answer is the current participant's evaluation, whereas rental booleans and garage count are shared facts that Match reads directly.

Selected check criteria are stored as namespaced keys such as `features:Fireplace`: `true` means Yes, `'no'` means explicit No, and absence is Unknown. Historical `false` is intentionally treated as Unknown. Ratings are participant-specific numeric values and are not evaluated until greater than zero (`src/components/HomeModal.jsx`, `setCheckItem`; `src/lib/matching.js`, `computeMatch`).

Match already excludes Unknown from both numerator and denominator. It directly evaluates canonical property type, budget/price, square feet, lot, beds, baths, multi-/single-select facts, rental booleans, and numeric garage spaces. Other objective `check` items read participant `checks`; experiential `rating` items read participant `ratings` (`src/lib/matching.js`, `computeMatch`). This existing semantic boundary should remain unchanged.

---

## 2. Safe V1 Auto-Fill Fields

Confidence labels below are internal bands, not user-visible percentages:

- **Canonical:** accepted structured data with an unambiguous type/unit, or two explicit sources that agree.
- **Reviewable:** explicit listing prose/text with a deterministic parse; may populate an empty editable field but must not overwrite.
- **Candidate only:** heuristic, marketing implication, image interpretation, omission, malformed/unit-ambiguous data, or conflict. Do not populate canonical storage.

| Existing field | V1 evidence | Minimum band | Match effect |
|---|---|---:|---|
| `listingUrl` | Exactly the HTTP(S) URL pasted by the user after normalization/validation | Canonical user input | None |
| `address` | Licensed structured property/listing address; JSON-LD `PostalAddress`; high-confidence URL path. Low-confidence flat-path address stays editable and is used for lookup only | Canonical to replace an empty candidate; Reviewable for URL heuristic | Indirect only (lookup/map), not Match |
| `price` | Explicit current listing price/monthly rent from structured source; labelled raw text in the correct search intent | Canonical/Reviewable | Yes, when Budget selected |
| `beds`, `baths` | Numeric structured values or explicit labelled/count prose | Canonical/Reviewable | Yes, when selected minimum exists |
| `sqft` | Structured living area with known square-foot unit; explicit labelled text | Canonical/Reviewable | Yes |
| `lotSize` | Structured lot area with known units; explicit labelled text | Canonical/Reviewable | Yes; preserve units because current parsing/display is text-based |
| `yearBuilt` | Structured integer or explicit “year built/built in” | Canonical/Reviewable | None currently |
| `propertyType` | Structured type mapped exactly to `apartment`, `house`, `townhome`, `condo`, `multifamily`, `other`; explicit labelled/rental phrase | Canonical/Reviewable | Yes, when preferred types selected |
| `garageSpaces` | Explicit structured garage-space count or “N-car garage”; explicit 0/no garage only from reliable data/prose | Canonical/Reviewable | Yes; `0` is an evaluated No for Garage |
| `homeLayout` | Explicit structured stories/type or narrowly labelled prose mapped to `Ranch / Single Story`, `Two Story`, `Split Level`, `Other` | Canonical only for the first three exact concepts; never map “open concept” | Yes when Home Layout selected |
| `primaryBedroomLocation`, `secondaryBedroomLocation` | Only explicit “primary on main/upstairs” or all/split bedroom-floor statements | Reviewable; exact language required | Yes when selected |
| `basementNotes` | Explicit basement type/details, including an explicit “no basement” rendered as clean descriptive text | Reviewable | None; distinct from `features:Basement` check |
| `conditionNotes` | Objective dated component/update statements only (for example roof replaced in 2022); not “turnkey” | Reviewable | None |
| `availableOn` | Structured ISO date or an explicit full availability date | Canonical/Reviewable | Informational; no Match branch today |
| `petsAllowed`, `utilitiesIncluded`, `inUnitLaundry` | Structured boolean or explicit positive/negative terms | Canonical/Reviewable | Yes, when corresponding selected criterion exists |
| `photoUrl` | A valid HTTPS representative image URL from licensed data, JSON-LD `image`, or OG metadata; no computer-vision facts | Canonical only if response is an image and host policy permits hotlinking | None |
| `daysOnMarket` | Current structured listing value or explicit label | Canonical/Reviewable | None |
| `hoaFeeMonthly`, property tax fields | Existing RentCast structured fields with defined period/year | Canonical | None by design |
| coordinates | Existing external property data | Canonical | Not current Match; internal only |

Do not auto-fill `homeCondition` in V1. Its options (“Move-In Ready,” “Renovation Potential”) are judgments, while “New Construction” still has definitional edge cases. Objective dated updates belong in `conditionNotes` or the temporary panel. Likewise, do not populate `schoolsNotes` from listing marketing claims.

Merge rules must be field-aware rather than truthiness-based: `null`/`undefined`/empty mean no candidate, but `false` and numeric/string zero may be canonical. Existing non-empty values—including values changed after import—are user-owned and immutable to automation. Populate all eligible empty fields quietly in one merge; do not ask for per-field approval.

---

## 3. Safe V1 Priority Auto-Answers

### Scope and storage rule

First inspect `visibleOrderedItems(...).filter(item => item.kind === 'check')` for the current participant. Do not create answers for unselected priorities. Put derived answers into the current participant's existing `checks` only if that key is absent. Never modify `ratings`. Shared fields (`garageSpaces`, the rental booleans, structured thresholds/layout/property type) need no duplicate `checks` entry because `computeMatch` already reads them directly.

In a collaborative search, one participant's existing check must never be overwritten or copied to the other. The same shared extraction result may independently prefill an absent selected check for each participant when that participant reviews/imports; durable cross-participant automation should wait for an explicit product/privacy decision.

### Explicit tri-state contract

For every rule: **Yes** requires an affirmative, property-specific statement or structured true/value; **No** requires an explicit negation/structured false or zero; **Unknown** covers omission, ambiguity, conflicting sources, “possible/space for,” nearby/community-only amenities, and marketing implication.

| Criterion (namespaced key) | Yes | No | Unknown / guardrails |
|---|---|---|---|
| `exterior:Garage` | `garageSpaces > 0`, explicit attached/detached/N-car garage | structured `garageSpaces = 0` or explicit “no garage” | parking/carport alone; conflict. Prefer shared numeric field over a check |
| `features:Basement` | explicit basement, including finished/walkout | explicit “no basement” / slab with explicit no-basement statement | omission; crawlspace alone |
| `features:Finished Basement` | explicit finished/fully finished basement | explicit unfinished basement | basement with no finish status |
| `features:Walkout Basement` | explicit walkout/daylight-with-exterior-egress wording | explicit “no walkout” | ordinary basement or exterior photos |
| `features:Basement Bedroom` | explicitly identified legal/conforming basement bedroom | explicit statement that basement has no bedroom | bedroom count plus basement does not imply it |
| `features:Fireplace` | explicit fireplace count/type | explicit “no fireplace” or structured count zero | omission; decorative mantle/fireplace-ready |
| `features:Central Air` | explicit central air/central A/C | explicit no central air / window units only | generic “air conditioning” if system type unknown |
| `features:Home Office` | explicit office/study/den used as a dedicated room | explicit “no office” | “office potential,” staged desk, spare bedroom |
| `features:Primary Ensuite` | explicit ensuite/private primary bath | explicit no primary ensuite | bath/bed counts alone |
| `features:First-Floor Laundry` | explicit first/main-floor laundry | explicit laundry located only on another floor | laundry present with no location |
| `features:Mudroom`, `Pantry`, `Walk-In Closet`, `Additional Living Space`, `features:Dishwasher` | exact named feature/appliance | exact absence or appliance exclusion | synonyms must be tightly curated; omission |
| `features:Updated Kitchen`, `features:Updated Bathrooms` | Prefer **not auto-answering in V1**; only a dated, specific completed renovation could qualify later | explicit “not updated” is still subjective and should remain Unknown | “updated,” “modern,” new-looking photos, granite |
| `features:Storage` | Prefer wait; the term is too broad | wait | closets/basement do not establish the user's intended adequacy |
| `features:Guest / In-Law Suite` | explicit guest/in-law/ADU suite | explicit absence only if source provides a relevant structured false | extra bedroom alone |
| `exterior:Fenced Yard` | explicit fully fenced yard | explicit unfenced/no fence | “fence allowed,” partial fence, photo inference |
| `exterior:Patio / Deck / Outdoor Living` | explicit private patio/deck/terrace | explicit none | community patio or marketing photo ambiguity |
| `exterior:Attached Garage` | explicit attached garage | explicit detached-only/no garage | garage without attachment type |
| `exterior:Driveway / Off-Street Parking` | explicit driveway or assigned/private off-street parking | explicit street parking only/no off-street parking | garage alone should not imply driveway |
| `exterior:Parking` | explicit included/assigned/on-site parking | explicit no parking | nearby street parking unless explicitly included |
| `exterior:Elevator` | explicit building elevator | explicit walk-up/no elevator | multi-story building omission |
| `exterior:Building Amenities` | Do not auto-answer as one boolean in V1; user meaning is underspecified | same | individual amenities may be candidates only |
| `features:Pets Allowed` | structured true or explicit pets allowed | structured false/no pets | restrictions/fees without a clear allow/deny remain Unknown; use shared boolean |
| `features:Utilities Included` | structured true or explicit **all** utilities included | structured false or tenant pays all utilities | “some utilities included” is not Yes to the current broad criterion; suggest details in Notes; use shared boolean |
| `features:In-Unit Laundry` | structured true or explicit in-unit washer/dryer/laundry | structured false or explicit shared laundry only/no in-unit | laundry listed without location; use shared boolean |
| Investment `features:Separate Utilities` | explicit separately metered/paid utilities per unit | explicit common/shared utilities | multifamily status alone |
| Investment `features:Unit Configuration` | Do not reduce an arbitrary desired configuration to generic Yes/No without the user's stored custom meaning | only explicit user evaluation | keep Unknown in V1 |
| Investment `exterior:Parking` | same explicit Parking rule | same explicit No rule | omission |
| `location:Schools` and every custom check | Never auto-answer from listing prose | Never auto-answer from listing prose | school preference is user-specific; unknown custom semantics cannot be parsed safely |

The parser should use boundary-aware, negation-aware phrase rules over normalized sentences/structured keys—not substring presence. A single conflicting Yes/No pair yields a conflict and leaves the canonical answer Unknown. These rules should produce evidence snippets internally for review/debugging, but no percentages.

All `rating` criteria remain untouched, including Neighborhood, Immediate Street / Surroundings, Walkability, parks/proximity, Home Feel, Yard/Privacy, Exterior Condition, Landscaping, Noise Level, Tenant Appeal, Rental Income Potential, Property Condition, and Owner-Occupancy Suitability. Commute continues through its existing explicit destination/route mechanism, not listing prose.

---

## 4. Temporary Enrichment Panel

### Eligible V1 findings

Surface only explicit, high-signal details that are not already represented by a populated canonical field or selected priority answer:

- HOA amount/frequency and material HOA inclusions/restrictions (do not repeat `hoaFeeMonthly` if it is already visibly shown);
- roof replacement/install year;
- furnace, boiler, central A/C, water-heater, electrical, plumbing, window, or other major-system update with an explicit year/scope;
- city/municipal versus well water and sewer versus septic;
- seller financing, assumable loan, rate buydown, or closing-credit terms;
- possession/occupancy timing;
- disclosed special assessment and amount/status;
- appliances explicitly included/excluded;
- major recent additions/renovations with scope/year;
- rental fees/deposit, lease term, pet restrictions/fees, partial utility allocation, parking terms, and furnished status; and
- other explicit listing terms with decision or tour value.

Do not surface granite, generic landscaping, spaciousness, curb appeal, “close to everything,” or other low-signal promotion in V1. The extraction contract may still classify these as `candidate_marketing` and omit them from the returned/surfaced list so future fixture testing does not require redesign.

### UI and Property Notes behavior

After fields are quietly merged, show a calm temporary block inside the existing Add/Edit review flow:

> **We found quite a lot!**  
> We filled in what we could. Here are a few other details you may want to keep.

Each normalized sentence has an **Add** text action. Keep “Add all” only when there are at least two and at most a small capped number (recommend six) of eligible suggestions; it must be visually secondary. An Add appends a clean bullet under a lightweight `Listing details:` heading in the existing `form.notes`; the user can edit it immediately. Do not create a new input or save a hidden suggestion record.

Suggested text must be factual and source-faithful: `Roof: replaced in 2021`, not `Newer roof`; `Utilities: water included; tenant pays electric`, not `Utilities included`. Strip UI chrome, prices unrelated to the fact, repeated whitespace, and promotional adjectives while retaining qualifications and dates.

### Dedupe and lifecycle

Use a stable client-only finding ID from `kind + normalized value + qualifier`, not the raw sentence. Suppress a suggestion when:

1. it maps to a canonical field that this import populated or that already has an equivalent value;
2. its normalized tokens/value already exist in `notes`, `basementNotes`, `conditionNotes`, or another proposed suggestion;
3. a more specific finding subsumes it (for example, “Roof replaced 2021” subsumes “Roof updated”); or
4. it conflicts with a canonical/user value.

Clicking Add marks the suggestion consumed in local state and makes repeated clicks idempotent. Add all applies the same dedupe one item at a time. Deleting the appended note manually does not re-add it automatically.

Ignored suggestions do nothing: no tasks, reminders, badges, database rows, analytics payload containing raw listing prose, or later prompts. They vanish when the modal closes or the home saves. On a save error they remain in current component state along with the form. Because Edit Home currently has no re-import, the first release panel naturally appears only in Add Home; V1.1 can consider an explicit “Refresh from listing” action with conflicts and staleness controls.

---

## 5. Forbidden Inference Contract

The following cannot change canonical fields, checks, ratings, or Match unless the user explicitly supplies the answer or a reliable source supplies the exact objective fact:

- **Experiential quality:** Neighborhood, Immediate Street / Surroundings, Layout / Flow quality, Overall Condition quality, Natural Light, Character / Charm, Room Sizes, Openness/Ceiling Height quality, indoor privacy, Yard/Outdoor Space quality, Yard Privacy, Landscaping quality, Exterior Condition quality, Noise Level, tenant appeal, or emotional fit.
- **Image-derived judgments:** light, room size, condition, privacy, fence completeness, views, trees/yard, finish quality, accessibility, or feature presence from listing photography. V1 performs no computer vision.
- **Marketing translations:** desirable neighborhood → quality; turnkey/immaculate → Move-In Ready; open concept → Layout / Flow; gourmet/granite → Updated Kitchen; spa-like → Updated Bathrooms; spacious → size; close/minutes to everything → commute/walkability; great schools → Schools.
- **Context proxies:** ZIP/price/taxes → schools or neighborhood; bedroom/bath count → office/ensuite; basement → finished/walkout/bedroom; multifamily → unit configuration/separate utilities; property age → condition; trees → privacy.
- **Omission:** no mention never becomes No. This includes fireplace, basement, garage, central air, office, pets, utilities, laundry, parking, elevator, appliances, and every other feature.
- **Unscoped or conditional wording:** “possible,” “potential,” “ready,” “could be,” “space for,” “access to,” “near,” “community,” “negotiable,” and “verify with agent” are not affirmative property facts.
- **Provider disagreement or unit ambiguity:** conflicts and unresolvable monthly/annual, interior/lot, full/half-bath, unit/building, included/available distinctions remain Unknown.
- **Custom criteria:** labels and intended meanings are user-authored and cannot be safely mapped by a generic extractor.

The denylist is a final safety gate after extraction. Adding a new extractor does not automatically grant permission to write a field; a destination must also be present in an explicit allowlist with evidence and conflict rules.

---

## 6. Provenance / Conflict Strategy

### Recommended import-domain model

Introduce a pure server/client-neutral contract (names illustrative):

```js
{
  request: { listingUrl, lookupAddress, searchIntent },
  findings: [{
    id,
    concept,             // e.g. 'garage.spaces', 'feature.fireplace'
    value,
    unit: null,
    sourceType,          // user_input | structured_listing | listing_prose |
                         // external_property | inferred_candidate | marketing
    sourceProvider,
    evidence,            // bounded excerpt or structured key; server/log-safe policy applies
    evidenceStrength,    // authoritative | explicit | candidate | forbidden
    observedAt,
  }],
  resolutions: [{ concept, status, value, winningFindingIds, conflictFindingIds }],
  fieldPatch: {},
  priorityPatch: {},
  suggestions: [],
  warnings: [],
}
```

Use named evidence bands, never a user-visible confidence percentage. Recommended precedence is:

1. a current non-empty form value / existing participant answer (`user_input`);
2. agreeing explicit structured listing or contracted property data, with concept-specific freshness and unit checks;
3. explicit listing prose/raw text;
4. cautious candidate inference;
5. marketing implication;
6. omission.

Precedence is not blind source ranking: two sources at different tiers can still conflict. For example, structured one-car garage versus explicit prose two-car garage should yield `status: 'conflict'`; do not write `garageSpaces`. Identical normalized values corroborate. Related, non-exclusive facts may coexist (structured two-car garage plus prose “attached”).

### User precedence and compact conflicts

Take a snapshot of populated fields and checks before applying the import. Only write keys empty in that snapshot. Any later edit marks that concept user-owned for the modal session. Re-running lookup cannot replace it.

For a high-impact conflict that the user can resolve without research, optionally display one compact inline choice under the normal field (“Listing data says 1; description says 2 — choose 1 / 2 / leave blank”). Default is blank/Unknown. Never show raw confidence scores or a provenance badge beside every field. If conflict UI threatens calmness, leave blank and show one restrained “Some details disagreed, so we left them blank” message.

### Persistence recommendation

No schema is needed for V1 if import happens once before first Save. Keep findings/provenance/conflicts/suggestions ephemeral and persist only resolved values. This meets user precedence during the review session and avoids creating a poorly understood evidence ledger.

Durable provenance becomes necessary before automatic refresh, background enrichment, source badges, audit/reversal, or collaboration-wide re-evaluation. At that point prefer a separate append-only `home_enrichment_findings` table over provenance columns on every home field. It should include home/search ownership, concept/value JSON, source type/provider, observed timestamp, bounded evidence/hash, status, and supersession—not mutate canonical home columns by last-write-wins. That is V1.1/V2 design work, not a migration to apply now.

---

## 7. Technical Import Options

### Current architecture and boundary

The app is Next.js 15 with a client `HomeModal`, authenticated server components/pages, Next Route Handlers, Supabase, and an existing outbound server fetch to RentCast (`package.json`; `src/app/api/import-listing/route.js`; `src/lib/supabase/server.js`). Browser code cannot reliably fetch arbitrary listing pages because of cross-origin policy, and doing so would expose implementation behavior to providers. Any URL fetch belongs in an authenticated server Route Handler.

The present URL path parsing and address-based RentCast lookup are the most reliable available path because they do not depend on provider page markup. The raw-text fallback is also viable and user-mediated. Neither retrieves a listing's actual HTML today.

### Options

**A. Existing URL → address → contracted property/listing API (recommended baseline).** Retain the original URL, parse an address candidate, then query RentCast. Benefits: already implemented, server-held credential, normalized data, no CORS issue, independent of provider DOM. Limits: address heuristic errors, coverage/freshness, no listing prose/photo/most features, two billable calls, and the current “first result” selection has no exact-match verification.

**B. Guarded server fetch of public listing metadata (cautious experiment).** For a normalized, allowlisted HTTPS URL, resolve DNS and reject loopback/private/link-local/reserved addresses (including redirects), cap redirects, bytes, and elapsed time, send a transparent user agent, require HTML, and parse only standard metadata/JSON-LD. Prefer schema.org objects such as `RealEstateListing`, `Residence`, `Apartment`, `Offer`, `PostalAddress`, and `ImageObject`; then Open Graph title/image/description as weaker candidates. Never execute scripts or build a DOM/browser scraper. Benefits: may add address/price/photo/basic structured facts. Limits: metadata varies, can be stale/marketing-oriented, pages may require JavaScript/cookies, image URLs can expire, and providers may block data-center/Vercel IPs or return challenge/interstitial HTML with status 200.

**C. Provider-specific HTML/state scraper (do not build in V1).** Embedded application state can look attractive but changes without notice and is likely subject to stronger contractual/anti-bot restrictions. The repository has no such scraper. It would be operationally brittle and should not be the product promise.

**D. Pasted raw listing text (recommended fallback and feature evidence source).** Already present and immune to CORS/provider blocking because the user supplies the text. Extend the pure parser into structured findings, not broader speculative regexes. It can reliably capture explicit prose absent from property APIs. Limit input size, avoid rendering as HTML, do not log it, and discard unused raw text at modal close/save.

**E. Browser extension/share sheet/bookmarklet or user-side assisted capture (wait).** This could read content in the user's browser context, but adds installation, permissions, provider DOM coupling, privacy disclosure, platform fragmentation, and a separate product surface. It contradicts the smallest “existing Add Home got smarter” V1.

**F. Additional licensed property/MLS/listing source (later).** Needed if real-world tests show RentCast lacks sufficiently fresh price/rental/photo/feature coverage. Evaluate coverage, permitted display/storage, attribution, refresh/deletion obligations, cost, address matching, and field provenance before selection. Do not add a service during this task.

### Provider reliability and legal/terms constraints

Assume Zillow/Realtor/Redfin/Homes pages are **opportunistic and provider-dependent**, not reliable APIs. CORS prevents a general browser fetch; server fetch avoids CORS but not robots controls, bot challenges, authentication/cookie requirements, markup churn, rate limits, IP reputation, copyright, or contractual restrictions. A Vercel function also has finite execution/body limits and ephemeral execution; no headless browser dependency should be introduced for this flow.

Before enabling any provider in an allowlist, product/legal must review that provider's current Terms of Use, robots directives, attribution requirements, and restrictions on automated access, caching, derived data, and image hotlinking. Terms and provider behavior change, so capture review date/owner in the implementation PR rather than hard-coding assumptions in this document. Network documentation lookup was unavailable in the audit environment; this report intentionally makes no claim that a named provider permits scraping.

### Recommended request sequence

1. Client validates an HTTP(S) URL and preserves it exactly enough for the user to open later.
2. Pure URL parser proposes an address; high-confidence path results may trigger lookup, while low-confidence results remain visibly editable and should ideally require address confirmation before consuming quota.
3. Authenticated server validates address/mode/input length, queries the existing property source, and (behind an internal provider allowlist/timeout) may attempt metadata fetch.
4. Independent adapters emit the common finding contract; resolver detects agreements/conflicts and builds allowlisted patches.
5. Client merges into empty fields/checks and retains ephemeral suggestions/conflicts.
6. On blocked/unrecognized/no-data URL, keep the URL and offer address plus the existing raw-text paste—never present a technical scraper failure.

Server protections required before Option B: authentication; per-user/IP rate limiting beyond the current auth-only guard; HTTPS-only URLs; hostname allowlist or strict public-network validation; DNS rebinding/redirect revalidation; request timeout/abort; response-size/content-type caps; no forwarded user cookies/auth; sanitized errors; no raw upstream body or listing prose in logs; and no arbitrary proxy response returned to the client.

---

## 8. Minimal Schema Changes, If Any

### V1: none

Reuse:

- current `homes` columns for canonical shared facts and `notes` for accepted suggestions;
- current nullable rental booleans for true/false/Unknown;
- current `home_member_state.checks` for the importing participant's selected objective criteria;
- current `ratings` untouched for experiential criteria; and
- component state for provenance, conflicts, candidates, and suggestion lifecycle.

No migration should be created or applied. Do not add permanent HOA/roof/HVAC/etc. inputs. Existing HOA/tax columns can continue their current informational role, but the panel must avoid duplicate display.

### Deferred schema considerations

Only after V1 testing demonstrates need:

- an append-only enrichment finding/evidence table for refresh/audit and collaborator-safe reuse;
- `imported_at`/source freshness metadata if automatic refresh is introduced;
- more precise facts (utility breakdown, parking type, pet policy) only when they earn permanent product surfaces and Match semantics;
- a dedicated property-notes structure only if free-text dedupe/editing proves insufficient.

Each would require RLS, column privileges/RPC review, retention policy, collaboration ownership, exports/deletion, and sanitized Compare parity. None is justified merely to render a one-session suggestion panel.

---

## 9. Proposed Implementation Phases

### Phase A — extraction contract and merge safety

- Add pure finding/resolution types (JSDoc is sufficient in this JavaScript repo), evidence bands, destination allowlist, normalizers, and a field-aware empty/value predicate.
- Split the existing raw-text parser into adapters that emit findings, retaining a compatibility wrapper if tests/callers need `parseListingText`.
- Centralize “user wins,” explicit-zero/false handling, corroboration, conflict, omission, and forbidden-destination gates.
- Resolve the duplicate `listingUrl.js` ownership and test only the canonical module.

**Exit:** fixtures resolve deterministically; no UI/server behavior changes required yet.

### Phase B — structured auto-fill

- Extend `normalizeRentCastFields` only for contracted, documented fields actually returned (property type/rental facts/photo only after verified fixtures/docs).
- Return findings plus backward-compatible `fields` from the authenticated route.
- Quietly merge safe fields in `HomeModal`, keeping the user's URL and all prior values.
- Separate text-fallback success from error state.

**Exit:** known data populates the existing form; false/zero survive; user edits cannot be replaced.

### Phase C — priority-aware auto-answer

- Filter current user's selected objective/check criteria.
- Implement the narrow explicit rules above, beginning with Basement, Fireplace, Central Air, Home Office, primary ensuite, fenced yard, patio/deck, attached garage, parking, dishwasher, and the already-modeled rental booleans.
- Prefer shared fields where `computeMatch` already consumes them; write absent `checks` only for check-only concepts.
- Ensure the server-side sanitized co-buyer Compare path continues to mirror Match semantics; do not change scoring.

**Exit:** explicit Yes/No evaluates selected priorities, omission/conflict stays Unknown, ratings never change.

### Phase D — temporary enrichment suggestions

- Add high-signal classifiers/formatters and stable IDs.
- Render the temporary block in the existing review flow, capped and deduped.
- Append only on Add/Add all to `form.notes`; ignored candidates remain ephemeral.

**Exit:** no duplicate permanent fields, hidden tasks, or automatic note writes.

### Phase E — real-world provider testing

- Assemble redacted/licensed HTML/JSON-LD/raw-text fixtures across sale/rental, provider, property type, locale, and blocked/challenge responses.
- Measure URL-address success, property-source exact match, field precision/coverage, conflict/Unknown rate, latency, quota use, and suggestion acceptance.
- Run legal/ToS review per provider. Enable guarded metadata adapters only where permitted and reliable.
- Decide whether a licensed additional source, manual browser-assisted capture, or softer suggestions merit V1.1.

---

## 10. Testing Plan

### Unit tests

- URL parsing: known providers, trailing/query/share URLs, encoded units/directions, cities containing suffix-like words, malformed escapes, unsupported schemes, userinfo, deceptive subdomains, and generic false positives.
- Normalization: integer/decimal fields, bath fractions, lot square feet/acres, property-type enum mapping, ISO dates, monthly versus annual fees, image URL validation, zero, false, null, and out-of-range values.
- Merge precedence: empty receives canonical values; existing/user-modified values win; `0`/`false` survive; same-value corroboration; retries are idempotent.
- Resolver: structured/prose agreement, conflicts at same/different tiers, unit mismatch, stale versus current listing facts, multiple values, forbidden destination.
- Priority selection: only current user's selected check keys; shared rental booleans/garage avoid duplicate checks; collaborator checks stay isolated.
- Match regression: Unknown excluded, explicit No missed, Yes met, existing partial-credit thresholds unchanged, rating criteria untouched.
- Suggestion formatting/dedupe: equivalent wording, subsumption, notes already containing fact, canonical-field duplication, Add/Add all idempotency, ignored lifecycle.

### Parser fixtures

Store small, redacted, legally usable fixtures rather than live network tests in CI:

- JSON-LD single object, `@graph`, arrays, malformed JSON, multiple properties/offers, missing units, stale price;
- Open Graph only, relative/candidate image, challenge/interstitial page, oversized/non-HTML response;
- pasted sale/rental text with explicit positives, explicit negatives, double negation, “some utilities,” building versus unit amenities, and marketing language;
- RentCast property-only, listing-only, empty, mismatched returned address, zero garage, nullable rental facts, rate limit and upstream error.

Every fixture should declare expected findings, resolutions, field patch, priority patch, suggestions, conflicts, and forbidden non-results. Never make provider live availability a merge-blocking test.

### Security and route tests

- unauthenticated requests; invalid/oversized bodies; sale/rental mode coercion; quota/rate limit behavior;
- SSRF cases: localhost, RFC1918, link-local, IPv6 local, decimal/encoded IPs, DNS rebinding, redirect to private host, credentials in URL, non-HTTPS, unsupported ports;
- timeout/abort, redirect cap, byte cap, incorrect content type, decompression bomb considerations, sanitized errors/logs;
- XSS payloads in metadata/prose remain plain text and are never injected as HTML;
- no API key, cookies, upstream body, or unaccepted raw prose reaches logs/client response.

### Production-safe QA

- Use test accounts and listings the team is permitted to access; do not load-test provider sites.
- Feature-gate metadata fetching by provider and maintain a kill switch independent of the baseline address lookup.
- Observe aggregate success/error/latency and finding-kind counts only; do not collect raw addresses, URLs, prose, or evidence in general analytics.
- Verify Add Home remains manually completable during provider errors/key absence/rate limiting.
- Verify Cancel creates no home, photo orphan, check, notes, or suggestion record; failed Save retains review state.
- Test solo and two-participant searches: shared facts are visible to both, imported check answers belong only to the current participant, and sanitized co-buyer Match agrees with local Match.

---

## 11. Risks / Unknowns

| Risk | Consequence | V1 mitigation / decision needed |
|---|---|---|
| Provider blocking/ToS | Failed imports, account/IP/legal exposure | Baseline on contracted address data; per-provider legal review; metadata allowlist/kill switch; no scraper |
| Brittle paths/markup | Wrong address/property or silent field drift | Structured adapters, fixtures, exact-address validation, conflicts, editable fields, Unknown fallback |
| Address match quality | RentCast's first result may not be the pasted home | Normalize/compare returned address; do not accept material mismatch; investigate provider IDs/units |
| Stale listing data | Wrong price/status/DOM | Source timestamps where available; listing-specific data over generic property data only when current; no background refresh in V1 |
| SSRF/arbitrary proxy | Internal-network access/data exfiltration | Strict URL/network/redirect/size/time validation; do not return raw body |
| Privacy/logging | Home-shopping intent and address leakage | Authentication, minimal retention, no raw prose/URL/address analytics, sanitized logs, discard ephemeral findings |
| Bad negation/unit parsing | False Yes/No or thresholds | Narrow deterministic rules, unit-aware findings, explicit negative only, conflict → Unknown |
| Match corruption | Automation changes tour decisions | Destination allowlist, no ratings, selected criteria only, existing scoring untouched, regression parity tests |
| Collaboration semantics | One person's auto-answer presented as shared opinion | Shared objective fields versus participant checks remain distinct; never overwrite/copy participant state |
| Photo hotlinking/expiry | Broken image or unauthorized reuse | Verify source rights/content type; allow user upload; do not proxy/store provider image without permission |
| Quota/abuse | RentCast cost and degraded service | Real user/IP rate limiting, retry discipline, optional short cache keyed by normalized address/mode, observable errors |
| Candidate overproduction | Noisy performative UI | High-signal allowlist, cap, dedupe, acceptance metrics without raw content; ignored means gone |
| Current parser limitations | Regex mistakes and state conflation | Finding contract, fixtures, compatibility wrapper; separate fallback success from provider error |
| Durable provenance absence | Cannot explain/refresh after Save | Acceptable for one-shot V1; require evidence table before automatic refresh/background writes |

Open questions for Phase E: actual contracted data fields/rights, exact provider coverage by market and rentals, apartment-unit address matching, whether HOA/tax should be in the panel when already visible, acceptable metadata latency budget, and whether users understand “Utilities Included” as all versus any utilities. Resolve with fixtures and observed imports before widening rules.

---

## 12. Recommended V1 Scope

### Smallest version worth building

1. **Keep the current interaction:** paste URL/address in Add Home; no wizard and no new permanent inputs.
2. **Harden the current baseline:** canonical URL path parser, address confirmation for low-confidence results, authenticated RentCast lookup, exact-address sanity check, and merge logic that preserves false/zero and every user value.
3. **Create the source-neutral finding/resolution layer:** named provenance/strength bands, destination allowlist, explicit conflict and forbidden-inference gates, all ephemeral.
4. **Auto-fill existing safe fields:** address, URL, asking price/rent, beds, baths, square feet, lot, year, type, garage, DOM, explicit layout/bedroom location, rental facts, photo when legally/reliably available, and descriptive basement/condition notes without duplication.
5. **Auto-answer a narrow selected-objective set:** shared Garage/rental booleans plus explicit Basement, Finished/Walkout Basement, Fireplace, Central Air, Home Office, Primary Ensuite, first-floor laundry, dishwasher, fenced yard, patio/deck, attached garage, and parking. Explicit No only; omission/conflict Unknown; no ratings.
6. **Extend raw-text fallback through the same contract.** This is the reliable way to obtain listing prose when provider pages block servers.
7. **Add the ephemeral high-signal panel:** maximum roughly six deduped findings, Add/Add all into existing Property Notes, ignored on save/cancel.
8. **Test with fixtures and permitted real listings, then gate any metadata fetch by measured provider reliability and legal approval.** The product promise must remain “we'll fill in what we can,” never “every listing link imports.”

### Explicitly wait for V1.1 / V2

- provider-specific DOM/application-state scraping or a headless browser;
- browser extension/share sheet/manual page capture tooling;
- a new external listing/property service or MLS integration;
- automatic refresh/background enrichment and durable provenance schema;
- source badges or numeric confidence in everyday UI;
- new permanent fields for HOA systems/updates/terms or an expanded Edit form;
- AI/LLM recommendations, free-form custom-criterion interpretation, computer vision, school/neighborhood/commute judgments;
- automatic Home Condition, Updated Kitchen/Bath, Storage, Building Amenities, Unit Configuration, or any experiential rating;
- lower-signal marketing suggestions until measured V1 acceptance shows they add value without noise;
- changing Match semantics, weighting, or Unknown behavior.

This boundary delivers real usefulness using the repository's established Add Home, storage, fallback parser, and Match contracts while keeping the costliest failure—an unsupported claim becoming a decision-driving fact—out of V1.
