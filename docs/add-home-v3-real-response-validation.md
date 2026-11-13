# Add Home V3, phase 5: real RentCast response validation

**FLH does the homework. The buyer makes the decisions.**

> **Status: BLOCKED at pre-flight. 0 live RentCast requests made.**
> The capture tooling, redaction, tests and this plan are ready. The founder
> must complete the checklist in §2 and run the capture locally. Until then
> nothing in phase 3 is confirmed or corrected by live data.

Builds on `main` at `36f8d57` (#178). Floor Plans and #166 are untouched. No
product code, storage, scoring or Match change is made in this PR.

## 1. Pre-flight results (this session)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | API credential available securely | **Not available** | No `RENTCAST_API_KEY` in the session environment; no network secret saved for any host on the cloud environment. Nothing was printed or requested |
| 2 | Actual remaining monthly allowance | **Not verifiable** | RentCast has no usage endpoint FLH knows of. The phase 4 doc records "RentCast's dashboard is the only meter". The docs host could not be reached to check for usage headers or an endpoint |
| 3 | 10 more requests fit inside the free allowance | **Not verifiable** (follows from 2) | 50/month is not assumed |
| 4 | Endpoint docs and response handling | **Partly**. The code paths are verified; the live docs could not be read | `developers.rentcast.io` and `www.rentcast.io` fail DNS from this sandbox; `api.rentcast.io` is not on the environment's allowed hosts. Endpoints and handling were checked against `rentcastLookup.js`, and tests pin the capture to the same two paths |
| 5 | Five suitable public listings | **Criteria prepared; addresses not chosen** | Listings change daily and real addresses must not be committed. The founder picks them on capture day (§3) |
| 6 | Raw responses git-ignored, never logged | **Done** | `/.rentcast-capture/` is in `.gitignore`; the script refuses to run if it isn't; tests assert nothing there is tracked |

**Requests consumed: 0 of 10.**

## 2. Founder checklist before any live request

All of these are checked by `scripts/ops/rentcast-capture/capture.mjs`.
It refuses to send anything until each one is supplied.

1. **Plan.** In the RentCast app, check that the API subscription is the free
   **Developer** plan. Pass `--plan=developer`.
2. **Remaining allowance.** Read the remaining requests for the current billing
   month from the RentCast API dashboard. Pass `--allowance-remaining=<n>`,
   `--allowance-source="<where you read it>"` and
   `--allowance-checked-at=<ISO time>`, all within the hour before the run. The
   run refuses if fewer remain than it plans to send.
3. **No overage charge.** In RentCast billing, confirm that going past the free
   allowance is blocked rather than billed, or that the 10 requests stay well
   inside it. Note whether a card is on file. Pass `--no-overage-confirmed` only
   after checking.
4. **Usage counting.** If the dashboard says so, note whether 404 / no-result
   requests count. The script counts every request either way.
5. **Key.** `export RENTCAST_API_KEY=…` in your local shell only, never in a file
   in the repo. The script never prints it.
6. **Targets.** Copy `scripts/ops/rentcast-capture/targets.example.json` to
   `.rentcast-capture/targets.json` (git-ignored) and fill in five addresses
   (§3). The run refuses placeholders.

```bash
node scripts/ops/rentcast-capture/capture.mjs --dry-run
```

```bash
node scripts/ops/rentcast-capture/capture.mjs --plan=developer --allowance-remaining=<n> --allowance-source="RentCast dashboard, API usage" --allowance-checked-at=<ISO time> --no-overage-confirmed
```

```bash
node scripts/ops/rentcast-capture/redact.mjs
```

```bash
node scripts/ops/rentcast-capture/coverage.mjs
```

Then commit only `test/fixtures/rentcast/*.json`, and paste the matrix into §5.

**Alternative:** the key could instead be saved as a network secret on a
dedicated cloud environment that allows `api.rentcast.io`, so a session can run
the capture. Allowance verification would still need the founder to read the
dashboard (step 2).

### What the script guarantees

- **At most 10 requests in total**, across runs. Every request is recorded in
  `.rentcast-capture/ledger.json` **before** it is sent. Failures, timeouts and
  404s all count. The 11th is refused.
- **At most 5 properties, 2 requests each.** These are the same two endpoints
  FLH uses (`/v1/properties`, then `/v1/listings/sale` or
  `/v1/listings/rental/long-term`).
- **One request at a time, no retries.** Anything but 200 or 404 stops the
  whole capture, and a later run refuses to continue. This covers 401/403
  (auth), 402 (billing), 429 (quota or rate limit), 400 (refused address), 5xx,
  timeouts and network errors.
- **Nothing sensitive is printed.** Output shows only the target id, kind,
  status and count: no key, URL or address.
- **Headers kept as evidence:** only content type, `retry-after`, `date` and
  rate-limit/usage-style headers. These settle whether RentCast reports usage
  per response.

## 3. Targets (chosen on capture day)

Pick publicly listed properties from a public listing site. No owner or
personal information is needed or kept.

| id | mode | Pick | Settles |
|---|---|---|---|
| `new-construction` | sale | Active builder listing in a new subdivision | `listingType: "New Construction"`; single-period `history`; `subdivision` form and case |
| `fireplace-pool` | sale | 1970s–90s single-family home with fireplace and in-ground pool, Sun Belt county (FL, AZ, TX) | `features.fireplace/fireplaceType`, `pool/poolType`, `viewType` values |
| `condo-hoa-unit` | sale | Condo with a stated HOA fee and a unit number | `hoa.fee` on both sources; `addressLine2` unit form; strict unit key |
| `midwest-older` | sale | Pre-1960 two-story home with a basement (OH, MI, IN, IL, WI), ideally relisted after an earlier expired/withdrawn listing | `foundationType`, `floorCount`; multi-period `history` and what each entry's `price` means |
| `long-term-rental` | rental | Single-family or condo for rent (not a large apartment community) | Rental listing shape; `event: "Rental Listing"`; rental `daysOnMarket` |

## 4. Redaction (`redact.mjs`)

Redaction is **allowlist-first**: a string is kept verbatim only when its key
is a known enum or type field (`propertyType`, `status`, `listingType`,
`event`, `state`, `zoning`, and `*Type` fields like `fireplaceType`). The
`unknownStrings` list in each fixture names every other string field. Those are
replaced with `"[redacted]"`, so their key and presence are still visible.

| Data | Treatment |
|---|---|
| Street line | House number → `9000N`. Street name → `Fixture`. Direction, street type and unit form kept |
| Unit / city / ZIP / county | `101`(+letter if it had one) / `Fixtureville` / `0000N` / `Fixture` (case kept). State kept |
| `formattedAddress` | Rebuilt from the synthetic parts, in the original's order and punctuation |
| `id`, `assessorID`, `legalDescription`, FIPS, `mlsNumber` | Fixture id, or masked keeping the same length and character classes |
| `owner`, `listingAgent`, `listingOffice`, `builder` | Keys kept; every string `"[redacted]"`, numbers 0 |
| `subdivision`, `mlsName` | `FIXTURE SUBDIVISION` (case kept), `FixtureMLS` |
| Coordinates | Rounded to 2 decimals |
| Money (price, sale price, assessments, tax) | Nearest $1,000 (≥ $10k) or $10 |
| `squareFootage`, `lotSize` | Nearest 10 |
| Dates and date keys | All shifted by one random whole number of weeks per property, never recorded. Intervals, `daysOnMarket` and weekdays stay consistent |
| `null`, booleans, number types, key order, nesting, enum strings | **Unchanged** |

A fixture is written only if `leakCheck` finds no raw address, name, id, MLS
number, subdivision or precise coordinate, and no email, phone number, URL or
key-like field. Its report never repeats the leaked value.

## 5. Field-population and enum matrix

**Pending capture.** `coverage.mjs` will generate it. Each cell will be one of:
`true` / `false` / `null` / `missing` / `empty` / `malformed (type)` / the
value / *N entries* / `no record`.

| Source | Field | new-construction | fireplace-pool | condo-hoa-unit | midwest-older | long-term-rental |
|---|---|---|---|---|---|---|
| property | `features.fireplace` / `fireplaceType` | — | — | — | — | — |
| property | `features.pool` / `poolType` | — | — | — | — | — |
| property | `features.viewType` | — | — | — | — | — |
| property | `subdivision` | — | — | — | — | — |
| property | `features.foundationType` / `floorCount` | — | — | — | — | — |
| property / listing | `hoa.fee` | — | — | — | — | — |
| listing | `listingType` | — | — | — | — | — |
| listing | `status`, `listedDate`, `removedDate`, `daysOnMarket` | — | — | — | — | — |
| listing | `history` | — | — | — | — | — |

## 6. Phase 3 assumptions: what the capture will confirm or correct

| Assumption (phase 3) | Current code | Confirmed if | Correct only if (and how) |
|---|---|---|---|
| `fireplace` / `pool` are booleans; only `true` is shown | `presentFeature` | Real values are `true`/`false`/absent | Values arrive as strings (`"Yes"`, `"Y"`): **document it and leave hidden**. Mapping strings would be a new interpretation |
| `fireplaceType` / `poolType` / `viewType` are shown as written | `descriptiveText` | Values are readable words | A value is a code (`"MSNRY"`, `"Y"`): hide it or list it as unknown. No mapping table |
| `viewType` "None" is not shown | `descriptiveText` drops none/no/n/a | — | A different "no view" spelling appears: add it to the drop list (clear bug) |
| `subdivision` is a plain name | `descriptiveText` | — | A placeholder (`"NONE"`, `"NOT IN A SUBDIVISION"`) appears: drop it (clear bug) |
| `listingType` ∈ Standard / New Construction / Foreclosure / Short Sale | `rentCastListingType` | Live values match | Another value appears: it stays unreported; document it |
| `history` is keyed by date; each entry is one listing period | `rentCastListingHistory` | Keys and entries match | Entries are price events, or keys aren't dates: **stop showing "Listed before"** and document |
| History `price` is the first or last price of a period | Kept, never shown | One relisted home can't settle this alone; only a period whose price changed can | Stays **deferred** unless the evidence is unambiguous |
| `floorCount` is a number of stories | `fact('stories')` | Integer | A fraction (1.5) or string: shown as given; document |
| `foundationType` is descriptive | Basement note while Unknown | — | A code appears: document; the hint stays "not proof" |
| `hoa.fee` is monthly | `hoaFeeMonthly` | Matches the public listing's stated monthly HOA | Annual-sized figures: **stop importing**. The period would be ambiguous |
| `status` ∈ Active/Inactive | `rentCastListingStatus` | — | Another value: already "unknown", never active |
| Dates are ISO strings | `isoDateOnly` | — | Another format: malformed values are already dropped; document |
| `daysOnMarket` is an integer | `formatInt` / history check | — | — |

**Rule for implementation fixes:** only a clear, well-supported normalization
or display bug is fixed, and each fix comes with a fixture test. Ambiguous
semantics are documented and deferred.

## 7. Tests (`test/rentcast-real-fixtures.test.js`)

- **Budget:** 5 properties = 10 requests, on the same endpoints as
  `rentcastLookup.js`; a 6th property, duplicate ids and placeholder addresses
  are refused.
- **Pre-flight:** every missing or invalid input blocks: key, plan, allowance,
  source, a stale check, overage confirmation, budget arithmetic.
- **Ledger:** the 11th request is refused; a stopped capture sends nothing more.
- **Responses:** only 200 and 404 continue; every other outcome stops.
- **Evidence headers:** cookies and key-like headers are never kept.
- **Capture script (static):** no print line references the key, address or
  URL; the git-ignore guard is present; the ledger is saved before sending; no
  retry loop.
- **Git:** nothing under `.rentcast-capture/` is tracked.
- **Redaction:**
  - structure, nulls, booleans, number types and enums are preserved;
  - identity is replaced;
  - unknown strings are masked and reported;
  - date shifts keep intervals;
  - the synthetic address still matches across sources and keeps its unit.
- **Leak check:** a clean redaction passes; raw input fails on every category,
  without echoing the value.
- **Coverage:** every classification is covered.
- **Live fixtures** (skipped until they exist):
  - no leaks;
  - fixture ids only;
  - synthetic addresses match;
  - only existing `fields` keys;
  - no `false` fact;
  - fireplace/pool only from `true`;
  - unknown `listingType` is not reported;
  - history periods are valid;
  - an inactive listing's price is never an asking price;
  - snapshot context renders.

## 8. Remaining unknowns (all need the capture)

- Fireplace / pool / view enum values, and how often they are populated.
- History price semantics.
- Whether `subdivision` uses placeholders.
- Whether responses carry rate-limit or usage headers.
- Whether 404 requests count against usage.
- Live confirmation of `hoa.fee` period, `floorCount` type and rental `history`
  events.
