// Add Home V3, phase 4 (docs/add-home-v3-lookup-efficiency.md): keeping
// property lookups cheap and keeping two properties' data apart. Pure helpers
// for HomeModal and the import route; nothing here makes a request or stores
// anything outside the caller.

import { emptyHome } from './constants.js';
import { propertyAddressKey } from './rentcast.js';

// Network lookups one Add Home session may make before the buyer is asked to
// add the home by address instead (each lookup is 2 RentCast requests).
export const SESSION_LOOKUP_LIMIT = 8;
// After the provider or FLH says "busy" (HTTP 429), no request for this long.
export const BUSY_COOLDOWN_MS = 60 * 1000;

/**
 * The session cache key for a lookup: the listing kind plus the property's
 * strict address identity. An address FLH can't identify strictly keys on its
 * exact normalized text, so two different addresses never share a result.
 */
export function lookupCacheKey(address, mode = 'sale') {
  const kind = mode === 'apartment' || mode === 'rental' ? mode : 'sale';
  const key = propertyAddressKey(address);
  return `${kind}|${key ? `addr:${key}` : `text:${String(address || '').trim().replace(/\s+/g, ' ').toLowerCase()}`}`;
}

/**
 * A home this search already holds at exactly this property address (strict
 * identity; see propertyAddressKey), or null. A lookup for it would only fetch
 * what the saved home already has.
 */
export function findHomeByAddress(homes = [], address) {
  const key = propertyAddressKey(address);
  if (!key) return null;
  return (homes || []).find((home) => home?.id && propertyAddressKey(home.address) === key) || null;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields a merge wrote: { field: value } for every field `after` changed. */
export function appliedImportFields(before = {}, after = {}) {
  return Object.fromEntries(Object.keys(after || {}).filter((key) => !same(before?.[key], after[key])).map((key) => [key, after[key]]));
}

/**
 * Take back what an earlier lookup or paste wrote, before another property's
 * data arrives: each field still holding exactly the value it was given goes
 * back to its empty default. A field the buyer changed since is theirs and is
 * kept. Returns the new form and the fields cleared.
 */
export function revertAppliedFields(form = {}, applied = {}) {
  const blank = emptyHome();
  const next = { ...form };
  const cleared = [];
  for (const [key, value] of Object.entries(applied || {})) {
    if (!same(form?.[key], value)) continue;
    next[key] = key in blank ? blank[key] : null;
    cleared.push(key);
  }
  return { form: next, cleared };
}
