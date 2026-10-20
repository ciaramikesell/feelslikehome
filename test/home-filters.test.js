import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePriorities, getItemlistCategories } from '../src/lib/constants.js';
import { computeMatch, selectPriorityItem } from '../src/lib/matching.js';
import {
  EMPTY_HOME_FILTERS, SHOW_CONFIRMED, SHOW_POSSIBLE, applyHomeFilters, buildConditions, classifyHome, filterableCriteria,
  homeFactReaders, homeFiltersStorageKey, normalizeHomeFilters, parseThreshold, possibleMatchNote,
  readStoredHomeFilters, writeStoredHomeFilters,
} from '../src/lib/homeFilters.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function select(priorities, categoryKey, label, tier, kind = 'check', extra = {}) {
  const def = getItemlistCategories(priorities.searchType).find((category) => category.key === categoryKey);
  return { ...priorities, [categoryKey]: selectPriorityItem(priorities[categoryKey], def, { label, kind, ...extra }, tier) };
}

// A buyer whose My Search asks for 1,800 sq ft and 0.5 acres (Must Haves), with
// a fenced yard, a custom "First-floor guest suite", and a few more criteria.
let buyer = normalizePriorities({
  searchType: 'purchase',
  budget: { value: '400000', tier: 'must' },
  sqftTarget: { value: '1800', tier: 'must' },
  lotSizeTarget: { value: '0.5', tier: 'important' },
  bedsMin: { value: '4', tier: 'important' },
});
buyer = select(buyer, 'exterior', 'Fenced yard', 'important');
buyer = select(buyer, 'features', 'First-floor guest suite', 'nice', 'check', { source: 'custom' });
buyer = select(buyer, 'features', 'Finished basement', 'nice');
buyer = select(buyer, 'exterior', 'Garage', 'nice');
const criteria = filterableCriteria(buyer);
const evaluate = (home) => computeMatch(home, buyer);
const ids = (list) => list.map((home) => home.id);
const deepFreeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

const FENCED = 'exterior:Fenced yard';
const SUITE = 'features:First-floor guest suite';

// The product vision: ≥ 1,200 sq ft, ≥ 0.2 acres, fenced yard, first-floor guest suite.
const vision = { sqftMin: '1,200', lotMinAcres: '0.2', criteria: [FENCED, SUITE] };

const homes = deepFreeze([
  { id: 'confirmed', price: '389000', sqft: '1,450', lotSize: '0.25 acres', beds: '3', baths: '2', propertyType: 'house', checks: { [FENCED]: true, [SUITE]: true } },
  { id: 'sqft-lot', price: '410000', sqft: '1300', lotSize: '8850 sq ft', beds: '3', baths: '2', propertyType: 'house', checks: { [FENCED]: true, [SUITE]: true } },
  { id: 'fence-unknown', price: '375000', sqft: '1600', lotSize: '1 acre', beds: '4', baths: '2.5', propertyType: 'house', checks: { [SUITE]: true } },
  { id: 'fence-legacy-false', price: '375000', sqft: '1600', lotSize: '0.3 acres', beds: '4', baths: '2', propertyType: 'house', checks: { [FENCED]: false, [SUITE]: true } },
  { id: 'fence-no', price: '365000', sqft: '2000', lotSize: '0.4 acres', beds: '4', baths: '3', propertyType: 'house', checks: { [FENCED]: 'no', [SUITE]: true } },
  { id: 'small', price: '299000', sqft: '1199', lotSize: '0.5 acres', beds: '2', baths: '1', propertyType: 'condo', checks: { [FENCED]: true, [SUITE]: true } },
  { id: 'lot-unitless', price: '350000', sqft: '1500', lotSize: '8712', beds: '3', baths: '2', propertyType: 'townhome', checks: { [FENCED]: true, [SUITE]: true } },
  { id: 'sparse', price: '', sqft: '', lotSize: '', beds: '', baths: '', propertyType: null, checks: {} },
]);

/* ------------------------------- the vision query ------------------------------- */

