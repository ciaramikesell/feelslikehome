// Rental Foundations, Stage 1: the Home to Rent and Apartment to Rent screens,
// their stored identities and pictures. docs/rental-foundations-onboarding-spec.md
// §1 (screens), §3 (identities), §4 (A1–A9), §5 (photos), §8 (history).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePriorities } from '../src/lib/constants.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { computeMatch } from '../src/lib/matching.js';
import { answerableCriteriaKeys } from '../src/lib/matchCriteria.js';
import { CARD_WIDTHS, ONBOARDING_PHOTOS, cardImage } from '../src/lib/onboardingImages.js';
import { ONBOARDING_FLOWS, beginOnboarding, onboardingStepsFor, resumeOnboardingStep } from '../src/lib/onboardingFlow.js';
import { addCriterion, isCriterionSelected, priorityLevels } from '../src/lib/searchProfile.js';
import {
  PETS_QUESTION, PRIORITY_CATEGORIES, addOwnFeature, categoryView, featureLevel, normalizeFeatureKey, otherChosenPriorities,
  priorityCategoriesFor, reviewCategories, setFeatureLevel, storedFeatureLabel, switchPrioritySearchType,
} from '../src/lib/priorityCategories.js';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const fresh = (type) => chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
const offered = (raw) => priorityCategoriesFor(raw).flatMap((category) => [...category.features, ...category.suggestions]);
const rows = (raw, key, field) => priorityCategoriesFor(raw).find((category) => category.key === key)[field].map((feature) => [feature.text, feature.id]);
const selectedKeys = (raw) => priorityLevels(raw).flatMap((level) => level.items).map((item) => item.key);
const withBudget = (raw) => ({ ...raw, budget: { ...raw.budget, value: '3000' } });
const RENT_HOME = { price: '2400', checks: {}, ratings: {} };

/* -------------------------------- screens -------------------------------- */

test('screen order per search type (spec §1); Home to Buy unchanged', () => {
  assert.deepEqual(onboardingStepsFor(4, { answers: { searchType: 'home_rent' } }), [
    'search_type', 'basics', 'locations', 'cat_essentials', 'cat_rent_layout', 'cat_rent_features', 'cat_exterior', 'cat_neighborhood', 'review',
  ]);
  assert.deepEqual(onboardingStepsFor(4, { answers: { searchType: 'apartment_rent' } }), [
    'search_type', 'basics', 'locations', 'cat_essentials', 'cat_apt_unit', 'cat_apt_property', 'review',
  ]);
  assert.deepEqual(onboardingStepsFor(4, { answers: { searchType: 'home_buy' } }), [
    'search_type', 'basics', 'locations', 'cat_layout', 'cat_kitchen', 'cat_living', 'cat_bath', 'cat_garage', 'cat_exterior', 'cat_neighborhood', 'review',
  ]);
  // Live flow 1 and the six-step preview (flow 3) are untouched.
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  assert.deepEqual(ONBOARDING_FLOWS[3].steps.map((step) => step.key), ['basics', 'locations', 'collaboration', 'priorities', 'rank', 'review']);
});

