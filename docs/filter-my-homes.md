# Filter My Homes (v1)

A temporary, read-only way for a buyer to narrow the homes they have **already
saved** in FLH. It is not listing discovery, not a replacement for My Search,
and not a second score.

> "Which of my homes are at least 1,200 square feet, have at least 0.2 acres,
> have a fenced yard, and have a first-floor guest suite?"

## Where it lives

* **Filter** action at the start of the My Homes quick-filter row (beside All /
  90%+ Matches / No Must-Haves Missing / Want to Tour).
* Opens `HomeFiltersSheet`: a bottom sheet on iPhone, a centered panel on iPad,
  and a right-hand panel beside the homes on desktop (≥ 1121px). Touch screens
  get 44px targets (`pointer: coarse`), including iPad in landscape.
* Applied filters show as a summary bar under the toolbar: counts, one removable
  pill per condition, the Confirmed only / Confirmed + possible switch, and
  Clear filters.

## Scope (which homes)

Filters apply to the **active homes on My Homes** (everything not archived),
after the search box and quick chips. Want to Tour, Favorites and Archive keep
their own complete lists. Filters never hide, archive, delete, edit or re-rank a
home: cards stay in the buyer's chosen sort, with every action, Notes and
navigation unchanged.

Filters are remembered for the browser session per search (`sessionStorage`),
so opening a home, visiting Want to Tour and coming back keeps them. They are
never written to the database and a new session starts clean.

## Canonical sources

| Filter | Source | Unknown when |
|---|---|---|
| Min / max price (rent on rental searches) | `homes.price` | empty, unreadable text ("Call for price", "450-500k"), or 0 |
| Min / max sq ft | `homes.sqft` (an `sq ft` suffix is allowed) | empty, unreadable, or 0 |
| Min lot size (acres) | `homes.lot_size` via `lotSizeAcres` (the Match grammar) | empty, unknown unit, **a bare number with no unit** ("8712"), or 0 |
| Min bedrooms / bathrooms | `homes.beds` / `homes.baths` | empty or unreadable ("Studio", "2 full, 1 half"); **0 is a real count** |
| Property type | `homes.property_type` | null |
| What matters to you | the buyer's own answers as `computeMatch` reads them (`allSelected`) | not answered, historical `false`, or a neutral tour response |

The stored text is read strictly: `parseNum` (which Match uses) turns "Call for
price" into 0; the filter treats it as Unknown so a max-price filter never shows
it as a bargain.

### Personal criteria

The list is exactly the buyer's selected My Search criteria (built-in and
custom, any tier), derived from `computeMatch` so it can never drift from what
Match tracks. Each home's answer is the **current participant's** answer:
`getHomesForUser` overlays only the caller's `home_member_state` checks and
ratings onto the shared home, so a co-buyer's answer can never stand in. Through
`computeMatch` the filter inherits Match's canonical readings:

* legacy label aliases are folded ("Fenced Yard" answered before the taxonomy
  unification counts for "Fenced yard");
* **Garage** reads the Home Facts `garage_spaces` (0 is a confirmed no), not the
  old checkbox;
* rental **Pets Allowed / Utilities Included / In-Unit Laundry** read the shared
  fact;
* historical boolean `false` is Unknown, never No.

Nothing is inferred: bedrooms never imply a guest suite, lot size never implies
a fence.

### No duplicate filters

My Search targets with a structured Home Fact — budget, square footage, lot
size, bedrooms, bathrooms, preferred property type — are **not** offered again
as personal criteria; the standard filters are their single home here, with
thresholds typed independently. A 1,200 sq ft filter never reads or changes the
stored 1,800 sq ft target, its tier, or any weight.

## Logic

All selected conditions must hold (AND). Each condition answers Yes / No /
Unknown, and each home is:

* **Confirmed match** — every condition is a known Yes.
* **Possible match** — nothing is a known No, but something is Unknown (or a
  neutral tour response). The card says why: *"Possible match — Fenced Yard not
  confirmed · Lot size unit not recorded"*.
* **Doesn't match** — at least one condition is a known No.

Unknown is never No. Thresholds are inclusive (≥ min, ≤ max). In the sheet, a
malformed or zero threshold is flagged and ignored, and a min above a max is
called out.

## Match safety

Filtering is pure and read-only (`src/lib/homeFilters.js` imports only
`computeMatch`, `criterionLabel`, the lot-size helpers and labels). Nothing in
this feature touches My Search, tiers, weights (4× / 2× / 1×), personal answers,
the SQL Match functions, permissions, Home Facts persistence or completeness.
Tests deep-freeze the inputs, compare Match before and after, and fingerprint
the database around real filtering.

## Files

* `src/lib/homeFilters.js` — conditions, classification, session memory.
* `src/components/HomeFiltersSheet.jsx` — the sheet.
* `src/components/HomesBoard.jsx` — Filter action, summary bar, possible-match
  note on cards, empty state.
* `test/home-filters.test.js`, `test/home-filters-db.test.js` — unit and
  real-Postgres tests.
* `scripts/qa/home-filters-e2e.mjs` — browser QA (30 homes, owner and co-buyer,
  desktop / iPad / iPhone).

## QA

`scripts/qa/home-filters-e2e.mjs` (37 steps) passed at 1440×900, iPad
820×1180 and 1180×820, and iPhone 390×844: live counts equal the pure module's,
possible-match reasons, Confirmed only, open/close a home, tab switching,
Want to Tour on a filtered card, zero results → relax → clear, keyboard and
focus return, a co-buyer's separate answers, no horizontal overflow, no console
errors, and an unchanged database fingerprint. Screenshots:
`docs/filter-my-homes-screenshots/`.

## Not in v1

Saved presets, external listings, Realtor or public filtering, fact inference,
new database fields, OR logic.
