// Areas of interest (Onboarding V2, Step 2: "Where are you looking?").
//
// Stored on the participant's own search-preferences document
// (search_member_priorities.priorities.searchAreas), so each buyer's areas are
// their own and follow the same RLS as every other preference. They are
// alternatives — a home in ANY of them fits — and they are context only: no
// Must-Have, no Match criterion and no penalty is created from them.

export const AREA_TYPES = Object.freeze({
  city: 'City',
  neighborhood: 'Neighborhood',
  school_district: 'School district',
  zip: 'ZIP code',
});

export const MAX_SEARCH_AREAS = 20;

// Provider place types → FLH area type. Anything else (streets, businesses,
// counties, states) is not offered: it is never silently relabelled as a city.
export function classifyAreaType(types = []) {
  const list = Array.isArray(types) ? types : [];
  if (list.includes('school_district')) return 'school_district';
  if (list.includes('postal_code')) return 'zip';
  if (list.includes('neighborhood') || list.some((type) => /^sublocality/.test(type))) return 'neighborhood';
  if (list.includes('locality') || list.includes('postal_town')) return 'city';
  return null;
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function normalizeArea(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const placeId = text(raw.placeId, 300);
  const name = text(raw.name, 120);
  const type = Object.hasOwn(AREA_TYPES, raw.type) ? raw.type : null;
  if (!placeId || !name || !type) return null;
  return { placeId, name, secondary: text(raw.secondary, 200), type, source: 'google_places' };
}

// Always a clean, de-duplicated, bounded list, whatever is stored.
export function normalizeSearchAreas(raw) {
  const seen = new Set();
  const areas = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const area = normalizeArea(entry);
    if (!area || seen.has(area.placeId)) continue;
    seen.add(area.placeId);
    areas.push(area);
    if (areas.length >= MAX_SEARCH_AREAS) break;
  }
  return areas;
}

export function searchAreasOf(priorities) {
  return normalizeSearchAreas(priorities?.searchAreas);
}

export function hasSearchArea(priorities, placeId) {
  return searchAreasOf(priorities).some((area) => area.placeId === placeId);
}

// Returns a new priorities document; every other preference is untouched.
export function addSearchArea(priorities, area) {
  const current = searchAreasOf(priorities);
  const next = normalizeArea(area);
  if (!next || current.some((entry) => entry.placeId === next.placeId) || current.length >= MAX_SEARCH_AREAS) {
    return { ...priorities, searchAreas: current };
  }
  return { ...priorities, searchAreas: [...current, next] };
}

export function removeSearchArea(priorities, placeId) {
  return { ...priorities, searchAreas: searchAreasOf(priorities).filter((area) => area.placeId !== placeId) };
}

// Provider suggestions → displayable results. Unclassifiable predictions are
// dropped rather than reinterpreted.
export function toAreaResults(predictions = []) {
  return predictions
    .map((prediction) => {
      const type = classifyAreaType(prediction?.types);
      const name = prediction?.mainText?.text || prediction?.text?.text || '';
      if (!type || !prediction?.placeId || !name) return null;
      return { placeId: prediction.placeId, name, secondary: prediction?.secondaryText?.text || '', type, source: 'google_places' };
    })
    .filter(Boolean);
}
