// Validation and local safety gates for a provider's extraction.
//
//   validateSchema(value)      structural check against EXTRACTION_SCHEMA
//                              (independent of the provider's own enforcement)
//   sanitizeExtraction(value)  trims, drops dangling references, and applies the
//                              local gates. Gates only ever WEAKEN a claim
//                              (downgrade evidence, mark optional/unclear, drop);
//                              they never strengthen one.
import { EXTRACTION_SCHEMA } from './schema.mjs';
import {
  AMBIGUOUS_LANGUAGE, CONFIGURATION, EVIDENCE, LIMITS, OPTIONAL_LANGUAGE,
} from './vocabulary.mjs';

export function validateSchema(value, schema = EXTRACTION_SCHEMA, path = '$') {
  const errors = [];
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);
  const actual = typeOf(value);
  const expected = schema.type;
  const typeOk = expected === actual || (expected === 'number' && actual === 'integer');
  if (!typeOk) return [`${path}: expected ${expected}, got ${actual}`];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: "${value}" is not one of ${schema.enum.join(', ')}`);
  if (expected === 'object') {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${path}.${key}: missing`);
    for (const key of Object.keys(value)) {
      if (!schema.properties?.[key]) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
        continue;
      }
      errors.push(...validateSchema(value[key], schema.properties[key], `${path}.${key}`));
    }
  }
  if (expected === 'array') value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${path}[${i}]`)));
  return errors;
}

// Parses provider text into JSON. Providers using structured outputs return
// bare JSON; a stray code fence is tolerated, anything else is an error.
export function parseExtractionText(text) {
  const trimmed = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { value: JSON.parse(trimmed), error: null };
  } catch (error) {
    return { value: null, error: `invalid JSON: ${error.message}` };
  }
}

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function hasOptionalLanguage(...texts) {
  return texts.some((text) => text && OPTIONAL_LANGUAGE.test(text));
}

export function hasAmbiguousLanguage(...texts) {
  return texts.some((text) => text && AMBIGUOUS_LANGUAGE.test(text));
}

// Returns { extraction, issues }. `issues` lists every change the gates made,
// with a code the scorer and report can count.
export function sanitizeExtraction(raw) {
  const issues = [];
  const note = (code, detail) => issues.push({ code, detail });

  const floors = (raw.floors || []).slice(0, LIMITS.floors).map((floor) => {
    const out = { id: clip(floor.id, LIMITS.id), printedCaption: clip(floor.printedCaption, LIMITS.label), level: floor.level };
    if (!out.printedCaption && out.level !== 'unknown') {
      note('floor_level_without_caption', `${out.id}: "${out.level}" → unknown`);
      out.level = 'unknown';
    }
    return out;
  });
  const floorIds = new Set(floors.map((floor) => floor.id));

  const rooms = [];
  for (const room of (raw.rooms || []).slice(0, LIMITS.rooms)) {
    const out = {
      id: clip(room.id, LIMITS.id), floorId: clip(room.floorId, LIMITS.id), printedLabel: clip(room.printedLabel, LIMITS.label),
      qualifierText: clip(room.qualifierText, LIMITS.qualifier), type: room.type, evidenceCategory: room.evidenceCategory,
      configuration: room.configuration, evidence: clip(room.evidence, LIMITS.evidence),
    };
    if (out.floorId && !floorIds.has(out.floorId)) { note('dangling_floor', `room ${out.id}`); out.floorId = ''; }
    if (out.evidenceCategory === EVIDENCE.PRINTED_LABEL && !out.printedLabel) {
      note('printed_label_without_text', `room ${out.id}`);
      out.evidenceCategory = EVIDENCE.LAYOUT_INFERRED;
    }
    if (out.configuration === CONFIGURATION.AS_DRAWN && hasOptionalLanguage(out.printedLabel, out.qualifierText)) {
      note('optional_language', `room ${out.id} "${out.printedLabel || out.qualifierText}"`);
      out.configuration = CONFIGURATION.OPTIONAL;
    }
    if (out.configuration === CONFIGURATION.AS_DRAWN && hasAmbiguousLanguage(out.printedLabel)) {
      note('ambiguous_label', `room ${out.id} "${out.printedLabel}"`);
      out.configuration = CONFIGURATION.UNCLEAR;
    }
    rooms.push(out);
  }
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  const relationships = [];
  for (const rel of (raw.relationships || []).slice(0, LIMITS.relationships)) {
    const out = {
      type: rel.type, fromRoomId: clip(rel.fromRoomId, LIMITS.id), toRoomId: clip(rel.toRoomId, LIMITS.id),
      evidenceCategory: rel.evidenceCategory, evidence: clip(rel.evidence, LIMITS.evidence),
    };
    if (!roomById.has(out.fromRoomId) || !roomById.has(out.toRoomId) || out.fromRoomId === out.toRoomId) {
      note('dangling_relationship', `${out.type} ${out.fromRoomId}→${out.toRoomId}`);
      continue;
    }
    if (out.evidenceCategory === EVIDENCE.NOT_DETERMINABLE) continue;
    relationships.push(out);
  }

  const features = [];
  for (const feature of (raw.features || []).slice(0, LIMITS.features)) {
    const out = {
      concept: feature.concept, floorId: clip(feature.floorId, LIMITS.id),
      roomIds: (feature.roomIds || []).slice(0, LIMITS.roomIds).map((id) => clip(id, LIMITS.id)),
      evidenceCategory: feature.evidenceCategory, configuration: feature.configuration,
      qualifierText: clip(feature.qualifierText, LIMITS.qualifier), evidence: clip(feature.evidence, LIMITS.evidence),
      uncertainty: clip(feature.uncertainty, LIMITS.uncertainty),
    };
    if (out.evidenceCategory === EVIDENCE.NOT_DETERMINABLE) { note('not_determinable_dropped', out.concept); continue; }
    if (!out.evidence) { note('feature_without_evidence', out.concept); continue; }
    const dangling = out.roomIds.filter((id) => !roomById.has(id));
    if (dangling.length) { note('dangling_feature_room', `${out.concept}: ${dangling.join(',')}`); out.roomIds = out.roomIds.filter((id) => roomById.has(id)); }
    if (out.floorId && !floorIds.has(out.floorId)) { note('dangling_floor', `feature ${out.concept}`); out.floorId = ''; }
    const linked = out.roomIds.map((id) => roomById.get(id));
    // A feature can only be "printed" if one of its rooms carries printed text.
    if (out.evidenceCategory === EVIDENCE.PRINTED_LABEL && !linked.some((room) => room.printedLabel)) {
      note('printed_feature_without_labelled_room', out.concept);
      out.evidenceCategory = EVIDENCE.LAYOUT_INFERRED;
    }
    // A feature inherits the weakest configuration of the rooms that show it.
    if (out.configuration === CONFIGURATION.AS_DRAWN) {
      if (hasOptionalLanguage(out.qualifierText) || linked.some((room) => room.configuration === CONFIGURATION.OPTIONAL)) {
        note('optional_language', `feature ${out.concept}`);
        out.configuration = CONFIGURATION.OPTIONAL;
      } else if (linked.some((room) => room.configuration === CONFIGURATION.UNCLEAR)) {
        note('ambiguous_label', `feature ${out.concept}`);
        out.configuration = CONFIGURATION.UNCLEAR;
      }
    }
    features.push(out);
  }

  const counts = {
    bedroomsLabeled: Math.max(0, Math.trunc(raw.counts?.bedroomsLabeled ?? 0)),
    fullBathsBySymbol: Math.max(0, Math.trunc(raw.counts?.fullBathsBySymbol ?? 0)),
    halfBathsBySymbol: Math.max(0, Math.trunc(raw.counts?.halfBathsBySymbol ?? 0)),
    note: clip(raw.counts?.note, LIMITS.note),
  };
  const warnings = (raw.warnings || []).slice(0, LIMITS.warnings).map((w) => clip(w, LIMITS.warning)).filter(Boolean);

  return {
    extraction: { schemaVersion: raw.schemaVersion, image: { ...raw.image }, floors, rooms, relationships, features, counts, warnings },
    issues,
  };
}

// Schema check + sanitize in one step. A schema-invalid extraction is never
// sanitized into something usable: it is rejected whole.
export function acceptExtraction(raw) {
  const schemaErrors = validateSchema(raw);
  if (schemaErrors.length) return { ok: false, schemaErrors, extraction: null, issues: [] };
  const { extraction, issues } = sanitizeExtraction(raw);
  return { ok: true, schemaErrors: [], extraction, issues };
}
