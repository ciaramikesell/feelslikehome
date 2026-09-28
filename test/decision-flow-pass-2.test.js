import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { normalizePriorities, emptyHome } from '../src/lib/constants.js';
import {
  computeMatch, evaluateSearchBasics, mustHaveStatus, parseNum, weightedPrioritySummary,
} from '../src/lib/matching.js';
import { formatLotSizeDisplay, lotSizeAcres } from '../src/lib/homeDisplay.js';
import { fieldProvenance } from '../src/lib/homeProvenance.js';
import { applyOnboardingSelections, applySearchChoice, flatOnboardingSuggestions } from '../src/lib/onboarding.js';
import { basicsSummary, matchShapingPriorityCount, moveCriterion, priorityLevels } from '../src/lib/searchProfile.js';

register('./support/alias-hooks.mjs', import.meta.url);
const { saveHomePersonalAndShared, getHomesForUser } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dbRoundTrip = (value) => JSON.parse(JSON.stringify(value));

/* --------------------------- Search Basics are not Match weights --------------------------- */

test('computeMatch never scores a Search Basic at any stored tier, and leaves the stored tier untouched', () => {
  const raw = {
    searchType: 'purchase',
    budget: { value: '400000', tier: 'must' }, bedsMin: { value: '5', tier: 'must' }, bathsMin: { value: '3', tier: 'important' },
    sqftTarget: { value: '4000', tier: 'nice' }, lotSizeTarget: { value: '2', tier: 'must' },
    preferredPropertyTypes: { values: ['house'], tier: 'must' }, homeLayout: { values: ['Two Story'], tier: 'must' },
    homeCondition: { values: ['Move-In Ready'], tier: 'must' }, primaryBedroomLocation: { value: 'Main Floor', tier: 'must' },
  };
  const before = structuredClone(raw);
  const home = { price: '900000', beds: '1', baths: '1', sqft: '800', lotSize: '0.1 acres', propertyType: 'condo', homeLayout: ['Ranch / Single Story'], homeCondition: ['New Construction'], primaryBedroomLocation: 'Upstairs', checks: {} };
  assert.equal(computeMatch(home, normalizePriorities(raw)), null);
  assert.deepEqual(raw, before);
  // Adding one ranked priority produces a Match built from that priority alone.
  const withRanked = normalizePriorities({ ...raw, features: { customItems: [{ label: 'Home office', kind: 'check' }], tiers: { 'Home office': 'important' } } });
  const match = computeMatch({ ...home, checks: { 'features:Home office': true } }, withRanked);
  assert.equal(match.pct, 100);
  assert.deepEqual(match.allSelected.map((criterion) => criterion.key), ['features:Home office']);
  // …while every Basic is still reported factually, not weighted.
  assert.deepEqual(evaluateSearchBasics(home, withRanked).map(({ key, met }) => [key, met]), [
    ['budget', false], ['beds', false], ['baths', false], ['sqft', false], ['lotSize', false],
    ['preferredPropertyTypes', false], ['homeLayout', false], ['homeCondition', false], ['primaryBedroomLocation', false],
  ]);
});

test('Search Basics compare only what is filled in; Unknown is never a miss and never a number', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', budget: { value: '500,000' }, bedsMin: { value: '3' }, preferredPropertyTypes: { values: ['No Preference'] } });
  const basics = evaluateSearchBasics({ ...emptyHome(), price: 'Contact agent' }, priorities);
  assert.deepEqual(basics.map(({ key, evaluated, met }) => [key, evaluated, met]), [['budget', false, null], ['beds', false, null]]);
  for (const basic of basics) assert.doesNotMatch(`${basic.detail} ${basic.wanted}`, /NaN|undefined|\$0\b/);
});

test('parseNum treats a value with no digits as Unknown (null), never 0', () => {
  assert.equal(parseNum('Contact agent'), null);
  assert.equal(parseNum('—'), null);
  assert.equal(parseNum('.'), null);
  assert.equal(parseNum('0'), 0);
  assert.equal(parseNum('$1,250.50'), 1250.5);
});