test('the product question: ≥1,200 sq ft, ≥0.2 acres, fenced yard, first-floor guest suite', () => {
  const result = applyHomeFilters(homes, vision, evaluate, { criteria });
  const status = Object.fromEntries(homes.map((home) => [home.id, result.byId.get(home.id).status]));
  assert.deepEqual(status, {
    confirmed: 'confirmed',
    'sqft-lot': 'confirmed', // 8850 sq ft = 0.203 acres ≥ 0.2
    'fence-unknown': 'possible',
    'fence-legacy-false': 'possible', // historical false is Unknown, never No
    'fence-no': 'excluded',
    small: 'excluded', // 1,199 < 1,200
    'lot-unitless': 'possible', // 8712 has no unit — never guessed at
    sparse: 'possible',
  });
  assert.deepEqual(result.counts, { total: 8, confirmed: 2, possible: 4, excluded: 2 });
  assert.deepEqual(ids(result.visible), ['confirmed', 'sqft-lot', 'fence-unknown', 'fence-legacy-false', 'lot-unitless', 'sparse']);
  assert.deepEqual(ids(applyHomeFilters(homes, { ...vision, show: SHOW_CONFIRMED }, evaluate, { criteria }).visible), ['confirmed', 'sqft-lot']);
});

test('a possible match explains exactly what is unknown', () => {
  const result = applyHomeFilters(homes, vision, evaluate, { criteria });
  assert.equal(possibleMatchNote(result.byId.get('fence-unknown')), 'Fenced Yard not confirmed');
  assert.equal(possibleMatchNote(result.byId.get('lot-unitless')), 'Lot size unit not recorded');
  assert.equal(possibleMatchNote(result.byId.get('sparse')), 'Square footage not added · Lot size not added · +2 more');
  assert.equal(possibleMatchNote(result.byId.get('confirmed')), null);
  assert.deepEqual(result.byId.get('fence-no').failed, ['Fenced Yard: no']);
  assert.deepEqual(result.byId.get('small').failed, ['Sq ft 1,199 is below 1,200']);
});

/* ------------------------------ thresholds & boundaries ------------------------------ */

test('numeric thresholds are inclusive at both ends', () => {
  const at = (filters, home) => classifyHome(home, buildConditions(filters), evaluate).status;
  const home = { id: 'h', price: '400000', sqft: '1200', lotSize: '0.2 acres', beds: '3', baths: '2.5' };
  assert.equal(at({ priceMax: '400000' }, home), 'confirmed');
  assert.equal(at({ priceMax: '399999' }, home), 'excluded');
  assert.equal(at({ priceMin: '400,000' }, home), 'confirmed');
  assert.equal(at({ priceMin: '$400,001' }, home), 'excluded');
  assert.equal(at({ sqftMin: '1200', sqftMax: '1200' }, home), 'confirmed');
  assert.equal(at({ sqftMin: '1201' }, home), 'excluded');
  assert.equal(at({ lotMinAcres: '0.2' }, home), 'confirmed');
  assert.equal(at({ lotMinAcres: '.21' }, home), 'excluded');
  assert.equal(at({ bedsMin: '3' }, home), 'confirmed');
  assert.equal(at({ bedsMin: '4' }, home), 'excluded');
  assert.equal(at({ bathsMin: '2.5' }, home), 'confirmed');
  assert.equal(at({ bathsMin: '3' }, home), 'excluded');
});

test('min above max matches nothing that is known, and says so in the sheet', () => {
  const result = applyHomeFilters(homes, { priceMin: '500000', priceMax: '300000' }, evaluate);
  assert.equal(result.counts.confirmed, 0);
  assert.deepEqual(ids(result.visible), ['sparse']); // only the home with no price
  assert.match(read('src/components/HomeFiltersSheet.jsx'), /minimum is above the maximum/);
});

test('lot size: square feet, acres, commas, hectares and unknown units all read through lotSizeAcres', () => {
  const at = (lotSize) => classifyHome({ id: 'x', lotSize }, buildConditions({ lotMinAcres: '0.2' }), evaluate).status;
  assert.equal(at('8712 sq ft'), 'confirmed'); // exactly 0.2 acres
  assert.equal(at('8,711 sq ft'), 'excluded');
  assert.equal(at('0.2 acres'), 'confirmed');
  assert.equal(at('0.19 ac'), 'excluded');
  assert.equal(at('1 hectare'), 'confirmed');
  assert.equal(at('8712'), 'possible'); // unitless legacy value
  assert.equal(at('0.25'), 'possible'); // unitless, even if it looks like acres
  assert.equal(at('about a quarter acre'), 'possible');
  assert.equal(at('0 acres'), 'possible');
  assert.equal(at(''), 'possible');
  assert.equal(at(null), 'possible');
});

