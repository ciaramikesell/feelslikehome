# Proposal: basement finish and access types

**Priority:** high. **Needs:** migration + JS Match + SQL parity.

## Today
- Preferences: `features:Finished basement`, `features:Walkout basement` (each
  its own check criterion, each the participant's own Yes / No / Unknown).
- Home: `homes.basement_notes` free text (RentCast `features.basement` →
  "Finished" / "Partially finished" / "Unfinished" / "Walkout" via
  `canonicalBasementNotes`), not scored. Import rules fill Finished / Walkout
  basement answers from explicit listing text.

## Model
Two independent axes, each a set of alternatives:
- **Finish:** finished · partially finished · unfinished
- **Access:** walkout · daylight · traditional (fully below grade)
plus "no basement".

## Storage
```sql
alter table public.homes
  add column if not exists basement_finish text[] not null default '{}',
  add column if not exists basement_access text[] not null default '{}',
  add column if not exists has_basement boolean;  -- null Unknown, false = no basement
```
Arrays (like `home_layout`) because a basement can be partly finished, and some
listings describe two exits. Shared facts, column grants, awareness RPC as above.

Preferences: two grouped preferences in the participant JSON, same shape as
`homeLayout`: `basementFinish { values, tier }`, `basementAccess { values, tier }`.
"Finished + Walkout" = finish ∈ {finished} AND access ∈ {walkout}; "Walkout or
Daylight" is one access group. Each group ranks as one item.

## Match (both scorers)
Group rule identical to `homeLayout`: met when any chosen value is in the home's
array; missed when the array is non-empty and disjoint, or `has_basement = false`;
Unknown when empty and `has_basement` is not false.

## Existing data
- Preferences: a selected `features:Finished basement` is folded on read into
  `basementFinish {values:['finished'], tier}` (and Walkout into
  `basementAccess`), the same in-memory fold pattern as
  `PURCHASE_LEGACY_LABEL_ALIASES`; persisted on next save. No bulk rewrite.
- Homes: a participant's existing Yes on those criteria stays as their personal
  answer and is used only while the shared fact is empty (read fallback), so
  nobody's Match regresses. `basement_notes` stays as notes; a one-time
  *suggestion* (not write) to fill the structured fields from it.

## Import
RentCast `features.basement` and `features.foundationType` →
`basement_finish` / `basement_access` / `has_basement` only on explicit values
("Slab" foundation alone does not set `has_basement=false`). Listing text:
explicit phrases only.

## UI
Basics Basement row: Finished · Unfinished · Walkout · Daylight · Traditional
(finish choices and access choices visually grouped, alternatives within each).
Edit Home: one Basement row with the same chips + Unknown + "No basement".

## Tests
Fold of legacy criteria; JS/SQL parity for every axis; Unknown never a miss;
co-buyer separation of personal fallback answers.
