# Proposal: garage location, garage size and "No Garage"

**Priority:** high. **Needs:** migration + JS Match + SQL co-buyer Match parity.

## Today
- Preference: `exterior:Garage` criterion (tier) + `exterior.garagePreference`
  (`any` | `attached` | `detached`), informational only.
- Home: `homes.garage_spaces` text (RentCast `features.garageSpaces`, listing
  text "2-car garage", manual). Match: >0 met, `0` miss, empty Unknown — in
  both scorers.
- Evidence not stored: RentCast `features.garageType` and description phrases
  (`listingFacts` "attached/detached garage") are shown in "What FLH found" only.

## Storage
```sql
alter table public.homes add column if not exists garage_type text
  check (garage_type is null or garage_type in ('attached','detached','none'));
```
NULL = Unknown. `garage_spaces` stays the capacity source. Add `garage_type` to
`SHARED_FIELDS`/`HOME_SHARED_COLUMNS`, column grants and
`resolve_shared_fact_priority_awareness` (eligible when the participant has a
Garage priority with a qualifier or minimum).

Preference (participant JSON, no schema): keep `exterior.garagePreference`
(`any` | `attached` | `detached` | `none`) and add `exterior.garageMinSpaces`
(`1` | `2` | `3`, absent = any size). "No Garage" is `garagePreference: 'none'`,
which clears `garageMinSpaces` (never an invisible contradictory size).

## Match (JS `computeMatch` and SQL, identically)
One Garage criterion, one tier — attributes are one preference, not separate
requirements:
| Preference | Met | Missed | Unknown |
| --- | --- | --- | --- |
| Any (+ min N) | spaces ≥ N (≥1 if no N) | spaces known and < N, or type `none` | spaces unknown and type not `none` |
| Attached / Detached (+ min N) | size met **and** type matches | size missed, or type known and different | size met but type Unknown → evaluate on size only (detail says "type not confirmed"); never a miss on Unknown type |
| No Garage | spaces = 0 or type `none` | spaces > 0 or type attached/detached | both unknown |
Existing searches (no min, `any`) behave exactly as today. A `garagePreference`
of attached/detached starts affecting Match only after this ships — call it out
in release notes; optional one-time banner in My Search.

## Import
- RentCast `features.garageType`: map "Attached Garage"/"Detached Garage"/"None"
  to `garage_type` only when unambiguous; carport/street → leave NULL.
- Listing text: explicit "attached garage" / "detached garage" / "no garage"
  only (existing `UNSAFE_CONTEXT` rules); "garage" alone sets nothing.
- Never infer `none` from a missing garage mention.

## Manual editing
Edit Home "Garage": one compact row — Type [Unknown · Attached · Detached · No
garage] and Spaces [Unknown · 1 · 2 · 3+ · custom]; choosing No garage sets
spaces 0. Shared fact, either decision-maker may edit (existing UPDATE policy).

## UI
Basics Garage row: Any Garage · Attached · Detached · No Garage; Garage Size row
(1 car · 2 cars · 3+ cars) shown only for a garage-positive choice; Rank label
e.g. "Garage — Attached, 2+ cars".

## Tests
JS unit table above; DB parity test (owner Match vs co-buyer Compare projection)
for every row; migration idempotence; import mapping; Unknown never a miss for a
Must-Have.