test('lot size has one canonical reading in acres for Match-adjacent facts and display', () => {
  assert.equal(lotSizeAcres('0.22 acres'), 0.22);
  assert.equal(lotSizeAcres('0.17'), 0.17); // what a person types into Lot size
  assert.equal(Math.round(lotSizeAcres('8712 sq ft') * 100) / 100, 0.2);
  assert.equal(Math.round(lotSizeAcres('9,583 sqft') * 100) / 100, 0.22);
  assert.equal(lotSizeAcres(''), null);
  assert.equal(lotSizeAcres('unknown'), null);
  // Regression: a bare "0.17" rendered as "0 sq ft".
  assert.equal(formatLotSizeDisplay('0.17'), '0.17 acres');
  assert.equal(formatLotSizeDisplay('120 sq ft'), '120 sq ft');
  // Regression: "8712 sq ft" was compared to a 0.25-acre target as 8712 acres.
  const priorities = normalizePriorities({ searchType: 'purchase', lotSizeTarget: { value: '0.25' } });
  const lot = evaluateSearchBasics({ lotSize: '8712 sq ft' }, priorities).find((basic) => basic.key === 'lotSize');
  assert.deepEqual([lot.met, lot.detail], [false, '0.20 acres']);
});

/* ------------------------- weighted aggregate agrees with Must Haves ------------------------- */

test('All weighted priorities counts Must Haves, so it can never claim everything matches beside a missing Must Have', () => {
  const priorities = normalizePriorities({
    searchType: 'purchase',
    features: { customItems: [{ label: 'Home office', kind: 'check' }, { label: 'Central air', kind: 'check' }, { label: 'Fireplace', kind: 'check' }], tiers: { 'Home office': 'must', 'Central air': 'important', Fireplace: 'nice' } },
  });
  const match = computeMatch({ checks: { 'features:Home office': 'no', 'features:Central air': true } }, priorities);
  const summary = weightedPrioritySummary(match);
  assert.equal(mustHaveStatus(match).missed, 1);
  assert.deepEqual([summary.matches.length, summary.mismatches.length, summary.unknown.length, summary.evaluated, summary.total], [1, 1, 1, 2, 3]);
  // Unknown (Fireplace) is its own count — never a "don't match".
  assert.ok(!summary.mismatches.some((criterion) => criterion.key === 'features:Fireplace'));
  const panel = read('src/components/DetailMatchPanel.jsx');
  assert.match(panel, /const summary = weightedPrioritySummary\(match\);/);
  assert.doesNotMatch(panel, /selectHomeCardCriteria/);
});

/* ------------------------------- onboarding → My Search round trip ------------------------------- */

