# Add Home V3, phase 3: more from the RentCast responses FLH already receives

**FLH does the homework. The buyer makes the decisions.**

Each Add Home lookup already makes two RentCast requests:
- `/v1/properties`, the county property record;
- `/v1/listings/sale` or `/v1/listings/rental/long-term`, the current
  listing.

Several documented fields in those responses were received and thrown away.
This phase reads them, keeps them in the existing snapshot
(`homes.listing_import`), and shows them as **dated, source-attributed
context**. None of it is a Home Fact value or a Match answer.

What this phase does not do:
- no new request, provider or live RentCast call;
- no migration, column, RLS or storage change;
- no Match, scoring or Unknown change;
- no automatic save.

Floor Plans and #166 are untouched.

## 1. Audit: what RentCast returns, what FLH did with it (on `main`, `b0b8829`)

**How fields are graded:**
- **Confirmed:** from the official schema pages, read by the product owner
  for #161.
- **Search-confirmed:** seen in excerpts of RentCast's own schema pages and
  sample records (`developers.rentcast.io`, which this build environment can't
  fetch directly).
- **Live test needed:** only a real response settles it.

| Field | Evidence | Before | Now |
|---|---|---|---|
| `features.fireplace` (bool), `features.fireplaceType` (string, county records; sample "Masonry") | Search-confirmed: schema plus sample record | Received, **discarded** | Snapshot fact `fireplace`, **only when `true`** (its type, or `true`). Home Facts "County records" line. Per-buyer Match pointer |
| `features.pool` (bool), `features.poolType` (sample "Concrete") | Search-confirmed | Discarded | Same as fireplace |
| `features.viewType` (string, county records; sample "City") | Search-confirmed | Discarded | Snapshot fact `viewType`; Home Facts "County records" line |
| `subdivision` (property record; sample "WOODLAKE") | Search-confirmed | Discarded | Snapshot fact `subdivision`; shown under the address (not for apartment communities) |
| Listing `listingType`: Standard / New Construction / Foreclosure / Short Sale | Search-confirmed: schema plus the 2024-09 changelog | Discarded | `listing.listingType` in the snapshot; a fact when not Standard; a found-card chip (active listings); a Home Facts line; a Condition hint |
| Listing `history`, keyed by YYYY-MM-DD: `{ event: 'Sale Listing' \| 'Rental Listing', price, listingType, listedDate, removedDate, daysOnMarket }` | Search-confirmed: schema plus a sample with a 2021-07-28 → 2021-08-23, 26-day period | Discarded | `listing.history`: validated listing **periods**. Home Facts "Listed before" lines (dates and days only) |
| `features.foundationType` | Confirmed (#161) | Snapshot fact, found panel only | Plus a Home Facts Basement note, only while the basement is Unknown |
| `features.floorCount` | Confirmed | Snapshot fact (`stories`), found panel only | Plus a Home Facts Layout hint, only while the layout is Unknown |
| Listing `status`, `listedDate`, `removedDate`, `daysOnMarket` | Confirmed | Snapshot plus the found panel | Plus a dated Home Facts line ("When added (date): …") |

**Live test still needed** for these, which no sanitized fixture or excerpt
showed:
- the full enum lists for fireplace, pool and view types. Values are shown as
  written and never mapped to anything;
- whether a history entry's `price` is that period's first or last price;
- how often these fields are actually populated.

A free Developer-plan capture of about 10 responses, with your approval, would
settle all three.

## 2. What the buyer sees now

**Found card (Add Home).**
- An active listing that is not a standard sale gets a quiet chip beside
  "We found your home": **New Construction**, **Foreclosure** or **Short
  Sale**.
- The "We found N details" count includes the new record facts.
- Save Home stays first and on screen.

**Saved home, Home Facts.** All of this is read-only, and every line is
attributed.
- Under the address: **Subdivision: SASS HILLS · county records**.
- Under the listing link:
  - **When added (Nov 12, 2026): Active · listed Sep 26, 2026 · 23 days on
    market.** The snapshot is always dated, so it is never presented as
    current. An inactive listing reads "No longer listed · … removed …", with
    no days on market.
  - **Listing type: New Construction** (not shown for Standard).
  - **Listed before: Mar 2, 2025 – Apr 30, 2025 (59 days)**: earlier
    periods, with dates and days only.
  - **County records: fireplace (Masonry) · pool (Concrete) · City view.**
- Hints, **only while the field is Unknown**. They disappear once a buyer sets
  the field:
  - Layout: "County records: 2 stories";
  - Condition: "Listing type: New Construction";
  - Basement: "County records: Poured Concrete foundation. Not proof of a
    basement's style or condition."

**Saved home, Match view.** On *this buyer's* unanswered Fireplace or Pool
criterion:
- the pointer reads **County records suggest Yes · Why?**;
- Why? shows "County records list a fireplace (Masonry). From the property
  record found when this home was added. Records can be out of date. Choose
  Yes or No yourself.";
- pasted listing text, where present, speaks first for the same criterion;
- the buyer's own answer always wins, and nothing is answered automatically.

## 3. Rules that hold

- **A false, missing, null or odd county-record value is never shown, and
  never becomes No.** County records are incomplete.
- **Stories and foundation are context only.** They never set a layout, a
  basement style or condition, or a Home Condition.
- **History never yields a price change.**
  - An entry is a listing period, not a price change.
  - Entries of the other kind (rental vs sale), with bad dates, or with a
    removal before the listing are dropped, never repaired.
  - Duplicates are dropped.
  - Prices are kept in the snapshot as reported but never displayed.
- **No field is added to the import.** `normalizeRentCastFields` returns the
  same `fields` keys as before, so existing and buyer values can't be
  overwritten.
- **Apartment communities** get no subdivision and no listing context (the
  existing rule: the community's listing isn't evidence about the option).
- **Still exactly two requests per lookup**, verified by a test.
- **Owner and co-buyer** see the same context; pointers and answers stay per
  buyer.

## 4. Remains Unknown, or deferred

| Item | Why | Needs |
|---|---|---|
| Price drops and increases | History is per listing period; within-period price changes aren't documented | A live sample showing price semantics, or another source |
| Fireplace / pool / view as **shared** facts that answer Match for everyone | No shared column, and this PR adds none | A migration plus new #167 readings (their own PR) |
| Home Condition "New Construction" filled automatically | That is a shared-fact write | Could become an "offered fact" (phase 2 pattern) in a follow-up; still no migration |
| Fresh listing status after the home is saved | The snapshot is taken once, at Add Home | Re-querying RentCast: new paid calls, **API approval** |
| Fireplace / pool / view enum values | Not visible in the docs excerpts | A live capture |
| Garage, laundry, school data from RentCast | Not in the documented schema | Unchanged (pasted text remains the path) |

## 5. Files

- `src/lib/rentcast.js`: reads `fireplace` / `pool` (true only), `viewType`,
  `subdivision`, `listingType` (`rentCastListingType`) and `history`
  (`rentCastListingHistory`, for the listing kind) into the snapshot.
- `src/lib/rentcastLookup.js`: passes the listing kind; still two requests.
- `src/lib/listingContext.js` (new): `countyRecordContext`,
  `listingSnapshotContext`, `listingSnapshotLines`. Pure readers of the saved
  snapshot.
- `src/lib/listingTextAnswers.js`: `recordListingAnswers`, the county-record
  Yes pointers. It reuses the same per-buyer loop as the pasted-text pointers.
- `src/lib/listingFacts.js`: a `features` group in the found panel.
- `src/components/HomeFacts.jsx`: the context block, the subdivision line,
  and the Unknown-only hints.
- `src/components/HomeModal.jsx`: the found-card listing-type chip and the
  panel group label.
- `src/components/MatchCriteria.jsx`, `src/components/HomeOverlay.jsx`: the
  county-record pointer, merged after pasted-text pointers.
- `src/app/globals.css`: styles.
- **Tests:**
  - `test/rentcast-context.test.js` (new);
  - documentation-derived builders in `test/support/rentcastDocumentedShapes.js`;
  - one updated pin in `add-home-listing-review`.
- **QA:**
  - `scripts/qa/add-home-rentcast-context-e2e.mjs` (new);
  - an opt-in "context" scenario in `scripts/qa/rentcast-fixture.mjs`, for
    house numbers 51690–51695 only, so other QA counts are unchanged.
