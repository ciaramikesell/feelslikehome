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

const plainText = (address) => String(address || '').trim().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether two addresses name the same property: equal strict identities, or
 * (when either can't be identified strictly) the same text. An unknown target
 * (a link FLH can't read an address from) is never the same property.
 */
export function sameProperty(a, b) {
  if (!plainText(a) || !plainText(b)) return false;
  const [ka, kb] = [propertyAddressKey(a), propertyAddressKey(b)];
  if (ka && kb) return ka === kb;
  return plainText(a) === plainText(b);
}

// Fields that identify the draft or belong to the search, not the property's
// details; never counted as something the buyer entered for a property.
const IDENTITY_FIELDS = new Set(['id', 'address', 'listingUrl', 'status', 'propertyType', 'latitude', 'longitude', 'coordinateAddressFingerprint', 'coordinateStatus', 'coordinateSource']);
const OWN_GROUPS = new Set(['notes', 'pros', 'cons', 'photoUrl', 'checks', 'ratings']);

/**
 * What the buyer put into this unsaved draft for its property, by kind, in
 * display order: 'notes' (notes, pros, cons), 'photo', 'answers' (Match
 * answers or ratings), 'listing' (pasted listing text, or shared facts added
 * from it) and 'details' (any other field the buyer typed or changed). A
 * field still holding what a lookup or paste wrote (`applied`), or what an
 * added fact wrote, is not the buyer's.
 */
export function draftBuyerContent({ form = {}, applied = {}, usedFacts = {}, photoStaged = false, pasteText = '' } = {}) {
  const blank = emptyHome();
  const kinds = [];
  if (['notes', 'pros', 'cons'].some((key) => String(form?.[key] || '').trim())) kinds.push('notes');
  if (photoStaged || String(form?.photoUrl || '').trim()) kinds.push('photo');
  if (Object.keys(form?.checks || {}).length || Object.values(form?.ratings || {}).some(Boolean)) kinds.push('answers');
  const factFields = new Set(Object.values(usedFacts || {}).map((fact) => fact?.field).filter(Boolean));
  if (String(pasteText || '').trim() || factFields.size) kinds.push('listing');
  const edited = Object.keys(form || {}).some((key) => !IDENTITY_FIELDS.has(key) && !OWN_GROUPS.has(key) && !factFields.has(key)
    && !same(form[key], key in (applied || {}) ? applied[key] : (key in blank ? blank[key] : undefined)));
  if (edited) kinds.push('details');
  return kinds;
}

const CONTENT_LABELS = { notes: 'notes', photo: 'photo', answers: 'Match answers', listing: 'pasted listing details', details: 'details you edited' };
/** "notes, photo and Match answers" */
export function draftContentPhrase(kinds = []) {
  const labels = kinds.map((kind) => CONTENT_LABELS[kind]).filter(Boolean);
  return labels.length <= 1 ? (labels[0] || '') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/**
 * What a Find does to the unsaved draft:
 * - 'keep': no property yet, or the same property (another link or spelling
 *   for it). Everything, including the buyer's answers, stays.
 * - 'fresh': a different property and nothing the buyer entered; start a
 *   fresh draft (nothing from the previous property can be saved on this one).
 * - 'confirm': a different property and the draft holds the buyer's own
 *   content; ask before starting fresh.
 * `target` is null when the new input names no address FLH can read.
 */
export function findSwitchPlan(currentAddress, target, content = []) {
  if (!String(currentAddress || '').trim()) return 'keep';
  if (target && sameProperty(currentAddress, target)) return 'keep';
  return content.length ? 'confirm' : 'fresh';
}

/**
 * A fresh new-home draft: nothing from the previous property, not even its
 * partial-save id (that row stays the previous property's own home). Only
 * what belongs to the search carries over: the stage and, for an apartment
 * search, the apartment property type.
 */
export function freshDraft(previous = {}, { apartment = false } = {}) {
  return {
    ...emptyHome(),
    status: previous?.status || emptyHome().status,
    propertyType: apartment && previous?.propertyType === 'apartment' ? 'apartment' : null,
  };
}
