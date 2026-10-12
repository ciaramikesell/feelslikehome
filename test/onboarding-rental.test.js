// Onboarding V2 for renters (Home to Rent, Apartment to Rent) inside the same
// six steps: a shared Rental essentials section, an optional apartment Building
// type, after-tour assessments marked as such, Step 4 wording in Steps 5–6,
// renter words for the same roles, compatible answers kept when the kind of
// search changes, and Home to Rent listing-text detection.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { getItemlistCategories, isExperientialCriterion, normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { flatOnboardingSuggestions } from '../src/lib/onboarding.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { peopleWords } from '../src/lib/onboardingPeople.js';
import { peopleSummary, prioritiesSummary } from '../src/lib/onboardingReview.js';
import { derivePriorityCheckPatch } from '../src/lib/importReview.js';
import { addCustomCriterion, moveCriterion, toggleCriterion } from '../src/lib/searchProfile.js';
import {
  FUTURE_RENTAL_PRIORITIES, UNANSWERABLE_RENTAL_OPTIONS, chipKey, moreToConsider, offeredChips, onboardingPriorityLevels,
  switchSearchType, whatMattersSections,
} from '../src/lib/whatMattersCatalog.js';
import { moveGroup, toggleGroupValue } from '../src/lib/whatMattersGroups.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = (type) => chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
const rentalCatalog = new Map(getItemlistCategories('rental').flatMap((category) =>
  [...category.coreItems, ...category.suggestedItems, ...(category.specificItems || [])].map((item) => [`${category.key}:${item.label}`, item])));
const chipByText = (priorities, text) => offeredChips(priorities).find((chip) => chip.text === text);
function pick(priorities, ...texts) {
  return texts.reduce((next, text) => {
    const chip = chipByText(next, text);
    assert.ok(chip, `chip "${text}"`);
    return chip.type === 'criterion' ? toggleCriterion(next, chip) : toggleGroupValue(next, chip.group, chip.value);
  }, priorities);
}
const labelsByLevel = (priorities) => Object.fromEntries(onboardingPriorityLevels(priorities).map((level) => [level.tier, level.items.map((item) => item.displayLabel + (item.qualifier ? ` (${item.qualifier})` : ''))]));

/* --------------------------------- catalog --------------------------------- */

test('both rental searches open with the same Rental essentials, then their own choices', () => {
  const sections = (type) => whatMattersSections(fresh(type)).map((section) => [section.title, section.chips.map((chip) => `${chip.text} → ${chipKey(chip)}`)]);
  const essentials = ['Rental essentials', [
    'Pet-friendly → features:Pets Allowed', 'In-unit laundry → features:In-Unit Laundry', 'Utilities included → features:Utilities Included',
    'Parking → exterior:Parking', 'Central air → features:Central Air', 'Dishwasher → features:Dishwasher',
  ]];
  assert.deepEqual(sections('home_rent'), [
    essentials,
    ['Neighborhood', ['Quiet street → location:Quiet street', 'Walkable to town → location:Walkable to Town', 'Great schools → location:Reputable Schools', 'Parks nearby → location:Parks nearby']],
    ['The home', ['Home office → features:Home office', 'Primary suite → features:Primary ensuite', 'Garage → exterior:Garage']],
    ['Outdoor space', ['Big backyard → exterior:Large backyard', 'Fenced yard → exterior:Fenced yard']],
    ['Property type', ['House → preferredPropertyTypes=house', 'Townhome → preferredPropertyTypes=townhome', 'Condo → preferredPropertyTypes=condo']],
  ]);
  assert.deepEqual(sections('apartment_rent'), [
    essentials,
    ['The unit', ['Balcony / patio → exterior:Patio / Deck / Outdoor Living', 'Updated interior → features:Updated Interior', 'Home office space → features:Home Office']],
    ['Building & amenities', ['Fitness center → exterior:Fitness Center', 'Pool → exterior:Pool', 'Secure entry → exterior:Secure Entry', 'Elevator → exterior:Elevator']],
    ['Building type', ['Apartment → preferredPropertyTypes=apartment', 'Condo → preferredPropertyTypes=condo', 'Townhome → preferredPropertyTypes=townhome']],
    ['After you tour', ['Quiet community → exterior:Noise Level', 'Privacy → homeFeel:Privacy']],
  ]);
  // The default set stays manageable; secondary options are under More to consider.
  for (const type of ['home_rent', 'apartment_rent']) {
    const shown = whatMattersSections(fresh(type)).flatMap((section) => section.chips).length;
    assert.ok(shown <= 18, `${type} shows ${shown} chips up front`);
    assert.ok(moreToConsider(fresh(type)).length > 0);
  }
});

