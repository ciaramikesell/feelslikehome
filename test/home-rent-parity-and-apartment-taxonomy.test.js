import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getItemlistCategories, normalizePriorities, hasQualifierOptions, qualifierOptions,
  criterionDisplayLabel, foldLegacyCheckAliases, isApartmentRental,
} from '../src/lib/constants.js';
import { computeMatch, selectPriorityItem } from '../src/lib/matching.js';
import { ONBOARDING_SUGGESTIONS, applySearchChoice, applyOnboardingSelections } from '../src/lib/onboarding.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function withSelected(priorities, categoryKey, label, tier, kind = 'check') {
  const def = getItemlistCategories(priorities.searchType, { isApartment: isApartmentRental(priorities) }).find((category) => category.key === categoryKey);
  return { ...priorities, [categoryKey]: selectPriorityItem(priorities[categoryKey], def, { label, kind }, tier) };
}

/* ------------------------------ Home to Rent parity ------------------------------ */

test('Home to Rent uses the exact same canonical Home criteria as Home to Buy', () => {
  const buyLabels = (key) => getItemlistCategories('purchase').find((c) => c.key === key).suggestedItems.map((i) => i.label);
  const rentLabels = (key) => getItemlistCategories('rental', { isApartment: false }).find((c) => c.key === key).suggestedItems.map((i) => i.label);
  assert.deepEqual(rentLabels('features'), buyLabels('features'));
  assert.deepEqual(rentLabels('exterior'), buyLabels('exterior'));
  assert.deepEqual(rentLabels('location'), buyLabels('location').filter((label) => label !== 'No HOA'));
});

test('No HOA exists for Home to Buy but is absent for Home to Rent', () => {
  const buyLocation = getItemlistCategories('purchase').find((c) => c.key === 'location').suggestedItems.map((i) => i.label);
  const rentLocation = getItemlistCategories('rental', { isApartment: false }).find((c) => c.key === 'location').suggestedItems.map((i) => i.label);
  assert.ok(buyLocation.includes('No HOA'));
  assert.ok(!rentLocation.includes('No HOA'));
});

test('First-Floor Primary, Guest Bedroom, Fenced Yard, and Privacy Fencing all exist for Home to Rent; Garage keeps its qualifier behavior', () => {
  const features = getItemlistCategories('rental', { isApartment: false }).find((c) => c.key === 'features').suggestedItems.map((i) => i.label);
  const exterior = getItemlistCategories('rental', { isApartment: false }).find((c) => c.key === 'exterior').suggestedItems.map((i) => i.label);
  assert.ok(features.includes('First-Floor Primary'));
  assert.ok(features.includes('Guest Bedroom'));
  assert.ok(exterior.includes('Fenced yard'));
  assert.ok(exterior.includes('Privacy Fencing'));
  assert.ok(exterior.includes('Garage'));
  assert.equal(hasQualifierOptions('exterior', 'Garage'), true);
  assert.deepEqual(qualifierOptions('exterior', 'Garage').map((o) => o.key), ['attached', 'detached']);
});

test('removed Home criteria (Charming Neighborhood, Move-in Ready, Renovation Potential, New Construction, First-Floor Bedroom parent) do not reappear for Home to Rent', () => {
  const all = getItemlistCategories('rental', { isApartment: false }).flatMap((c) => c.suggestedItems.map((i) => i.label));
  for (const removed of ['Charming Neighborhood', 'Move-in Ready', 'Renovation Potential', 'New Construction', 'First-Floor Bedroom']) {
    assert.ok(!all.includes(removed));
  }
});

test('Home to Rent onboarding derives from the same canonical catalog as My Search — no separate hand-authored list', () => {
  const onboardingLabels = ONBOARDING_SUGGESTIONS.home_rent.flatMap(([, items]) => items.map((item) => `${item.categoryKey}:${item.label}`));
  const mySearchLabels = getItemlistCategories('rental', { isApartment: false }).flatMap((def) => def.suggestedItems.map((item) => `${def.key}:${item.label}`));
  assert.deepEqual(onboardingLabels, mySearchLabels);
});

