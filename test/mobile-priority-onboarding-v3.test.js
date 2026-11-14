// Mobile Priority Onboarding V3 (flow 4): category screens over the existing
// priority document. See docs/mobile-priority-onboarding-v3.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { CARD_WIDTHS, ONBOARDING_ILLUSTRATIONS, ONBOARDING_PHOTOS, cardImage } from '../src/lib/onboardingImages.js';
import {
  CURRENT_ONBOARDING_VERSION, advanceOnboarding, beginOnboarding, isLegacyOnboardedProfile, normalizeOnboardingState,
  onboardingStepsFor, resumeOnboardingStep, retreatOnboarding, setOnboardingSearchType, skipOnboardingStep,
} from '../src/lib/onboardingFlow.js';
import { onboardingV3Enabled } from '../src/lib/featureFlags.js';
import { getItemlistCategories, isRetiredPurchaseBuiltIn, normalizePriorities } from '../src/lib/constants.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { computeMatch } from '../src/lib/matching.js';
import { addCriterion, isCriterionSelected, priorityLevels } from '../src/lib/searchProfile.js';
import {
  GARAGE_TYPES, PRIORITY_CATEGORIES, PRIORITY_CATEGORY_STEPS, addOwnFeature, categoryView, cleanFeatureLabel, earlierPreferences, featureLevel,
  garageImportance, garageType, normalizeFeatureKey, otherChosenPriorities, priorityCategoriesFor, renameOwnFeature, reviewCategories,
  setFeatureLevel, setGarageImportance, setGarageType, switchPrioritySearchType,
} from '../src/lib/priorityCategories.js';

const OWN = { searchId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
const T0 = '2026-11-14T12:00:00.000Z';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = (type = 'home_buy') => chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
const texts = (raw, key, field = 'features') => priorityCategoriesFor(raw).find((category) => category.key === key)[field].map((feature) => feature.text);

/* ------------------------------ release safety ------------------------------ */

test('the live flow is unchanged: version 1 by default, flow 4 only behind FLH_ONBOARDING_V3', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  assert.equal(onboardingV3Enabled({}), false);
  assert.equal(onboardingV3Enabled({ FLH_ONBOARDING_V3: 'off' }), false);
  assert.equal(onboardingV3Enabled({ FLH_ONBOARDING_V3: 'on' }), true);
  const page = read('src/app/onboarding/page.js');
  assert.match(page, /onboardingV3Enabled\(\) \? 4 : CURRENT_ONBOARDING_VERSION/);
  assert.match(page, /beginOnboarding\(\{ context: \{ searchId: search\.id, role \}, targetVersion \}\)/, 'shared-search setup uses the same target');
  assert.match(page, /context: \{ searchId: search\.id, role \},\n    targetVersion,/, 'account onboarding uses the same target');
});

test('completed accounts are never re-routed (gate and legacy rule untouched)', () => {
  assert.equal(isLegacyOnboardedProfile({ onboarding_complete: true, onboarding_version: null }), true);
  assert.match(read('src/app/onboarding/page.js'), /needsSharedSearchSetup/);
});

/* ---------------------------------- flow 4 ---------------------------------- */

test('flow 4: one category per screen, ten question screens for a buyer, then Review', () => {
  const buy = onboardingStepsFor(4, { answers: { searchType: 'home_buy' } });
  assert.deepEqual(buy, ['search_type', 'basics', 'locations', 'cat_layout', 'cat_kitchen', 'cat_living', 'cat_bath', 'cat_garage', 'cat_exterior', 'cat_neighborhood', 'review']);
  assert.deepEqual(onboardingStepsFor(4, {}), buy, 'before the type is chosen, the buyer screens are shown');
  // Rentals: docs/rental-foundations-onboarding-spec.md §1 (exact order in test/rental-foundations-onboarding.test.js).
  const rent = onboardingStepsFor(4, { answers: { searchType: 'home_rent' } });
  assert.ok(rent.includes('cat_essentials') && !rent.includes('cat_garage') && !rent.includes('cat_kitchen'));
  const apartment = onboardingStepsFor(4, { answers: { searchType: 'apartment_rent' } });
  assert.ok(apartment.includes('cat_essentials') && !apartment.includes('cat_garage') && !apartment.includes('cat_exterior'));
  for (const step of PRIORITY_CATEGORY_STEPS) assert.ok(rent.includes(step) || buy.includes(step) || apartment.includes(step), step);
});

