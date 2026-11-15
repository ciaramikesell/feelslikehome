# Home to Buy priority catalog refinement (PR #186)

Onboarding V3 (flow 4), Home to Buy only, phones and the desktop board. A
catalog / UX change: existing identities are reused, nothing a buyer saved is
removed, and no scorer, SQL function, migration or feature flag changes.
`FLH_ONBOARDING_V3` stays off in Production; `CURRENT_ONBOARDING_VERSION` is 1.
Home Facts and automatic Match fulfillment are the next PR.

> FLH does the homework. The buyer makes the decisions.

## Audit (before editing)

| Question | Finding |
|---|---|
| Home Preferences on V3 Basics? | **Not present.** V3's Basics (`BasicsQuestions` in `PriorityFlow.jsx`) asks budget, bedrooms, bathrooms and ideal square footage only; lot size is on Exterior & Property. The expandable Home Preferences section belongs to the live flow's `BasicsStep` (flow 1), which this PR does not touch. A test now pins V3 Basics so it cannot come back. Saved home type / layout / condition / garage / basement / yard values are untouched and still shown read-only on Review ("Saved from earlier") and editable in Add Home / Home Facts. |
| Near Water, Wooded Setting, Walkable Neighborhood, Second-Floor Laundry, Room for Entertaining, Fire Pit, Workshop Space | Already **not offered** by V3 Home to Buy (they are live-flow suggestions and catalog entries). Kept in the catalog for anyone who chose them. |
| Walkable to Schools (`location:Walkable schools`) | Was a V3 Home to Buy suggestion → **removed** here. |
| First-Floor Laundry (`features:First-floor laundry`) | The identity Home Facts' laundry location answers (`laundry_location = first_floor`). **Not renamed in storage**: the V3 card shows it as **Main Floor Laundry** (`text`), so saved choices, Home Facts answers and both scorers are unchanged. Elsewhere (My Search, Match details) it still reads "First-Floor Laundry" — see *Decisions*. |
| Finished / Walkout basement | Two independent identities (`features:Finished basement`, `features:Walkout basement`), each answered separately by Home Facts. Kept separate. |
| Privacy Fence | Already a canonical identity: `exterior:Privacy Fencing`, displayed "Privacy Fence", a factual Yes / No deliberately distinct from `exterior:Fenced yard` (the Home Preferences code already allows both). Listing-text reading keeps them as separate concepts. **Reused** — no new identity. |
| Garage | One criterion `exterior:Garage` (one importance; Match scores it from the home's garage spaces) plus `exterior.garagePreference` (`any` / `attached` / `detached`), which is recorded for the buyer but **not** a Match input. `heldGarage` sets both aside across house ↔ apartment switches. |

## What changed

| Screen | Approved choices (in order) |
|---|---|
| Layout & Living Spaces | First-Floor Bedroom · Home Office · Primary Ensuite · Finished Basement · Walkout Basement · **Main Floor Laundry** (all six are cards; no suggestions) |
| Kitchen | **Countertop Seating** (first card, founder photo, existing identity) · Stainless Steel Appliances · Walk-in Pantry; suggestions unchanged |
| Garage | **Any Garage · Attached Garage · Detached Garage** (see below); garage details (Workbench, Garage Extension, Door to Backyard) unchanged |
| Exterior & Property | Deck / Patio · Fenced Yard · **Privacy Fence**; suggestions Mature Trees · Garden Space · Pool · **Front Porch** (moved here from Layout; same `exterior:Front porch`); Ideal lot size panel unchanged |
| Location & Neighborhood | Low-Traffic Street · Sidewalks · Tree-Lined Street · No HOA; suggestion Cul-de-Sac (Walkable to Schools removed) |

Home to Rent and Apartment to Rent screens are byte-for-byte unchanged.

### Garage: three choices, one priority

Smallest safe implementation, no scoring change:

- **Phones:** "How important is a garage?" (unchanged), then **"Which garage?"**
  with three photo cards — *Any garage* (attached or detached), *Attached
  garage*, *Detached garage* — writing the existing `garagePreference`.
- **Desktop board:** the Garage library section offers three chips — *Any
  Garage*, *Attached Garage*, *Detached Garage*. Each is the same
  `exterior:Garage` priority plus its qualifier (`placeOnBoard` writes exactly
  what the phone writes). Once one is ranked, all three leave the library; the
  column shows the one chosen, and its chooser can switch the kind. Removing it
  is the phone's Not important (qualifier kept).
- So there is always **one** garage criterion: no contradictory selections, no
  duplicate Match counting, `heldGarage` unchanged.

**Not done (needs a Match change):** making Match treat "Attached Garage" as
met only by an attached garage. Today Match scores Garage from garage spaces
for every choice; the attached / detached preference is stored for the buyer.
Homes already record a garage type (Home Facts), so the next PR (automatic
Match fulfillment from Garage) can score it without a new identity. This was
not done silently here.

### Privacy Fence

`exterior:Privacy Fencing` with the founder's `privacy-fence.webp` (reserved in
#185, now mapped; 400w 23 KB, 800w 89 KB). Never inferred from a Fenced Yard
answer (JS and SQL tests, and listing text: "fully fenced backyard" is a fenced
yard, not a privacy fence). `apartment-pool.webp` and `private-garage.webp` stay
reserved for the rental catalog. `walkable-to-schools.webp` is now listed as
**retired** (its card was removed): the original is kept, its two card
derivatives were removed, and the photo test accepts it only by name.

## Historical data

Nothing is deleted or migrated. A buyer who chose a removed option (Walkable
to Schools, Near Water, Wooded Setting, Second-Floor Laundry, Fire Pit, Room for
Entertaining, Workshop Space, Walkable Neighborhood) keeps it: still counted in
Match (Unknown until answered, never No), listed on Review under "More of your
priorities", shown once in its column on the desktop board, editable in My
Search. A buyer who chose First-floor laundry sees it chosen as Main Floor
Laundry. Co-buyers keep independent documents.

## Tests and QA

- `test/home-to-buy-catalog-refinement.test.js` (8) and
  `test/home-to-buy-catalog-refinement-db.test.js` (real Postgres, JS = SQL).
- Updated: V3 catalog, photo manifest, Home to Buy snapshot fixture
  (`test/fixtures/v3-home-buy-screens.json`, regenerated for the approved
  catalog), desktop board garage tests, desktop and mobile QA scripts.

## Decisions for the founder

1. **"Main Floor Laundry" everywhere?** It is the onboarding name only; My
   Search / Match / Home Facts still say "First-Floor Laundry" (same identity).
   Renaming the display label app-wide is a one-line change, left for approval.
2. **Front Porch** moved from Layout to Exterior & Property suggestions (it is
   an exterior identity and was not in the approved Layout list).
3. **Garage Match semantics** (above) — next PR.
4. **Garden Space** kept as an Exterior suggestion (not in either list).
