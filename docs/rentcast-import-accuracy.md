# RentCast import accuracy and reliability (PR #161)

Makes the existing RentCast import (`/api/import-listing`) use only fields RentCast
documents, keep stale listing prices out of the asking price, check that a
result is for the address asked about, keep the imported map point, and report
partial or failed lookups accurately. No migration, no new provider, no live
RentCast calls, no change to Match, Realtor SQL or Floor Plans (#159).

## Evidence and its limits

`developers.rentcast.io` was **not reachable from the build environment**:
DNS failed for the fetch tool, and the egress proxy refused the shell. That
included `llms.txt` and the `.md` page variants. The inventory below therefore
rests on:

1. **Confirmed**: fields the product owner read in RentCast's official Property
   Data Schema and Property Listings Schema pages and supplied for this PR.
2. **Search-confirmed**: from a web search of RentCast's property-listings
   reference. It corroborates the listing dates, `listingType`, `mlsName` /
   `mlsNumber`, and a sample with `"status": "Active"` and `"removedDate": null`.
3. **Used, not re-confirmed**: long-standing fields the importer already read
   and still reads, unchanged in meaning. They need a re-read of the full schema.

No live response was requested, captured or committed. The test fixtures
(`test/support/rentcastDocumentedShapes.js`) and the QA fixture
(`scripts/qa/rentcast-fixture.mjs`) are **documentation-derived shapes with
invented values**, labelled as such. They are not live responses.

## Field inventory

### Property record (`/v1/properties`)

| Field | Type / unit | Status | Used for |
|---|---|---|---|
| `features.heatingType` | text | Confirmed | Heating |
| `features.coolingType` | text | Confirmed | Cooling |
| `features.heating`, `features.cooling` | boolean presence flags | Confirmed | Found panel "Yes" only; never a type, `false` not shown |
| `features.garage` | boolean | Confirmed | Found panel "Yes" when no garage type |
| `features.garageSpaces` | number | Confirmed | Garage spaces (0 kept; negative dropped) |
| `features.garageType` | text | Confirmed | Garage type, only when exactly "attached" or "detached" |
| `features.exteriorType`, `features.roofType` | text | Confirmed | Exterior, Roof |
| `features.floorCount`, `features.foundationType`, `features.architectureType` | number / text | Confirmed | Found panel only (Stories, Foundation, Style) |
| `hoa.fee` | number, **monthly** | Confirmed | HOA fee /mo (0 = confirmed $0/mo) |
| `lotSize` | number, **square feet** | Confirmed | Lot size with its unit ("8712 sq ft", "1.00 acres") |
| `latitude`, `longitude` | numbers | Confirmed | Map point (see Coordinates) |
| `propertyTaxes` | object keyed by year, `{ year, total }` | Confirmed (tax history). Entry shape is used, not re-confirmed | Most recent plausible year's annual total, with that year |
| `formattedAddress`, `propertyType`, `bedrooms`, `bathrooms`, `squareFootage`, `yearBuilt` | text / numbers | Used, not re-confirmed | Address check, basics |
| `taxAssessments`, `lastSalePrice`, `lastSaleDate`, `owner`, `history` | — | Not used | Owner and sale history are personal or not needed; deliberately not imported or stored |

### Listings (`/v1/listings/sale`, `/v1/listings/rental/long-term`)

| Field | Type | Status | Used for |
|---|---|---|---|
| `status` | `Active` / `Inactive` | Confirmed | Only Active fills price and days on market |
| `price` | number | Confirmed. Inactive keeps the **last known** price | Asking price or rent (Active); "Last listed price (not a current asking price)" otherwise |
| `listedDate`, `removedDate`, `lastSeenDate` | ISO date-time | Confirmed | Snapshot and found panel (date only) |
| `daysOnMarket` | number | Confirmed | Days on market (Active only) |
| `mlsNumber`, `mlsName` | text | Confirmed | Listing ID; MLS shown in the found panel |
| `hoa.fee` | number, monthly | Confirmed | HOA fallback when the property record has none |
| `latitude`, `longitude` | numbers | Confirmed | Map-point cross-check |
| `listingType` | Standard / New Construction / Foreclosure / Short Sale | Search-confirmed | Not used yet (see follow-ups) |
| `formattedAddress`, `bedrooms`, `bathrooms`, `squareFootage`, `propertyType`, `lotSize` | — | Used, not re-confirmed | Address check, size |

### Not found in the confirmed schema: no longer mapped

The old importer read these keys. None is in the confirmed schema, and the
QA fixture had invented some of them. They are no longer read. If RentCast ever
documents one, it can be added back with its meaning confirmed. Absence from
the confirmed list doesn't prove such data never occurs.

| Previously read | Effect before | Now |
|---|---|---|
| `features.basement` | Basement condition / style / notes | Unknown |
| `features.laundry`, `features.laundryLocation` | Laundry Location | Unknown |
| `listing.description` / `text` / `remarks` / `publicRemarks` | "Features mentioned" | None. Pasted listing text is still read |
| `features.pool`, `fireplaceCount` / `fireplaces`, `parkingSpaces`, `parkingType`, `carport`, `water`, `sewer`, `fuel`, `appliances`, `fencing` | Found-panel facts | Not shown |
| top-level `floorCount` | Stories | Read from documented `features.floorCount` |
| `listing.id` as Listing ID | RentCast's internal id could appear as the MLS number | Only `mlsNumber` |

## Before / after mapping

| Home field | Before | After |
|---|---|---|
| Price | Any listing's `price`, including Inactive | Active listing only. Otherwise blank, with the last listed price labelled in the found panel and snapshot |
| Days on market | Any listing | Active listing only |
| Beds / baths / sq ft | Listing first, then property | Active listing, then property record, then an inactive listing's last attributes |
| Heating | `heatingType` ?? `heating` | `heatingType` only |
| Cooling | `coolingType` ?? `cooling` | `coolingType` only |
| Garage type | `garageType` ?? `garage` | `garageType` only |
| Garage spaces | Any value | Non-negative numbers |
| Basement condition / style / notes | `features.basement` | Not mapped (Unknown) |
| Laundry Location | `features.laundry` / `laundryLocation` | Not mapped (Unknown) |
| HOA fee /mo | `property.hoa.fee` | `property.hoa.fee` ?? `listing.hoa.fee`, non-negative. The found-panel "HOA: No" for $0 is removed |
| Property tax + year | Highest year | Highest plausible year (integer, 1900 to next year), non-negative total |
| Lot size | Any number, including 0 ("0 sq ft") | Positive numbers only |
| Latitude / longitude | Property only, any value, saved as *unresolved* (overwritten by Google) | Valid point, not 0,0, property and listing within 250 m, from an address-matched result. Saved as *resolved* (source `rentcast`) when the address is unchanged at save |
| Listing ID | `mlsNumber` | `mlsNumber` (unchanged) |
| Description features | Listing description | None (undocumented) |
| Results for another address | Used | Dropped (see Address matching) |

## Behaviour

**Listing freshness.** Status is read case-insensitively: Active, Inactive or
"Not reported." Only Active is treated as current. An Inactive or unreported
listing's price is never an asking price. The found card reads "No current
asking price" (Inactive) or "Price unknown," and the found panel shows "Last
listed price — $X (not a current asking price)." Nothing refreshes an existing
home or overwrites anything a buyer entered.

**Address matching.** Each result's `formattedAddress` is compared with the
address looked up. A mismatch means a different house number, street name,
unit, ZIP or state, after abbreviations are normalized ("Lane" / "Ln",
"#4" / "Apt 4"). That result is dropped. A missing part is never a mismatch, so
a ZIP or unit on only one side still matches. When nothing matches, the buyer
sees "We couldn't match property records to that exact address."

**Coordinates.** Before this PR, imported coordinates were stored with
`coordinate_status = 'unresolved'` and no address fingerprint. The map ignored
them and the commute route re-geocoded and overwrote them. Now an imported
point that passes the checks above is saved as resolved with
`coordinate_source = 'rentcast'` and the fingerprint of the saved address. This
happens only when the saved address is still the one looked up and the point
wasn't changed (`src/lib/importSnapshot.js`). `currentHomeCoordinates`,
`coordinatesAreCurrent` and the existing address-change trigger are unchanged.
Editing the address still invalidates the point, and anything that doesn't
qualify falls back to Google geocoding exactly as before. The commute route
already documented RentCast as a valid coordinate source.

**Partial results and errors.** Each lookup ends as ok, empty, mismatch, or one
of `rate_limited`, `timeout`, `invalid_address` (RentCast HTTP 400) or
`unavailable`.
- One lookup failing while the other finds the home keeps what was found, with
  a calm note: "Current listing details weren't available right now, so price
  and listing status are left for you to add." Or: "Property records weren't
  available right now, so some details may be missing."
- A failure with nothing found is reported as a failure (429 / 504 / 422 / 502)
  with a reason-specific, non-technical note. It's never "No property data was
  found."
- HTTP status codes are logged server-side only. The temporary `diagnostics`
  field is gone from the response.

**Snapshot (`homes.listing_import`, jsonb, no migration).** It now also records
`source` (`rentcast` or `pasted_text`), `importedAt`, `listing` (status, last
known price, the three dates, days on market, MLS name and number) and
`sources` (per-lookup outcome). Provenance is unchanged: "From listing" still
means the value equals the snapshot's. Older snapshots without the new keys
read as before.

## What a buyer sees

Screenshots are in `docs/rentcast-import-accuracy-screenshots/` (desktop 1440,
iPad 820, iPhone 390; Chromium emulation, QA fixture data).

- **Complete** (`*-1-complete-found`, `*-2-complete-home-facts`): "We found your
  home," $335,000, 5 bd · 2 ba · 2,080 sq ft · 0.29 acres. Home Facts shows HOA
  $0/mo (not "No HOA"), Heating "Forced Air," Cooling Unknown (the record only
  says cooling exists), Garage Attached · 2, and taxes $4,210 (2025). Basement
  and Laundry are Unknown.
- **Partial** (`*-3-partial-found`): the same home with "Price unknown" and the
  listing-details note. Property facts are kept.
- **Inactive** (`*-4-inactive-found`): "No current asking price." Status
  "Inactive (no longer listed)" and "Last listed price — $335,000 (not a
  current asking price)" are in the found panel and snapshot. Price and days
  on market are saved blank.