test('every rental chip is an existing criterion Match already evaluates; nothing is invented', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    const homeRentOffered = new Set(flatOnboardingSuggestions(type).map((item) => `${item.categoryKey}:${item.label}`));
    for (const chip of offeredChips(fresh(type)).filter((entry) => entry.type === 'criterion')) {
      const key = chipKey(chip);
      assert.ok(rentalCatalog.has(key) || homeRentOffered.has(key), `${type}: ${key}`);
      assert.equal(chip.kind, rentalCatalog.get(key)?.kind || flatOnboardingSuggestions(type).find((item) => `${item.categoryKey}:${item.label}` === key).kind, key);
    }
    // No duplicate concepts (e.g. canonical "Central air" beside the rental chip).
    const keys = offeredChips(fresh(type)).map((chip) => chipKey(chip).toLowerCase());
    assert.equal(new Set(keys).size, keys.length, type);
  }
  // Earlier apartment options nothing can answer are not offered; future work is documented, not offered.
  const apartmentKeys = new Set(offeredChips(fresh('apartment_rent')).map(chipKey));
  for (const option of UNANSWERABLE_RENTAL_OPTIONS) assert.ok(!apartmentKeys.has(option.key), option.key);
  assert.deepEqual(FUTURE_RENTAL_PRIORITIES, ['Move-in date', 'Lease length', 'Furnished', 'Deposits and fees']);
  for (const text of ['Move-in date', 'Lease length', 'Furnished']) assert.equal(chipByText(fresh('apartment_rent'), text), undefined);
  const doc = read('docs/onboarding-v2-rental.md');
  for (const text of FUTURE_RENTAL_PRIORITIES) assert.match(doc, new RegExp(text));
});

test('after-tour assessments are marked apart from facts that can be checked before touring', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    for (const chip of offeredChips(fresh(type)).filter((entry) => entry.type === 'criterion')) {
      assert.equal(Boolean(chip.afterTour), isExperientialCriterion(chip.categoryKey, chip.label), chipKey(chip));
    }
  }
  const tour = whatMattersSections(fresh('apartment_rent')).find((section) => section.title === 'After you tour');
  assert.match(tour.note, /after you tour/);
  assert.ok(tour.chips.every((chip) => chip.afterTour));
  assert.ok(whatMattersSections(fresh('apartment_rent')).find((section) => section.title === 'Rental essentials').chips.every((chip) => !chip.afterTour));
  const step = read('src/components/onboarding/WhatMattersStepV2.jsx');
  assert.match(step, /\{chip\.afterTour && <span className="flh-ob-chip-tag">after tour<\/span>\}/);
  // Steps 5 and 6 say so too.
  const ranked = pick(fresh('apartment_rent'), 'Quiet community', 'Pet-friendly');
  assert.deepEqual(labelsByLevel(ranked).important, ['Pet-friendly', 'Quiet community (After you tour)']);
});

/* ------------------------------ building type ------------------------------ */

test('Apartment to Rent never presets or hides a property type; Building type is optional alternatives with one level', () => {
  const apartment = fresh('apartment_rent');
  assert.deepEqual(apartment.preferredPropertyTypes.values, [], 'nothing preselected');
  for (const propertyType of ['apartment', 'condo', 'townhome', null]) {
    assert.doesNotMatch(JSON.stringify(computeMatch({ propertyType, checks: {}, ratings: {}, price: '2000' }, { ...apartment, budget: { value: '2400', tier: 'important' } })), /preferredPropertyTypes/, 'no silent penalty');
  }
  let chosen = pick(apartment, 'Apartment', 'Condo');
  assert.deepEqual(chosen.preferredPropertyTypes, { values: ['apartment', 'condo'], tier: 'important' });
  chosen = moveGroup(chosen, 'preferredPropertyTypes', 'must');
  const status = (propertyType) => computeMatch({ propertyType, checks: {}, ratings: {} }, chosen).allSelected.find((entry) => entry.key === 'preferredPropertyTypes');
  assert.equal(status('condo').met, true, 'either alternative counts');
  assert.equal(status('apartment').met, true);
  assert.equal(status('townhome').met, false);
  assert.equal(status(null).evaluated, false, 'unknown is never a miss, even as a Must-Have');
  // One Step 5 item, labelled as the building.
  assert.deepEqual(labelsByLevel(chosen).must, ['Building type (Apartment or Condo)']);
  assert.ok(prioritiesSummary(chosen).find((level) => level.tier === 'must').items.some((item) => item.label === 'Building type' && item.qualifier === 'Apartment or Condo'));
  // The live flow is unchanged.
  assert.deepEqual(chooseSearchType(normalizePriorities({}), 'apartment_rent').preferredPropertyTypes.values, ['apartment']);
});

