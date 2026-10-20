// Filter My Homes: a temporary, read-only way to narrow the homes a buyer has
// ALREADY saved. It is not listing discovery, not My Search, and not a score.
//
// Every condition reads one canonical source and answers Yes / No / Unknown:
//
//   Price, square feet      homes.price / homes.sqft (shared Home Facts, text).
//                           Read strictly: "$450,000" is 450000; "", "Call",
//                           "450-500k" and 0 are Unknown, never 0.
//   Lot size (acres)        homes.lot_size through lotSizeAcres — the same unit
//                           grammar Match uses, so "8850 sq ft" is 0.203 acres
//                           and a saved bare number (no unit) stays Unknown.
//   Bedrooms, bathrooms     homes.beds / homes.baths. 0 is a real count (a studio).
//   Property type           homes.property_type (null is Unknown; 'other' is known).
//   Personal criteria       the participant's OWN per-home answers, exactly as
//                           computeMatch reads them (evaluate(home).allSelected):
//                           their home_member_state checks/ratings, legacy label
//                           aliases folded, Garage from garageSpaces, rental
//                           shared facts (Pets Allowed …) from the shared field.
//                           A co-buyer's answers are never on `home` (see
//                           getHomesForUser), so they can never stand in.
//
// The typed thresholds are independent of My Search: a 1,200 sq ft filter never
// reads or changes the stored 1,800 sq ft target, its tier, or any Match weight.
// The structured My Search targets (budget, sqft, lot size, beds, baths,
// preferred property type) are therefore NOT offered again as personal
// criteria — the standard filters above are their one canonical home here.
//
// Conditions combine with AND. A home is
//   confirmed  every condition is a known Yes,
//   possible   none is a known No, but at least one is Unknown (or a neutral
//              tour response, which is neither a yes nor a no),
//   excluded   at least one condition is a known No.
// Unknown is never treated as No.

import { computeMatch, criterionLabel } from './matching.js';
import { lotSizeAcres, isUnitlessLotSize } from './lotSize.js';
import { PROPERTY_TYPE_LABELS, HOME_PROPERTY_TYPE_OPTIONS } from './searchIntent.js';

export const SHOW_CONFIRMED = 'confirmed';
export const SHOW_POSSIBLE = 'possible';

export const EMPTY_HOME_FILTERS = Object.freeze({
  priceMin: '', priceMax: '', sqftMin: '', sqftMax: '', lotMinAcres: '', bedsMin: '', bathsMin: '',
  propertyTypes: Object.freeze([]), criteria: Object.freeze([]), show: SHOW_POSSIBLE,
});

const NUMERIC_KEYS = ['priceMin', 'priceMax', 'sqftMin', 'sqftMax', 'lotMinAcres', 'bedsMin', 'bathsMin'];

export const BEDS_OPTIONS = Object.freeze(['1', '2', '3', '4', '5']);
export const BATHS_OPTIONS = Object.freeze(['1', '1.5', '2', '2.5', '3', '4']);
export const PROPERTY_TYPE_OPTIONS = HOME_PROPERTY_TYPE_OPTIONS;
export const propertyTypeFilterLabel = (value) => PROPERTY_TYPE_LABELS[value] || value;

/* --------------------------------- numbers --------------------------------- */

// "1,200", "$450,000", " 0.2 " → number. Anything else (text, ranges, several
// dots, a European decimal comma, negatives) → null.
const NUMBER = /^\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/;

function strictNumber(raw, { unit = null } = {}) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  let text = String(raw).trim();
  if (unit) text = text.replace(unit, '').trim();
  const match = text.match(NUMBER);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

// A typed threshold. Blank is "no filter"; a positive number is a filter; zero
// and malformed text are not filters (the sheet says why).
export function parseThreshold(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { state: 'empty', value: null };
  const value = strictNumber(raw);
  if (value === null) return { state: 'invalid', value: null };
  if (value <= 0) return { state: 'zero', value: null };
  return { state: 'ok', value };
}

const SQFT_UNIT = /\s*(?:sq\.?\s*ft\.?|sqft|sf|square\s*f(?:ee|oo)t)$/i;