test('a preview session stored on a screen its search no longer shows resumes at the first unfinished screen', () => {
  const context = { searchId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
  const stored = { step: 'cat_kitchen', completed: ['search_type', 'basics', 'locations', 'cat_essentials', 'cat_layout'], answers: { searchType: 'home_rent' }, startedAt: '2026-11-01T00:00:00.000Z' };
  assert.equal(resumeOnboardingStep(4, stored), 'cat_rent_layout');
  assert.equal(beginOnboarding({ storedVersion: 4, storedState: stored, context, targetVersion: 4 }).state.step, 'cat_rent_layout');
  assert.equal(resumeOnboardingStep(4, { ...stored, step: 'cat_exterior', answers: { searchType: 'apartment_rent' } }), 'cat_apt_unit');
});

test('Home to Buy screens are byte-for-byte unchanged (snapshot taken from main before this change)', () => {
  const snapshot = JSON.parse(read('test/fixtures/v3-home-buy-screens.json'));
  const p = fresh('home_buy');
  const categories = priorityCategoriesFor(p);
  const now = {
    steps: onboardingStepsFor(4, { answers: { searchType: 'home_buy' } }),
    categories,
    views: categories.map((category) => { const view = categoryView(p, category.key); return { key: category.key, cards: view.cards, suggestions: view.suggestions }; }),
    images: Object.fromEntries(categories.flatMap((category) => [...category.features, ...category.suggestions]).map((feature) => [feature.id, cardImage(feature.art)])),
  };
  // `only` (which searches a screen applies to) is internal metadata, never
  // rendered; Home to Buy screens gained it because rentals now have their own.
  const rendered = JSON.parse(JSON.stringify(now));
  for (const doc of [rendered, snapshot]) doc.categories.forEach((category) => { delete category.only; });
  assert.deepEqual(rendered, snapshot);
});

test('Home to Rent offers exactly the approved cards and suggestions, with their stored identities (§3)', () => {
  const p = fresh('home_rent');
  assert.deepEqual(priorityCategoriesFor(p).map((category) => category.key), ['essentials', 'rent_layout', 'rent_features', 'exterior', 'neighborhood']);
  assert.deepEqual(rows(p, 'essentials', 'features'), []);
  assert.deepEqual(rows(p, 'essentials', 'suggestions'), []);
  assert.deepEqual(rows(p, 'rent_layout', 'features'), [
    ['First-Floor Bedroom', 'features:First-Floor Bedroom'], ['Home Office', 'features:Home office'],
    ['Finished Basement', 'features:Finished basement'], ['Primary Ensuite Bathroom', 'features:Primary ensuite'],
  ]);
  assert.deepEqual(rows(p, 'rent_layout', 'suggestions'), [
    ['First-Floor Laundry', 'features:First-floor laundry'], ['Extra Bedroom', 'features:Extra Bedroom'], ['Front Porch', 'exterior:Front porch'],
  ]);
  assert.deepEqual(rows(p, 'rent_features', 'features'), [
    ['Kitchen Countertop Seating', 'features:Countertop Seating'], ['Stainless Steel Appliances', 'features:Stainless Steel Appliances'],
    ['Fireplace', 'features:Fireplace'], ['Central Air', 'features:Central Air'], ['Garage', 'exterior:Garage'],
  ]);
  assert.deepEqual(rows(p, 'rent_features', 'suggestions'), [
    ['Kitchen Island', 'features:Kitchen Island'], ['High Ceilings', 'features:High Ceilings'], ['In-Unit Laundry', 'features:In-Unit Laundry'],
    ['Dishwasher', 'features:Dishwasher'], ['Utilities Included', 'features:Utilities Included'], ['Off-Street Parking', 'exterior:Driveway / Off-Street Parking'],
  ]);
  assert.deepEqual(rows(p, 'exterior', 'features'), [['Deck / Patio', 'exterior:Patio / deck'], ['Fenced Yard', 'exterior:Fenced yard']]);
  assert.deepEqual(rows(p, 'exterior', 'suggestions'), [['Mature Trees', 'location:Mature Trees'], ['Pool', 'exterior:Pool'], ['Landscaping', 'exterior:Landscaping']]);
  assert.deepEqual(rows(p, 'neighborhood', 'features'), [['Low-Traffic Street', 'location:Low-Traffic Street'], ['Walkable Neighborhood', 'location:Walkable Neighborhood']]);
  assert.deepEqual(rows(p, 'neighborhood', 'suggestions'), [
    ['Cul-de-Sac', 'location:Cul-de-Sac'], ['Parks Nearby', 'location:Parks nearby'], ['Reputable Schools', 'location:Reputable Schools'],
  ]);
});

test('Apartment to Rent offers exactly The Unit and The Property, with their stored identities (§3)', () => {
  const p = fresh('apartment_rent');
  assert.deepEqual(priorityCategoriesFor(p).map((category) => category.key), ['essentials', 'apt_unit', 'apt_property']);
  assert.deepEqual(rows(p, 'apt_unit', 'features'), [
    ['In-Unit Laundry', 'features:In-Unit Laundry'], ['Home Office Space', 'features:Home Office'], ['Central Air', 'features:Central Air'],
  ]);
  assert.deepEqual(rows(p, 'apt_unit', 'suggestions'), [
    ['Private Garage', 'exterior:Private Garage'], ['Private Outdoor Space', 'exterior:Patio / Deck / Outdoor Living'],
    ['Dishwasher', 'features:Dishwasher'], ['Utilities Included', 'features:Utilities Included'],
  ]);
  assert.deepEqual(rows(p, 'apt_property', 'features'), [['Fitness Center', 'exterior:Fitness Center'], ['Pool', 'exterior:Pool'], ['Garage Parking', 'exterior:Garage']]);
  assert.deepEqual(rows(p, 'apt_property', 'suggestions'), [['Elevator', 'exterior:Elevator'], ['Sufficient Parking', 'exterior:Parking'], ['Secure Entry', 'exterior:Secure Entry']]);
});

test('removed items are no longer offered in either rental flow (§1)', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    const texts = offered(fresh(type)).map((feature) => feature.text.toLowerCase());
    for (const gone of ['pet-friendly', 'pets allowed', 'guest bedroom', 'large backyard', 'privacy fencing', 'walkable to schools', 'near water', 'near waterfront',
      'bustling street', 'walkable to town', 'quiet street', 'updated interior', 'quiet community', 'privacy', 'storage unit', 'package room', 'dead-end street',
      'double vanity', 'soaking tub', 'walk-in pantry', 'eat-in kitchen', 'formal dining room', 'workbench', 'sidewalks', 'tree-lined street']) {
      assert.ok(!texts.includes(gone), `${type}: ${gone}`);
    }
  }
  // Rental Essentials is a question screen: no ranked Pet-Friendly card anywhere.
  for (const type of ['home_rent', 'apartment_rent']) {
    assert.ok(!offered(fresh(type)).some((feature) => feature.id === 'features:Pets Allowed'), type);
    assert.equal(priorityCategoriesFor(fresh(type))[0].question, PETS_QUESTION);
    assert.deepEqual(categoryView(fresh(type), 'essentials').cards, []);
  }
});

