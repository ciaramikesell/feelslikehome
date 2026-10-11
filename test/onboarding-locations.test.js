// Onboarding V2, Step 2 (Where are you looking?). Areas of interest live on the
// participant's own preferences document; Places That Matter are their own
// commute destinations, saved without a maximum drive time. Neither creates a
// Must-Have or changes Match. The step is only reachable in the inactive flow 3.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { CURRENT_ONBOARDING_VERSION, onboardingProgress, onboardingStepsFor } from '../src/lib/onboardingFlow.js';
import {
  AREA_TYPES, MAX_SEARCH_AREAS, addSearchArea, classifyAreaType, hasSearchArea, normalizeSearchAreas,
  removeSearchArea, searchAreasOf, toAreaResults,
} from '../src/lib/searchAreas.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const area = (placeId, type = 'city', name = placeId) => ({ placeId, name, secondary: 'Michigan, USA', type });

test('provider place types map to the four area types, and nothing else is relabelled', () => {
  assert.equal(classifyAreaType(['locality', 'political']), 'city');
  assert.equal(classifyAreaType(['postal_town']), 'city');
  assert.equal(classifyAreaType(['neighborhood', 'political']), 'neighborhood');
  assert.equal(classifyAreaType(['sublocality_level_1', 'sublocality']), 'neighborhood');
  assert.equal(classifyAreaType(['postal_code']), 'zip');
  assert.equal(classifyAreaType(['school_district']), 'school_district');
  for (const types of [['route'], ['administrative_area_level_2'], ['establishment'], [], undefined]) {
    assert.equal(classifyAreaType(types), null, JSON.stringify(types));
  }
  assert.deepEqual(Object.keys(AREA_TYPES), ['city', 'neighborhood', 'school_district', 'zip']);
});

test('suggestions keep the provider id and label; unclassifiable predictions are dropped', () => {
  const results = toAreaResults([
    { placeId: 'a', types: ['locality'], mainText: { text: 'Grosse Pointe' }, secondaryText: { text: 'MI, USA' } },
    { placeId: 'b', types: ['route'], mainText: { text: 'Kercheval Ave' } },
    { placeId: 'c', types: ['postal_code'], mainText: { text: '48230' } },
    { types: ['locality'], mainText: { text: 'No id' } },
  ]);
  assert.deepEqual(results.map((result) => [result.placeId, result.type, result.name]), [['a', 'city', 'Grosse Pointe'], ['c', 'zip', '48230']]);
  assert.ok(results.every((result) => result.source === 'google_places'));
});

test('areas are added once, removed by id, and leave every other preference untouched', () => {
  const base = normalizePriorities({ budget: { value: '500000', tier: 'must' } });
  let priorities = addSearchArea(base, area('gp'));
  priorities = addSearchArea(priorities, area('district', 'school_district'));
  priorities = addSearchArea(priorities, area('gp'));
  assert.deepEqual(searchAreasOf(priorities).map((entry) => entry.placeId), ['gp', 'district']);
  assert.equal(hasSearchArea(priorities, 'district'), true);
  priorities = removeSearchArea(priorities, 'gp');
  assert.deepEqual(searchAreasOf(priorities).map((entry) => entry.placeId), ['district']);
  const { searchAreas, ...rest } = priorities;
  assert.deepEqual(rest, base);
  // Unknown/invalid stored entries are cleaned and the list is bounded.
  const stored = [area('x'), area('x'), { placeId: 'y', name: 'Y', type: 'county' }, null, ...Array.from({ length: 30 }, (_, i) => area(`n${i}`))];
  const clean = normalizeSearchAreas(stored);
  assert.equal(clean.length, MAX_SEARCH_AREAS);
  assert.equal(new Set(clean.map((entry) => entry.placeId)).size, clean.length);
  assert.equal(addSearchArea({ searchAreas: clean }, area('extra')).searchAreas.length, MAX_SEARCH_AREAS);
});

test('areas survive the preferences round trip and never change Match', () => {
  const home = { beds: 3, baths: 2, sqft: 1800, price: 450000, address: '1 Main St, Detroit, MI' };
  const base = normalizePriorities({ searchType: 'purchase', bedsMin: { value: '3', tier: 'must' } });
  const withAreas = addSearchArea(addSearchArea(base, area('gp')), area('48230', 'zip'));
  const reloaded = normalizePriorities(JSON.parse(JSON.stringify(withAreas)));
  assert.deepEqual(searchAreasOf(reloaded).map((entry) => entry.placeId), ['gp', '48230']);
  assert.deepEqual(computeMatch(home, reloaded), computeMatch(home, base));
});

test('Step 2 exists only in the inactive approved flow; the live flow is unchanged', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  assert.deepEqual(onboardingStepsFor(3, {}), ['basics', 'locations', 'collaboration', 'priorities', 'rank', 'review']);
  const progress = onboardingProgress(3, { completed: ['basics'] }, 'locations');
  assert.equal(progress.position, 2);
  assert.equal(progress.total, 6);
});