test('state keeps the search type and skipped screens, and drops anything invalid', () => {
  const state = normalizeOnboardingState({ step: 'cat_kitchen', skipped: ['cat_kitchen', 'bogus'], answers: { searchType: 'castle' } });
  assert.deepEqual(state.skipped, ['cat_kitchen']);
  assert.equal(state.answers.searchType, undefined);
  assert.equal(setOnboardingSearchType(state, 'apartment_rent', T0).answers.searchType, 'apartment_rent');
  assert.equal(setOnboardingSearchType(state, 'castle', T0).answers.searchType, undefined);
});

test('Skip moves on without touching answers; Continue later clears the mark; resume never returns to a skipped screen', () => {
  let state = beginOnboarding({ context: OWN, now: T0, targetVersion: 4 }).state;
  assert.equal(state.step, 'search_type');
  state = advanceOnboarding(4, state, 'search_type', T0).state;
  state = skipOnboardingStep(4, state, 'basics', T0).state;
  assert.equal(state.step, 'locations');
  assert.deepEqual(state.skipped, ['basics']);
  assert.ok(state.completed.includes('basics'));
  const resumed = beginOnboarding({ storedVersion: 4, storedState: { ...state, step: null }, context: OWN, now: T0, targetVersion: 4 });
  assert.equal(resumed.state.step, 'locations');
  assert.deepEqual(resumed.state.skipped, ['basics']);
  state = retreatOnboarding(4, state, 'locations', T0);
  assert.equal(state.step, 'basics');
  state = advanceOnboarding(4, state, 'basics', T0).state;
  assert.deepEqual(state.skipped, []);
});

test('a session started in the live flow carries finished screens into flow 4', () => {
  const v1 = advanceOnboarding(1, beginOnboarding({ context: OWN, now: T0 }).state, 'basics', T0).state;
  const moved = beginOnboarding({ storedVersion: 1, storedState: v1, context: OWN, now: T0, targetVersion: 4 });
  assert.equal(moved.version, 4);
  assert.deepEqual(moved.state.completed, ['basics']);
  assert.equal(moved.state.step, 'search_type', 'first unfinished screen; the type is already saved and shown');
});

/* --------------------------------- catalog --------------------------------- */

test('screens offer exactly the approved features and suggestions (Home to Buy)', () => {
  const p = fresh();
  assert.deepEqual(texts(p, 'layout'), ['First-Floor Bedroom', 'Home Office', 'Finished Basement', 'Primary Ensuite']);
  assert.deepEqual(texts(p, 'layout', 'suggestions'), ['First-Floor Laundry', 'Walkout Basement', 'Front Porch']);
  assert.deepEqual(texts(p, 'kitchen'), ['Countertop Seating', 'Stainless Steel Appliances', 'Walk-in Pantry']);
  assert.deepEqual(texts(p, 'kitchen', 'suggestions'), ['Eat-in Kitchen', 'Kitchen Island', 'Formal Dining Room']);
  assert.deepEqual(texts(p, 'living'), ['Fireplace', 'High Ceilings']);
  assert.deepEqual(texts(p, 'living', 'suggestions'), ['Built-in Shelving', 'Large Windows']);
  assert.deepEqual(texts(p, 'bath'), ['Double Vanity', 'Soaking Tub']);
  assert.deepEqual(texts(p, 'bath', 'suggestions'), ['Separate Shower / Tub', 'Private Toilet', 'Linen Closet']);
  assert.deepEqual(texts(p, 'garage', 'suggestions'), ['Workbench', 'Garage Extension', 'Door to Backyard']);
  assert.deepEqual(texts(p, 'exterior'), ['Deck / Patio', 'Fenced Yard']);
  assert.deepEqual(texts(p, 'exterior', 'suggestions'), ['Mature Trees', 'Garden Space', 'Pool']);
  assert.deepEqual(texts(p, 'neighborhood'), ['Low-Traffic Street', 'Sidewalks', 'Tree-Lined Street', 'No HOA']);
  assert.deepEqual(texts(p, 'neighborhood', 'suggestions'), ['Cul-de-Sac', 'Walkable to Schools']);
  const all = priorityCategoriesFor(p).flatMap((category) => [...category.features, ...category.suggestions].map((feature) => feature.text.toLowerCase()));
  for (const omitted of ['second-floor laundry', 'basement storage', 'fire pit', 'room for entertaining', 'walkable neighborhood', 'near water']) {
    assert.ok(!all.includes(omitted), `${omitted} is not offered in onboarding`);
  }
});

