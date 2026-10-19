# Home Facts completeness (PR #160)

First follow-up from the property-information audit. No migration, no Match
change, no import change, no Realtor SQL change, no new provider.

## What changed

| Fact | Before | Now |
| --- | --- | --- |
| HOA fee (`hoa_fee_monthly`) | Row shown only when an import had filled it, so a buyer could never enter it | Always shown for a home to buy. Blank is **Unknown**; `0` is a confirmed **No HOA · $0/mo** (stored as the number 0, never null). The "Enter 0 if there's no HOA" hint shows only to people who can edit |
| Property tax year (`property_tax_year`) | Read-only, folded into the "Annual taxes · 2025" label, kept after the amount was corrected | Its own field beside Annual taxes. A four-digit year, or blank for Unknown |
| Property type | Single-Family, Multi-Family, Condominium | Adds **Townhome** (canonical `townhome`). Saved values not offered (Other, Apartment) still show and stay selected |
| Apartment floor plan name / unit (`selected_floor_plan_name`, `selected_unit_label`) | Stored and shown on My Homes cards, but nothing edited them | Edited beside Property name in the apartment editor ("More property details", and Add Property for apartments). Shown read-only under the property name in Home Facts. Blank or whitespace saves as null (Unknown) |

## Tax year and provenance

`propertyTaxPatch` (src/lib/homeFacts.js) decides the year when the amount changes:

- The year came from the listing (it equals the snapshot's year) and the new
  amount is not the listing's amount: the year returns to **Unknown**. It no
  longer describes the figure on screen.
- The amount is set back to the listing's figure while the year is blank: the
  listing's year comes back with it.
- A year a person typed is theirs and is never changed by an amount edit.
- `homes.listing_import` is never edited, so "From listing" vs "Added by you"
  stays provable for both fields.

## Boundaries kept

- Match: HOA, tax year, and floor plan / unit are not Match inputs. Property
  type was already one, and Townhome uses its existing canonical value.
  Weights stay 4 / 2 / 1. Nobody's personal "No HOA" answer is read or written.
- Import precedence: unchanged. `mergeImportFields` still fills only empty fields.
- Shared vs personal: every field here is a shared `homes` column, edited
  through the existing autosave (`saveHomeSharedFields`) or the full editor
  save. Owner and co-buyers may edit; Realtors and outsiders are refused by
  RLS / column grants (tested on real Postgres). Realtors see Home Facts read-only.
- The house quick-add card is unchanged; it still asks only for the address.
- Heating and cooling: unchanged. Save and reload re-verified; no bug found.

## Tests

- `test/home-facts-completeness.test.js`: pure checks always. Real-Postgres
  checks with `FLH_TEST_PGHOST` cover HOA Unknown → $0 → amount → Unknown,
  tax year after a corrected amount, Townhome (and refusal of non-canonical
  values), floor plan / unit save and reload, Realtor / outsider refusal, and a
  heating / cooling round trip.
- `scripts/qa/home-facts-completeness-e2e.mjs`: browser QA on desktop 1440,
  iPad Air and iPhone 13 (Chromium emulation) as owner, co-buyer and Realtor
  against the Supabase stand-in. Screenshots are in
  `docs/home-facts-completeness-screenshots/`.

## Found, not fixed here

- **Install banner covers Save on iPhone (inherited, on `main`).** The
  "Add to your Home screen" banner (`InstallPrompt`, fixed at the bottom,
  z-index 100) sits over the apartment editor's Save button on an iPhone user
  agent until it is dismissed. The browser QA dismisses it first; the overlay
  harness never meets it because it does not use an iPhone user agent.
- `homeFactSections` (the older read-model, now used only by tests) still
  lists HOA only when known. It is not rendered anywhere.
