# Onboarding V2 — priority gaps and assessment follow-ups

Status: tracked, not implemented. Recorded during the Step 4 refinement pass on
draft PR #141. Nothing below changes Match, extracts features automatically, or
adds a selectable option that FLH can't honour today.

## 1. Approved Figma priorities not yet offered in Step 4

Step 4 (`src/lib/whatMattersCatalog.js`) offers only chips backed by an existing
canonical priority. These three are part of the approved design and the
long-term spec, but are held back until they can be honoured end to end.
`UNSUPPORTED_FIGMA_OPTIONS` in the catalog lists them so they can't be forgotten.

### Natural light

* **What exists:** `homeFeel:Natural Light` is a tour-judged (experiential)
  criterion with three tour answers — Disappointing / Fine / Great — scored as
  not met / neutral / met. Not rated means not evaluated. It is in
  `RETIRED_PURCHASE_BUILT_INS`, so for purchase searches it is kept for old data
  and never counts in Match.
* **Minimal path to a valid priority:**
  1. Un-retire it for purchase: remove it from `RETIRED_PURCHASE_BUILT_INS` and
     add it to the purchase Home Feel suggestions.
  2. Make the same change to the SQL co-buyer scorer
     (`resolve_cobuyer_compare_perspectives`). `test/match-scorer-parity.test.js`
     requires the two retired lists to match, so this needs a migration.
  3. Decide the answer model. Keep the tour answer (judged in person, after a
     visit), or switch to Yes / No / Unknown. The tour answer already separates
     "not evaluated" from a negative judgement.
* **Why not now:** un-retiring changes Match for anyone who already has it
  selected (it would start counting), and it needs a database migration. Both
  are out of scope for this pass.

### Open kitchen

* **What exists:** no canonical criterion. `features:Updated Kitchen` is retired
  and means something different.
* **Minimal path to a valid priority:**
  1. Add `features:Open kitchen` as a check-kind criterion in
     `FEATURES_SUGGESTED`, with a display label.
  2. A check-kind criterion is already assessed on a saved home with the
     existing Yes / No / Unknown control (Add/Edit Home → Personalized Match):
     `true` = Yes, `'no'` = No, absent = Unknown. Unknown is never a miss.
  3. Confirm the SQL co-buyer scorer treats a new check-kind key the same way
     (parity test), and decide whether listing import may ever fill it. The
     default is never: there's no reliable source.
* **Why not now:** adding a new canonical criterion changes the catalog My
  Search, Rank and Match all read. It should be its own reviewed change, not
  part of a visual pass.

### Easy commute

* **What exists:** Places That Matter (Step 2) are saved as the person's own
  `commute_destinations`, with **no** maximum drive time from onboarding.
  `/api/commute` already computes drive times from each saved home to each
  place, and they appear as distance context. `location:Commute` counts in
  Match only through `evaluateCommute`, which needs a place with
  `max_drive_minutes` set.
* **Proposed design (no automatic thresholds):**
  1. "Easy commute" records that commute matters. It does not create a
     threshold.
  2. With saved places, Step 5 can rank it like any priority. On each home, FLH
     shows the computed drive times to those places as context.
  3. It counts in Match only when the person explicitly sets a maximum drive
     time for a place in My Search (existing behaviour). Until then it stays
     Not evaluated, never a miss.
  4. Alternative: treat it as a check-kind criterion the person answers per
     home (Yes / No / Unknown) after seeing the drive times. That is simpler,
     but subjective.
* **Why not now:** offering it today would create a priority that silently
  never counts. The ranking-only behaviour in step 2 needs a product decision
  and a small Step 5 / My Search change.

## 2. Follow-up task — manual assessment on saved homes

Separate from onboarding; Home Detail is not redesigned in this pass. Each item
must keep Yes, No and Unknown distinct where it applies. Unknown is never
treated as No.

| Assessment | Today | Needed |
|---|---|---|
| Property layout | Recorded as the home's layout (Ranch / Two Story / …) in Add/Edit Home → Home details. Shown once the person's layout group has an importance, which Step 4 now gives it. Blank = Unknown; a match on any chosen layout = Yes; a different layout = No. | Confirm the field is discoverable for every buyer who chose a layout in onboarding. Consider a short "Ranch or Two Story?" prompt on Home Detail. |
| Home condition | Same mechanism as layout (`homeCondition`). | Same as layout. |
| Garage details | Garage spaces in Add/Edit Home: blank = Unknown, 0 = No, 1+ = Yes. The importer fills it only from explicit text ("2-car garage", "Garage: 2"). Attached/Detached is an optional buyer-side qualifier, not a home fact. | Decide whether a home-side Attached/Detached fact is wanted. If so, add it as Unknown by default and never infer it. |
| Natural light | Not assessable for purchase searches (retired; see above). | Section 1. |
| Open kitchen | No criterion (see above). | Section 1. |

## 3. Decisions locked in this pass (for reference)

* Six-step flow: a fresh buyer starts Step 4 with nothing chosen. House is no
  longer preset from "a home to buy" (`chooseSearchType(…, { presetPropertyType:
  false })`). The live flow still presets it. Existing searches keep their
  explicit choices.
* Property type, Layout and Condition stay alternative groups (any chosen
  option fits, one importance). Match is unchanged.
* Garage is chosen in Step 4 and ranked in Step 5. Onboarding doesn't ask
  Attached vs Detached; an existing qualifier is kept and shown.