test('a legacy Home-to-Rent "Home Office" (Title Case) selection folds onto the shared canonical identity, matching what Home to Buy already does — no duplicate visible priority', () => {
  const priorities = normalizePriorities({
    searchType: 'rental',
    features: { tiers: { 'Home Office': 'must' }, customItems: [{ label: 'Home Office', kind: 'check' }] },
  });
  assert.equal(priorities.features.tiers['Home office'], 'must');
  assert.equal(priorities.features.tiers['Home Office'], undefined);
  assert.ok(!priorities.features.customItems.some((item) => item.label === 'Home Office'));
});

test('a legacy Home-to-Rent "Fenced Yard" (Title Case) selection folds onto the shared lowercase canonical identity', () => {
  const priorities = normalizePriorities({ searchType: 'rental', exterior: { tiers: { 'Fenced Yard': 'important' } } });
  assert.equal(priorities.exterior.tiers['Fenced yard'], 'important');
  assert.equal(priorities.exterior.tiers['Fenced Yard'], undefined);
});

test('a Home-to-Rent legacy criterion with no safe kind-preserving equivalent (rating "Parks Nearby" vs the new check-kind canonical) is preserved under its own identity, never guessed', () => {
  const priorities = normalizePriorities({
    searchType: 'rental',
    location: { tiers: { 'Parks Nearby': 'nice' }, customItems: [{ label: 'Parks Nearby', kind: 'rating' }] },
  });
  assert.equal(priorities.location.tiers['Parks Nearby'], 'nice');
  assert.equal(priorities.location.tiers['Parks nearby'], undefined);
});

test('items dropped from Home-to-Rent\'s new offering (In-Unit Laundry, Walkability) remain visible and still count toward Match for anyone who already selected them', () => {
  const priorities = normalizePriorities({
    searchType: 'rental',
    features: { tiers: { 'In-Unit Laundry': 'important' }, customItems: [{ label: 'In-Unit Laundry', kind: 'check' }] },
  });
  // In-Unit Laundry has always read the shared home.inUnitLaundry boolean (see
  // sharedBooleanField), not a per-home checks entry — unaffected by this pass.
  const match = computeMatch({ inUnitLaundry: true, checks: {} }, priorities);
  assert.ok(match.allSelected.some((item) => item.key === 'features:In-Unit Laundry' && item.evaluated && item.met));

  const walkability = normalizePriorities({
    searchType: 'rental',
    location: { tiers: { Walkability: 'nice' }, customItems: [{ label: 'Walkability', kind: 'rating' }] },
  });
  const walkabilityMatch = computeMatch({ checks: {}, ratings: { 'location:Walkability': 4 } }, walkability);
  assert.ok(walkabilityMatch.allSelected.some((item) => item.key === 'location:Walkability' && item.evaluated));
});

test('a per-home fact recorded under the old Home-to-Rent Title-Case key stays visible to Match once the priority has folded onto the canonical label', () => {
  const folded = foldLegacyCheckAliases({ 'features:Home Office': true }, 'rental', false);
  assert.equal(folded['features:Home office'], true);
});

test('the Home-to-Rent fold never fires for Apartment to Rent', () => {
  const apartmentPriorities = normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent', features: { tiers: { 'Home Office': 'important' } } });
  assert.equal(apartmentPriorities.features.tiers['Home Office'], 'important');
  assert.equal(apartmentPriorities.features.tiers['Home office'], undefined);
  const foldedApartmentChecks = foldLegacyCheckAliases({ 'features:Home Office': true }, 'rental', true);
  assert.equal(foldedApartmentChecks['features:Home office'], undefined);
});

/* ------------------------------ Apartment onboarding ------------------------------ */

test('Apartment onboarding renders exactly the approved three groups with the approved criteria', () => {
  assert.deepEqual(ONBOARDING_SUGGESTIONS.apartment_rent.map(([title]) => title), ['Living There', 'Apartment Features', 'Amenities']);
  const [[, livingThere], [, apartmentFeatures], [, amenities]] = ONBOARDING_SUGGESTIONS.apartment_rent;
  assert.deepEqual(livingThere.map((i) => i.displayLabel), ['Parks Nearby', 'Near Public Transit', 'On-Site Management', 'Pet-Friendly', 'Secure Entry', 'Utilities Included', 'Furnished', 'Guest Parking']);
  assert.deepEqual(apartmentFeatures.map((i) => i.displayLabel), ['Patio / Balcony', 'Fireplace', 'Central Air', 'Independent Thermostat', 'Ample Outlets', 'Dishwasher', 'In-Unit Laundry', 'Home Office Space', 'Counter Space', 'No Neighbors Above']);
  assert.deepEqual(amenities.map((i) => i.displayLabel), ['Pool', 'Elevator', 'Dog Park', 'Fitness Center', 'Storage', 'Designated Parking', 'Rooftop', 'Recycling', 'Trash Valet', 'Clubhouse', 'Playground']);
});

