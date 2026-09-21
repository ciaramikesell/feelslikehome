import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIER_META, normalizePriorities } from '../src/lib/constants.js';
import { normalizeSearchIntent } from '../src/lib/searchIntent.js';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applyOnboardingSelections, applySearchChoice, flatOnboardingSuggestions, onboardingOverview, onboardingPriorityCounts } from '../src/lib/onboarding.js';
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

test('Home to Buy curated suggestions are exactly the canonical purchase taxonomy — one shared catalog with My Search, no Home Feel group, Garage the sole parent/child criterion', () => {
  assert.deepEqual(displayed('home_buy'), [
    'Reputable Schools', 'Walkable to Town', 'Parks Nearby', 'Quiet Street', 'Bustling Street', 'Near Waterfront', 'Walkable Schools', 'No HOA',
    'Finished Basement', 'Walkout Basement', 'First-Floor Primary', 'Guest Bedroom', 'Primary Ensuite', 'First-Floor Laundry', 'Home Office', 'Central Air', 'Fireplace', 'Guest / In-Law Suite',
    'Deck / Patio', 'Fenced Yard', 'Privacy Fencing', 'Garage', 'Large Backyard', 'Front Porch', 'Pool', 'Landscaping',
  ]);
  assert.deepEqual(ONBOARDING_SUGGESTIONS.home_buy.map(([title]) => title), ['Location', 'Home Features', 'Exterior & Property']);
  for (const retired of ['Charming Neighborhood', 'Move-in Ready', 'Renovation Potential', 'New Construction', 'First-Floor Bedroom', 'Neighborhood', 'Walkability', 'Immediate Street / Surroundings', 'Basement', 'Yard', 'Overall Condition', 'Layout / Flow', 'Natural Light', 'Character / Charm', 'Attached Garage', 'Detached Garage']) {
    assert.ok(!displayed('home_buy').includes(retired));
  }
});

// 2026 Home-to-Rent parity pass: Home to Rent now shares Home to Buy's exact canonical
// catalog, minus No HOA — one shared taxonomy, not a separately hand-authored list.
test('Home to Rent curated suggestions match Home to Buy exactly, minus No HOA', () => {
  assert.deepEqual(displayed('home_rent'), [
    'Reputable Schools', 'Walkable to Town', 'Parks Nearby', 'Quiet Street', 'Bustling Street', 'Near Waterfront', 'Walkable Schools',
    'Finished Basement', 'Walkout Basement', 'First-Floor Primary', 'Guest Bedroom', 'Primary Ensuite', 'First-Floor Laundry', 'Home Office', 'Central Air', 'Fireplace', 'Guest / In-Law Suite',
    'Deck / Patio', 'Fenced Yard', 'Privacy Fencing', 'Garage', 'Large Backyard', 'Front Porch', 'Pool', 'Landscaping',
  ]);
  assert.ok(!displayed('home_rent').includes('No HOA'), 'No HOA is Home to Buy only');
  assert.deepEqual(ONBOARDING_SUGGESTIONS.home_rent.map(([title]) => title), ['Location', 'Home Features', 'Exterior & Property']);
  for (const removed of ['Neighborhood', 'Walkability', 'Dog Parks Nearby', 'Groceries Nearby', 'Restaurants / Coffee / Shopping Nearby', 'Basement', 'Hardwood Floors', 'Pets Allowed', 'Utilities Included', 'In-Unit Laundry']) {
    assert.ok(!displayed('home_rent').includes(removed), `${removed} is no longer offered to new Home-to-Rent selections`);
  }
});

// 2026 apartment taxonomy replacement: Apartment to Rent's own dedicated catalog —
// Living There / Apartment Features / Amenities — replaces the old four-group list.
test('Apartment to Rent curated suggestions are the approved Living There / Apartment Features / Amenities taxonomy', () => {
  assert.deepEqual(displayed('apartment_rent'), [
    'Parks Nearby', 'Near Public Transit', 'On-Site Management', 'Pet-Friendly', 'Secure Entry', 'Utilities Included', 'Furnished', 'Guest Parking',
    'Patio / Balcony', 'Fireplace', 'Central Air', 'Independent Thermostat', 'Ample Outlets', 'Dishwasher', 'In-Unit Laundry', 'Home Office Space', 'Counter Space', 'No Neighbors Above',
    'Pool', 'Elevator', 'Dog Park', 'Fitness Center', 'Storage', 'Designated Parking', 'Rooftop', 'Recycling', 'Trash Valet', 'Clubhouse', 'Playground',
  ]);
  assert.deepEqual(ONBOARDING_SUGGESTIONS.apartment_rent.map(([title]) => title), ['Living There', 'Apartment Features', 'Amenities']);
  for (const removed of ['Neighborhood', 'Walkability', 'Immediate Street / Surroundings', 'Groceries Nearby', 'Restaurants / Coffee / Shopping Nearby', 'Basement', 'Primary Ensuite', 'Finished Basement', 'Walkout Basement', 'First-Floor Laundry', 'Mudroom', 'Pantry', 'Updated Kitchen', 'Updated Bathrooms', 'Walk-In Closet', 'Additional Living Space', 'Hardwood Floors', 'Updated Interior', 'Parking', 'Garage', 'Driveway / Off-Street Parking', 'Fenced Yard', 'Patio / Deck / Outdoor Living', 'Yard Privacy', 'Building Amenities', 'Noise Level', 'Overall Condition', 'Layout / Flow', 'Natural Light', 'Character / Charm', 'Room Sizes', 'Openness / Ceiling Height', 'Privacy from Neighbors']) {
    assert.ok(!displayed('apartment_rent').includes(removed), `${removed} is no longer offered to new Apartment-to-Rent selections`);
  }
});