test('onboarding writes the same canonical search model My Search reads, through a persistence round trip', () => {
  // Step 1 — The Basics (the same patch shapes Onboarding's BasicsStep writes).
  let priorities = applySearchChoice({}, 'home_buy');
  priorities = { ...priorities, budget: { ...priorities.budget, value: '650,000' }, bedsMin: { ...priorities.bedsMin, value: '3' }, bathsMin: { ...priorities.bathsMin, value: '2.5' }, lotSizeTarget: { ...priorities.lotSizeTarget, value: '.25' }, homeLayout: { ...priorities.homeLayout, values: ['Two Story'] } };
  // Step 2 — What Matters: selection only; everything chosen starts Important.
  const offered = flatOnboardingSuggestions('home_buy');
  const chosen = offered.filter((criterion) => ['Home office', 'Fenced yard', 'Quiet street'].includes(criterion.label)).map((criterion) => `${criterion.categoryKey}:${criterion.label}`);
  assert.equal(chosen.length, 3);
  priorities = applyOnboardingSelections(priorities, chosen);
  const afterSelection = priorityLevels(priorities);
  assert.deepEqual(afterSelection.map((level) => [level.tier, level.items.length]), [['must', 0], ['important', 3], ['nice', 0]]);
  // Step 3 — Rank: one move to Must Have, one to Nice to Have.
  const item = (label) => afterSelection.flatMap((level) => level.items).find((entry) => entry.label === label);
  priorities = moveCriterion(priorities, item('Home office').categoryKey, 'Home office', 'must');
  priorities = moveCriterion(priorities, item('Quiet street').categoryKey, 'Quiet street', 'nice');

  // Saved as JSON, read back by My Search.
  const saved = normalizePriorities(dbRoundTrip(priorities));
  assert.deepEqual(priorityLevels(saved).map((level) => [level.tier, level.items.map((entry) => entry.label)]), [
    ['must', ['Home office']], ['important', ['Fenced yard']], ['nice', ['Quiet street']],
  ]);
  assert.equal(matchShapingPriorityCount(saved), 3);
  const summary = basicsSummary(saved);
  assert.deepEqual(summary.numbers, ['$650,000 maximum', '3+ bedrooms', '2.5+ bathrooms', '.25+ acres']);
  assert.doesNotMatch(JSON.stringify(summary), /NaN|undefined/);
  // A second round trip is stable (no onboarding-only transformation drifts it).
  assert.deepEqual(normalizePriorities(dbRoundTrip(saved)), saved);
  // Basics never became ranked priorities.
  assert.ok(!priorityLevels(saved).flatMap((level) => level.items).some((entry) => ['budget', 'bedsMin', 'homeLayout'].includes(entry.categoryKey)));
});

/* -------------------------- Add Home → Match → saved Home Detail round trip -------------------------- */

// Minimal in-memory Supabase: just the query shapes the home save/load path uses.
function fakeSupabase() {
  const tables = { homes: [], home_member_state: [], realtor_suggestions: [] };
  let nextId = 1;
  const keyOf = (table, row) => (table === 'home_member_state' ? `${row.home_id}|${row.user_id}` : row.id);
  function builder(table) {
    const state = { filters: [], upserted: null };
    const rows = () => tables[table].filter((row) => state.filters.every((filter) => filter(row)));
    const api = {
      upsert(row) {
        const stored = { ...row };
        if (table === 'homes' && !stored.id) stored.id = `home-${nextId++}`;
        const index = tables[table].findIndex((existing) => keyOf(table, existing) === keyOf(table, stored));
        if (index >= 0) tables[table][index] = { ...tables[table][index], ...stored };
        else tables[table].push(stored);
        state.upserted = tables[table].find((existing) => keyOf(table, existing) === keyOf(table, stored));
        return api;
      },
      select() { return api; },
      single() { return Promise.resolve({ data: structuredClone(state.upserted), error: null }); },
      eq(column, value) { state.filters.push((row) => (row[column] ?? false) === value); return api; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return api; },
      order() { return api; },
      then(resolve, reject) { return Promise.resolve({ data: structuredClone(state.upserted ? [] : rows()), error: null }).then(resolve, reject); },
    };
    return api;
  }
  return { tables, from: builder };
}

const buyerPriorities = normalizePriorities({
  searchType: 'purchase',
  budget: { value: '450000' },
  features: { customItems: [{ label: 'Home office', kind: 'check' }, { label: 'Fireplace', kind: 'check' }], tiers: { 'Home office': 'must', Fireplace: 'important' } },
  exterior: { customItems: [{ label: 'Fenced yard', kind: 'check' }], tiers: { 'Fenced yard': 'must' } },
});