test('the legacy apartment catalog (Neighborhood, Walkability, Basement, Building Amenities, etc.) is no longer offered to new selections', () => {
  const offered = new Set(ONBOARDING_SUGGESTIONS.apartment_rent.flatMap(([, items]) => items.map((i) => i.label)));
  for (const removed of ['Neighborhood', 'Walkability', 'Immediate Street / Surroundings', 'Groceries Nearby', 'Basement', 'Primary Ensuite', 'Building Amenities', 'Overall Condition', 'Layout / Flow', 'Natural Light', 'Character / Charm', 'Room Sizes', 'Openness / Ceiling Height', 'Privacy']) {
    assert.ok(!offered.has(removed), `${removed} should not be offered`);
  }
});

test('an apartment selection persists into My Search as Important, exactly like every other onboarding search type', () => {
  let priorities = applySearchChoice({}, 'apartment_rent');
  priorities = applyOnboardingSelections(priorities, new Set(['exterior:Pool']), new Set());
  assert.equal(priorities.exterior.tiers.Pool, 'important');
});

/* ------------------------------ Apartment My Search ------------------------------ */

test('Apartment My Search uses the same canonical catalog as apartment onboarding — no Home Feel category, no duplicate criteria', () => {
  const categories = getItemlistCategories('rental', { isApartment: true });
  assert.deepEqual(categories.map((c) => c.key), ['location', 'features', 'exterior']);
  assert.ok(!categories.some((c) => c.key === 'homeFeel'));
  const onboardingLabels = ONBOARDING_SUGGESTIONS.apartment_rent.flatMap(([, items]) => items.map((item) => `${item.categoryKey}:${item.label}`));
  const mySearchLabels = categories.flatMap((def) => def.suggestedItems.map((item) => `${def.key}:${item.label}`));
  assert.deepEqual(onboardingLabels, mySearchLabels);
  assert.equal(new Set(mySearchLabels).size, mySearchLabels.length);
});

test('an apartment priority remains draggable/rankable across tiers exactly like any other selected priority', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent' }), 'exterior', 'Pool', 'important');
  assert.equal(priorities.exterior.tiers.Pool, 'important');
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /const setTier = \(categoryKey, label, tier\) => patch/);
});

test('custom/Add Your Own priorities remain available and distinct from canonical apartment criteria', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /addCustomItem\(newItemCategory/);
  const priorities = normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent', exterior: { customItems: [{ label: 'Rooftop grill access', kind: 'check', source: 'custom' }], tiers: { 'Rooftop grill access': 'nice' } } });
  assert.equal(priorities.exterior.tiers['Rooftop grill access'], 'nice');
});

/* ------------------------------ Match safety for new apartment criteria ------------------------------ */