- **Rate-limited** (`*-5-rate-limited`): "Property lookups are busy right now.
  Add the address and fill in the rest on Home Facts, or try again in a few
  minutes." The home can still be added. No import data is saved.

## Test and QA results

- `npm test` with real PostgreSQL 16: **1115 / 1115 pass, 0 skipped**. That
  includes 26 new tests in `test/rentcast-import-accuracy.test.js` and updates
  to tests that had locked in the undocumented mappings. `main`, run the same
  way, passes 1089 / 1089. No regressions.
- `next build`: passes.
- Browser QA `scripts/qa/rentcast-import-e2e.mjs`: **12 / 12**, covering
  complete, partial, inactive and rate-limited lookups on desktop, iPad and
  iPhone against the Supabase stand-in on real Postgres.
- Regression QA: `home-facts-completeness-e2e.mjs` 21 / 21. `home-overlay-e2e.mjs`
  gave 27 / 27 on two runs and 26 / 27 on one. The failure was "[1440] 11.
  Duplicate URL…", the dev-server flake already reported as open in #160.
  `home-overlay-e2e` now expects Laundry Location to stay Unknown after import.

## Concerns

- **Quota and abuse (unchanged):** any signed-in user can call the route
  repeatedly. Each lookup is 2 billable requests, with no per-user limit and no
  cache (audit T-03). This should get its own PR: a per-user counter, plus a
  short cache keyed by normalized address and mode.