test('Home to Rent keeps House / Townhome / Condo as alternatives, not separate requirements', () => {
  const chosen = moveGroup(pick(fresh('home_rent'), 'House', 'Townhome'), 'preferredPropertyTypes', 'must');
  assert.deepEqual(labelsByLevel(chosen).must, ['Property type (House or Townhome)']);
  const match = (propertyType) => computeMatch({ propertyType, checks: {}, ratings: {} }, chosen);
  assert.equal(match('townhome').mustMet, 1);
  assert.equal(match('condo').missing.length, 1);
  assert.equal(match(null).missing.length, 0);
});

/* --------------------------------- labels ---------------------------------- */

test('Steps 5 and 6 use the Step 4 words, for buyers and renters alike', () => {
  const buyer = pick(fresh('home_buy'), 'Great schools', 'Big backyard', 'Primary suite', 'House', 'Condo');
  assert.deepEqual(labelsByLevel(buyer).important, ['Great schools', 'Primary suite', 'Big backyard', 'Property type (House or Condo)']);
  const apartment = pick(fresh('apartment_rent'), 'Pet-friendly', 'Balcony / patio', 'Home office space');
  assert.deepEqual(labelsByLevel(apartment).important, ['Pet-friendly', 'Home office space', 'Balcony / patio']);
  assert.deepEqual(prioritiesSummary(apartment).find((level) => level.tier === 'important').items.map((item) => item.label), ['Pet-friendly', 'Home office space', 'Balcony / patio']);
  // Typed priorities keep their own words.
  const own = addCustomCriterion(fresh('home_rent'), 'features', 'Bike storage', []);
  assert.deepEqual(labelsByLevel(own).important, ['Bike storage']);
  assert.match(read('src/components/onboarding/RankStepV2.jsx'), /const levels = onboardingPriorityLevels\(priorities\);/);
  assert.match(read('src/lib/onboardingReview.js'), /return onboardingPriorityLevels\(raw\)/);
});

/* ------------------------- switching kinds of search ------------------------ */

test('switching search types keeps compatible answers at their levels and says what it removed', () => {
  let rent = { ...fresh('home_rent'), budget: { value: '2400', tier: 'important' }, bedsMin: { value: '2', tier: 'important' }, lotSizeTarget: { value: '0.25', tier: 'nice' } };
  rent = pick(rent, 'Pet-friendly', 'In-unit laundry', 'Great schools', 'Garage', 'House', 'Condo');
  rent = moveCriterion(rent, 'features', 'Pets Allowed', 'must');
  rent = addCustomCriterion(rent, 'features', 'Bike storage', []);

  const { priorities: apartment, removed } = switchSearchType(rent, 'apartment_rent');
  assert.deepEqual(removed, ['Great schools', 'Garage', 'House', 'Ideal lot size']);
  assert.equal(apartment.budget.value, '2400');
  assert.equal(apartment.bedsMin.value, '2');
  assert.equal(apartment.lotSizeTarget.value, '', 'a lot size never applies to an apartment');
  assert.deepEqual(apartment.preferredPropertyTypes.values, ['condo']);
  assert.deepEqual(labelsByLevel(apartment), { must: ['Pet-friendly'], important: ['In-unit laundry', 'Bike storage', 'Building type (Condo)'], nice: [] });
  // Match never scores a lot size for the apartment.
  assert.doesNotMatch(JSON.stringify(computeMatch({ lotSize: '0.1', checks: {}, ratings: {} }, apartment)), /lotSize/);

  // Back again: nothing compatible is lost.
  const back = switchSearchType(apartment, 'home_rent');
  assert.deepEqual(back.removed, []);
  assert.deepEqual(labelsByLevel(back.priorities), { must: ['Pet-friendly'], important: ['In-unit laundry', 'Bike storage', 'Property type (Condo)'], nice: [] });

  // A buyer's layout and condition don't silently linger when renting.
  const buyer = pick(fresh('home_buy'), 'Ranch', 'Move-in ready', 'Home office', 'Multifamily');
  const rented = switchSearchType(buyer, 'home_rent');
  assert.deepEqual(rented.removed, ['Multifamily', 'Ranch', 'Move-in ready']);
  assert.deepEqual(rented.priorities.homeLayout.values, []);
  assert.deepEqual(rented.priorities.homeCondition.values, []);
  assert.deepEqual(labelsByLevel(rented.priorities).important, ['Home office']);
  assert.doesNotMatch(JSON.stringify(computeMatch({ homeLayout: ['Two Story'], homeCondition: ['Move-In Ready'], checks: {}, ratings: {} }, rented.priorities)), /homeLayout|homeCondition/);
});