test('unknown data never becomes a mismatch for any newly introduced apartment criterion', () => {
  const newCriteria = [
    ['location', 'Near Public Transit'], ['location', 'On-Site Management'], ['location', 'Furnished'], ['location', 'Guest Parking'],
    ['features', 'Independent Thermostat'], ['features', 'Ample Outlets'], ['features', 'No Neighbors Above'], ['features', 'Counter Space'],
    ['exterior', 'Dog Park'], ['exterior', 'Designated Parking'], ['exterior', 'Rooftop'], ['exterior', 'Recycling'], ['exterior', 'Trash Valet'], ['exterior', 'Clubhouse'], ['exterior', 'Playground'],
  ];
  for (const [categoryKey, label] of newCriteria) {
    const priorities = withSelected(normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent' }), categoryKey, label, 'must');
    const match = computeMatch({ checks: {} }, priorities);
    assert.equal(match.allSelected[0].evaluated, false, `${categoryKey}:${label} should be Unknown, not evaluated, when the home has no recorded fact`);
    assert.equal(match.pct, null);
  }
});

test('Pet-Friendly (stored as Pets Allowed) and Utilities Included keep reading the shared home.petsAllowed/utilitiesIncluded booleans even though they now live under the Living There category, not Home Features', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent' }), 'location', 'Pets Allowed', 'must');
  assert.equal(criterionDisplayLabel('location', 'Pets Allowed'), 'Pet-Friendly');
  const yes = computeMatch({ petsAllowed: true, checks: {} }, priorities);
  assert.equal(yes.allSelected[0].met, true);
  const no = computeMatch({ petsAllowed: false, checks: {} }, priorities);
  assert.equal(no.allSelected[0].met, false);
  const unknown = computeMatch({ petsAllowed: null, checks: {} }, priorities);
  assert.equal(unknown.allSelected[0].evaluated, false);
});

test('In-Unit Laundry under Apartment Features still reads the shared home.inUnitLaundry boolean', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent' }), 'features', 'In-Unit Laundry', 'important');
  const yes = computeMatch({ inUnitLaundry: true, checks: {} }, priorities);
  assert.equal(yes.allSelected[0].met, true);
});

/* ------------------------------ Post-Tour ------------------------------ */

test('Apartment to Rent Post-Tour Big 4 are Layout / Location / Condition / Amenities; Layout reuses the Home Big 4\'s stable key', () => {
  const modal = read('src/components/PostTourModal.jsx');
  assert.match(modal, /export const APARTMENT_POST_TOUR_EVALUATIONS = \[/);
  assert.match(modal, /\{ key: 'tour-v2:layout', label: 'Layout' \}/);
  assert.match(modal, /\{ key: 'tour-v2:location', label: 'Location' \}/);
  assert.match(modal, /\{ key: 'tour-v2:condition', label: 'Condition' \}/);
  assert.match(modal, /\{ key: 'tour-v2:amenities', label: 'Amenities' \}/);
});

test('Home to Buy and Home to Rent Post-Tour keep their existing four dimensions, unchanged', () => {
  const modal = read('src/components/PostTourModal.jsx');
  assert.match(modal, /export const HOME_POST_TOUR_EVALUATIONS = \[/);
  assert.match(modal, /\{ key: 'tour-v2:curb_appeal', label: 'Curb Appeal' \}/);
  assert.match(modal, /\{ key: 'tour-v2:privacy', label: 'Privacy' \}/);
  assert.match(modal, /\{ key: 'tour-v2:neighborhood', label: 'Neighborhood' \}/);
});

test('the modal picks the apartment Big 4 only for an apartment search, using the same isApartmentRental signal as everywhere else', () => {
  const modal = read('src/components/PostTourModal.jsx');
  assert.match(modal, /const isApartment = isApartmentRental\(priorities\)/);
  assert.match(modal, /const evaluations = isApartment \? APARTMENT_POST_TOUR_EVALUATIONS : HOME_POST_TOUR_EVALUATIONS/);
});

test('Post-Tour note suggestions mention Noise Level, Water Pressure, and Walkability for apartments, without turning them into scored dimensions', () => {
  const modal = read('src/components/PostTourModal.jsx');
  assert.match(modal, /Noise level, water pressure, walkability/i);
  assert.doesNotMatch(modal, /\{ key: 'tour-v2:noise/i);
  assert.doesNotMatch(modal, /\{ key: 'tour-v2:water_pressure/i);
  assert.doesNotMatch(modal, /\{ key: 'tour-v2:walkability/i);
});

test('historical Post-Tour responses are never relabeled — the ratings map is read generically by key, so an old Home-dimension answer on an apartment stays under its own key untouched', () => {
  const modal = read('src/components/PostTourModal.jsx');
  assert.match(modal, /const \[ratings, setRatings\] = useState\(home\.ratings \|\| \{\}\)/);
  // No code path filters or rewrites keys not present in the currently-rendered
  // evaluations array — they simply pass through unread and unmodified.
  assert.doesNotMatch(modal, /delete ratings\[/);
});