/* ------------------------------ unknown and malformed ------------------------------ */

test('stored facts are read strictly: malformed, empty and zero price/sqft are Unknown, never 0', () => {
  assert.equal(homeFactReaders.price({ price: '$450,000' }), 450000);
  assert.equal(homeFactReaders.price({ price: 'Call for price' }), null);
  assert.equal(homeFactReaders.price({ price: '450-500k' }), null);
  assert.equal(homeFactReaders.price({ price: '0' }), null);
  assert.equal(homeFactReaders.price({ price: '' }), null);
  assert.equal(homeFactReaders.price({}), null);
  assert.equal(homeFactReaders.sqft({ sqft: '1,832 sq ft' }), 1832);
  assert.equal(homeFactReaders.sqft({ sqft: '1.832,5' }), null);
  assert.equal(homeFactReaders.sqft({ sqft: '0' }), null);
  // A count of 0 is real (a studio); text is not.
  assert.equal(homeFactReaders.beds({ beds: '0' }), 0);
  assert.equal(homeFactReaders.beds({ beds: 'Studio' }), null);
  assert.equal(homeFactReaders.baths({ baths: '2.5' }), 2.5);
  assert.equal(homeFactReaders.baths({ baths: '2 full, 1 half' }), null);
  assert.equal(homeFactReaders.propertyType({ propertyType: 'castle' }), null);
  assert.equal(homeFactReaders.propertyType({ propertyType: 'other' }), 'other');
  // A max-price filter never treats unreadable text as a $0 bargain.
  assert.equal(classifyHome({ id: 'x', price: 'TBD' }, buildConditions({ priceMax: '300000' }), evaluate).status, 'possible');
  assert.equal(classifyHome({ id: 'x', beds: '0' }, buildConditions({ bedsMin: '1' }), evaluate).status, 'excluded');
});

test('typed thresholds: blank is off, malformed and zero are not filters', () => {
  assert.deepEqual(parseThreshold(''), { state: 'empty', value: null });
  assert.deepEqual(parseThreshold('  '), { state: 'empty', value: null });
  assert.deepEqual(parseThreshold('1,200'), { state: 'ok', value: 1200 });
  assert.deepEqual(parseThreshold('.2'), { state: 'ok', value: 0.2 });
  assert.deepEqual(parseThreshold('$350,000'), { state: 'ok', value: 350000 });
  assert.deepEqual(parseThreshold('0'), { state: 'zero', value: null });
  assert.deepEqual(parseThreshold('-5'), { state: 'invalid', value: null });
  assert.deepEqual(parseThreshold('abc'), { state: 'invalid', value: null });
  assert.deepEqual(parseThreshold('0,2'), { state: 'invalid', value: null });
  assert.equal(buildConditions({ sqftMin: 'abc', bedsMin: '0', lotMinAcres: '' }).length, 0);
});

/* --------------------------------- personal criteria --------------------------------- */

test('personal criteria are the buyer’s own My Search criteria, including custom ones, minus structured facts', () => {
  // Match's own order (category, then the buyer's order), with display labels.
  assert.deepEqual(criteria, [
    { key: SUITE, label: 'First-floor guest suite' },
    { key: 'features:Finished basement', label: 'Finished Basement' },
    { key: FENCED, label: 'Fenced Yard' },
    { key: 'exterior:Garage', label: 'Garage' },
  ]);
  const keys = new Set(criteria.map((criterion) => criterion.key));
  assert.ok(keys.has(SUITE), 'custom criterion offered');
  for (const structured of ['budget', 'sqft', 'lotSize', 'beds', 'baths', 'preferredPropertyTypes']) assert.ok(!keys.has(structured), structured);
  // Removing a criterion from My Search makes a remembered filter on it inert.
  const conditions = buildConditions({ criteria: ['features:Pool'] }, { criteria });
  assert.equal(conditions.length, 0);
});

