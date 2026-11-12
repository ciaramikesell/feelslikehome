// The fixed structured-extraction schema sent to every provider.
//
// Deliberately restricted to the JSON-Schema subset both Claude structured
// outputs and Gemini responseJsonSchema accept: object/array/string/integer/
// boolean, enum, required, additionalProperties:false. No null unions, no
// min/max/length/pattern keywords (lengths are enforced locally in
// validate.mjs). Every property is required; "none" is the empty string.
//
// The schema is static and contains no user data (providers cache compiled
// schemas separately from prompts).
import {
  CONFIGURATIONS, EVIDENCE_CATEGORIES, FEATURE_CONCEPTS, FLOOR_LEVELS, PIPELINE_VERSION, RELATIONSHIP_TYPES, ROOM_TYPES,
} from './vocabulary.mjs';

const str = (description) => ({ type: 'string', description });
const enumOf = (values, description) => ({ type: 'string', enum: [...values], description });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items, description) => ({ type: 'array', items, description });

export const EXTRACTION_SCHEMA = Object.freeze(obj({
  schemaVersion: enumOf([PIPELINE_VERSION], 'Always the literal pipeline version.'),
  image: obj({
    isFloorPlan: { type: 'boolean', description: 'False if the image is not an architectural floor plan.' },
    legibility: enumOf(['clear', 'partly_legible', 'poor'], 'How readable the printed text is.'),
    multipleDrawings: { type: 'boolean', description: 'True if the image contains more than one floor drawing.' },
  }),
  floors: arr(obj({
    id: str('Short id such as f1.'),
    printedCaption: str('The floor caption exactly as printed (e.g. "SECOND FLOOR"); empty string if none is printed.'),
    level: enumOf(FLOOR_LEVELS, 'Level named by the printed caption; "unknown" whenever no caption is printed.'),
  }), 'One entry per separate floor drawing in the image.'),
  rooms: arr(obj({
    id: str('Short id such as r1.'),
    floorId: str('Id of the floor drawing this room is in.'),
    printedLabel: str('Room text exactly as printed, without dimensions; empty string if the room has no text.'),
    qualifierText: str('Printed qualifier attached to this room such as "OPTIONAL", "ALT.", "FUTURE", "UPGRADE"; empty string if none.'),
    type: enumOf(ROOM_TYPES, 'Normalized room type.'),
    evidenceCategory: enumOf(EVIDENCE_CATEGORIES, 'printed_label if named in text; drawn_symbol if identified only by fixture symbols; layout_inferred if only by shape or position.'),
    configuration: enumOf(CONFIGURATIONS, 'optional_or_alternate if the plan marks it optional/alternate/proposed/upgrade/future; unclear if it carries two possible uses.'),
    evidence: str('What is visible that supports this, in a short phrase.'),
  }), 'Every enclosed room or space drawn.'),
  relationships: arr(obj({
    type: enumOf(RELATIONSHIP_TYPES, 'door_between only when a door or opening is drawn between the two rooms; sharing a wall is not a relationship.'),
    fromRoomId: str('Room id.'),
    toRoomId: str('Room id.'),
    evidenceCategory: enumOf(EVIDENCE_CATEGORIES, 'Evidence category for this relationship.'),
    evidence: str('What is drawn, e.g. "door swing between the two rooms".'),
  }), 'Connections between rooms that are drawn on the plan.'),
  features: arr(obj({
    concept: enumOf(FEATURE_CONCEPTS, 'The feature.'),
    floorId: str('Floor id, or empty string.'),
    roomIds: arr({ type: 'string' }, 'Rooms that show this feature.'),
    evidenceCategory: enumOf(EVIDENCE_CATEGORIES, 'Evidence category.'),
    configuration: enumOf(CONFIGURATIONS, 'Configuration status.'),
    qualifierText: str('Printed qualifier such as "OPTIONAL"; empty string if none.'),
    evidence: str('Visible evidence in a short phrase.'),
    uncertainty: str('What the plan does not show about this feature; empty string if nothing material.'),
  }), 'Layout features visible on the plan. Never list a feature because it is missing.'),
  counts: obj({
    bedroomsLabeled: { type: 'integer', description: 'Rooms whose printed label names them as a bedroom.' },
    fullBathsBySymbol: { type: 'integer', description: 'Bathrooms with a drawn tub or shower.' },
    halfBathsBySymbol: { type: 'integer', description: 'Bathrooms with a toilet and sink but no tub or shower.' },
    note: str('Anything that makes these counts uncertain; empty string if none.'),
  }),
  warnings: arr({ type: 'string' }, 'Problems reading the plan (blur, missing captions, cut-off drawings).'),
}));

// Keywords this schema is allowed to use (checked in tests so a later edit
// cannot silently introduce something a provider rejects).
export const PORTABLE_SCHEMA_KEYWORDS = Object.freeze(new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description',
]));