/* ------------------------------- identities ------------------------------- */

test('every rental card maps to exactly one answerable identity, and no two cards in a flow share one', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    const base = withBudget(fresh(type));
    const features = offered(base);
    const keys = features.map((feature) => normalizeFeatureKey(feature.id));
    assert.equal(new Set(keys).size, keys.length, `${type}: no shared identities`);
    for (const feature of features) {
      assert.equal(feature.kind, 'check', feature.id);
      const chosen = setFeatureLevel(base, feature, 'important');
      // One new selected criterion, under exactly the card's identity.
      assert.deepEqual(selectedKeys(chosen).filter((key) => !selectedKeys(base).includes(key)), [feature.id], `${type} ${feature.id}`);
      // Answerable Yes / No / Unknown on the home workspace (the shared facts
      // and Garage's Home Fact are answered there as well).
      assert.ok(answerableCriteriaKeys(chosen).has(feature.id), `${type} ${feature.id} is answerable`);
      // Scored once: unknown until answered, never a mismatch.
      const match = computeMatch(RENT_HOME, chosen);
      assert.deepEqual([match.selectedCount, match.evaluatedCount], [2, 1], `${type} ${feature.id}`);
      assert.equal(featureLevel(chosen, feature), 'important');
    }
  }
});

test('D6: former essentials are optional suggestions; nothing is preselected or mandatory', () => {
  for (const [type, screens] of [['home_rent', ['rent_layout', 'rent_features', 'exterior', 'neighborhood']], ['apartment_rent', ['apt_unit', 'apt_property']]]) {
    const p = fresh(type);
    for (const key of screens) assert.equal(categoryView(p, key).chosenCount, 0, `${type} ${key}`);
    assert.deepEqual(selectedKeys(p), [], `${type}: no criterion is selected by choosing the search type`);
  }
  const roles = Object.fromEntries(offered(fresh('home_rent')).map((feature) => [feature.id, feature.role]));
  for (const id of ['features:In-Unit Laundry', 'features:Dishwasher', 'features:Utilities Included', 'exterior:Driveway / Off-Street Parking']) assert.equal(roles[id], 'suggestion', id);
  assert.equal(roles['features:Central Air'], 'feature');
  const apartment = Object.fromEntries(offered(fresh('apartment_rent')).map((feature) => [feature.id, feature.role]));
  assert.equal(apartment['features:Utilities Included'], 'suggestion');
});