test('Add Home → Personalized Match → saved Home Detail round-trips listing, provenance, and participant-owned answers', async () => {
  const supabase = fakeSupabase();
  const listingImport = { fields: { price: '439000', beds: '3', baths: '2.5', sqft: '1536', address: '26560 Acacia St, Harrison Township, MI' } };
  const added = {
    ...emptyHome(),
    listingUrl: 'https://www.zillow.com/homedetails/26560-Acacia-St/123_zpid/',
    address: '26560 Acacia St, Harrison Township, MI', price: '439000', beds: '3', baths: '2.5',
    sqft: '1600', // corrected by the participant
    propertyType: 'house', // added by the participant
    listingImport,
    // Personalized Match step: Yes / No, and Fireplace left Unknown.
    checks: { 'features:Home office': true, 'exterior:Fenced yard': 'no' },
    pros: 'Bright front room', notes: 'Ask about the roof',
  };
  const matchBefore = computeMatch(added, buyerPriorities);
  await saveHomePersonalAndShared(supabase, added, 'buyer', 'search-1');

  // Participant answers live on the participant's own row, not the shared home.
  assert.equal(supabase.tables.homes.length, 1);
  assert.equal(supabase.tables.home_member_state.length, 1);
  assert.deepEqual(supabase.tables.home_member_state[0].checks, added.checks);

  const [home] = await getHomesForUser(supabase, 'buyer', 'search-1');
  assert.equal(home.listingUrl, added.listingUrl);
  assert.deepEqual(home.checks, added.checks);
  const snapshot = home.listingImport;
  assert.deepEqual(['price', 'sqft', 'propertyType', 'lotSize'].map((field) => fieldProvenance(home[field], snapshot, field)), ['listing', 'you', 'you', 'unknown']);
  const matchAfter = computeMatch(home, buyerPriorities);
  assert.equal(matchAfter.pct, matchBefore.pct);
  assert.deepEqual(mustHaveStatus(matchAfter), mustHaveStatus(matchBefore));
  // Unknown stays neutral end to end.
  const fireplace = matchAfter.allSelected.find((criterion) => criterion.key === 'features:Fireplace');
  assert.deepEqual([fireplace.evaluated, fireplace.met], [false, null]);
  assert.equal(weightedPrioritySummary(matchAfter).mismatches.length, 1);
  // Search Basics are reported as facts, never weighted.
  assert.deepEqual(evaluateSearchBasics(home, buyerPriorities).map(({ key, met }) => [key, met]), [['budget', true]]);
});

test('editing a home preserves provenance and every participant’s own answers', async () => {
  const supabase = fakeSupabase();
  const listingImport = { fields: { price: '439000', beds: '3' } };
  await saveHomePersonalAndShared(supabase, { ...emptyHome(), listingUrl: 'https://example.com/listing/1', address: '1 Main St', price: '439000', beds: '3', listingImport, checks: { 'features:Home office': true } }, 'buyer', 'search-1');
  const [saved] = await getHomesForUser(supabase, 'buyer', 'search-1');
  // A co-buyer's own answers for the same shared home.
  supabase.tables.home_member_state.push({ home_id: saved.id, user_id: 'cobuyer', status: 'Saved', ratings: {}, checks: { 'features:Home office': 'no' } });

  // Edit Home: correct the price (a shared fact) and answer one more criterion.
  await saveHomePersonalAndShared(supabase, { ...saved, price: '429000', checks: { ...saved.checks, 'exterior:Fenced yard': true } }, 'buyer', 'search-1');
  const [edited] = await getHomesForUser(supabase, 'buyer', 'search-1');
  assert.equal(supabase.tables.homes.length, 1); // edited in place, never duplicated
  assert.equal(edited.listingUrl, 'https://example.com/listing/1');
  assert.equal(fieldProvenance(edited.price, edited.listingImport, 'price'), 'you');
  assert.equal(fieldProvenance(edited.beds, edited.listingImport, 'beds'), 'listing');
  assert.deepEqual(edited.checks, { 'features:Home office': true, 'exterior:Fenced yard': true });
  const cobuyer = supabase.tables.home_member_state.find((row) => row.user_id === 'cobuyer');
  assert.deepEqual(cobuyer.checks, { 'features:Home office': 'no' });
});

