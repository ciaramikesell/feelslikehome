# My Search and tour-evaluated criteria audit (2026-09-18)

## Existing architecture

* Participant priorities are JSON documents in `search_member_priorities`, keyed by the durable `category:label` identity. Structured price, beds, baths, square footage, lot size, property type, layout, and condition are separate priority shapes and already contribute to Match.
* Personal home state is isolated in `home_member_state` by `(home_id, user_id)`. Ratings and checks are JSON maps; this provides a backward-compatible location for criterion-level tour evaluations without creating household truth. Shared notes remain separate.
* Match 2.0 already excluded Unknown from the denominator and did not fail an unknown Must Have. It formerly treated every rating as a numeric 1–5 score and Post Tour wrote 5/2 sentinels behind generic Liked/Didn't Like controls.
* The canonical property types are `apartment`, `house`, `townhome`, `condo`, `multifamily`, and `other`. Search intent is a separate purchase/rental/investment concept; no parallel property taxonomy was added.
* Realtor Home Detail is read-only for buyer personal state. Co-buyer compare uses a security-definer projection, while buyer writes stay caller-owned.

## Additive model and compatibility decisions

Criterion identity remains unchanged. A central catalog registry now provides `evaluationMode` (`pre_tour` or `tour`) and `applicablePropertyTypes`. Picker filtering applies only to available choices; an already-selected legacy criterion remains active, visible, and scoreable even when it is not applicable to the newly selected property type.

Tour responses are stable JSON values: `negative`, `neutral`, `positive`, and `not_evaluated`. Existing numeric 1–5 ratings remain readable and retain their historical score. No production priority or evaluation is deleted or rewritten.

### Tour criteria

Existing identities reused: Overall Condition, Layout / Flow, Natural Light, Character / Charm, Room Sizes, Openness / Ceiling Height, Privacy from Neighbors, Immediate Street / Surroundings, Yard, Yard Privacy, Exterior Condition, Landscaping, Outdoor Space, Noise Level, and Storage. Curb Appeal is additive. `Room Sizes` is retained rather than duplicating it as “Room Size / Proportions”; Yard/Outdoor Space and the two existing Privacy identities remain deliberately distinct.

Neighborhood stays pre-tour because the current product also uses it as location context. Renovation Potential stays in structured Home Condition rather than being duplicated. Price/budget, beds, baths, square footage, lot size, property type, home layout, and home condition remain structured and are not inserted into the preference chip catalog.

### Property applicability

On-Site Management, Fitness Center, Elevator, Secure Entry, and Building Amenities apply to attached housing (`apartment`, `condo`, `multifamily`). Pets Allowed and Utilities Included apply to apartments; In-Unit Laundry applies to apartments and condos. Multiple selected property types use union semantics.

## Scoring behavior

* `positive`: evaluated, score 1, matches.
* `negative`: evaluated, score 0, does not match.
* `neutral`: evaluated and displayed as neutral, but excluded from both numerator and denominator in V1. It is neither a pass nor a failure and cannot make a Must Have missing.
* `not_evaluated`/absent: Unknown and excluded from the score.

Counts and Match rows are recomputed from the participant's current priority document on every render. Removed criteria therefore stop contributing; newly selected tour criteria appear unresolved; retained historical answers can become active again if the criterion is reselected.

## Yellow flags for beta

* The criteria catalog is code metadata rather than a normalized criteria table. That is the safest additive fit for durable production JSON identities, but an admin-managed catalog would require a later migration strategy.
* Historical numeric ratings remain visible through legacy 1–5 semantics. They are not automatically rewritten to the new sentiment values.
* Neutral is intentionally unscored. Product should validate this with beta users before adopting any partial-credit formula.
* The sanitized co-buyer RPC scores semantic tour strings and excludes neutral, but its “different takes” projection remains limited to historical numeric opposing ratings. A future collaboration UI can add semantic disagreement without exposing raw participant state.
* Custom criteria default to their category's established kind; only canonical criteria receive catalog metadata. A future custom-criterion editor may need an explicit “evaluate after tour” choice.