test('the rental essentials use one identity in both rental flows', () => {
  const ids = (type) => new Set(offered(fresh(type)).map((feature) => feature.id));
  for (const id of ['features:In-Unit Laundry', 'features:Utilities Included', 'features:Central Air', 'features:Dishwasher']) {
    assert.ok(ids('home_rent').has(id) && ids('apartment_rent').has(id), id);
  }
});

test('D3: Extra Bedroom is the renter’s own Yes/No, separate from the Basics bedroom count', () => {
  let p = withBudget(fresh('home_rent'));
  const extra = offered(p).find((feature) => feature.id === 'features:Extra Bedroom');
  assert.deepEqual([extra.custom, extra.hint], [true, 'An extra bedroom beyond the minimum you entered in Basics.']);
  p = { ...p, bedsMin: { ...p.bedsMin, value: '3' } };
  const chosen = setFeatureLevel(p, extra, 'must');
  assert.equal(chosen.bedsMin.value, '3', 'choosing it never changes the bedroom minimum');
  assert.deepEqual(chosen.features.customItems.find((item) => item.label === 'Extra Bedroom'), { label: 'Extra Bedroom', kind: 'check', source: 'custom', group: 'rent_layout' });
  // A home with four bedrooms does not answer it: still Unknown.
  const unknown = computeMatch({ ...RENT_HOME, beds: '4' }, { ...chosen, bedsMin: { ...chosen.bedsMin, tier: 'dontcare' } });
  assert.equal(unknown.evaluatedCount, 1, 'only the budget is evaluated; Extra Bedroom stays Unknown');
  const yes = computeMatch({ ...RENT_HOME, beds: '4', checks: { 'features:Extra Bedroom': true } }, { ...chosen, bedsMin: { ...chosen.bedsMin, tier: 'dontcare' } });
  assert.equal(yes.evaluatedCount, 2, 'answered by the renter');
});

test('D1 / A5 / M3: Private Garage is never inferred from a garage count; Garage Parking is', () => {
  let p = withBudget(fresh('apartment_rent'));
  const [privateGarage, garageParking] = ['exterior:Private Garage', 'exterior:Garage'].map((id) => offered(p).find((feature) => feature.id === id));
  assert.equal(privateGarage.custom, true);
  assert.equal(privateGarage.hint, 'A garage for your unit only.');
  assert.equal(garageParking.custom, false);
  p = setFeatureLevel(p, privateGarage, 'must');
  const home = { ...RENT_HOME, garageSpaces: '120' };
  assert.equal(computeMatch(home, p).evaluatedCount, 1, 'a building with 120 garage spaces does not answer Private Garage');
  p = setFeatureLevel(p, garageParking, 'important');
  assert.equal(computeMatch(home, p).evaluatedCount, 2, 'Garage Parking is answered by the garage spaces Home Fact');
  assert.equal(computeMatch({ ...home, checks: { 'exterior:Private Garage': true } }, p).evaluatedCount, 3);
});

