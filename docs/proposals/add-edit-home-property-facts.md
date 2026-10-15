# Proposal: improved Add / Edit Home property-fact controls

**Priority:** medium, sequenced after garage and basement (it surfaces their new
columns). **Needs:** no schema of its own.

## Goals
One compact "Home details" card that mirrors The Basics' Home preferences rows,
so what a buyer asks for and what is recorded about a home use the same words.

| Row | Control | Stored as | Unknown / No |
| --- | --- | --- | --- |
| Home type | single choice chips | `property_type` | no chip = Unknown |
| Layout | multi chips (Ranch · Two-Story · Split Level · Other) | `home_layout[]` | empty = Unknown (shipped in #145) |
| Primary bedroom | Main floor · Upstairs | `primary_bedroom_location` | empty = Unknown |
| Condition | multi chips | `home_condition[]` | empty = Unknown (shipped in #145) |
| Garage | Type + Spaces (see garage proposal) | `garage_type`, `garage_spaces` | NULL / '' = Unknown; "No garage" = known No |
| Basement | finish + access chips + "No basement" | basement proposal | empty = Unknown; `has_basement=false` = No |
| Yard / fencing | personal Yes/No today; shared `yard_fencing` only if co-buyers report conflicts | — | — |

## Principles
- Unknown is the default and is always one tap away; "No" is only ever explicit.
- Rows appear when relevant to someone in the search (awareness RPC), with a
  "Show all details" disclosure — no permanent wall of controls.
- Provenance tags (From listing / Added by you / Unknown) per row, as Key details
  already do.
- Shared facts: either decision-maker may edit; personal Yes/No stays in
  `home_member_state`. Realtors keep their current (suggestion-only) access.
- Desktop: label left, chips right on one line; phones: stacked, 44px targets.

## Tests
Persistence per row (DB), owner/co-buyer edit permission, Realtor denial,
Unknown ↔ value round trip, Match parity for each scored fact.
