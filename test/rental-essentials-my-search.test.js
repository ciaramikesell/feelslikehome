// Renters after onboarding: My Search offers the Rental essentials first, with
// the same words and Match behavior as onboarding; three unanswerable apartment
// options are retired from what's offered (saved selections keep working); and
// listing text never records contradictory parking answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const { RENTAL_ESSENTIALS, criterionDisplayLabel, normalizePriorities, isDiscontinuedOffering } = await import('../src/lib/constants.js');
const { applySearchChoice, ONBOARDING_SUGGESTIONS } = await import('../src/lib/onboarding.js');
const { availableCriteriaGroups, moveCriterion, offeredCriteriaGroups, priorityLevels, toggleCriterion } = await import('../src/lib/searchProfile.js');
const { computeMatch, parseListingText } = await import('../src/lib/matching.js');
const { derivePriorityCheckPatch } = await import('../src/lib/importReview.js');

const search = (type) => applySearchChoice(normalizePriorities({}), type);
const titles = (priorities) => offeredCriteriaGroups(priorities).map((group) => group.title);
const essentialsOf = (priorities) => offeredCriteriaGroups(priorities)[0].items.map((item) => item.displayLabel);
const ESSENTIALS = ['Pet-Friendly', 'In-Unit Laundry', 'Utilities Included', 'Parking', 'Central Air', 'Dishwasher'];

test('every rental search offers the Rental essentials first; buyers are unchanged', () => {
  for (const priorities of [search('home_rent'), search('apartment_rent'), normalizePriorities({ searchType: 'rental' }),
    { ...search('apartment_rent'), preferredPropertyTypes: { values: ['condo', 'townhome'], tier: 'important' } }]) {
    assert.equal(titles(priorities)[0], 'Rental Essentials');
    assert.deepEqual(essentialsOf(priorities), ESSENTIALS);
    // Never offered twice (e.g. the canonical "Central air" in Home to Rent's list).
    const labels = offeredCriteriaGroups(priorities).flatMap((group) => group.items.map((item) => item.displayLabel.toLowerCase()));
    assert.equal(labels.filter((label) => label === 'central air').length, 1);
  }
  assert.ok(!titles(search('home_buy')).includes('Rental Essentials'));
  assert.ok(!offeredCriteriaGroups(search('home_buy')).flatMap((group) => group.items).some((item) => item.label === 'Pets Allowed'));
  assert.deepEqual(RENTAL_ESSENTIALS.map((item) => `${item.categoryKey}:${item.label}`), [
    'features:Pets Allowed', 'features:In-Unit Laundry', 'features:Utilities Included', 'exterior:Parking', 'features:Central Air', 'features:Dishwasher',
  ]);
  assert.equal(criterionDisplayLabel('features', 'Pets Allowed'), 'Pet-Friendly');
});

test('a chosen essential leaves the offered list, shows on the board, and counts in Match like onboarding', () => {
  let priorities = search('home_rent');
  for (const item of RENTAL_ESSENTIALS) priorities = toggleCriterion(priorities, item);
  priorities = moveCriterion(priorities, 'features', 'Pets Allowed', 'must');
  assert.ok(!availableCriteriaGroups(priorities).some((group) => group.title === 'Rental Essentials'));
  assert.deepEqual(priorityLevels(priorities).flatMap((level) => level.items).map((item) => item.displayLabel).sort(), [...ESSENTIALS].sort());
  const status = (home, key) => { const c = computeMatch({ checks: {}, ratings: {}, ...home }, priorities).allSelected.find((entry) => entry.key === key); return c.evaluated ? c.met : 'unknown'; };
  // Shared facts for pets/laundry/utilities; Yes/No for the rest; Unknown never a miss.
  assert.equal(status({ petsAllowed: true }, 'features:Pets Allowed'), true);
  assert.equal(status({ petsAllowed: false }, 'features:Pets Allowed'), false);
  assert.equal(status({}, 'features:Pets Allowed'), 'unknown');
  assert.equal(status({ checks: { 'exterior:Parking': 'no' } }, 'exterior:Parking'), false);
  assert.equal(status({ checks: { 'features:Dishwasher': true } }, 'features:Dishwasher'), true);
  assert.equal(computeMatch({ checks: {}, ratings: {} }, priorities).missing.length, 0);
});