test('A1: a card reads and writes the case variant already stored, so nothing is scored twice (rentals only)', () => {
  // A live-flow Home to Rent document: "Central air", "Fenced Yard" (rental catalog), "Home Office".
  let p = withBudget(fresh('home_rent'));
  p = addCriterion(p, { categoryKey: 'features', label: 'Central air', kind: 'check' }, 'important');
  p = addCriterion(p, { categoryKey: 'exterior', label: 'Fenced Yard', kind: 'check' }, 'nice');
  p = addCriterion(p, { categoryKey: 'features', label: 'Home Office', kind: 'check' }, 'must');
  const card = (id) => offered(p).find((feature) => feature.id === id);
  const before = computeMatch(RENT_HOME, p).selectedCount;
  for (const [id, stored, level] of [['features:Central Air', 'Central air', 'important'], ['exterior:Fenced yard', 'Fenced Yard', 'nice'], ['features:Home office', 'Home Office', 'must']]) {
    assert.equal(storedFeatureLabel(p, card(id)), stored, id);
    assert.equal(featureLevel(p, card(id)), level, `${id} shows the stored variant as chosen`);
    const next = setFeatureLevel(p, card(id), 'nice');
    const [categoryKey] = id.split(':');
    assert.equal(next[categoryKey].tiers[stored], 'nice', `${id} updates ${stored}`);
    assert.equal(next[categoryKey].tiers[card(id).label], undefined, `${id} never adds the other variant`);
    assert.equal(computeMatch(RENT_HOME, next).selectedCount, before);
    assert.equal(computeMatch(RENT_HOME, setFeatureLevel(p, card(id), 'none')).selectedCount, before - 1);
  }
  // A variant stored but deselected is reused rather than adding a second identity.
  const off = setFeatureLevel(p, card('features:Central Air'), 'none');
  const again = setFeatureLevel(off, card('features:Central Air'), 'must');
  assert.deepEqual([again.features.tiers['Central air'], again.features.tiers['Central Air']], ['must', undefined]);
  // A rating with the same letters is a different criterion, never a variant.
  let parks = addCriterion(withBudget(fresh('home_rent')), { categoryKey: 'location', label: 'Parks Nearby', kind: 'rating' }, 'important');
  const parksCard = offered(parks).find((feature) => feature.id === 'location:Parks nearby');
  assert.equal(featureLevel(parks, parksCard), null);
  parks = setFeatureLevel(parks, parksCard, 'nice');
  assert.deepEqual([parks.location.tiers['Parks nearby'], parks.location.tiers['Parks Nearby']], ['nice', 'important'], 'the earlier rating is kept as saved');
  // Home to Buy is unchanged: its cards use their own label (the purchase alias fold handles variants).
  const buy = addCriterion(fresh('home_buy'), { categoryKey: 'features', label: 'Home Office', kind: 'check' }, 'must');
  assert.equal(storedFeatureLabel(buy, { categoryKey: 'features', label: 'Home office', custom: false }), 'Home office');
});

test('A1: switching between the rental flows never leaves two selected case variants', () => {
  let p = fresh('apartment_rent');
  for (const feature of offered(p)) p = setFeatureLevel(p, feature, 'important');
  for (const type of ['home_rent', 'apartment_rent', 'home_rent', 'home_buy', 'home_rent']) {
    p = switchPrioritySearchType(p, type).priorities;
    for (const categoryKey of ['features', 'exterior', 'location']) {
      const chosen = Object.entries(p[categoryKey].tiers).filter(([label]) => isCriterionSelected(p, categoryKey, label)).map(([label]) => normalizeFeatureKey(label));
      assert.equal(new Set(chosen).size, chosen.length, `${type} ${categoryKey}: ${chosen}`);
    }
  }
});

