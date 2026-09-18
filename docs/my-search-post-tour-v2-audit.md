# My Search cleanup and Post-Tour Take V2 audit

## Existing architecture reused

* Participant priorities remain in the existing JSON priority document. Stable category/label identities and routes were not renamed.
* Participant lifecycle, reaction, ratings, and checks remain in `home_member_state`; its existing caller-owned write path and RLS remain authoritative.
* Shared property notes remain the existing `homes.notes` field. Post-tour text is appended after existing content rather than replacing it. Realtor notes remain in `realtor_notes`.
* The four V2 evaluations use semantic values (`negative`, `neutral`, `positive`) under reserved `tour-v2:*` keys in the participant-owned ratings JSON. They are deliberately absent from Match criteria and weights.

## Legacy strategy

Removed purchase built-ins are retained verbatim in saved priority JSON. They are hidden from the purchase picker and excluded from both client Match and the sanitized co-buyer Match projection, so they cannot generate artificial Unknown counts. No destructive data migration is performed. New user-created criteria are tagged `source: custom`, including when their label resembles a retired built-in.

A limitation of the historical JSON shape is that old suggested items and old custom items did not record origin. For the known retired built-in identities, safety favors deprecation from Match. The original data remains available for a future explicit recovery/migration UI.

## Security and ownership

No policy or grant was widened. Post-tour writes continue to upsert only `(home_id, auth user)` through the established participant state path. Co-buyers cannot update one another's rows, Realtor read-only detail cannot render the take editor, and Realtor professional notes remain separate.
