import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIER_META, normalizePriorities } from '../src/lib/constants.js';
import { normalizeSearchIntent } from '../src/lib/searchIntent.js';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applyOnboardingSelections, applySearchChoice, flatOnboardingSuggestions } from '../src/lib/onboarding.js';
import { selectPriorityItem } from '../src/lib/matching.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const displayed = (choice) => ONBOARDING_SUGGESTIONS[choice].flatMap(([, items]) => items.map((entry) => entry.displayLabel));

test('new users see exactly the three product choices while historical Investment stays compatible', () => {
  assert.deepEqual(NEW_SEARCH_CHOICES.map(({ label }) => label), ['Home to buy', 'Home to rent', 'Apartment to rent']);
  assert.ok(!NEW_SEARCH_CHOICES.some(({ intent }) => intent === 'investment'));
  assert.equal(normalizeSearchIntent('investment'), 'investment');
  assert.equal(normalizePriorities({ searchType: 'investment' }).searchType, 'investment');
});

test('new choices map to canonical intents and existing property-type preferences without a schema', () => {
  const buy = applySearchChoice({}, 'home_buy');
  const homeRent = applySearchChoice({}, 'home_rent');
  const apartment = applySearchChoice({}, 'apartment_rent');
  assert.deepEqual([buy.searchType, homeRent.searchType, apartment.searchType], ['purchase', 'rental', 'rental']);
  assert.deepEqual([buy.preferredPropertyTypes.values, homeRent.preferredPropertyTypes.values, apartment.preferredPropertyTypes.values], [['house'], ['house'], ['apartment']]);
});

test('Home to Buy curated suggestions are exact', () => {
  assert.deepEqual(displayed('home_buy'), ['Neighborhood','Walkability','Parks Nearby','Quiet Street','Basement','Fireplace','Primary Ensuite','Home Office','Central Air','Guest Suite','Hardwood Floors','Garage','Fenced Yard','Yard Space','Deck / Patio','Yard Privacy','Pool','Landscaping','Overall Condition','Layout','Natural Light','Character / Charm','Privacy from Neighbors']);
});

test('Home to Rent curated suggestions are exact', () => {
  assert.deepEqual(displayed('home_rent'), ['Neighborhood','Walkability','Parks Nearby','Quiet Street','Basement','Fireplace','Primary Ensuite','Home Office','Central Air','Hardwood Floors','Garage','Fenced Yard','Outdoor Space','Patio / Deck','Yard Privacy','Pets Allowed','Utilities Included','Overall Condition','Layout','Natural Light','Privacy','Noise Level']);
});

test('Apartment to Rent curated suggestions are exact', () => {
  assert.deepEqual(displayed('apartment_rent'), ['In-Unit Laundry','Central Air','Dishwasher','Updated Interior','Balcony / Patio','Home Office Space','Parking','Fitness Center','Pool','Secure Entry','Outdoor Space','Elevator','Pet-Friendly','Quiet Community','Social Community','On-Site Management','Privacy','Surrounding Neighborhood']);
});

test('selected priorities become Important, dealbreakers become Must Have, and Nice is not assigned', () => {
  let priorities = applySearchChoice({}, 'home_buy');
  const keys = new Set(['features:Fireplace', 'homeFeel:Natural Light']);
  priorities = applyOnboardingSelections(priorities, keys, new Set(['features:Fireplace']));
  assert.equal(priorities.features.tiers.Fireplace, 'must');
  assert.equal(priorities.homeFeel.tiers['Natural Light'], 'important');
  assert.ok(!flatOnboardingSuggestions('home_buy').some(({ categoryKey, label }) => priorities[categoryKey].tiers[label] === 'nice'));
});

test('custom priorities use the same canonical JSON structure and default to Important', () => {
  const priorities = normalizePriorities({ searchType: 'purchase' });
  const selected = selectPriorityItem(priorities.homeFeel, { coreItems: [], suggestedItems: [] }, { label: 'Morning coffee spot', kind: 'rating' }, 'important');
  assert.equal(selected.tiers['Morning coffee spot'], 'important');
  assert.deepEqual(selected.customItems.at(-1), { label: 'Morning coffee spot', kind: 'rating' });
});

test('journey preserves choices on Back, persists before completion, and reveals actual My Search', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const search = read('src/components/MySearchPanel.jsx');
  assert.match(onboarding, /onBack=\{\(\) => setStep\(2\)\}/);
  assert.match(onboarding, /await flush\(\); await completeOnboarding/);
  assert.match(onboarding, /router\.push\('\/search\?welcome=1'\)/);
  assert.match(search, /Here&apos;s what we heard\./);
  assert.match(search, /href="\/homes\?add=1">Add your first home/);
});

test('onboarding is tap-first and responsive while My Search retains tier actions', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.doesNotMatch(onboarding, /draggable|PriorityBoard|CommuteDestinations/);
  assert.match(onboarding, /aria-pressed=\{selected\(criterion\)\}/);
  assert.match(board, /Move to \{TIER_META\[target\]\.label\}/);
  assert.match(board, />Remove priority<\/button>/);
  assert.match(css, /\.hh-onboarding-suggestions \.hh-chip[^}]*min-height: 40px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.hh-onboarding-suggestions \{ grid-template-columns: 1fr/);
  assert.deepEqual(Object.fromEntries(Object.entries(TIER_META).map(([tier, meta]) => [tier, meta.weight])), { must: 4, important: 2, nice: 1, dontcare: 0 });
});