test('A2 / A4 / A8: Add your own never selects an unanswerable rental rating', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    const p = withBudget(fresh(type));
    const screen = type === 'home_rent' ? 'rent_features' : 'apt_unit';
    for (const typed of ['Walkability', 'Groceries Nearby', 'Dog Parks Nearby', 'Restaurants / Coffee / Shopping Nearby', 'parks nearby']) {
      const result = addOwnFeature(p, screen, typed);
      assert.ok(result.feature, `${type} ${typed}`);
      const chosen = setFeatureLevel(result.priorities, result.feature, 'important');
      assert.ok(answerableCriteriaKeys(chosen).has(result.feature.id), `${type} ${typed} → ${result.feature.id} is answerable`);
      if (type === 'home_rent' && typed === 'parks nearby') assert.equal(result.feature.id, 'location:Parks nearby', 'the offered Yes/No card (A2)');
    }
    // A broad name that would collide with an existing unanswerable item: nothing is created.
    const broad = addOwnFeature(p, type === 'home_rent' ? 'neighborhood' : 'apt_property', 'Neighborhood');
    if (type === 'home_rent') {
      assert.equal(broad.feature, null);
      assert.match(broad.error, /too broad/);
      assert.deepEqual(broad.priorities, p);
    } else {
      // On The Property (exterior) it is simply the renter's own Yes/No.
      assert.equal(broad.feature.categoryKey, 'exterior');
    }
    // A4: "Outdoor Space" finds the apartment card, not the after-tour rating.
    if (type === 'apartment_rent') assert.equal(addOwnFeature(p, 'apt_property', 'outdoor space').feature.id, 'exterior:Patio / Deck / Outdoor Living');
    // Tour criteria are still found (they are answered after a tour).
    assert.equal(addOwnFeature(p, screen, 'Noise Level').feature.id, 'exterior:Noise Level');
  }
  // An unanswerable item the renter already chose is reused, never duplicated.
  const earlier = addCriterion(fresh('apartment_rent'), { categoryKey: 'location', label: 'Walkability', kind: 'rating' }, 'nice');
  const reused = addOwnFeature(earlier, 'apt_unit', 'walkability');
  assert.equal(reused.feature.id, 'location:Walkability');
  assert.deepEqual(reused.priorities, earlier);
  // Home to Buy keeps today's behavior.
  assert.equal(addOwnFeature(fresh('home_buy'), 'kitchen', 'central air').feature.id, 'features:Central air');
});

test('Add your own never creates a case-variant duplicate of a rental card', () => {
  let p = fresh('home_rent');
  for (const [screen, typed, id] of [['rent_layout', 'home office', 'features:Home office'], ['rent_features', 'CENTRAL AIR', 'features:Central Air'], ['exterior', 'fenced-yard', 'exterior:Fenced yard'],
    ['rent_features', 'kitchen countertop seating', 'features:Countertop Seating'], ['rent_features', 'off street parking', 'exterior:Driveway / Off-Street Parking'], ['rent_layout', 'extra  bedroom', 'features:Extra Bedroom']]) {
    const result = addOwnFeature(p, screen, typed);
    assert.equal(result.feature.id, id, typed);
    p = setFeatureLevel(result.priorities, result.feature, 'important');
  }
  const again = addOwnFeature(p, 'rent_layout', 'Extra Bedroom');
  assert.equal(again.priorities.features.customItems.filter((item) => normalizeFeatureKey(item.label) === 'extrabedroom').length, 1);
  const apartment = addOwnFeature(fresh('apartment_rent'), 'apt_property', 'private garage');
  assert.equal(apartment.feature.id, 'exterior:Private Garage');
  assert.equal(apartment.homeCategory, 'apt_unit');
});

/* ------------------------------- history ------------------------------- */

