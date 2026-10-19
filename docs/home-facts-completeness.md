# Home Facts completeness (PR #160)

First follow-up from the property-information audit. No migration, no Match
change, no import change, no Realtor SQL change, no new provider.

## What changed

| Fact | Before | Now |
| --- | --- | --- |
| HOA fee (`hoa_fee_monthly`) | Row shown only when an import had filled it, so a buyer could never enter it | Always shown for a home to buy. Blank is **Unknown**; `0` is a confirmed **$0/mo** (stored as the number 0, never null). A $0 monthly fee does not prove there is no HOA, so nothing says "No HOA". The "Enter 0 for a $0 monthly fee" hint shows only to people who can edit |
| Property tax year (`property_tax_year`) | Read-only, folded into the "Annual taxes · 2025" label, kept after the amount was corrected | Its own field beside Annual taxes. A four-digit year, or blank for Unknown. An invalid year is never saved and never silently reverted: on Enter or leaving the field it stays on screen, marked invalid, with "Not saved. Enter a four-digit year, like 2025, or clear it." The typing pause never shows the message |
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

## Install banner and modals

The "Add to your home screen" banner (`InstallPrompt`) is fixed at the bottom
of the screen on iPhone / iPad user agents, which is where a modal's Save, Add
and Close controls sit on phones. While any `[role="dialog"][aria-modal="true"]`
is open (the home overlay, Add / Edit Home, every `Sheet`, the post-tour modal,
the mobile tour) the banner steps aside, without being dismissed, and comes back
when the dialog closes. Its look, its Dismiss / Install behaviour and its
stored dismissal are unchanged. Every modal in the app already marks itself
`aria-modal="true"`; a unit test keeps that true for the main ones.

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
- `scripts/qa/home-facts-completeness-e2e.mjs`: browser QA in Chromium device
  emulation on desktop 1440 × 900, iPad 820 × 1180 (Playwright's iPad (gen 11)
  user agent and touch) and iPhone 13, as owner, co-buyer and Realtor against
  the Supabase stand-in. On iPad and iPhone it leaves the install banner
  undismissed and checks that it shows on My Homes, steps aside for Add Home, an
  Archive `Sheet`, the home overlay and the apartment editor (whose Save really
  receives the tap), comes back afterwards, and still dismisses for good.
  Screenshots are in `docs/home-facts-completeness-screenshots/`.

## Found, not fixed here

- Real iPads on iPadOS 13+ send a Mac (desktop Safari) user agent by default,
  so they may never show the install banner at all. That is unchanged here.
- `homeFactSections` (the older read-model, now used only by tests) still
  lists HOA only when known. It is not rendered anywhere.
- **Overlay harness step 11 at 1440 (dev server only).** `home-overlay-e2e.mjs`
  intermittently fails "[1440] 11. Duplicate URL…" on this branch (3 of 6 runs),
  while `main` passed 4 of 4. Instrumented runs show the cause: right after a
  navigation the dev server has not yet applied the main stylesheet
  (`document.styleSheets.length` 1 of 2), so the phone-only collapse toggles are
  briefly visible at 1440 and the harness tries to click one as it disappears.
  It did not reproduce in isolation on either server, and the same harness on
  this branch's production build (`next start`) showed no unstyled moment at
  1440. Why it shows up more often on this branch's dev server is still
  unexplained.
- **The overlay harness does not support production builds.** Against `main`'s
  own `next start` build it fails 12 of 27 steps (from step 1), so the one
  production-build failure on this branch ("[390] 11", navigation after a manual
  add) is the harness's limitation, not a regression.