test('the live Add/Edit Home editor records Home type and rental facts (they were only in dead code before)', () => {
  const modal = read('src/components/HomeModal.jsx');
  assert.doesNotMatch(modal, /function PropertyFacts/);
  assert.match(modal, /<select id="home-property-type" className="hh-input" value=\{form\.propertyType \?\? ''\}/);
  assert.match(modal, /ProvenanceTag provenance=\{provenanceOf\('propertyType'\)\}/);
  assert.match(modal, /\{showsRentalFacts && <section className="flh-rental-facts"/);
  // No Basics tier drives a MUST badge any more.
  assert.doesNotMatch(modal, /must=\{priorities\.\w+\?\.tier === 'must'\}/);
});

/* ------------------------------------ Postgres parity ------------------------------------ */

function latestDefinition(name) {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const file = readdirSync(dir).filter((entry) => entry.endsWith('.sql')).sort()
    .filter((entry) => readFileSync(new URL(entry, dir), 'utf8').includes(`create or replace function public.${name}(`)).at(-1);
  const sql = readFileSync(new URL(file, dir), 'utf8');
  const start = sql.indexOf(`create or replace function public.${name}(`);
  return { file, body: sql.slice(start, sql.indexOf('$$;', start)) };
}

test('the Postgres co-buyer Match no longer scores Search Basics and matches the JS retired-criteria list', () => {
  const { file, body } = latestDefinition('resolve_cobuyer_compare_perspectives');
  // Whichever migration defines it last must keep Search Basics out of Match.
  assert.ok(file >= '2026-09-28-search-basics-unweighted.sql', file);
  for (const basic of ["'budget'", "'bedsMin'", "'homeLayout'", "'primaryBedroomLocation'", "'{preferredPropertyTypes,tier}'"]) assert.ok(!body.includes(basic), basic);
  const sqlRetired = new Set(body.match(/v_key = any\(array\[([\s\S]*?)\]\) then continue/)[1].match(/'[^']+'/g).map((entry) => entry.slice(1, -1)));
  const constants = read('src/lib/constants.js');
  const jsRetired = new Set(constants.match(/const RETIRED_PURCHASE_BUILT_INS = new Set\(\[([\s\S]*?)\]\);/)[1].match(/'[^']+'/g).map((entry) => entry.slice(1, -1)));
  assert.deepEqual([...sqlRetired].sort(), [...jsRetired].sort());
  assert.ok(!sqlRetired.has('exterior:Garage'));
});

test('shared-fact awareness treats a Basic as selected when it is filled in, not by a leftover tier', () => {
  const { file, body } = latestDefinition('resolve_shared_fact_priority_awareness');
  assert.equal(file, '2026-09-28-search-basics-unweighted.sql');
  assert.doesNotMatch(body, /\{(budget|bedsMin|bathsMin|sqftTarget|lotSizeTarget|homeLayout|homeCondition|preferredPropertyTypes),tier\}/);
  assert.match(body, /when 'homeLayout' then exists \(select 1 from jsonb_array_elements_text/);
  const migration = read('supabase/migrations/2026-09-28-search-basics-unweighted.sql');
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /grant execute on function public\.resolve_cobuyer_compare_perspectives\(uuid, uuid\[\]\) to authenticated;/);
  assert.match(migration, /revoke execute on function public\.resolve_cobuyer_compare_perspectives\(uuid, uuid\[\]\) from anon;/);
});

/* ------------------------------------ Account ------------------------------------ */

test('Account is a hub of implemented destinations and never assumes an active buyer search', () => {
  const account = read('src/components/AccountSettings.jsx');
  assert.match(account, /searchSummary \? \(/);
  assert.match(account, /No active home search/);
  assert.match(account, /title="Profile details"/);
  assert.doesNotMatch(account, /Notifications|Privacy and data|Delete account/i);
});