test('§8: items removed from onboarding stay saved, counted in Match and editable on Review', () => {
  let rent = withBudget(fresh('home_rent'));
  for (const [categoryKey, label] of [['features', 'Guest Bedroom'], ['exterior', 'Large backyard'], ['exterior', 'Privacy Fencing'], ['location', 'Walkable to Town'],
    ['location', 'Quiet street'], ['location', 'Walkable schools'], ['location', 'Bustling Street'], ['location', 'Near waterfront'], ['exterior', 'Parking']]) {
    rent = addCriterion(rent, { categoryKey, label, kind: 'check' }, 'important');
  }
  rent = { ...rent, features: { ...rent.features, customItems: [...rent.features.customItems, { label: 'Storage Unit', kind: 'check', source: 'custom', group: 'essentials' }], tiers: { ...rent.features.tiers, 'Storage Unit': 'nice' } } };
  const other = otherChosenPriorities(rent).map((item) => item.id);
  for (const id of ['features:Guest Bedroom', 'exterior:Large backyard', 'exterior:Privacy Fencing', 'location:Walkable to Town', 'location:Quiet street', 'location:Walkable schools', 'location:Bustling Street', 'location:Near waterfront', 'exterior:Parking', 'features:Storage Unit']) {
    assert.ok(other.includes(id), `${id} is under More of your priorities`);
  }
  assert.equal(computeMatch(RENT_HOME, rent).selectedCount, 11, 'budget + all ten still count');
  assert.ok(!reviewCategories(rent).some((category) => category.chosen.some((item) => item.label === 'Storage Unit')), 'not on the question screen');

  let apartment = withBudget(fresh('apartment_rent'));
  for (const [categoryKey, label, kind] of [['features', 'Updated Interior', 'check'], ['exterior', 'Outdoor Space', 'rating'], ['exterior', 'Noise Level', 'rating'], ['homeFeel', 'Privacy', 'rating'], ['features', 'Walk-In Closet', 'check']]) {
    apartment = addCriterion(apartment, { categoryKey, label, kind }, 'important');
  }
  const kept = otherChosenPriorities(apartment).map((item) => item.id);
  for (const id of ['features:Updated Interior', 'exterior:Outdoor Space', 'exterior:Noise Level', 'homeFeel:Privacy', 'features:Walk-In Closet']) assert.ok(kept.includes(id), id);
  assert.equal(computeMatch(RENT_HOME, apartment).selectedCount, 6);
});

test('switching rental type keeps what the new flow offers and lists what it removes', () => {
  let p = fresh('home_rent');
  const pick = (id, tier) => { p = setFeatureLevel(p, offered(p).find((feature) => feature.id === id), tier); };
  pick('features:Central Air', 'must');
  pick('features:In-Unit Laundry', 'important');
  pick('exterior:Garage', 'nice');
  pick('exterior:Fenced yard', 'important');
  const { priorities, removed } = switchPrioritySearchType(p, 'apartment_rent');
  const level = (id) => featureLevel(priorities, offered(priorities).find((feature) => feature.id === id));
  assert.deepEqual([level('features:Central Air'), level('features:In-Unit Laundry'), level('exterior:Garage')], ['must', 'important', 'nice']);
  assert.ok(removed.some((label) => /^fenced yard$/i.test(label)), JSON.stringify(removed));
});

/* --------------------------------- images --------------------------------- */

const RENTAL_UPLOADS = ['extra-bedroom', 'landscaping', 'parks-nearby', 'fitness-center', 'elevator', 'secure-entry', 'sufficient-parking', 'dishwasher', 'apartment-balcony', 'apartment-parking-garage', 'pet-friendly'];

test('§5: all 11 rental photos are in the explicit manifest, with card-sized derivatives; originals unchanged', () => {
  for (const key of RENTAL_UPLOADS) {
    assert.equal(ONBOARDING_PHOTOS[key].file, `${key}.webp`, key);
    assert.equal(cardImage(key).kind, 'photo', key);
    for (const width of CARD_WIDTHS) {
      const size = statSync(new URL(`public/images/onboarding/cards/${key}-${width}.webp`, ROOT)).size;
      assert.ok(size <= (width === 400 ? 60 : 120) * 1024, `${key}-${width} is ${Math.round(size / 1024)} KB`);
    }
  }
  // The script writes only derivatives; it never writes into the originals' folder.
  const script = read('scripts/visual/onboarding-card-images.mjs');
  assert.match(script, /const OUT = join\(SRC, 'cards'\)/);
  assert.match(script, /join\(OUT, `\$\{key\}-\$\{width\}\.webp`\)/);
  assert.ok(readdirSync(new URL('public/images/onboarding/', ROOT)).filter((file) => file.endsWith('.webp')).length >= 48);
});

