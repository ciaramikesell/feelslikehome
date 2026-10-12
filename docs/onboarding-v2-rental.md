# Onboarding V2 — renting (Home to Rent, Apartment to Rent)

Renters use the same six steps and components as buyers. Only the Step 4
catalog, a few words and the search-type rules differ. Nothing here adds a
role, a permission, a database column or a Match rule.

## Decisions

| Decision | Where |
|---|---|
| **Apartment Building type is optional.** The six-step flow never presets Apartment. Building type (Apartment, Condo, Townhome) is a normal Step 4 group: the values are alternatives with one importance, visible in Steps 5–6, and never scored unless chosen. The live flow still presets Apartment. | `propertyTypeChoicesFor`, `chooseSearchType` (six-step branch), `whatMattersGroups` |
| **Rental essentials come first for both types:** Pet-friendly, In-unit laundry, Utilities included, Parking, Central air, Dishwasher. These are existing rental criteria. Pets, laundry and utilities are shared facts about a property. | `whatMattersCatalog.js` |
| **Home to Rent** adds Neighborhood, The home, Outdoor space and Property type (House / Townhome / Condo). **Apartment to Rent** adds The unit, Building & amenities, Building type and After you tour. Secondary options sit under More to consider. Everything Home to Rent already offered stays available there. | `RENTAL_SECTIONS`, `RENTAL_MORE` |
| **After-tour assessments are marked.** Quiet community, Privacy and Outdoor space carry an "after tour" tag in Step 4 and "After you tour" in Steps 5–6. Everything else can usually be checked before touring. | `isExperientialCriterion` |
| **Steps 5 and 6 use Step 4's words** for every kind of search (e.g. "Great schools", "Pet-friendly", "Quiet community"). Stored identities are unchanged. | `onboardingPriorityLevels` |
| **Co-renter and Agent wording.** These are the same `co_buyer` and `realtor` roles, invitations and permissions. | `peopleWords` |
| Apartment to Rent finishes with **"Add my first apartment."** | `ReviewStep` |
| **Switching search types keeps what still applies.** That includes the Basics, compatible picks at their levels, compatible property types and typed priorities. Step 1 lists anything removed (picks the new type doesn't offer, layout or condition when renting, a lot size for an apartment) and offers Undo. | `switchSearchType`, `BasicsStep` |
| **Home to Rent listing-text detection** now covers the canonical criteria it offers (central air, home office, finished basement, fenced yard, …). Typed priorities are never guessed. | `derivePriorityCheckPatch` |

## Retired, kept for existing users

**Social community, On-site management and Surrounding neighborhood** are retired from what renters are offered. Nothing in FLH can answer them for a home: there's no listing field, no Yes/No question and no after-tour question. Anyone who already chose one keeps it; it stays on their board and keeps counting as before.

- Onboarding V2 doesn't offer them.
- My Search and the current onboarding list retire them on the live-fixes branch, `claude/charming-bell-i0xo4w`.

Quiet community and Privacy remain, labelled as after-tour assessments.

## Future rental priorities (not offered)

These need new property data and Match design first:

- **Move-in date.** Listing text already yields `availableOn`, but the saved-home editor can't edit it and Match doesn't compare it. This needs the renter's move-in window and a rule for "available by".
- **Lease length.** No field, import source or rule exists yet.
- **Furnished.** No field, import source or rule exists yet.
- **Deposits and fees.** These are better kept as notes than as priorities. A fee calculation would need new fields.

## Notes from QA

- **Parking, Off-street parking and Garage** are three separate priorities:
  - Parking is in Rental essentials.
  - Off-street parking is under More to consider.
  - Garage is in "The home", for Home to Rent only.

  Each is answered from its own source: garage spaces for Garage, and its own Yes/No for the other two. The live-fixes branch also stops listing-text import from recording "No parking" against a home it says has a garage or driveway.
- **A rental lot size** is entered as an "ideal" with no importance. It is never ranked or treated as a Must-Have, and Match ignores it until the person gives it a level in My Search. This is the same as the live flow.

## Related live-app changes (separate branch `claude/charming-bell-i0xo4w`, not this PR)

- The saved-home editor's Pets / Laundry / Utilities answers count in Match.
- Co-buyers can save shared facts on homes someone else added.
- My Search offers Rental Essentials to renters; the three options above are retired.
- Listing text no longer produces contradictory parking answers.
- A read-only audit of historical Pets / Laundry / Utilities answers: `docs/rental-fact-history-audit.md`.

## Known gaps

- **"Deck / patio" for Home to Rent** has no listing-text rule, so it's recorded manually, as before.
