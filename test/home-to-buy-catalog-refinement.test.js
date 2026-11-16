// Home to Buy priority catalog refinement (PR #186). See
// docs/home-to-buy-catalog-refinement.md. The approved Home to Buy choices on
// phones and the desktop board; existing identities reused; nothing a buyer
// already saved is lost; rentals and earlier flows untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../src/lib/constants.js');
const { chooseSearchType } = await import('../src/lib/onboardingBasics.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { addCriterion, priorityLevels } = await import('../src/lib/searchProfile.js');
const { ONBOARDING_SUGGESTIONS } = await import('../src/lib/onboarding.js');
const { classifyListingText } = await import('../src/lib/listingTextAnswers.js');
const {
  GARAGE_TYPES, categoryView, earlierPreferences, featureLevel, garageType, otherChosenPriorities, priorityCategoriesFor, reviewCategories,
  setFeatureLevel, setGarageImportance, setGarageType, switchPrioritySearchType,
} = await import('../src/lib/priorityCategories.js');
const { BOARD_GARAGE_CHOICES, placeOnBoard, priorityBoard } = await import('../src/lib/priorityBoard.js');
const { featureDescription } = await import('../src/lib/featureDescriptions.js');
const { cardImage } = await import('../src/lib/onboardingImages.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = (type = 'home_buy') => chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
const screen = (type, key) => priorityCategoriesFor(fresh(type)).find((category) => category.key === key);
const offered = (type) => priorityCategoriesFor(fresh(type)).flatMap((category) => [...category.features, ...category.suggestions]);

test('Basics: V3 Home to Buy has no Home Preferences section; budget, beds, baths, sq ft and lot size stay', () => {
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  const basics = flow.slice(flow.indexOf('function BasicsQuestions('), flow.indexOf('const BASICS_TITLE'));
  assert.doesNotMatch(basics, /HomePreferences|homePreferenceRows|Home preferences/);
  for (const field of ['BudgetField', "label=\"Bedrooms\"", "label=\"Bathrooms\"", 'Ideal square footage']) assert.ok(basics.includes(field), field);
  assert.match(flow, /label="Ideal lot size"/, 'lot size still asked (Exterior & Property)');
  // The live flow's own Basics (flow 1) is a different screen and is unchanged.
  assert.match(read('src/components/onboarding/BasicsStep.jsx'), /<HomePreferences priorities=\{priorities\} patch=\{patch\} \/>/);
});

test('the approved Home to Buy choices, with their existing identities', () => {
  const ids = (key, field = 'features') => screen('home_buy', key)[field].map((feature) => [feature.text, feature.id]);
  assert.deepEqual(ids('layout'), [
    ['First-Floor Bedroom', 'features:First-Floor Bedroom'], ['Home Office', 'features:Home office'], ['Primary Ensuite', 'features:Primary ensuite'],
    ['Finished Basement', 'features:Finished basement'], ['Walkout Basement', 'features:Walkout basement'], ['Main Floor Laundry', 'features:First-floor laundry'],
  ]);
  assert.deepEqual(ids('kitchen')[0], ['Countertop Seating', 'features:Countertop Seating'], 'Countertop Seating is the first, photographed kitchen card');
  assert.equal(cardImage(screen('home_buy', 'kitchen').features[0].art).kind, 'photo');
  assert.deepEqual(GARAGE_TYPES.map((type) => type.text), ['Any Garage', 'Attached Garage', 'Detached Garage']);
  assert.deepEqual(ids('exterior'), [['Deck / Patio', 'exterior:Patio / deck'], ['Fenced Yard', 'exterior:Fenced yard'], ['Privacy Fence', 'exterior:Privacy Fencing']]);
  assert.deepEqual(ids('exterior', 'suggestions').map(([text]) => text), ['Mature Trees', 'Garden Space', 'Pool', 'Front Porch']);
  assert.deepEqual(ids('neighborhood').map(([text]) => text), ['Low-Traffic Street', 'Sidewalks', 'Tree-Lined Street', 'No HOA']);
  assert.deepEqual(ids('neighborhood', 'suggestions').map(([text]) => text), ['Cul-de-Sac']);
  const all = offered('home_buy').map((feature) => feature.text.toLowerCase());
  for (const gone of ['walkable neighborhood', 'near water', 'wooded setting', 'walkable schools', 'walkable to schools', 'first-floor laundry', 'second-floor laundry', 'room for entertaining', 'fire pit', 'workshop space']) {
    assert.ok(!all.includes(gone), `${gone} is not offered`);
  }
  // No duplicates: every offered identity appears once.
  const keys = offered('home_buy').map((feature) => feature.id.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  // The desktop board offers exactly the same catalog.
  const board = priorityBoard(placeOnBoard(fresh(), BOARD_GARAGE_CHOICES[0], 'nice'));
  const boardTexts = board.groups.filter((group) => !group.own).flatMap((group) => group.features.map((feature) => feature.text));
  for (const text of offered('home_buy').map((feature) => feature.text)) assert.ok(boardTexts.includes(text), `board: ${text}`);
  for (const text of ['Main Floor Laundry', 'Privacy Fence', 'Any Garage', 'Attached Garage', 'Detached Garage', 'Fenced Yard']) {
    assert.ok(!/^Your own|^A priority you chose/.test(featureDescription({ text })), `${text} has its own description`);
  }
});

test('desktop and phone writes are identical for every Home to Buy choice', () => {
  for (const feature of offered('home_buy')) {
    for (const tier of ['must', 'nice']) assert.deepEqual(placeOnBoard(fresh(), feature, tier), setFeatureLevel(fresh(), feature, tier), `${feature.text} ${tier}`);
  }
  for (const choice of BOARD_GARAGE_CHOICES) {
    assert.deepEqual(placeOnBoard(fresh(), choice, 'important'), setGarageType(setGarageImportance(fresh(), 'important'), choice.variant), choice.text);
  }
});

test('Main Floor Laundry is the existing First-floor laundry identity: saved choices and Home Facts answers keep working', () => {
  // A buyer who chose it under the old name sees it chosen under the new one.
  let p = addCriterion(fresh(), { categoryKey: 'features', label: 'First-floor laundry', kind: 'check' }, 'must');
  const card = categoryView(p, 'layout').cards.find((entry) => entry.text === 'Main Floor Laundry');
  assert.equal(card.level, 'must');
  assert.equal(otherChosenPriorities(p).some((item) => item.label === 'First-floor laundry'), false, 'not orphaned to "More of your priorities"');
  // Home Facts' laundry location still answers it (no Match change).
  const item = (home) => computeMatch({ price: '1', checks: {}, ...home }, p).allSelected.find((entry) => entry.key === 'features:First-floor laundry');
  assert.equal(item({ laundryLocation: 'first_floor' }).met, true);
  assert.equal(item({}).evaluated, false, 'Unknown is never No');
  // Finished and Walkout basement stay independent.
  p = setFeatureLevel(fresh(), screen('home_buy', 'layout').features.find((feature) => feature.text === 'Walkout Basement'), 'important');
  assert.equal(featureLevel(p, { categoryKey: 'features', label: 'Finished basement' }), null);
  assert.equal(featureLevel(p, { categoryKey: 'features', label: 'Walkout basement' }), 'important');
});

test('Privacy Fence is distinct from Fenced Yard and never inferred from it', () => {
  let p = setFeatureLevel(fresh(), { categoryKey: 'exterior', label: 'Fenced yard' }, 'important');
  p = setFeatureLevel(p, { categoryKey: 'exterior', label: 'Privacy Fencing' }, 'must');
  const keys = priorityLevels(p).flatMap((level) => level.items).map((entry) => entry.key);
  assert.ok(keys.includes('exterior:Fenced yard') && keys.includes('exterior:Privacy Fencing'), 'both can be chosen');
  // A home answered Yes for a fenced yard says nothing about a privacy fence.
  const match = computeMatch({ price: '1', checks: { 'exterior:Fenced yard': true } }, p);
  assert.equal(match.allSelected.find((entry) => entry.key === 'exterior:Fenced yard').met, true);
  assert.equal(match.allSelected.find((entry) => entry.key === 'exterior:Privacy Fencing').evaluated, false);
  // Listing text: a fenced yard is not a privacy fence; only explicit wording is.
  const concepts = (text) => classifyListingText(text).map((entry) => entry.concept);
  assert.deepEqual(concepts('Fully fenced backyard with a patio.').filter((concept) => /fence/i.test(concept)), ['fencedYard']);
  assert.ok(concepts('New privacy fence around the yard.').includes('privacyFence'));
  assert.equal(cardImage('privacy-fence').kind, 'photo');
});

test('garage: three choices are one Garage priority; switching kinds of search keeps heldGarage behaviour', () => {
  for (const choice of BOARD_GARAGE_CHOICES) {
    const p = placeOnBoard(fresh(), choice, 'must');
    assert.equal(priorityLevels(p).flatMap((level) => level.items).filter((entry) => entry.categoryKey === 'exterior' && /garage/i.test(entry.label)).length, 1, `${choice.text}: one criterion`);
    assert.equal(garageType(p), choice.variant);
    // Match still scores Garage from garage spaces, whatever the qualifier (no scoring change).
    assert.equal(computeMatch({ price: '1', garageSpaces: '2', checks: {} }, p).allSelected.find((entry) => entry.key === 'exterior:Garage').met, true);
    assert.equal(computeMatch({ price: '1', garageSpaces: '', checks: {} }, p).allSelected.find((entry) => entry.key === 'exterior:Garage').evaluated, false);
  }
  let p = placeOnBoard(fresh(), BOARD_GARAGE_CHOICES.find((choice) => choice.variant === 'detached'), 'important');
  p = switchPrioritySearchType(p, 'apartment_rent').priorities;
  assert.deepEqual(p.exterior.heldGarage, { house: { tier: 'important', garagePreference: 'detached' } });
  p = switchPrioritySearchType(p, 'home_buy').priorities;
  assert.deepEqual([featureLevel(p, { categoryKey: 'exterior', label: 'Garage' }), garageType(p)], ['important', 'detached']);
  assert.deepEqual(reviewCategories(p).find((category) => category.key === 'garage').garage, { importance: 'important', type: 'detached' });
});

test('nothing a buyer already saved is lost: removed choices stay chosen, counted and visible', () => {
  let p = fresh();
  const legacy = [
    ['location', 'Walkable schools'], ['location', 'Walkable Neighborhood'], ['location', 'Near waterfront'], ['location', 'Wooded Setting'],
    ['features', 'Second-Floor Laundry'], ['exterior', 'Room for Entertaining'], ['exterior', 'Fire Pit'], ['exterior', 'Workshop Space'],
  ];
  for (const [categoryKey, label] of legacy) p = addCriterion(p, { categoryKey, label, kind: 'check' }, 'important');
  p = { ...p, preferredPropertyTypes: { values: ['house'], tier: 'important' }, homeLayout: { values: ['Ranch / Single Story'], tier: 'nice' }, homeCondition: { values: ['Move-In Ready'], tier: 'important' } };
  const stored = normalizePriorities(p);
  const chosen = priorityLevels(stored).flatMap((level) => level.items).map((entry) => entry.key);
  for (const [categoryKey, label] of legacy) assert.ok(chosen.includes(`${categoryKey}:${label}`), `${label} still chosen and counted`);
  // Review lists them; the board shows each once, in its column.
  const others = otherChosenPriorities(stored).map((entry) => entry.label);
  for (const [, label] of legacy) assert.ok(others.includes(label), `${label} on Review (More of your priorities)`);
  const board = priorityBoard(stored);
  for (const [categoryKey, label] of legacy) assert.equal(board.columns.important.filter((feature) => feature.id === `${categoryKey}:${label}`).length, 1);
  // Home type, layout and condition: kept and shown read-only on Review.
  assert.deepEqual(earlierPreferences(stored).map((group) => group.key), ['preferredPropertyTypes', 'homeLayout', 'homeCondition']);
});

test('rentals, the live flow and the scorers are untouched', () => {
  const rentExterior = screen('home_rent', 'exterior');
  assert.deepEqual([...rentExterior.features, ...rentExterior.suggestions].map((feature) => feature.text), ['Deck / Patio', 'Fenced Yard', 'Mature Trees', 'Pool', 'Landscaping']);
  assert.deepEqual(screen('home_rent', 'rent_layout').suggestions.map((feature) => feature.text), ['Main Floor Laundry', 'Extra Bedroom', 'Front Porch']);
  assert.deepEqual(screen('home_rent', 'neighborhood').suggestions.map((feature) => feature.text), ['Cul-de-Sac', 'Parks Nearby', 'Reputable Schools']);
  assert.equal(offered('apartment_rent').some((feature) => /Privacy|Main Floor/.test(feature.text)), false);
  assert.equal(GARAGE_TYPES.length, 3);
  // Live flow (1) suggestions still include its own list (not this catalog).
  assert.ok(ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items).length > 0);
  // constants.js changes only the Main Floor Laundry display label (founder decision).
  for (const path of ['src/lib/matching.js', 'src/lib/onboarding.js', 'src/lib/onboardingFlow.js']) {
    assert.doesNotMatch(read(path), /PR #186/, `${path} is not part of this change`);
  }
});

/* ----------------------- founder decisions (PR #186) ---------------------- */

test('“Main Floor Laundry” everywhere a priority is shown; storage, Home Facts and listing wording unchanged', async () => {
  const { criterionDisplayLabel } = await import('../src/lib/constants.js');
  const { criterionLabel } = await import('../src/lib/matching.js');
  // Both stored spellings of the one identity read the same.
  assert.equal(criterionDisplayLabel('features', 'First-floor laundry'), 'Main Floor Laundry');
  assert.equal(criterionDisplayLabel('features', 'First-Floor Laundry'), 'Main Floor Laundry');
  const p = addCriterion(fresh(), { categoryKey: 'features', label: 'First-floor laundry', kind: 'check' }, 'important');
  const item = priorityLevels(p).flatMap((level) => level.items).find((entry) => entry.key === 'features:First-floor laundry');
  assert.equal(item.displayLabel, 'Main Floor Laundry', 'My Search / Review rows');
  assert.equal(criterionLabel({ key: 'features:First-floor laundry', label: 'First-floor laundry' }), 'Main Floor Laundry', 'Match rows');
  assert.equal(priorityBoard(p).columns.important[0].text, 'Main Floor Laundry', 'desktop board');
  assert.equal(categoryView(p, 'layout').cards.find((card) => card.id === 'features:First-floor laundry').text, 'Main Floor Laundry', 'phone card');
  assert.equal(p.features.tiers['First-floor laundry'], 'important', 'stored under the same identity');
  // Listing evidence still describes what a listing says.
  assert.match(read('src/lib/listingTextAnswers.js'), /firstFloorLaundry: \{ yesLabel: 'First-floor laundry'/);
  assert.match(read('src/lib/homeFactCriteria.js'), /firstFloorLaundry: Object\.freeze\(\['features:First-floor laundry', 'features:First-Floor Laundry'\]\)/);
});

test('Unfenced Yard chosen earlier is preserved; a contradiction with Fenced Yard / Privacy Fence is identified and editable, never auto-resolved', async () => {
  const { yardConflict } = await import('../src/lib/yardConflict.js');
  let p = addCriterion(fresh(), { categoryKey: 'exterior', label: 'Unfenced Yard', kind: 'check' }, 'nice'); // from the old Home Preferences
  assert.equal(yardConflict(p), null, 'one side alone is not a conflict');
  const fenced = screen('home_buy', 'exterior').features.find((feature) => feature.text === 'Fenced Yard');
  const privacy = screen('home_buy', 'exterior').features.find((feature) => feature.text === 'Privacy Fence');
  p = setFeatureLevel(p, fenced, 'important');
  p = placeOnBoard(p, privacy, 'must');
  const keys = priorityLevels(p).flatMap((level) => level.items).map((entry) => entry.key);
  assert.ok(keys.includes('exterior:Unfenced Yard'), 'never overwritten by choosing a fenced option');
  const conflict = yardConflict(p);
  assert.deepEqual([conflict.unfenced.text, conflict.fenced.map((feature) => feature.text).sort()], ['Unfenced Yard', ['Fenced Yard', 'Privacy Fence']]);
  assert.match(conflict.message, /Nothing changes until you choose/);
  // Editing either side is the ordinary write; removing Unfenced clears the conflict.
  const resolved = setFeatureLevel(p, conflict.unfenced, 'none');
  assert.equal(yardConflict(resolved), null);
  assert.equal(resolved.exterior.tiers['Unfenced Yard'], 'dontcare', 'kept in the document, just no longer chosen');
  assert.equal(yardConflict(setFeatureLevel(setFeatureLevel(p, fenced, 'none'), privacy, 'none')), null);
  // Shown where the buyer can act on it: Review, the phone Exterior screen, the desktop board.
  assert.match(read('src/components/onboarding/priority/PriorityReview.jsx'), /<YardConflictNote conflict=\{yardConflict\(priorities\)\}/);
  assert.match(read('src/components/onboarding/priority/PriorityFlow.jsx'), /category\.key === 'exterior' && <YardConflictNote conflict=\{yardConflict\(priorities\)\}/);
  assert.match(read('src/components/onboarding/priority/PriorityBoard.jsx'), /<YardConflictNote className="flh-ob-board-yard-conflict" conflict=\{yardConflict\(priorities\)\}/);
  assert.doesNotMatch(read('src/lib/yardConflict.js'), /setFeatureLevel|moveCriterion|removeCriterion|patch\(/, 'read-only');
});