test('selected priorities become Important, dealbreakers become Must Have, and Nice is not assigned', () => {
  let priorities = applySearchChoice({}, 'home_buy');
  const keys = new Set(['features:Fireplace', 'exterior:Pool']);
  priorities = applyOnboardingSelections(priorities, keys, new Set(['features:Fireplace']));
  assert.equal(priorities.features.tiers.Fireplace, 'must');
  assert.equal(priorities.exterior.tiers.Pool, 'important');
  assert.ok(!flatOnboardingSuggestions('home_buy').some(({ categoryKey, label }) => priorities[categoryKey].tiers[label] === 'nice'));
});

test('zero dealbreakers and zero Nice to Haves remain truthful', () => {
  let priorities = applySearchChoice({}, 'home_buy');
  priorities = applyOnboardingSelections(priorities, new Set(['features:Fireplace']), new Set());
  assert.deepEqual(onboardingPriorityCounts(priorities), { must: 0, important: 1, nice: 0 });
});

test('Step 4 overview only includes values the participant entered', () => {
  const priorities = applySearchChoice({ budget: { value: '450,000', tier: 'important' }, bedsMin: { value: '', tier: 'important' } }, 'home_buy');
  assert.deepEqual(onboardingOverview(priorities), ['Home to buy', '$450,000 max']);
});

test('custom priorities use the same canonical JSON structure and default to Important', () => {
  const priorities = normalizePriorities({ searchType: 'purchase' });
  const selected = selectPriorityItem(priorities.homeFeel, { coreItems: [], suggestedItems: [] }, { label: 'Morning coffee spot', kind: 'rating' }, 'important');
  assert.equal(selected.tiers['Morning coffee spot'], 'important');
  assert.deepEqual(selected.customItems.at(-1), { label: 'Morning coffee spot', kind: 'rating' });
});

test('two-screen journey preserves choices on Back, persists before completion, and finishes straight into My Search', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const search = read('src/components/MySearchPanel.jsx');
  // No Dealbreakers screen, no separate "My Search Criteria" summary screen —
  // step 2's own CTA is the only forward action left in onboarding.
  assert.doesNotMatch(onboarding, /Dealbreaker|dealbreaker/);
  assert.doesNotMatch(onboarding, /SummaryStep|My Search Criteria/);
  assert.match(onboarding, /onBack=\{\(\) => setStep\(1\)\}/);
  assert.match(onboarding, /Rank my priorities/);
  assert.match(onboarding, /await flush\(\); await completeOnboarding/);
  // #73: a pending share-intake destination (see (app)/layout.js) takes over
  // this push when present; the plain welcome landing is still the default.
  assert.match(onboarding, /onNext=\{\(\) => finish\(pendingRedirect \|\| '\/search\?welcome=1'\)\}/);
  assert.match(search, /Here&apos;s what we heard\./);
  assert.match(search, /href="\/homes\?add=1">Add your first home/);
});

test('onboarding is tap-first and responsive while My Search retains tier actions', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.doesNotMatch(onboarding, /draggable|CommuteDestinations/);
  assert.doesNotMatch(onboarding, /<PriorityBoard/);
  assert.match(onboarding, /aria-pressed=\{selected\(criterion\)\}/);
  assert.match(board, /Move to \{TIER_META\[target\]\.label\}/);
  assert.match(board, />Remove priority<\/button>/);
  assert.match(css, /\.hh-onboarding-suggestions \.hh-chip[^}]*min-height: 40px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.hh-onboarding-suggestions \{ grid-template-columns: 1fr/);
  assert.deepEqual(Object.fromEntries(Object.entries(TIER_META).map(([tier, meta]) => [tier, meta.weight])), { must: 4, important: 2, nice: 1, dontcare: 0 });
});

test('the old Dealbreakers onboarding state cannot trap an existing user', () => {
  // Onboarding gating is a single boolean (profiles.onboarding_complete) — see
  // completeOnboarding — never a persisted step number, so there is no stored
  // "step 3" value an existing user could be stuck on. Every visit to
  // /onboarding starts this same two-screen flow from step 1.
  const dataLib = read('src/lib/supabase/data.js');
  assert.match(dataLib, /onboarding_complete/);
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /const \[step, setStep\] = useState\(1\);/);
  assert.doesNotMatch(onboarding, /setStep\(3\)|setStep\(4\)/);
});