// Stored Home Facts read for filtering. A price or floor area of 0 is not a
// real value (a placeholder at best), so it is Unknown; a count of 0 is real.
export const homeFactReaders = Object.freeze({
  price: (home) => { const n = strictNumber(home?.price); return n && n > 0 ? n : null; },
  sqft: (home) => { const n = strictNumber(home?.sqft, { unit: SQFT_UNIT }); return n && n > 0 ? n : null; },
  lotAcres: (home) => lotSizeAcres(home?.lotSize),
  beds: (home) => strictNumber(home?.beds),
  baths: (home) => strictNumber(home?.baths),
  propertyType: (home) => (HOME_PROPERTY_TYPE_OPTIONS.includes(home?.propertyType) ? home.propertyType : null),
});

/* ------------------------------ personal criteria ----------------------------- */

// My Search targets with a structured Home Fact: covered by the standard
// filters, so never offered twice.
const STRUCTURED_MATCH_KEYS = new Set(['budget', 'sqft', 'lotSize', 'beds', 'baths', 'preferredPropertyTypes']);

// The participant's own selected My Search criteria (built-in and custom), in
// Match's order, that can be used as filters. Derived from computeMatch itself so
// the list is exactly what Match tracks — a criterion removed from My Search
// disappears here too.
export function filterableCriteria(priorities) {
  const match = computeMatch({ checks: {}, ratings: {} }, priorities);
  return (match?.allSelected || [])
    .filter((criterion) => !STRUCTURED_MATCH_KEYS.has(criterion.key))
    .map((criterion) => ({ key: criterion.key, label: criterionLabel(criterion) }));
}

/* ------------------------------- normalization ------------------------------- */

export function normalizeHomeFilters(raw, availableCriteriaKeys = null) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = { ...EMPTY_HOME_FILTERS };
  NUMERIC_KEYS.forEach((key) => { out[key] = typeof source[key] === 'string' || typeof source[key] === 'number' ? String(source[key]) : ''; });
  out.propertyTypes = Array.isArray(source.propertyTypes) ? [...new Set(source.propertyTypes.filter((value) => HOME_PROPERTY_TYPE_OPTIONS.includes(value)))] : [];
  const allowed = availableCriteriaKeys ? new Set(availableCriteriaKeys) : null;
  out.criteria = Array.isArray(source.criteria)
    ? [...new Set(source.criteria.filter((key) => typeof key === 'string' && (!allowed || allowed.has(key))))]
    : [];
  out.show = source.show === SHOW_CONFIRMED ? SHOW_CONFIRMED : SHOW_POSSIBLE;
  return out;
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const plain = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const acresText = (n) => `${plain(n)} ${n === 1 ? 'acre' : 'acres'}`;

/* -------------------------------- conditions -------------------------------- */

const yes = () => ({ state: 'yes' });
const no = (reason) => ({ state: 'no', reason });
const unknown = (reason) => ({ state: 'unknown', reason });

// One condition per active filter: { key, label, test(home, match) }.
// `vocabulary` only changes words (Rent vs Price, property vs home).
export function buildConditions(filters, { criteria = [], rental = false } = {}) {
  const f = normalizeHomeFilters(filters);
  const conditions = [];
  const priceWord = rental ? 'Rent' : 'Price';
  const range = (key, label, read, min, max, format, unknownReason) => {
    if (min === null && max === null) return;
    const text = min !== null && max !== null ? `${format(min)}–${format(max)}` : min !== null ? `${format(min)}+` : `up to ${format(max)}`;
    conditions.push({
      key, label: `${label} ${text}`,
      test: (home) => {
        const value = read(home);
        if (value === null) return unknown(unknownReason(home));
        if (min !== null && value < min) return no(`${label} ${format(value)} is below ${format(min)}`);
        if (max !== null && value > max) return no(`${label} ${format(value)} is above ${format(max)}`);
        return yes();
      },
    });
  };
  const value = (key) => parseThreshold(f[key]).value;

  range('price', priceWord, homeFactReaders.price, value('priceMin'), value('priceMax'), money, () => `${priceWord} not added`);
  range('sqft', 'Sq ft', homeFactReaders.sqft, value('sqftMin'), value('sqftMax'), plain, () => 'Square footage not added');
  range('lot', 'Lot', homeFactReaders.lotAcres, value('lotMinAcres'), null, acresText,
    (home) => (isUnitlessLotSize(home?.lotSize) ? 'Lot size unit not recorded' : String(home?.lotSize ?? '').trim() ? 'Lot size not readable' : 'Lot size not added'));
  range('beds', 'Beds', homeFactReaders.beds, value('bedsMin'), null, plain, () => 'Bedrooms not added');
  range('baths', 'Baths', homeFactReaders.baths, value('bathsMin'), null, plain, () => 'Bathrooms not added');

  if (f.propertyTypes.length) {
    const wanted = new Set(f.propertyTypes);
    conditions.push({
      key: 'propertyType', label: f.propertyTypes.map(propertyTypeFilterLabel).join(' or '),
      test: (home) => {
        const type = homeFactReaders.propertyType(home);
        if (!type) return unknown('Property type not added');
        return wanted.has(type) ? yes() : no(`Property type is ${propertyTypeFilterLabel(type)}`);
      },
    });
  }

  const labels = new Map(criteria.map((criterion) => [criterion.key, criterion.label]));
  f.criteria.forEach((key) => {
    const label = labels.get(key);
    if (!label) return; // no longer in My Search: ignored, never guessed at
    conditions.push({
      key: `criterion:${key}`, label,
      test: (home, match) => {
        const criterion = match?.allSelected?.find((candidate) => candidate.key === key);
        if (!criterion || !criterion.evaluated) return unknown(`${label} not confirmed`);
        if (criterion.met === true) return yes();
        if (criterion.met === false) return no(`${label}: no`);
        return unknown(criterion.detail ? `${label} rated “${criterion.detail}”` : `${label} is neutral`);
      },
    });
  });
  return conditions;
}