test('Garage reads the canonical garageSpaces fact, exactly as Match does — never the old checkbox', () => {
  const conditions = buildConditions({ criteria: ['exterior:Garage'] }, { criteria });
  const at = (home) => classifyHome(home, conditions, evaluate).status;
  assert.equal(at({ id: 'a', garageSpaces: '2', checks: {} }), 'confirmed');
  assert.equal(at({ id: 'b', garageSpaces: '0', checks: { 'exterior:Garage': true } }), 'excluded');
  assert.equal(at({ id: 'c', garageSpaces: '', checks: { 'exterior:Garage': true } }), 'possible');
});

test('nothing is inferred: bedrooms never imply a guest suite, lot size never implies a fence', () => {
  const big = { id: 'big', beds: '6', lotSize: '3 acres', checks: {} };
  const result = classifyHome(big, buildConditions({ criteria: [FENCED, SUITE] }, { criteria }), evaluate);
  assert.equal(result.status, 'possible');
  assert.deepEqual(result.unknown, ['Fenced Yard not confirmed', 'First-floor guest suite not confirmed']);
});

test('legacy label aliases fold exactly as in Match ("Fenced Yard" answered before the taxonomy unification)', () => {
  const home = { id: 'legacy', checks: { 'exterior:Fenced Yard': 'no' } };
  assert.equal(classifyHome(home, buildConditions({ criteria: [FENCED] }, { criteria }), evaluate).status, 'excluded');
});

test('rental shared facts (Pets Allowed) read the shared field, and a neutral tour response is not a yes or a no', () => {
  let renter = normalizePriorities({ searchType: 'rental' });
  renter = select(renter, 'features', 'Pets Allowed', 'must');
  renter = select(renter, 'homeFeel', 'Natural Light', 'important', 'rating');
  const renterCriteria = filterableCriteria(renter);
  const evalRenter = (home) => computeMatch(home, renter);
  const conditions = buildConditions({ criteria: ['features:Pets Allowed', 'homeFeel:Natural Light'] }, { criteria: renterCriteria, rental: true });
  const at = (home) => classifyHome(home, conditions, evalRenter);
  assert.equal(at({ id: 'a', petsAllowed: true, ratings: { 'homeFeel:Natural Light': 'positive' } }).status, 'confirmed');
  assert.equal(at({ id: 'b', petsAllowed: false, ratings: { 'homeFeel:Natural Light': 'positive' } }).status, 'excluded');
  const neutral = at({ id: 'c', petsAllowed: true, ratings: { 'homeFeel:Natural Light': 'neutral' } });
  assert.equal(neutral.status, 'possible');
  assert.deepEqual(neutral.unknown, ['Natural Light rated “Fine”']);
  assert.equal(at({ id: 'd', petsAllowed: null, ratings: {} }).status, 'possible');
  // Rental price filter reads monthly rent and says so.
  assert.equal(buildConditions({ priceMax: '2500' }, { rental: true })[0].label, 'Rent Up to $2,500');
});

/* --------------------------------- co-buyer separation --------------------------------- */