test('Step 1 shows what a switch removed, with Undo; the live flow is unchanged', () => {
  const basics = read('src/components/onboarding/BasicsStep.jsx');
  assert.match(basics, /const \{ priorities: next, removed \} = switchSearchType\(priorities, key\);/);
  // Switches add up: everything removed since the first one stays listed, and Undo goes back before it.
  assert.match(basics, /const all = \[\.\.\.new Set\(\[\.\.\.\(earlier\?\.removed \|\| \[\]\), \.\.\.removed\]\)\];\n\s+return all\.length \? \{ removed: all, previous: earlier\?\.previous \|\| priorities \} : null;/);
  assert.match(basics, /const undoSwitch = \(\) => \{ patch\(\(\) => switched\.previous\); setSwitched\(null\); \};/);
  assert.match(basics, /Removed what no longer applies: \{switched\.removed\.join\(', '\)\}\. Everything else is kept\./);
  assert.match(basics, /<button type="button" className="flh-text-action" onClick=\{undoSwitch\}>Undo<\/button>/);
  assert.match(basics, /if \(presetPropertyType\) \{ patch\(\(next\) => chooseSearchType\(next, key, \{ presetPropertyType \}\)\); return; \}/);
});

/* ----------------------------------- copy ---------------------------------- */

test('renters see Co-renter and Agent for the same roles; apartments add "my first apartment"', () => {
  assert.equal(peopleWords('home_rent').coBuyer, 'Co-renter');
  assert.equal(peopleWords('apartment_rent').realtor, 'Agent');
  assert.equal(peopleWords('home_buy').coBuyer, 'Co-buyer');
  assert.equal(peopleWords(null).realtor, 'Realtor');
  const lines = (searchType, choice, people = null, role = 'owner') => peopleSummary({ choice, people, role, searchType }).map((line) => line.text);
  assert.deepEqual(lines('apartment_rent', 'co_buyer_and_realtor'), ['You’d like to search with a co-renter', 'You’d like to work with an agent']);
  assert.deepEqual(lines('home_buy', 'co_buyer_and_realtor'), ['You’d like to search with a co-buyer', 'You’d like to work with a Realtor']);
  assert.deepEqual(lines('home_rent', null, { coBuyers: [{ name: null }], realtors: 1 }), ['You’re searching with a co-renter', 'Your agent is connected']);
  assert.deepEqual(lines('home_rent', null, { ownerName: 'Sam' }, 'co_buyer'), ['You’re searching with Sam']);
  // Only words change: the stored answer and roles are the same keys.
  const step = read('src/components/onboarding/CollaborationStep.jsx');
  assert.match(step, /\['co_buyer', 'realtor'\]\.map\(\(kind\) => \(/);
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /<CollaborationStep\n\s+searchType=\{priorities\.onboardingSearchType \|\| null\}/);
  assert.match(read('src/components/onboarding/ReviewStep.jsx'), /'Add my first apartment' : 'Add my first home'/);
});

/* --------------------------- Match and fact capture -------------------------- */

test('every rental pick reaches Match; unknown is never a mismatch; shared facts count when recorded', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    let priorities = fresh(type);
    for (const chip of offeredChips(priorities)) priorities = chip.type === 'criterion' ? toggleCriterion(priorities, chip) : toggleGroupValue(priorities, chip.group, chip.value);
    priorities = moveCriterion(priorities, 'features', 'Pets Allowed', 'must');
    const ranked = onboardingPriorityLevels(priorities).flatMap((level) => level.items);
    const unknown = computeMatch({ checks: {}, ratings: {} }, priorities);
    assert.equal(unknown.evaluatedCount, 0, type);
    assert.equal(unknown.missing.length, 0, `${type}: unknown is never missing`);
    // Nothing in Match is hidden from Steps 5–6.
    const visible = new Set(ranked.map((item) => (item.group ? item.categoryKey : item.key)));
    for (const criterion of unknown.allSelected) assert.ok(visible.has(criterion.key), `${type}: ${criterion.key} is shown in Step 5`);
    // A recorded shared fact counts (Yes and No), for a Must-Have too.
    const pets = (petsAllowed) => computeMatch({ petsAllowed, checks: {}, ratings: {} }, priorities).allSelected.find((entry) => entry.key === 'features:Pets Allowed');
    assert.equal(pets(true).met, true);
    assert.equal(pets(false).met, false);
    assert.equal(pets(null).evaluated, false);
    // A Yes/No recorded for a pre-tour fact counts.
    const parking = computeMatch({ checks: { 'exterior:Parking': 'no' }, ratings: {} }, priorities).allSelected.find((entry) => entry.key === 'exterior:Parking');
    assert.deepEqual([parking.evaluated, parking.met], [true, false]);
  }
});