test('every non-custom feature is an existing identity Match already counts; every custom one is not in the catalog', () => {
  for (const type of ['home_buy', 'home_rent', 'apartment_rent']) {
    const p = fresh(type);
    const defs = getItemlistCategories(p.searchType);
    const catalog = new Set(defs.flatMap((def) => [...def.coreItems, ...def.suggestedItems].map((item) => `${def.key}:${item.label}`)));
    for (const feature of priorityCategoriesFor(p).flatMap((category) => [...category.features, ...category.suggestions])) {
      assert.equal(feature.kind, 'check');
      assert.equal(isRetiredPurchaseBuiltIn(feature.categoryKey, { label: feature.label, source: feature.custom ? 'custom' : undefined }, p.searchType), false, `${type} ${feature.id} counts in Match`);
      if (feature.custom) assert.ok(!catalog.has(feature.id), `${feature.id} is a buyer's own priority`);
    }
  }
  // Tree-lined street: the historical identity, still counted, reused rather than duplicated.
  assert.ok(priorityCategoriesFor(fresh()).some((category) => category.features.some((feature) => feature.id === 'location:Tree-lined street')));
});

test('branching: rentals get Rental Essentials; an apartment gets no garage, lot size, fenced yard or HOA, and keeps its existing identities', () => {
  const apartment = fresh('apartment_rent');
  const keys = priorityCategoriesFor(apartment).map((category) => category.key);
  assert.deepEqual(keys, ['essentials', 'apt_unit', 'apt_property']);
  assert.deepEqual(priorityCategoriesFor(fresh('home_rent')).map((category) => category.key), ['essentials', 'rent_layout', 'rent_features', 'exterior', 'neighborhood']);
  const ids = priorityCategoriesFor(apartment).flatMap((category) => [...category.features, ...category.suggestions].map((feature) => feature.id));
  assert.ok(ids.includes('features:Home Office') && !ids.includes('features:Home office'), 'the rental catalog identity is reused');
  assert.ok(ids.includes('exterior:Patio / Deck / Outdoor Living'));
  for (const absent of ['exterior:Fenced yard', 'location:No HOA', 'features:Finished basement']) assert.ok(!ids.includes(absent), absent);
  assert.ok(!priorityCategoriesFor(fresh('home_rent')).flatMap((category) => category.features).some((feature) => feature.id === 'location:No HOA'));
});

/* ---------------------------------- writes ---------------------------------- */

test('choosing a level is the same write as My Search; Not important deselects; nothing is chosen by opening', () => {
  const p = fresh();
  const island = { categoryKey: 'features', label: 'Kitchen Island', custom: false };
  const chosen = setFeatureLevel(p, island, 'must');
  assert.deepEqual(chosen.features, addCriterion(p, { categoryKey: 'features', label: 'Kitchen Island', kind: 'check' }, 'must').features);
  assert.equal(featureLevel(chosen, island), 'must');
  assert.equal(featureLevel(setFeatureLevel(chosen, island, 'nice'), island), 'nice');
  const removed = setFeatureLevel(chosen, island, 'none');
  assert.equal(isCriterionSelected(removed, 'features', 'Kitchen Island'), false);
  assert.deepEqual(setFeatureLevel(p, island, 'none'), p, 'Not important on an unanswered feature writes nothing');
  assert.equal(categoryView(p, 'kitchen').chosenCount, 0, 'nothing is preselected');
  assert.ok(categoryView(p, 'kitchen').cards.every((card) => card.level === null));
});

test('a custom feature is the buyer’s own Yes/No priority, remembered on its screen, and Unknown never scores', () => {
  let p = fresh();
  p.budget = { ...p.budget, value: '500000' };
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Countertop Seating', custom: true, group: 'kitchen' }, 'must');
  assert.deepEqual(p.features.customItems.find((item) => item.label === 'Countertop Seating'), { label: 'Countertop Seating', kind: 'check', source: 'custom', group: 'kitchen' });
  const home = { price: '450000', checks: {}, ratings: {} };
  const unknown = computeMatch(home, p);
  assert.deepEqual([unknown.pct, unknown.evaluatedCount], [100, 1], 'only the budget is evaluated; Unknown is not a mismatch');
  const no = computeMatch({ ...home, checks: { 'features:Countertop Seating': 'no' } }, p);
  assert.deepEqual([no.pct, no.evaluatedCount], [33, 2], 'unchanged weights: 1×2 + 0×4 over 6');
});