test('each participant filters by their own answers; a co-buyer’s Yes never substitutes for mine', () => {
  // getHomesForUser overlays ONLY the caller's home_member_state checks onto the
  // shared home; the same shared row therefore arrives with different answers.
  const shared = { id: 'h1', sqft: '1500', lotSize: '0.3 acres' };
  const mine = { ...shared, checks: {} }; // I haven't answered
  const theirs = { ...shared, checks: { [FENCED]: true } }; // my co-buyer said Yes
  const conditions = buildConditions({ criteria: [FENCED] }, { criteria });
  assert.equal(classifyHome(mine, conditions, evaluate).status, 'possible');
  assert.equal(classifyHome(theirs, conditions, evaluate).status, 'confirmed');
  // The filter reads home.checks through computeMatch only; it has no other
  // path to anyone's answers, and the board never loads a co-buyer's checks.
  const code = read('src/lib/homeFilters.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /coBuyer|home_member_state|\.checks\b/);
  const layout = read('src/app/(app)/homes/(board)/layout.js');
  assert.match(layout, /getHomesForUser\(supabase, user\.id, search\.id\)/);
});

/* ----------------------------------- read-only safety ----------------------------------- */

test('filtering is read-only: homes, priorities and Match results are unchanged', () => {
  const frozenPriorities = deepFreeze(structuredClone(buyer));
  const before = homes.map((home) => JSON.stringify(computeMatch(home, frozenPriorities)));
  const evalFrozen = (home) => computeMatch(home, frozenPriorities);
  // deepFreeze above makes any write throw in strict-mode ES modules.
  applyHomeFilters(homes, { ...vision, priceMax: '1', bedsMin: '9', propertyTypes: ['condo'] }, evalFrozen, { criteria: filterableCriteria(frozenPriorities) });
  assert.deepEqual(homes.map((home) => JSON.stringify(computeMatch(home, frozenPriorities))), before);
  // A 1,200 sq ft filter never touches the stored 1,800 sq ft target or its tier.
  assert.equal(frozenPriorities.sqftTarget.value, '1800');
  assert.equal(frozenPriorities.sqftTarget.tier, 'must');
});

test('the filter modules never write: no Supabase, no save helpers, no storage beyond sessionStorage', () => {
  for (const path of ['src/lib/homeFilters.js', 'src/components/HomeFiltersSheet.jsx']) {
    const source = read(path);
    assert.doesNotMatch(source, /supabase|saveHome|upsert|\.update\(|\.insert\(|\.rpc\(|localStorage|fetch\(/, path);
  }
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /readStoredHomeFilters\(typeof window === 'undefined' \? null : window\.sessionStorage, searchId\)/);
  // Matching, lot size and Match scoring are untouched by this feature.
  assert.doesNotMatch(read('src/lib/matching.js'), /homeFilters/);
});

/* ------------------------------- combining & ordering ------------------------------- */

test('conditions combine with AND, and the incoming (sorted) order is kept', () => {
  const reversed = [...homes].reverse();
  const result = applyHomeFilters(reversed, { priceMax: '400000', propertyTypes: ['house', 'townhome'], bathsMin: '2' }, evaluate);
  assert.deepEqual(ids(result.visible), ['sparse', 'lot-unitless', 'fence-no', 'fence-legacy-false', 'fence-unknown', 'confirmed']);
  assert.equal(result.byId.get('sqft-lot').status, 'excluded'); // $410k
  assert.equal(result.byId.get('small').status, 'excluded'); // condo, 1 bath
});

test('no active filters: every home is shown, nothing is classified as excluded', () => {
  const result = applyHomeFilters(homes, EMPTY_HOME_FILTERS, evaluate, { criteria });
  assert.equal(result.active, false);
  assert.equal(result.visible.length, homes.length);
  assert.equal(result.counts.excluded, 0);
});

test('zero results are possible and clearing returns every home', () => {
  const none = applyHomeFilters(homes, { priceMin: '1000000', show: SHOW_CONFIRMED }, evaluate);
  assert.equal(none.visible.length, 0);
  assert.equal(none.counts.possible, 1); // the home with no price might
  const cleared = applyHomeFilters(homes, normalizeHomeFilters({}), evaluate);
  assert.equal(cleared.visible.length, homes.length);
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /No \{vocabulary\.pluralLower\} meet every filter yet/);
  assert.match(board, /Show possible matches/);
  assert.match(board, /Adjust filters/);
  assert.match(board, /onClick=\{clearAllFilters\}/);
});

test('a large collection (500 homes) filters quickly and evaluates each home at most once', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    id: `h${i}`, price: String(250000 + i * 1000), sqft: String(900 + i * 3), lotSize: i % 3 ? `${8000 + i * 10} sq ft` : `${(i % 7) / 10} acres`,
    beds: String(2 + (i % 4)), baths: String(1 + (i % 3)), propertyType: i % 5 ? 'house' : 'condo', checks: i % 2 ? { [FENCED]: true } : i % 3 ? { [FENCED]: 'no' } : {},
  }));
  let calls = 0;
  const cache = new Map();
  const counted = (home) => { if (!cache.has(home)) { calls += 1; cache.set(home, computeMatch(home, buyer)); } return cache.get(home); };
  const started = performance.now();
  const result = applyHomeFilters(many, { ...vision, priceMax: '600000' }, counted, { criteria });
  const elapsed = performance.now() - started;
  assert.equal(result.counts.total, 500);
  assert.equal(result.counts.confirmed + result.counts.possible + result.counts.excluded, 500);
  assert.equal(calls, 500);
  assert.ok(elapsed < 1000, `took ${elapsed}ms`);
});