test('Social Community, On-Site Management and Surrounding Neighborhood are retired for renters; saved choices keep working', () => {
  const retired = ['homeFeel:Social Community', 'homeFeel:On-Site Management', 'location:Neighborhood'];
  for (const priorities of [search('apartment_rent'), normalizePriorities({ searchType: 'rental' })]) {
    const offered = offeredCriteriaGroups(priorities).flatMap((group) => group.items.map((item) => item.key));
    for (const key of retired) assert.ok(!offered.includes(key), key);
  }
  const apartmentOnboarding = ONBOARDING_SUGGESTIONS.apartment_rent.flatMap(([, items]) => items).map((item) => `${item.categoryKey}:${item.label}`);
  for (const key of retired) assert.ok(!apartmentOnboarding.includes(key), key);
  assert.ok(apartmentOnboarding.includes('exterior:Noise Level') && apartmentOnboarding.includes('homeFeel:Privacy'), 'Quiet Community and Privacy stay');
  // Investment keeps Neighborhood; a renter's typed priority is never retired.
  assert.equal(isDiscontinuedOffering('location', { label: 'Neighborhood' }, 'investment'), false);
  assert.equal(isDiscontinuedOffering('homeFeel', { label: 'Social Community', source: 'custom' }, 'rental'), false);
  // An existing selection stays on the board and in Match, unchanged.
  let saved = toggleCriterion(search('apartment_rent'), { categoryKey: 'homeFeel', label: 'Social Community', kind: 'rating' });
  saved = moveCriterion(saved, 'location', 'Neighborhood', 'nice');
  assert.deepEqual(priorityLevels(saved).flatMap((level) => level.items).map((item) => item.key).sort(), ['homeFeel:Social Community', 'location:Neighborhood']);
  assert.equal(computeMatch({ checks: {}, ratings: { 'homeFeel:Social Community': 4 } }, saved).allSelected.find((entry) => entry.key === 'homeFeel:Social Community').met, true);
});

test('Parking, Off-street parking and Garage stay distinct, and listing text never contradicts itself', () => {
  let priorities = search('apartment_rent');
  for (const [categoryKey, label] of [['exterior', 'Parking'], ['exterior', 'Driveway / Off-Street Parking'], ['exterior', 'Garage']]) priorities = toggleCriterion(priorities, { categoryKey, label, kind: 'check' });
  const keys = priorityLevels(priorities).flatMap((level) => level.items).map((item) => item.key);
  assert.deepEqual(keys.sort(), ['exterior:Driveway / Off-Street Parking', 'exterior:Garage', 'exterior:Parking']);
  const patch = (text) => derivePriorityCheckPatch(text, priorities, {});
  assert.deepEqual(patch('Attached 2-car garage. Street parking only.'), {});
  assert.deepEqual(patch('No parking. 1-car garage.'), {});
  assert.deepEqual(patch('Driveway. No parking on street.'), { 'exterior:Driveway / Off-Street Parking': true });
  assert.deepEqual(patch('Detached garage. No off-street parking for guests.'), {});
  // Genuine answers are still recorded.
  assert.deepEqual(patch('Street parking only.'), { 'exterior:Driveway / Off-Street Parking': 'no' });
  assert.deepEqual(patch('Assigned parking. No garage.'), { 'exterior:Parking': true });
  // Garage is answered by garage spaces, never by the Parking answers, and vice versa.
  const match = computeMatch({ garageSpaces: parseListingText('Attached 2-car garage.', 'rental').garageSpaces, checks: { 'exterior:Parking': 'no' }, ratings: {} }, priorities);
  const status = (key) => match.allSelected.find((entry) => entry.key === key);
  assert.equal(status('exterior:Garage').met, true);
  assert.equal(status('exterior:Parking').met, false, 'a person\'s own explicit No is respected');
  assert.equal(status('exterior:Driveway / Off-Street Parking').evaluated, false);
});