test('Step 2 copy, persistence wiring and no-requirement guarantees', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const step = read('src/components/onboarding/LocationsStep.jsx');
  assert.match(onboarding, /title=\{<>Where are you <em>looking\?<\/em><\/>\}/);
  assert.match(onboarding, /lead="Every search starts somewhere\. Add the areas you’re drawn to, and we’ll keep them in mind as you explore\."|lead="Every search starts somewhere\. Add the areas you're drawn to, and we'll keep them in mind as you explore\."/);
  // Places are saved without a maximum drive time, so no commute requirement is created.
  assert.match(onboarding, /createCommuteDestination\(createClient\(\), searchId, userId, \{ \.\.\.place, maxDriveMinutes: null \}\)/);
  // A place appears only after its write resolves.
  assert.match(onboarding, /const saved = await services\.createPlace\(searchId, userId, place\);\s*setPlaces/);
  assert.match(onboarding, /await services\.deletePlace\(place\.id\);\s*setPlaces/);
  assert.match(step, /placeholder=\{full \? `You’ve added \$\{MAX_SEARCH_AREAS\} areas` : 'City, neighborhood, district, or ZIP'\}/);
  assert.match(step, /Places add helpful distance context\. They won’t become hard requirements\./);
  assert.match(step, /Start with any area/);
  assert.match(step, /City and school district selections can be added independently\./);
  assert.doesNotMatch(step, /maxDriveMinutes|max_drive|tiers?\b|'must'|"must"/);
  // Area results come only from the provider; the provider owns no sample data.
  assert.doesNotMatch(read('src/lib/areaSearchProvider.js'), /Grosse|preview/i);
});

test('Step 2 styles are scoped to onboarding', () => {
  const css = read('src/app/globals.css');
  const block = css.slice(css.indexOf('/* ── Onboarding V2 — Step 2'));
  assert.ok(block.length > 100);
  for (const selector of block.match(/^[^@\s/}][^{]*\{/gm) || []) {
    assert.match(selector, /\.flh-onboarding-root|\.flh-ob-/, `unscoped selector: ${selector}`);
  }
});

/* ------------------------------ real Postgres ------------------------------ */

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createCommuteDestination, createInvitation, deleteCommuteDestination, getCommuteDestinations,
  resolvePriorities, savePriorities,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

async function household(tag) {
  const owner = db.createUser({ email: `owner.${tag}@example.com` });
  const coBuyer = db.createUser({ email: `cobuyer.${tag}@example.com` });
  const search = { id: db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id, user_id: owner };
  const invitation = await createInvitation(db.clientFor(owner), search.id, owner, `cobuyer.${tag}@example.com`, 'co_buyer');
  const accepted = await acceptInvitation(db.clientFor(coBuyer), invitation.token);
  assert.equal(accepted.success, true);
  return { owner, coBuyer, search };
}

dbTest('a co-buyer’s areas are saved on their own preferences only', async () => {
  const { owner, coBuyer, search } = await household('areas');
  const ownerPrefs = addSearchArea(normalizePriorities({}), area('owner-area'));
  await savePriorities(db.clientFor(owner), search, owner, ownerPrefs);
  const coPrefs = addSearchArea(normalizePriorities({}), area('co-area', 'school_district'));
  await savePriorities(db.clientFor(coBuyer), search, coBuyer, coPrefs);
  const reloadedCo = normalizePriorities(await resolvePriorities(db.clientFor(coBuyer), search, coBuyer));
  const reloadedOwner = normalizePriorities(await resolvePriorities(db.clientFor(owner), search, owner));
  assert.deepEqual(searchAreasOf(reloadedCo).map((entry) => entry.placeId), ['co-area']);
  assert.deepEqual(searchAreasOf(reloadedOwner).map((entry) => entry.placeId), ['owner-area']);
  // The owner cannot write the co-buyer's document.
  await assert.rejects(savePriorities(db.clientFor(owner), search, coBuyer, addSearchArea(normalizePriorities({}), area('intruder'))));
  const after = normalizePriorities(await resolvePriorities(db.clientFor(coBuyer), search, coBuyer));
  assert.deepEqual(searchAreasOf(after).map((entry) => entry.placeId), ['co-area']);
});

dbTest('places are saved per person without a drive-time limit, and stay private to their owner’s writes', async () => {
  const { owner, coBuyer, search } = await household('places');
  const place = await createCommuteDestination(db.clientFor(coBuyer), search.id, coBuyer, { label: 'Work', address: '500 Woodward Ave, Detroit, MI', maxDriveMinutes: null });
  assert.equal(place.maxDriveMinutes, null);
  assert.deepEqual((await getCommuteDestinations(db.clientFor(coBuyer), search.id, coBuyer)).map((entry) => entry.label), ['Work']);
  assert.deepEqual(await getCommuteDestinations(db.clientFor(owner), search.id, owner), []);
  // Nobody can create a place for someone else.
  await assert.rejects(createCommuteDestination(db.clientFor(owner), search.id, coBuyer, { label: 'Family', address: '1 Main St', maxDriveMinutes: null }));
  // Another person's delete leaves the row in place.
  await deleteCommuteDestination(db.clientFor(owner), place.id);
  assert.equal(db.admin(`select count(*)::int as n from public.commute_destinations where id = '${place.id}'`)[0].n, 1);
  await deleteCommuteDestination(db.clientFor(coBuyer), place.id);
  assert.equal(db.admin(`select count(*)::int as n from public.commute_destinations where id = '${place.id}'`)[0].n, 0);
});