/* ----------------------------------- normalization & memory ----------------------------------- */

test('stored filters are normalized: unknown keys, bad types and removed criteria are dropped', () => {
  const f = normalizeHomeFilters({ priceMin: 300000, sqftMin: { x: 1 }, propertyTypes: ['house', 'castle', 'house'], criteria: [FENCED, 'features:Pool', 7], show: 'everything', evil: true }, criteria.map((c) => c.key));
  assert.deepEqual(f, { ...EMPTY_HOME_FILTERS, priceMin: '300000', propertyTypes: ['house'], criteria: [FENCED], show: SHOW_POSSIBLE });
});

test('session memory: per search, survives a round trip, empty filters remove the entry, failures are harmless', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  writeStoredHomeFilters(storage, 's1', vision);
  assert.ok(store.has(homeFiltersStorageKey('s1')));
  assert.deepEqual(readStoredHomeFilters(storage, 's1'), normalizeHomeFilters(vision));
  assert.deepEqual(readStoredHomeFilters(storage, 's2'), { ...EMPTY_HOME_FILTERS });
  writeStoredHomeFilters(storage, 's1', EMPTY_HOME_FILTERS);
  assert.ok(!store.has(homeFiltersStorageKey('s1')));
  store.set(homeFiltersStorageKey('s3'), '{not json');
  assert.deepEqual(readStoredHomeFilters(storage, 's3'), { ...EMPTY_HOME_FILTERS });
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.deepEqual(readStoredHomeFilters(throwing, 's1'), { ...EMPTY_HOME_FILTERS });
  assert.doesNotThrow(() => writeStoredHomeFilters(throwing, 's1', vision));
  assert.deepEqual(readStoredHomeFilters(null, 's1'), { ...EMPTY_HOME_FILTERS });
});

/* ------------------------------------------ UI contract ------------------------------------------ */

test('My Homes: a Filter action, live counts, removable pills, both display modes, and existing cards kept', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /className=\{`hh-filter-open/);
  assert.match(board, /aria-haspopup="dialog"/);
  assert.match(board, /confirmed<\/strong>/);
  assert.match(board, /Remove filter: \$\{condition\.label\}/);
  assert.match(board, /Confirmed only/);
  assert.match(board, /Confirmed \+ possible/);
  // Filters only ever narrow the active My Homes list; Want to Tour, Favorites
  // and Archive keep their own unfiltered lists.
  assert.match(board, /applyHomeFilters\(quickFiltered, mode === 'homes' \? homeFilters : EMPTY_HOME_FILTERS/);
  assert.match(board, /if \(mode !== 'homes'\) return baseList;\n    return sortContenders\(refinement\.visible, sortBy, evaluate\);/);
  // The same HomeCard renders every home (actions, Notes, navigation unchanged).
  assert.match(board, /filterResult=\{filterResults\?\.get\(h\.id\) \|\| null\}/);
  assert.match(board, /Possible match<\/span> \{possibleMatchNote\(filterResult\)\}/);
  const sheet = read('src/components/HomeFiltersSheet.jsx');
  assert.match(sheet, /<Sheet open=\{open\}/);
  assert.match(sheet, /role="radiogroup"/);
  assert.match(sheet, /aria-pressed=\{on\}/);
  assert.match(sheet, /htmlFor=\{id\}/);
  assert.match(sheet, /they don’t change My Search, your priorities, or any Match score/);
  assert.match(sheet, /never as a No/);
});

test('responsive presentation: phone bottom sheet, iPad panel, desktop side panel, 44px touch targets, 16px inputs on phones', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /@media \(min-width: 1121px\) \{\n  \.hh-sheet-backdrop:has\(> \.hh-refine-sheet\) \{ justify-content: flex-end;/);
  assert.match(css, /@media \(pointer: coarse\) \{\n  \.hh-refine-sheet \.hh-refine-chip, \.hh-refine-sheet \.hh-refine-segment, \.hh-refine-sheet \.hh-sheet-close,/);
  assert.match(css, /\.hh-refine-input input \{ font-size: 16px; \} \/\* no iOS focus zoom \*\//);
});
