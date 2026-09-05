// Pure normalization for Geocodio's "school" data append. No network calls live
// here — see src/app/api/import-listing/route.js for the (server-only) fetch.
//
// Geocodio has changed this field's shape before (a flat array of district
// objects vs. a nested object keyed by level — "elementary"/"secondary"/
// "unified" — confirmed by their own client library's changelog handling both
// formats), so this reads defensively rather than assuming one shape.
//
// This returns a single plain district NAME STRING only — never a rating, score,
// or quality judgment. A property can technically span multiple district
// entries (elementary vs. secondary); we surface one representative name rather
// than a breakdown, since the product goal is one simple fact, not a report.
export function normalizeSchoolDistrict(geocodioResponse) {
  const fields = geocodioResponse?.results?.[0]?.fields;
  if (!fields) return null;

  const raw = fields.school_districts || fields.school;
  if (!raw) return null;

  const hasName = (e) => e && typeof e.name === 'string' && e.name.trim();

  if (Array.isArray(raw)) {
    const first = raw.find(hasName);
    return first ? first.name.trim() : null;
  }

  if (typeof raw === 'object') {
    // Prefer "unified" since it names one district covering all grade levels;
    // otherwise fall back to whichever entry is actually present.
    if (hasName(raw.unified)) return raw.unified.name.trim();
    if (hasName(raw.elementary)) return raw.elementary.name.trim();
    if (hasName(raw.secondary)) return raw.secondary.name.trim();
    const first = Object.values(raw).find(hasName);
    return first ? first.name.trim() : null;
  }

  return null;
}