test('Add your own never duplicates across case, spacing or punctuation, and finds features on other screens', () => {
  let p = fresh();
  const first = addOwnFeature(p, 'kitchen', '  Pot   filler ');
  p = first.priorities;
  assert.equal(first.feature.label, 'Pot filler');
  assert.equal(first.feature.custom, true);
  assert.equal(featureLevel(p, first.feature), null, 'created, not chosen: the importance picker decides');
  for (const variant of ['POT FILLER', 'pot-filler', 'Pot  Filler']) {
    const again = addOwnFeature(p, 'kitchen', variant);
    assert.equal(again.priorities.features.customItems.filter((item) => normalizeFeatureKey(item.label) === 'potfiller').length, 1, variant);
  }
  const island = addOwnFeature(p, 'kitchen', 'kitchen island');
  assert.equal(island.feature.id, 'features:Kitchen Island');
  assert.deepEqual(island.priorities, p, 'a catalog feature needs no new item');
  const porch = addOwnFeature(p, 'kitchen', 'Front Porch');
  assert.deepEqual([porch.feature.id, porch.homeCategory], ['exterior:Front porch', 'layout']);
  const shower = addOwnFeature(p, 'bath', 'separate shower/tub');
  assert.equal(shower.feature.label, 'Separate Shower / Tub', 'the suggestion, not a near-duplicate');
  const air = addOwnFeature(p, 'living', 'central air');
  assert.deepEqual([air.feature.id, air.feature.custom], ['features:Central air', false]);
  assert.equal(addOwnFeature(p, 'kitchen', '   '), null);
  assert.equal(cleanFeatureLabel('a'.repeat(80)).length, 60);
  // Shown on the screen it was added on.
  assert.ok(categoryView(p, 'kitchen').cards.some((card) => card.label === 'Pot filler'));
  assert.ok(!categoryView(p, 'bath').cards.some((card) => card.label === 'Pot filler'));
});

test('renaming the buyer’s own feature keeps its importance and refuses duplicates', () => {
  let p = fresh();
  const created = addOwnFeature(p, 'kitchen', 'Pot filler');
  p = setFeatureLevel(created.priorities, created.feature, 'nice');
  const renamed = renameOwnFeature(p, created.feature, 'Pot Filler Faucet');
  assert.equal(renamed.priorities.features.tiers['Pot Filler Faucet'], 'nice');
  assert.equal(renamed.priorities.features.tiers['Pot filler'], undefined);
  assert.ok(renameOwnFeature(p, created.feature, 'kitchen island').error);
  assert.ok(renameOwnFeature(p, created.feature, '  ').error);
  assert.ok(renameOwnFeature(p, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'Island').error);
});

test('garage: overall importance first; Not important skips the details and never marks any home', () => {
  let p = fresh();
  p.budget = { ...p.budget, value: '500000' };
  assert.equal(garageImportance(p), null);
  p = setGarageImportance(p, 'not_important');
  assert.equal(garageImportance(p), 'not_important');
  assert.equal(isCriterionSelected(p, 'exterior', 'Garage'), false);
  assert.equal(garageType(p), null, 'no subtype is written');
  const noGarage = computeMatch({ price: '450000', garageSpaces: '0', checks: {}, ratings: {} }, p);
  assert.deepEqual([noGarage.pct, noGarage.evaluatedCount], [100, 1], 'a home without a garage is not marked down');
  p = setGarageType(setGarageImportance(p, 'important'), 'detached');
  assert.deepEqual([garageImportance(p), garageType(p)], ['important', 'detached']);
  assert.equal(priorityLevels(p).flatMap((level) => level.items).find((item) => item.label === 'Garage').qualifier, 'Detached');
});

