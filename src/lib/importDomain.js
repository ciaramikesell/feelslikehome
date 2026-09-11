/**
 * Source-neutral, ephemeral import findings. Findings and resolutions are returned
 * to the client for the current Add Home session; they are never persisted.
 *
 * @typedef {'authoritative'|'explicit'|'candidate'|'forbidden'} EvidenceStrength
 * @typedef {{id:string, concept:string, value:unknown, unit:string|null,
 * sourceType:string, sourceProvider:string, evidence:string,
 * evidenceStrength:EvidenceStrength, observedAt:string|null}} ImportFinding
 */

export const EVIDENCE_STRENGTH = Object.freeze({
  AUTHORITATIVE: 'authoritative',
  EXPLICIT: 'explicit',
  CANDIDATE: 'candidate',
  FORBIDDEN: 'forbidden',
});

// Adding an extractor never grants permission to update a form field. In
// particular, conditionNotes and all personal ratings/checks are absent here.
export const IMPORT_DESTINATIONS = Object.freeze([
  'listingUrl', 'address', 'price', 'beds', 'baths', 'sqft', 'lotSize',
  'yearBuilt', 'propertyType', 'garageSpaces', 'daysOnMarket', 'homeLayout',
  'primaryBedroomLocation', 'secondaryBedroomLocation', 'availableOn',
  'petsAllowed', 'utilitiesIncluded', 'inUnitLaundry', 'photoUrl',
  'hoaFeeMonthly', 'propertyTaxAnnual', 'propertyTaxYear', 'latitude', 'longitude',
  // Option fields are legal destinations only for a future explicitly-scoped
  // floor-plan/unit adapter. Community RentCast normalization never emits them.
  'selectedFloorPlanName', 'selectedUnitLabel', 'floorPlanImageUrl',
]);

const DESTINATIONS = new Set(IMPORT_DESTINATIONS);
const CANONICAL_PROPERTY_TYPES = new Set(['apartment', 'house', 'townhome', 'condo', 'multifamily', 'other']);

export function isImportCandidate(value) {
  return value !== null && value !== undefined && value !== '';
}

export function isEmptyImportTarget(value) {
  return value === null || value === undefined || value === '';
}

export function normalizeImportValue(concept, value) {
  if (!isImportCandidate(value)) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (concept === 'propertyType') {
    const type = trimmed.toLowerCase();
    return CANONICAL_PROPERTY_TYPES.has(type) ? type : null;
  }
  if (['listingUrl', 'photoUrl'].includes(concept)) {
    try {
      const url = new URL(trimmed);
      return /^https?:$/.test(url.protocol) ? url.toString() : null;
    } catch { return null; }
  }
  return trimmed;
}

function comparable(value) {
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) return `number:${Number(value)}`;
  return `${typeof value}:${JSON.stringify(value)}`;
}

function stableId(parts) {
  const input = parts.join('|');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `finding-${(hash >>> 0).toString(36)}`;
}

export function createFinding({ concept, value, unit = null, sourceType, sourceProvider, evidence = '', evidenceStrength = EVIDENCE_STRENGTH.EXPLICIT, observedAt = null }) {
  if (!DESTINATIONS.has(concept)) return null;
  const normalized = normalizeImportValue(concept, value);
  if (!isImportCandidate(normalized)) return null;
  return {
    id: stableId([concept, comparable(normalized), unit || '', sourceType || '', sourceProvider || '']),
    concept, value: normalized, unit, sourceType, sourceProvider,
    evidence: String(evidence).slice(0, 240), evidenceStrength, observedAt,
  };
}

export function findingsFromFields(fields, source = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  return Object.entries(fields).map(([concept, value]) => createFinding({
    concept, value,
    sourceType: source.sourceType || 'structured_listing',
    sourceProvider: source.sourceProvider || 'unknown',
    evidence: source.evidence?.[concept] || concept,
    evidenceStrength: source.evidenceStrength || EVIDENCE_STRENGTH.EXPLICIT,
    observedAt: source.observedAt || null,
  })).filter(Boolean);
}

export function resolveFindings(findings = [], currentValues = {}) {
  const grouped = new Map();
  findings.filter(Boolean).forEach((finding) => {
    if (!DESTINATIONS.has(finding.concept)) return;
    if (![EVIDENCE_STRENGTH.AUTHORITATIVE, EVIDENCE_STRENGTH.EXPLICIT].includes(finding.evidenceStrength)) return;
    const list = grouped.get(finding.concept) || [];
    list.push(finding);
    grouped.set(finding.concept, list);
  });

  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([concept, group]) => {
    if (!isEmptyImportTarget(currentValues[concept])) {
      return { concept, status: 'user_value', value: currentValues[concept], winningFindingIds: [], conflictFindingIds: group.map((f) => f.id) };
    }
    const values = new Map();
    group.forEach((finding) => {
      const key = comparable(finding.value);
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(finding);
    });
    if (values.size > 1) {
      return { concept, status: 'conflict', value: null, winningFindingIds: [], conflictFindingIds: group.map((f) => f.id) };
    }
    const winners = [...values.values()][0];
    return { concept, status: winners.length > 1 ? 'corroborated' : 'resolved', value: winners[0].value, winningFindingIds: winners.map((f) => f.id), conflictFindingIds: [] };
  });
}

export function fieldPatchFromResolutions(resolutions = []) {
  return Object.fromEntries(resolutions
    .filter((r) => (r.status === 'resolved' || r.status === 'corroborated') && DESTINATIONS.has(r.concept) && isImportCandidate(r.value))
    .map((r) => [r.concept, r.value]));
}

/** Merge an import patch into empty fields. Existing values, including false/0,
 * always win. Applying the same patch repeatedly is therefore idempotent. */
export function mergeImportFields(current = {}, patch = {}) {
  const next = { ...current };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (DESTINATIONS.has(key) && isImportCandidate(value) && isEmptyImportTarget(next[key])) next[key] = value;
  });
  return next;
}

export function resolveImport(findings = [], currentValues = {}) {
  const resolutions = resolveFindings(findings, currentValues);
  return { findings, resolutions, fieldPatch: fieldPatchFromResolutions(resolutions) };
}