export function activeHomeFilterCount(filters, criteria = []) {
  return buildConditions(filters, { criteria }).length;
}

// Confirmed / Possible / Excluded for one home, with the reasons a buyer reads.
export function classifyHome(home, conditions, evaluate) {
  if (!conditions.length) return { status: 'confirmed', unknown: [], failed: [] };
  const match = conditions.some((condition) => condition.key.startsWith('criterion:')) ? evaluate(home) : null;
  const unknownReasons = [];
  const failed = [];
  conditions.forEach((condition) => {
    const result = condition.test(home, match);
    if (result.state === 'no') failed.push(result.reason);
    else if (result.state === 'unknown') unknownReasons.push(result.reason);
  });
  const status = failed.length ? 'excluded' : unknownReasons.length ? 'possible' : 'confirmed';
  return { status, unknown: unknownReasons, failed };
}

// Classifies every home and returns the visible list in the incoming order (the
// buyer's chosen sort is kept — filtering never re-ranks).
export function applyHomeFilters(homes, filters, evaluate, options = {}) {
  const f = normalizeHomeFilters(filters);
  const conditions = buildConditions(f, options);
  const byId = new Map();
  const counts = { total: homes.length, confirmed: 0, possible: 0, excluded: 0 };
  homes.forEach((home) => {
    const result = classifyHome(home, conditions, evaluate);
    byId.set(home.id, result);
    counts[result.status] += 1;
  });
  const visible = conditions.length
    ? homes.filter((home) => {
      const { status } = byId.get(home.id);
      return status === 'confirmed' || (f.show === SHOW_POSSIBLE && status === 'possible');
    })
    : homes;
  return { active: conditions.length > 0, conditions, visible, counts, byId, show: f.show };
}

// "Fenced yard not confirmed · Lot size unit not recorded" (at most `limit`).
export function possibleMatchNote(result, limit = 2) {
  if (!result || result.status !== 'possible') return null;
  const shown = result.unknown.slice(0, limit);
  const more = result.unknown.length - shown.length;
  return `${shown.join(' · ')}${more > 0 ? ` · +${more} more` : ''}`;
}

/* ------------------------------ session memory ------------------------------ */

// Filters last for the browser session only (per search), so moving between
// My Homes, Want to Tour and back keeps them, and a new session starts clean.
// Never stored in the database. Storage failures simply forget.
export const homeFiltersStorageKey = (searchId) => `flh-home-filters:${searchId || 'default'}`;

export function readStoredHomeFilters(storage, searchId) {
  try {
    const raw = storage?.getItem(homeFiltersStorageKey(searchId));
    return raw ? normalizeHomeFilters(JSON.parse(raw)) : { ...EMPTY_HOME_FILTERS };
  } catch {
    return { ...EMPTY_HOME_FILTERS };
  }
}

export function writeStoredHomeFilters(storage, searchId, filters) {
  try {
    const f = normalizeHomeFilters(filters);
    const isEmpty = NUMERIC_KEYS.every((key) => !f[key]) && !f.propertyTypes.length && !f.criteria.length && f.show === SHOW_POSSIBLE;
    if (isEmpty) storage?.removeItem(homeFiltersStorageKey(searchId));
    else storage?.setItem(homeFiltersStorageKey(searchId), JSON.stringify(f));
  } catch { /* private mode or quota: filters just aren't remembered */ }
}