test('changing the kind of search keeps what still applies and says what it removed', () => {
  let p = fresh();
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'must');
  p = setGarageImportance(p, 'important');
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Countertop Seating', custom: true, group: 'kitchen' }, 'nice');
  // Home to Rent offers all three (Rental Features), so all three are kept.
  const rent = switchPrioritySearchType(p, 'home_rent');
  assert.equal(featureLevel(rent.priorities, { categoryKey: 'features', label: 'Kitchen Island' }), 'must');
  assert.equal(featureLevel(rent.priorities, { categoryKey: 'features', label: 'Countertop Seating' }), 'nice');
  assert.equal(featureLevel(rent.priorities, { categoryKey: 'exterior', label: 'Garage' }), 'important');
  assert.deepEqual(rent.removed, []);
  // An apartment has no kitchen screen: Kitchen Island is removed (and said
  // so); the buyer's own Countertop Seating is kept. A house Garage is never
  // turned into apartment Garage Parking: it is set aside, not counted.
  const { priorities, removed } = switchPrioritySearchType(p, 'apartment_rent');
  assert.equal(featureLevel(priorities, { categoryKey: 'features', label: 'Kitchen Island' }), null);
  assert.ok(removed.includes('Kitchen Island'));
  assert.equal(featureLevel(priorities, { categoryKey: 'features', label: 'Countertop Seating' }), 'nice');
  assert.equal(featureLevel(priorities, { categoryKey: 'exterior', label: 'Garage' }), null);
  assert.ok(removed.includes('Garage'));
  assert.deepEqual(priorities.exterior.heldGarage, { tier: 'important', from: 'home_buy' });
});

/* --------------------------------- review --------------------------------- */

test('Review lists chosen features by category, earlier choices it no longer asks, and never clears them', () => {
  let p = fresh();
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'nice');
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Walk-in Pantry', custom: false }, 'must');
  p = addCriterion(p, { categoryKey: 'features', label: 'Central air', kind: 'check' }, 'important');
  p = { ...p, homeLayout: { values: ['Ranch / Single Story'], tier: 'important' }, preferredPropertyTypes: { values: ['house'], tier: 'important' } };
  const kitchen = reviewCategories(p).find((category) => category.key === 'kitchen');
  assert.deepEqual(kitchen.chosen.map((item) => [item.text, item.level]), [['Walk-in Pantry', 'must'], ['Kitchen Island', 'nice']]);
  assert.deepEqual(otherChosenPriorities(p).map((item) => item.text), ['Central Air']);
  assert.deepEqual(earlierPreferences(p).map((group) => [group.key, group.text]), [['preferredPropertyTypes', 'Single Family'], ['homeLayout', 'Ranch']]);
});

/* ------------------------------ UI contract ------------------------------ */

test('one category component drives every category screen; Home type, layout and condition are not asked', () => {
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.equal((flow.match(/<CategoryStep\b/g) || []).length, 1);
  assert.doesNotMatch(flow, /homePreferenceRows|toggleHomePreference|toggleGroupValue/);
  assert.match(flow, /<PriorityFooter/);
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /onSkip=\{\(from\) => moveOn\(from, \{ skip: true \}\)\}/);
  // Home Add / Home Facts keep their home type, layout and condition questions.
  assert.match(read('src/components/HomeFacts.jsx') + read('src/components/FactFields.jsx'), /homeLayout|Layout/);
});