test('Home to Rent listing text fills in its supported facts; typed priorities are never guessed', () => {
  const text = 'Finished basement. Central air. Home office. Fully fenced backyard. Assigned parking. Dishwasher.';
  let rent = pick(fresh('home_rent'), 'Home office', 'Fenced yard', 'Parking', 'Dishwasher', 'Finished Basement');
  rent = addCustomCriterion(rent, 'features', 'Central air conditioning', []);
  assert.deepEqual(derivePriorityCheckPatch(text, rent, {}), {
    'features:Finished basement': true, 'features:Home office': true, 'features:Dishwasher': true, 'exterior:Fenced yard': true, 'exterior:Parking': true,
  });
  // An answer someone already recorded is never overwritten.
  assert.deepEqual(derivePriorityCheckPatch(text, rent, { 'features:Home office': 'no' })['features:Home office'], undefined);
  // Shared facts come from the listing fields, never from personal checks.
  const apartment = pick(fresh('apartment_rent'), 'Pet-friendly', 'In-unit laundry');
  assert.deepEqual(derivePriorityCheckPatch('Pets allowed. In-unit laundry.', apartment, {}), {});
});

/* ------------------------------ real Postgres ------------------------------ */

register('./support/aliasHooks.mjs', import.meta.url);
const { acceptInvitation, createInvitation, resolvePriorities, savePriorities } = await import('../src/lib/supabase/collaboration.js');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('a co-renter’s rental preferences are their own: same search, independent picks and levels', async () => {
  const owner = db.createUser({ email: 'owner.rent@example.com' });
  const coRenter = db.createUser({ email: 'corenter.rent@example.com' });
  const search = { id: db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id, user_id: owner };
  const invitation = await createInvitation(db.clientFor(owner), search.id, owner, 'corenter.rent@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(coRenter), invitation.token)).success, true);

  const ownerPrefs = moveCriterion(pick(fresh('apartment_rent'), 'Pet-friendly', 'Apartment', 'Condo'), 'features', 'Pets Allowed', 'must');
  const coRenterPrefs = moveGroup(pick(fresh('apartment_rent'), 'In-unit laundry', 'Townhome'), 'preferredPropertyTypes', 'nice');
  await savePriorities(db.clientFor(owner), search, owner, ownerPrefs);
  await savePriorities(db.clientFor(coRenter), search, coRenter, coRenterPrefs);

  const ownerReloaded = normalizePriorities(await resolvePriorities(db.clientFor(owner), search, owner));
  const coRenterReloaded = normalizePriorities(await resolvePriorities(db.clientFor(coRenter), search, coRenter));
  assert.deepEqual(labelsByLevel(ownerReloaded), { must: ['Pet-friendly'], important: ['Building type (Apartment or Condo)'], nice: [] });
  assert.deepEqual(labelsByLevel(coRenterReloaded), { must: [], important: ['In-unit laundry'], nice: ['Building type (Townhome)'] });
  // The same townhome rental: each member's Match uses their own priorities.
  const home = { propertyType: 'townhome', petsAllowed: true, inUnitLaundry: null, checks: {}, ratings: {} };
  assert.equal(computeMatch(home, ownerReloaded).missing.length, 1, 'not an apartment or condo');
  assert.equal(computeMatch(home, coRenterReloaded).missing.length, 0, 'laundry unknown is not a miss');
});

/* --------------------------- follow-up QA (decisions) -------------------------- */

test('Parking, Off-street parking and Garage are three distinct priorities, each answered from its own source', () => {
  const where = (type) => Object.fromEntries(['Parking', 'Off-street parking', 'Garage'].map((text) => {
    const section = whatMattersSections(fresh(type)).find((entry) => entry.chips.some((chip) => chip.text === text));
    return [text, section ? section.title : chipByText(fresh(type), text) ? 'More to consider' : 'not offered'];
  }));
  assert.deepEqual(where('home_rent'), { Parking: 'Rental essentials', 'Off-street parking': 'More to consider', Garage: 'The home' });
  assert.deepEqual(where('apartment_rent'), { Parking: 'Rental essentials', 'Off-street parking': 'More to consider', Garage: 'not offered' });

  const all = pick(fresh('home_rent'), 'Parking', 'Off-street parking', 'Garage');
  const ranked = onboardingPriorityLevels(all).flatMap((level) => level.items);
  assert.deepEqual(ranked.map((item) => `${item.displayLabel} → ${item.key}`).sort(), [
    'Garage → exterior:Garage', 'Off-street parking → exterior:Driveway / Off-Street Parking', 'Parking → exterior:Parking',
  ]);
  const status = (home) => Object.fromEntries(computeMatch({ checks: {}, ratings: {}, ...home }, all).allSelected.map((entry) => [entry.key, entry.evaluated ? entry.met : 'unknown']));
  // Garage comes from garage spaces only; Parking and Off-street parking from their own answers only.
  assert.deepEqual(status({ garageSpaces: '2' }), { 'exterior:Parking': 'unknown', 'exterior:Driveway / Off-Street Parking': 'unknown', 'exterior:Garage': true });
  assert.deepEqual(status({ checks: { 'exterior:Parking': true } }), { 'exterior:Parking': true, 'exterior:Driveway / Off-Street Parking': 'unknown', 'exterior:Garage': 'unknown' });
  assert.deepEqual(status({}), { 'exterior:Parking': 'unknown', 'exterior:Driveway / Off-Street Parking': 'unknown', 'exterior:Garage': 'unknown' });
});

test('a rental lot size is never a Must-Have on its own: it is not ranked and only counts once given a level', () => {
  const rent = { ...fresh('home_rent'), lotSizeTarget: { ...fresh('home_rent').lotSizeTarget, value: '0.25' } };
  assert.equal(rent.lotSizeTarget.tier, 'dontcare', 'entering a lot size sets no importance');
  assert.ok(!onboardingPriorityLevels(rent).some((level) => level.items.some((item) => item.key === 'lotSize')));
  assert.doesNotMatch(JSON.stringify(computeMatch({ lotSize: '0.1', checks: {}, ratings: {}, price: '1' }, { ...rent, budget: { value: '2', tier: 'important' } })), /lotSize/);
  // Switching keeps it unranked (and clears it for an apartment).
  assert.equal(switchSearchType(rent, 'home_buy').priorities.lotSizeTarget.tier, 'dontcare');
  assert.equal(switchSearchType(rent, 'apartment_rent').priorities.lotSizeTarget.value, '');
});

test('the apartment Building type stays optional, visible and never preset — even across switches', () => {
  const section = (priorities) => whatMattersSections(priorities).find((entry) => entry.title === 'Building type');
  assert.deepEqual(section(fresh('apartment_rent')).chips.map((chip) => chip.text), ['Apartment', 'Condo', 'Townhome'], 'visible');
  assert.deepEqual(fresh('apartment_rent').preferredPropertyTypes.values, [], 'not preset');
  assert.ok(!onboardingPriorityLevels(fresh('apartment_rent')).some((level) => level.items.some((item) => item.group)), 'nothing ranked until chosen');
  let priorities = switchSearchType(fresh('home_rent'), 'apartment_rent').priorities;
  assert.deepEqual(priorities.preferredPropertyTypes.values, []);
  priorities = switchSearchType(switchSearchType(fresh('home_buy'), 'apartment_rent').priorities, 'home_rent').priorities;
  priorities = switchSearchType(priorities, 'apartment_rent').priorities;
  assert.deepEqual(priorities.preferredPropertyTypes.values, [], 'never preset after several switches');
});
