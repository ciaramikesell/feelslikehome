// Where a property fact on a home came from — derived only from data FLH actually
// stores, never guessed:
//
//  - The importer's snapshot of what the listing supplied is persisted on the home
//    (homes.listing_import, see the listing-import-provenance migration; in Add Home
//    it is the in-memory import result before it is saved).
//  - The importer only ever FILLS EMPTY fields (mergeImportFields), so a current
//    value equal to the snapshot's value came from the listing, and any other
//    non-empty value was entered or corrected by a person.
//  - An empty value is Unknown — neutral, never a "No".
//
// When a home has no import snapshot at all (added manually, or before the
// snapshot existed), a filled value's origin is genuinely unknown, so no
// provenance is claimed for it (null) rather than inventing one.

export const PROVENANCE_LABELS = Object.freeze({ listing: 'From listing', you: 'Added by you', unknown: 'Unknown' });

const isEmpty = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  || (Array.isArray(value) && value.length === 0);

function normalize(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).sort().join('|');
  const text = String(value).trim();
  const numeric = text.replace(/[$,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(numeric) ? String(Number(numeric)) : text.toLowerCase();
}

export function fieldProvenance(value, importSnapshot, field) {
  if (isEmpty(value)) return 'unknown';
  const fields = importSnapshot?.fields;
  if (!fields || typeof fields !== 'object') return null;
  const imported = fields[field];
  if (!isEmpty(imported) && normalize(imported) === normalize(value)) return 'listing';
  return 'you';
}

export function hasImportSnapshot(importSnapshot) {
  return !!(importSnapshot?.fields && typeof importSnapshot.fields === 'object' && Object.keys(importSnapshot.fields).length);
}
