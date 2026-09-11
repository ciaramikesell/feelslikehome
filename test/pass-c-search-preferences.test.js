import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CANONICAL_SEARCH_INTENT_OPTIONS, PROPERTY_TYPE_LABELS,
  PURCHASE_PROPERTY_TYPE_OPTIONS, RENTAL_PROPERTY_TYPE_OPTIONS,
  prioritiesForExplicitSave,
} from '../src/lib/searchIntent.js';
import { defaultPriorities, getItemlistCategories, normalizePriorities, TIER_META } from '../src/lib/constants.js';
import { computeMatch, splitCategoryItems } from '../src/lib/matching.js';

const labels = (intent, category) => {
  const def = getItemlistCategories(intent).find(({ key }) => key === category);
  return [...def.coreItems, ...def.suggestedItems].map(({ label }) => label);
};

test('new-user intents and property type options are exact canonical sets', () => {
  assert.deepEqual(CANONICAL_SEARCH_INTENT_OPTIONS, [
    { key: 'purchase', label: 'Purchase' },
    { key: 'rental', label: 'Rental' },
    { key: 'investment', label: 'Investment Property' },
  ]);
  assert.deepEqual(PURCHASE_PROPERTY_TYPE_OPTIONS.map((key) => PROPERTY_TYPE_LABELS[key]), ['House', 'Condo', 'Townhome', 'Multifamily']);
  assert.deepEqual(RENTAL_PROPERTY_TYPE_OPTIONS.map((key) => PROPERTY_TYPE_LABELS[key]), ['Apartment', 'House', 'Townhome', 'Condo']);
});

test('explicit save canonicalizes only intent and preserves the complete document', () => {
  const raw = { searchType: 'rent_apartment', preferredPropertyTypes: { values: ['apartment', 'condo'], tier: 'must', extra: true }, location: { tiers: { Commute: 'nice' } }, unknown: { keep: 1 } };
  const before = structuredClone(raw);
  const saved = prioritiesForExplicitSave(raw);
  assert.deepEqual(raw, before);
  assert.equal(saved.searchType, 'rental');
  assert.deepEqual({ ...saved, searchType: raw.searchType }, raw);
});

test('preferred property type is optional and follows unknown/satisfied/mismatch weighted Match semantics', () => {
  const empty = normalizePriorities({ searchType: 'rental' });
  assert.equal(computeMatch({ propertyType: 'house' }, empty), null);

  const priorities = normalizePriorities({ searchType: 'rental', preferredPropertyTypes: { values: ['apartment', 'condo'], tier: 'must' } });
  const unknown = computeMatch({ propertyType: null }, priorities);
  assert.equal(unknown.pct, null);
  assert.equal(unknown.allSelected[0].evaluated, false);
  const overlap = computeMatch({ propertyType: 'condo' }, priorities);
  assert.equal(overlap.pct, 100);
  const mismatch = computeMatch({ propertyType: 'house' }, priorities);
  assert.equal(mismatch.pct, 0);
  assert.equal(mismatch.missing[0].key, 'preferredPropertyTypes');
  assert.equal(TIER_META.must.weight, 4);
});

test('canonical Rental has one duplicate-free approved suggestion bank', () => {
  const categories = getItemlistCategories('rental');
  const all = categories.flatMap((def) => [...def.coreItems, ...def.suggestedItems].map((item) => `${def.key}:${item.label}`));
  assert.equal(new Set(all).size, all.length);
  for (const required of ['Neighborhood', 'Walkability', 'Dog Parks Nearby', 'Groceries Nearby']) assert.ok(labels('rental', 'location').includes(required));
  for (const required of ['Dishwasher', 'Pets Allowed', 'Utilities Included', 'In-Unit Laundry']) assert.ok(labels('rental', 'features').includes(required));
  for (const removed of ['Commute', 'Proximity to Family / Friends', 'Schools']) {
    assert.ok(!labels('rental', 'location').includes(removed));
    assert.ok(!labels('purchase', 'location').includes(removed));
  }
  for (const removed of ['Pet Policy', 'Pet Rent / Fees', 'Lease Terms', 'Maintenance Responsibility']) {
    assert.ok(!categories.flatMap((def) => [...def.coreItems, ...def.suggestedItems]).some((item) => item.label === removed));
  }
});

test('removed legacy selections and custom criteria remain renderable without mutation', () => {
  const priorities = normalizePriorities({ searchType: 'rent_home', location: { tiers: { Commute: 'must', 'Proximity to Family / Friends': 'nice', Schools: 'important' } }, features: { tiers: { 'Pet Policy': 'important' }, customItems: [{ label: 'Near train', kind: 'rating' }] } });
  const before = structuredClone(priorities);
  const location = splitCategoryItems(getItemlistCategories(priorities.searchType)[0], priorities);
  const features = splitCategoryItems(getItemlistCategories(priorities.searchType)[1], priorities);
  assert.deepEqual(location.custom.map(({ label }) => label), ['Commute', 'Proximity to Family / Friends', 'Schools']);
  assert.equal(location.custom.find(({ label }) => label === 'Schools').kind, 'check');
  assert.deepEqual(features.custom.map(({ label }) => label), ['Near train', 'Pet Policy']);
  assert.deepEqual(priorities, before);
});

test('Investment remains separate from preferred property types', () => {
  assert.deepEqual(defaultPriorities().investmentPropertyTypes, []);
  const investmentLocation = getItemlistCategories('investment').find(({ key }) => key === 'location');
  assert.ok(investmentLocation.coreItems.some(({ label }) => label === 'Commute'));
  assert.ok(investmentLocation.suggestedItems.some(({ label }) => label === 'Proximity to Family / Friends'));
  assert.deepEqual(investmentLocation.suggestedItems.at(-1), { label: 'Tenant Appeal', kind: 'rating' });
});

test('Places that matter and weighted Must Have copy are user-facing', () => {
  const mySearch = fs.readFileSync(new URL('../src/components/MySearchPanel.jsx', import.meta.url), 'utf8');
  const onboarding = fs.readFileSync(new URL('../src/components/onboarding/Onboarding.jsx', import.meta.url), 'utf8');
  const constants = fs.readFileSync(new URL('../src/lib/constants.js', import.meta.url), 'utf8');
  assert.match(mySearch, /Places that matter/);
  assert.match(mySearch, /Got somewhere you go all the time\?/);
  assert.doesNotMatch(onboarding, /Places that matter/);
  assert.doesNotMatch(onboarding, /CommuteDestinations/);
  assert.doesNotMatch(onboarding, /requiredDestination|destinationCategor/);
  assert.match(constants, /One of your highest priorities/);
  assert.doesNotMatch(`${mySearch}\n${onboarding}\n${constants}`, /A dealbreaker if it's missing/);
});

test('Places are optional My Search enrichment using existing private persistence', () => {
  const page = fs.readFileSync(new URL('../src/app/onboarding/page.js', import.meta.url), 'utf8');
  const onboarding = fs.readFileSync(new URL('../src/components/onboarding/Onboarding.jsx', import.meta.url), 'utf8');
  const destinations = fs.readFileSync(new URL('../src/components/CommuteDestinations.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /getCommuteDestinations/);
  assert.doesNotMatch(onboarding, /CommuteDestinations/);
  assert.match(destinations, /createCommuteDestination\(supabase, searchId, userId, values\)/);
  assert.match(destinations, /maxDriveMinutes/);
  assert.match(destinations, /startCollapsedWhenEmpty/);
});