- **Privacy:** addresses go to RentCast, as before. Owner, sale history and
  assessor data are neither read nor stored. Request URLs, which contain the
  address, are not logged.
- **Licensing:** no photos, descriptions or scraped pages are imported. MLS
  number and name are shown as identifiers only.
- **Data quality:** RentCast's first result is still the only one read. A
  mismatch is now caught, but a near-duplicate (same street and number in an
  unlisted unit) is not.
- **Migration:** none. The snapshot keys are additive in existing jsonb.

## Remaining uncertainties (need the full schema or one approved live sample)

1. The entry shape inside `propertyTaxes` (`{ year, total }`) and whether keys
   are always years.
2. Exact vocabulary of `garageType` (is "Attached Garage" / "Detached" used?) and
   of `heatingType` / `coolingType`.
3. What RentCast returns for an unparseable address. We map HTTP 400 to
   "Check the address" and 404 / empty to "No property data."
4. Whether `status` ever takes values other than Active / Inactive. Anything
   else is treated as "Not reported."
5. Whether `bedrooms`, `bathrooms`, `squareFootage`, `yearBuilt`,
   `propertyType` (and its values such as "Single Family", "Townhouse",
   "Condo", "Multi-Family", "Apartment") and `formattedAddress` are unchanged in
   the current schema.

## Left for #162 and later

- Per-user rate limiting and a short lookup cache (quota).
- A read-only "Listing status" line in Home Facts from the snapshot. Today it
  is visible in Add Home and the listing inspector.
- `listingType` (foreclosure / short sale / new construction) as listing
  context, once its display is designed.
- Pool / fireplace / other features, if the full schema documents them.
- Choosing among several RentCast results instead of the first.
