# Proposal: shared "main floor" fact as First-Floor Primary evidence

**Priority:** medium. **Needs:** JS Match + SQL parity (no schema).

## Today
- Preference: `features:First-Floor Primary` (check criterion), answered only by
  each participant's own Yes / No in Edit Home.
- Shared fact: `homes.primary_bedroom_location` ('Main Floor' | 'Upstairs' | ''),
  editable in Edit Home when eligible, scored only for the separate
  `primaryBedroomLocation` preference (single-select, rarely used).

## Change
For `features:First-Floor Primary`, evaluate in this order (both scorers):
1. the participant's own explicit answer (Yes / `'no'`) — the person's own
   judgement wins;
2. else shared `primary_bedroom_location`: 'Main Floor' → met; 'Upstairs' →
   missed **only if** the listing/editor recorded it explicitly (it is a single
   choice, so 'Upstairs' is an explicit statement); '' → Unknown.

## Verify before shipping
- SQL branch added beside the Garage special case; parity DB test with owner
  answer / shared fact / both / neither.
- Unknown behavior: empty fact + no answer stays Unknown for a Must-Have.
- Edit Home: show "From shared home details" provenance when the fact decides.
- Awareness RPC: make `primaryBedroomLocation` eligible when either participant
  has the First-Floor Primary priority, so the field appears for them.