test('cards: text label always, decorative local images with lazy loading, responsive sizes and a fallback; no remote images', () => {
  const visual = read('src/components/onboarding/priority/FeatureVisual.jsx');
  assert.match(visual, /alt=""/);
  assert.match(visual, /loading=\{eager \? 'eager' : 'lazy'\}/);
  assert.match(visual, /srcSet=\{image\.srcSet\}/);
  assert.match(visual, /sizes=\{image\.srcSet \? CARD_SIZES : undefined\}/);
  assert.match(visual, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.doesNotMatch(visual, /https?:\/\//);
  assert.match(read('src/components/onboarding/priority/FeatureCard.jsx'), /aria-label=\{`\$\{feature\.text\}/);
});

test('photos: an explicit manifest maps every card to the founder’s upload; derivatives are card-sized; originals are kept', () => {
  const features = [...PRIORITY_CATEGORIES.flatMap((category) => [...category.features, ...category.suggestions, ...(category.question ? [category.question] : [])]), ...GARAGE_TYPES];
  const arts = new Set(features.map((feature) => feature.art).filter(Boolean));
  for (const art of arts) {
    const image = cardImage(art);
    assert.ok(image, `${art} has a photo or an illustration`);
    if (image.kind === 'photo') {
      const original = `public/images/onboarding/${ONBOARDING_PHOTOS[art].file}`;
      assert.ok(existsSync(new URL(`../${original}`, import.meta.url)), `${original} (founder upload) is present`);
      for (const width of CARD_WIDTHS) {
        const path = `public/images/onboarding/cards/${art}-${width}.webp`;
        assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
        const size = statSync(new URL(`../${path}`, import.meta.url)).size;
        assert.ok(size <= (width === 400 ? 60 : 120) * 1024, `${path} is ${Math.round(size / 1024)} KB`);
      }
    } else {
      const svg = read(image.src.replace(/^\//, 'public/'));
      assert.ok(svg.length < 4096);
      assert.doesNotMatch(svg, /<image|href=/);
    }
  }
  // Every uploaded photo is used, and every manifest entry is used by a card.
  const uploads = readdirSync(new URL('../public/images/onboarding/', import.meta.url)).filter((file) => file.endsWith('.webp'));
  assert.deepEqual([...uploads].sort(), Object.values(ONBOARDING_PHOTOS).map((photo) => photo.file).sort());
  assert.deepEqual([...Object.keys(ONBOARDING_PHOTOS)].filter((key) => !arts.has(key)), []);
  // Names that differ between upload and card are mapped explicitly.
  assert.equal(ONBOARDING_PHOTOS['garage-attached'].file, 'attached-garage.webp');
  assert.equal(ONBOARDING_PHOTOS['garage-yard-door'].file, 'garage-backyard-door.webp');
  // Photos win over illustrations; illustrations remain only where no photo exists.
  // Dishwasher and Pet-Friendly now use the founder's rental photography (PR #182).
  assert.deepEqual([...ONBOARDING_ILLUSTRATIONS].sort(), ['garage-either', 'in-unit-laundry']);
  assert.deepEqual(readdirSync(new URL('../public/images/features/', import.meta.url)).sort(), ['garage-either.svg', 'in-unit-laundry.svg']);
  // Every pictured feature also has an icon to fall back to; No HOA is icon-only.
  for (const feature of features.filter((entry) => entry.art)) assert.ok(feature.icon, `${feature.label || feature.key} has a fallback icon`);
  const neighborhood = PRIORITY_CATEGORIES.find((category) => category.key === 'neighborhood');
  assert.equal(neighborhood.features.find((feature) => feature.label === 'No HOA').art, undefined);
  assert.equal(neighborhood.suggestions.find((feature) => feature.label === 'Cul-de-Sac').art, 'cul-de-sac');
});

test('Dead-End Street is no longer offered, but a buyer who already added it keeps it, on its screen and on Review', () => {
  const all = priorityCategoriesFor(fresh()).flatMap((category) => [...category.features, ...category.suggestions]);
  assert.ok(!all.some((feature) => /dead.?end/i.test(feature.text)));
  let p = fresh();
  p = { ...p, location: { ...p.location, customItems: [{ label: 'Dead-End Street', kind: 'check', source: 'custom', group: 'neighborhood' }], tiers: { 'Dead-End Street': 'important' } } };
  const card = categoryView(p, 'neighborhood').cards.find((entry) => entry.label === 'Dead-End Street');
  assert.deepEqual([card.custom, card.level], [true, 'important']);
  assert.ok(reviewCategories(p).find((category) => category.key === 'neighborhood').chosen.some((item) => item.label === 'Dead-End Street'));
  assert.ok(isCriterionSelected(p, 'location', 'Dead-End Street'));
  // Saved before the group field existed: kept under More of your priorities.
  const older = { ...p, location: { ...p.location, customItems: [{ label: 'Dead-End Street', kind: 'check', source: 'custom' }] } };
  assert.deepEqual(otherChosenPriorities(older).map((item) => item.text), ['Dead-End Street']);
});

test('garage Not important moves straight on; coming back shows it chosen and changeable', () => {
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(flow, /patch\(\(next\) => setGarageImportance\(next, choice\.key\)\);\n\s+if \(choice\.key === 'not_important' && onNotImportant\) onNotImportant\(\);/);
  assert.match(flow, /onAutoAdvance=\{category\.key === 'garage' \? \(\) => onContinue\(step\) : null\}/);
  assert.match(flow, /aria-pressed=\{importance === choice\.key\}/);
  // Continue (not Skip): the answer is recorded and Back returns to it.
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /onContinue=\{\(from\) => moveOn\(from\)\}/);
});

test('the importance picker offers the three levels and Not important as buttons, and closing changes nothing', () => {
  const sheet = read('src/components/onboarding/priority/ImportanceSheet.jsx');
  assert.match(sheet, /PRIORITY_LEVELS\.map/);
  assert.match(sheet, /onChoose\('none'\)/);
  assert.match(sheet, /aria-pressed/);
  assert.doesNotMatch(sheet, /type="radio"/, 'buttons, so arrow keys never change an answer');
  assert.match(read('src/components/Sheet.jsx'), /Escape/);
});
