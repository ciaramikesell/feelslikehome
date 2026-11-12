// Fixed vocabulary for floor-plan extraction (pipeline fpa-2). Shared by the
// schema, the validator, the deterministic mapper and the scorer, so every
// provider is asked for, and judged on, exactly the same terms.
//
// Design rules (docs/ai-floor-plan-analysis-feasibility.md):
//   * The extraction describes what is DRAWN. It never says a feature is
//     absent: there is no "absent" value anywhere, so omission can never
//     become a No.
//   * Every room / feature carries an evidence category and a configuration
//     status. Only printed (or, for a few concepts, drawn-symbol) evidence of
//     an as-drawn configuration can ever be offered to a buyer as "Yes".

export const PIPELINE_VERSION = 'fpa-2';

// How the plan shows something. Ordered strongest → weakest.
export const EVIDENCE = Object.freeze({
  PRINTED_LABEL: 'printed_label', //     the room/feature is named in text on the plan
  DRAWN_SYMBOL: 'drawn_symbol', //       a standard fixture symbol, no text (W/D circles, two sinks)
  LAYOUT_INFERRED: 'layout_inferred', // reasoned from shape, size or position — never offerable
  NOT_DETERMINABLE: 'not_determinable', // a plan can't show it — dropped by the validator
});
export const EVIDENCE_CATEGORIES = Object.freeze(Object.values(EVIDENCE));

// Whether the plan presents the thing as part of the home as drawn.
export const CONFIGURATION = Object.freeze({
  AS_DRAWN: 'as_drawn',
  OPTIONAL: 'optional_or_alternate', // Optional / Alternate / Proposed / Upgrade / Future / "Opt." …
  UNCLEAR: 'unclear', //               "Den/BR 4", "Flex", two labels for one room
});
export const CONFIGURATIONS = Object.freeze(Object.values(CONFIGURATION));

export const FLOOR_LEVELS = Object.freeze(['basement', 'main', 'second', 'third', 'unknown']);

export const ROOM_TYPES = Object.freeze([
  'bedroom', 'primary_bedroom', 'full_bath', 'half_bath', 'primary_bath',
  'walk_in_closet', 'closet', 'kitchen', 'dining', 'living', 'family', 'great_room',
  'office', 'den_flex', 'laundry', 'mudroom', 'pantry', 'walk_in_pantry', 'foyer', 'hall',
  'stairs', 'garage', 'bonus_room', 'rec_room', 'storage', 'mechanical', 'porch',
  'screened_porch', 'deck_patio', 'balcony', 'guest_suite', 'unfinished', 'other',
]);

export const RELATIONSHIP_TYPES = Object.freeze(['door_between', 'ensuite_bath', 'closet_of', 'jack_and_jill']);

// Features the model may report. Floor-dependent concepts (first-floor
// bedroom / primary, laundry floor) are NOT reported by the model: they are
// derived locally from rooms + captioned floors (mapping.mjs), so a floor
// claim always rests on a printed floor caption.
export const FEATURE_CONCEPTS = Object.freeze([
  'walk_in_closet', 'walk_in_pantry', 'pantry', 'mudroom', 'office', 'den_flex', 'laundry',
  'primary_ensuite', 'jack_and_jill_bath', 'formal_dining', 'eat_in_kitchen', 'kitchen_island',
  'double_vanity', 'soaking_tub', 'fireplace', 'bonus_room', 'rec_room', 'guest_suite',
  'finished_basement', 'basement', 'screened_porch', 'front_porch', 'patio_deck', 'balcony',
  'attached_garage', 'detached_garage', 'garage', 'pool', 'other',
]);

// Concepts derived locally (never requested from a provider).
export const DERIVED_CONCEPTS = Object.freeze([
  'first_floor_bedroom', 'first_floor_primary', 'laundry_first_floor', 'laundry_second_floor',
]);

// Concepts whose standard drawn symbol is itself the evidence (a plan draws two
// sinks or W/D circles; it rarely writes "double vanity"). Everything else
// needs a printed label before it can be offered.
export const SYMBOL_DEFINED_CONCEPTS = Object.freeze(new Set(['double_vanity', 'kitchen_island', 'laundry']));

// Configuration language. Matching any of these on a label or qualifier forces
// configuration = optional_or_alternate, whatever the provider said.
export const OPTIONAL_LANGUAGE = /\b(?:optional|opt|options?|alternate|alternative|proposed|upgrade[sd]?|future|potential|possible|available|convertible|may be|could be|by builder|per plan|planned|rough[- ]?in)\b|\b(?:opt|alt)\./i;

// Ambiguous dual-purpose labels ("Den/BR 4", "Flex", "Office or Bedroom"):
// configuration = unclear for the affected room. "W/D" and "W.I.C." are not
// alternatives and are excluded.
const ROOMISH = '(?:den|flex|bonus|office|study|br\\.?\\s*\\d*|bdrm\\.?\\s*\\d*|bed(?:room)?\\s*\\d*|guest|play(?:room)?|media|loft|nursery|dining|craft|gym)';
export const AMBIGUOUS_LANGUAGE = new RegExp(`\\b${ROOMISH}\\s*(?:/|\\bor\\b)\\s*${ROOMISH}|\\bflex\\b`, 'i');

// Field length limits enforced locally (structured outputs cannot express
// maxLength). Values are trimmed, never rejected.
export const LIMITS = Object.freeze({
  id: 16, label: 80, qualifier: 60, evidence: 240, uncertainty: 200, note: 200, warning: 200,
  floors: 8, rooms: 80, relationships: 120, features: 60, roomIds: 8, warnings: 10,
});