test('§5: cards use the approved pictures; apartments never use house Pool or Deck photography', () => {
  const art = (type) => Object.fromEntries(offered(fresh(type)).map((feature) => [feature.id, feature.art]));
  const rent = art('home_rent');
  assert.deepEqual([rent['features:Extra Bedroom'], rent['exterior:Landscaping'], rent['location:Parks nearby'], rent['features:Dishwasher'], rent['exterior:Pool'], rent['exterior:Patio / deck']],
    ['extra-bedroom', 'landscaping', 'parks-nearby', 'dishwasher', 'pool', 'deck-patio']);
  const apartment = art('apartment_rent');
  assert.deepEqual([apartment['exterior:Fitness Center'], apartment['exterior:Elevator'], apartment['exterior:Secure Entry'], apartment['exterior:Parking'], apartment['features:Dishwasher'],
    apartment['exterior:Patio / Deck / Outdoor Living'], apartment['exterior:Garage']], ['fitness-center', 'elevator', 'secure-entry', 'sufficient-parking', 'dishwasher', 'apartment-balcony', 'apartment-parking-garage']);
  for (const feature of offered(fresh('apartment_rent'))) {
    assert.ok(!['pool', 'deck-patio', 'fenced-yard', 'garden'].includes(feature.art), `${feature.id} uses ${feature.art}`);
  }
  // D5: icons for missing or abstract pictures; In-Unit Laundry keeps its illustration.
  const icons = (type) => offered(fresh(type)).filter((feature) => !feature.art).map((feature) => [feature.id, feature.icon]);
  assert.deepEqual(icons('home_rent'), [['features:Central Air', 'AirVent'], ['exterior:Garage', 'Warehouse'], ['features:Utilities Included', 'PlugZap'],
    ['exterior:Driveway / Off-Street Parking', 'Car'], ['location:Walkable Neighborhood', 'Store'], ['location:Reputable Schools', 'School']]);
  assert.deepEqual(icons('apartment_rent'), [['features:Central Air', 'AirVent'], ['exterior:Private Garage', 'Warehouse'], ['features:Utilities Included', 'PlugZap'], ['exterior:Pool', 'Waves']]);
  assert.equal(cardImage('in-unit-laundry').kind, 'illustration');
  // Reputable Schools never reuses the Walkable to Schools photo.
  assert.notEqual(offered(fresh('home_rent')).find((feature) => feature.id === 'location:Reputable Schools').art, 'walkable-schools');
  // The pet photo belongs to the question, never a ranked card.
  assert.equal(PETS_QUESTION.art, 'pet-friendly');
  assert.ok(!PRIORITY_CATEGORIES.some((category) => [...category.features, ...category.suggestions].some((feature) => feature.art === 'pet-friendly')));
  // Every icon is one FeatureVisual can draw.
  const visual = read('src/components/onboarding/priority/FeatureVisual.jsx');
  const iconMap = visual.slice(visual.indexOf('const ICONS = {'), visual.indexOf('};', visual.indexOf('const ICONS = {')));
  for (const icon of new Set(PRIORITY_CATEGORIES.flatMap((category) => [...category.features, ...category.suggestions, ...(category.question ? [category.question] : [])]).map((feature) => feature.icon))) {
    assert.match(iconMap, new RegExp(`\\b${icon}\\b`), icon);
  }
});

test('the question screen shows no cards or Add your own (its UI is Stage 3); CriteriaPicker stays unused', () => {
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(flow, /const showFeatures = !category\.question && /);
  const imports = readdirSync(new URL('src/', ROOT), { recursive: true })
    .filter((file) => /\.(js|jsx)$/.test(file))
    .filter((file) => /from ['"][^'"]*CriteriaPicker['"]/.test(readFileSync(join(new URL('src/', ROOT).pathname, file), 'utf8')));
  assert.deepEqual(imports, [], 'CriteriaPicker (a direct tiers write) is not used by any screen');
});
