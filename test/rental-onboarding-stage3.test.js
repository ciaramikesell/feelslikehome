// Rental Foundations, Stage 3: the mobile UI for Home to Rent and Apartment
// to Rent (docs/rental-foundations-onboarding-spec.md §1, §7, §9 Stage 3).
// The pets question, Home to Rent's lot-size importance (D4), card hints, and
// the editable Review rows. Pure logic plus source contracts; the browser QA
// lives in scripts/qa/mobile-priority-onboarding-v3-qa.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePriorities } from '../src/lib/constants.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { computeMatch } from '../src/lib/matching.js';
import { CURRENT_ONBOARDING_VERSION, onboardingStepsFor } from '../src/lib/onboardingFlow.js';
import { addCriterion } from '../src/lib/searchProfile.js';
import {
  LOT_SIZE_FEATURE, PETS_FEATURE, categoryView, lotSizeImportance, lotSizeRankable, lotSizeReview, otherChosenPriorities,
  petsReview, priorityCategoriesFor, reviewCategories, setFeatureLevel, setLotSizeImportance,
} from '../src/lib/priorityCategories.js';
import { petsAutoMarker, petsMovingAnswer, restorePets, setPetsMoving } from '../src/lib/rentalPets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = (type) => chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
const withLot = (raw, value = '0.5') => ({ ...raw, lotSizeTarget: { ...raw.lotSizeTarget, value } });
const T = '2026-11-15T00:00:00.000Z';
const HOME = { price: '2400', lotSize: '0.75 acres', checks: {}, ratings: {} };
const lotItem = (raw, home = HOME) => computeMatch(home, raw)?.allSelected.find((item) => item.key === 'lotSize');

/* ------------------------------- the screens ------------------------------- */

test('exact screens and progress per search type: Home to Rent 8, Apartment 6, Home to Buy 10 (Review is the finish line)', () => {
  const counted = (type) => onboardingStepsFor(4, { answers: { searchType: type } }).filter((step) => step !== 'review');
  assert.deepEqual(counted('home_rent'), ['search_type', 'basics', 'locations', 'cat_essentials', 'cat_rent_layout', 'cat_rent_features', 'cat_exterior', 'cat_neighborhood']);
  assert.deepEqual(counted('apartment_rent'), ['search_type', 'basics', 'locations', 'cat_essentials', 'cat_apt_unit', 'cat_apt_property']);
  assert.equal(counted('home_buy').length, 10);
  assert.equal(CURRENT_ONBOARDING_VERSION, 1, 'the live flow is unchanged');
});

test('Rental / Apartment Basics headings; Home to Buy keeps its own', () => {
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(flow, /BASICS_TITLE = \{ home_buy: 'The Basics', home_rent: 'Rental Basics', apartment_rent: 'Apartment Basics' \}/);
  assert.match(flow, /BASICS_NOUN = \{ home_buy: 'home search', home_rent: 'rental search', apartment_rent: 'apartment search' \}/);
  // Monthly rent keeps the $ prefix and thousands separators (BudgetField, rent=true).
  assert.match(flow, /<BudgetField label=\{fields\.budgetLabel\} rent=\{rent\}/);
});

/* ----------------------------- the pets question ----------------------------- */

test('PetsQuestion: three radios, the pet-friendly photo, every write through setPetsMoving, exact Undo through restorePets', () => {
  const source = read('src/components/onboarding/priority/PetsQuestion.jsx');
  assert.match(source, /Will pets be moving with you\?/);
  assert.match(source, /PETS_ANSWERS\.map/);
  assert.match(source, /type="radio"/);
  assert.match(source, /art: PETS_QUESTION\.art/);
  assert.match(source, /setPetsMoving\(current, next\)/);
  assert.match(source, /restorePets\(current, snapshot\)/);
  assert.doesNotMatch(source, /setFeatureLevel|moveCriterion|addCriterion|tiers\[/, 'no other write path');
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /breed|weight|species|type="text"|type="number"|<textarea|<select/i, 'no pet details collected');
  assert.equal((code.match(/<input /g) || []).length, 1, 'one radio input, rendered once per answer');
  // On the Rental Essentials screen, in the shared frame; no cards, no Add your own.
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(flow, /\{category\.question && <PetsQuestion priorities=\{priorities\} patch=\{patch\} \/>\}/);
  assert.match(flow, /const showFeatures = !category\.question && /);
});

test('the Rental Essentials screen never shows Pet-Friendly as a ranking card', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    const p = setPetsMoving(fresh(type), 'yes', T).priorities;
    const view = categoryView(p, 'essentials');
    assert.deepEqual([view.cards, view.suggestions], [[], []]);
    const cards = priorityCategoriesFor(p).flatMap((category) => categoryView(p, category.key).cards);
    assert.ok(!cards.some((card) => card.id === 'features:Pets Allowed'), type);
  }
});

test('Yes → Undo, No → Undo and answer changes are exact (the screen’s sequence)', () => {
  const start = addCriterion(fresh('apartment_rent'), { categoryKey: 'features', label: 'Pets Allowed', kind: 'check' }, 'important');
  const yes = setPetsMoving(start, 'yes', T);
  assert.equal(yes.change, 'set_must');
  assert.deepEqual(normalizePriorities(restorePets(yes.priorities, yes.undo)), normalizePriorities(start), 'Undo of Yes');
  const no = setPetsMoving(yes.priorities, 'no', T);
  assert.deepEqual([no.change, no.priorities.features.tiers['Pets Allowed']], ['restored', 'important']);
  assert.deepEqual(normalizePriorities(restorePets(no.priorities, no.undo)), normalizePriorities(yes.priorities), 'Undo of No');
  const unsure = setPetsMoving(no.priorities, 'not_sure', T);
  assert.deepEqual([unsure.change, petsMovingAnswer(unsure.priorities), unsure.priorities.features.tiers['Pets Allowed']], [null, 'not_sure', 'important']);
});

/* ---------------------------------- Review --------------------------------- */

test('Review: the pets answer with its provenance, Pet-Friendly shown once and never under More of your priorities', () => {
  const auto = setPetsMoving(fresh('home_rent'), 'yes', T).priorities;
  const essentials = reviewCategories(auto).find((category) => category.key === 'essentials');
  assert.deepEqual([essentials.pets.answerText, essentials.pets.item.level, essentials.pets.automatic, essentials.pets.source], ['Yes', 'must', true, 'Because pets are moving with you']);
  assert.ok(!otherChosenPriorities(auto).some((item) => item.id === 'features:Pets Allowed'));
  assert.equal(essentials.chosen.length, 0, 'not a card either');

  // The renter's own level (set before Yes was ever answered).
  const own = setPetsMoving(setFeatureLevel(fresh('apartment_rent'), PETS_FEATURE, 'must'), 'yes', T).priorities;
  assert.deepEqual([petsReview(own).automatic, petsReview(own).source], [false, 'You set this yourself']);

  // Unanswered, but chosen earlier: still shown (once), with its level.
  const earlier = addCriterion(fresh('home_rent'), { categoryKey: 'features', label: 'Pets Allowed', kind: 'check' }, 'nice');
  assert.deepEqual([petsReview(earlier).answer, petsReview(earlier).item.level], [null, 'nice']);
  // No / Not sure: no row for Pet-Friendly, no requirement.
  const no = setPetsMoving(fresh('home_rent'), 'no', T).priorities;
  assert.deepEqual([petsReview(no).answerText, petsReview(no).item], ['No', null]);

  // Home to Buy has no pets row; a Pet-Friendly saved there stays under More.
  const buy = addCriterion(fresh('home_buy'), { categoryKey: 'features', label: 'Pets Allowed', kind: 'check' }, 'nice');
  assert.ok(!reviewCategories(buy).some((category) => category.pets));
  assert.ok(otherChosenPriorities(buy).some((item) => item.id === 'features:Pets Allowed'));
});

test('Review: changing Pet-Friendly’s level is a manual edit that ends FLH ownership; No then changes nothing', () => {
  const auto = setPetsMoving(fresh('home_rent'), 'yes', T).priorities;
  const edited = setFeatureLevel(auto, PETS_FEATURE, 'important');
  assert.deepEqual([edited.features.tiers['Pets Allowed'], petsAutoMarker(edited), petsMovingAnswer(edited)], ['important', null, 'yes']);
  const no = setPetsMoving(edited, 'no', T);
  assert.deepEqual([no.change, no.priorities.features.tiers['Pets Allowed']], [null, 'important']);
  const removed = setFeatureLevel(auto, PETS_FEATURE, 'none');
  assert.deepEqual([removed.features.tiers['Pets Allowed'], petsAutoMarker(removed)], ['dontcare', null]);
});

test('Review component renders the pets row, the ranked lot size and counts both once', () => {
  const review = read('src/components/onboarding/priority/PriorityReview.jsx');
  assert.match(review, /Pets moving with you: <strong>\{pets\.answerText \|\| 'Not answered'\}<\/strong>/);
  assert.match(review, /category\.pets\?\.item \? 1 : 0\) \+ \(category\.lot\?\.scored \? 1 : 0\)/);
  assert.match(review, /category\.lot\s*\n?\s*\? <LotLine lot=\{category\.lot\}/);
  // Home to Buy keeps its unranked line exactly.
  assert.match(review, /: <p className="flh-ob-pf-review-line">Ideal lot size: <strong>\{lot\} acres<\/strong><\/p>\);/);
});

/* --------------------------- lot-size importance --------------------------- */

test('D4: only Home to Rent ranks the lot size; Home to Buy keeps its unranked field', () => {
  assert.equal(lotSizeRankable(fresh('home_rent')), true);
  assert.equal(lotSizeRankable(fresh('home_buy')), false);
  assert.equal(lotSizeRankable(fresh('apartment_rent')), false);
  assert.ok(!reviewCategories(withLot(fresh('home_buy'))).some((category) => category.lot), 'no ranked lot row for buyers');
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(flow, /const rankLot = lotSize && lotSizeRankable\(priorities\);/);
  assert.match(flow, /\{rankLot && <LotSizeImportance /);
});

test('D4: no importance → unscored; a level → the existing threshold; Not important → dontcare; acreage untouched', () => {
  const unranked = withLot(fresh('home_rent'));
  assert.equal(unranked.lotSizeTarget.tier, 'dontcare');
  assert.equal(lotItem(unranked), undefined, 'entering acreage alone never scores it');
  for (const level of ['must', 'important', 'nice']) {
    const ranked = setLotSizeImportance(unranked, level);
    assert.deepEqual(ranked.lotSizeTarget, { value: '0.5', tier: level });
    assert.equal(lotSizeImportance(ranked), level);
    assert.deepEqual([lotItem(ranked).tier, lotItem(ranked).met], [level, true]);
    assert.equal(lotItem(ranked, { ...HOME, lotSize: '0.25 acres' }).met, false);
    assert.equal(lotItem(ranked, { ...HOME, lotSize: '' }).evaluated, false, 'unknown lot size is Unknown, never a miss');
    assert.deepEqual(setLotSizeImportance(ranked, 'none').lotSizeTarget, { value: '0.5', tier: 'dontcare' });
  }
  assert.deepEqual(setLotSizeImportance(unranked, 'none'), normalizePriorities(unranked), 'no-op when already unranked');
});

test('D4: a saved lot-size tier shows as the chosen importance; Review reports whether Match uses it', () => {
  const saved = { ...withLot(fresh('home_rent'), '1'), lotSizeTarget: { value: '1', tier: 'important' } };
  assert.deepEqual(lotSizeReview(saved), { value: '1', level: 'important', scored: true, feature: { ...LOT_SIZE_FEATURE, level: 'important' } });
  const exterior = reviewCategories(saved).find((category) => category.key === 'exterior');
  assert.equal(exterior.lot.level, 'important');
  assert.equal(lotSizeReview(withLot(fresh('home_rent'))).scored, false);
  assert.equal(lotSizeReview(fresh('home_rent')).scored, false, 'no acreage: never scored');
});

test('the importance sheet ranks the lot size with the same four choices and writes only lotSizeTarget.tier', () => {
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(flow, /feature\.target === 'lotSizeTarget' \? setLotSizeImportance\(priorities, feature, tier\)|feature\.target === 'lotSizeTarget' \? setLotSizeImportance\(priorities, tier\)/);
  assert.match(flow, /feature\.target === 'lotSizeTarget' \? lotSizeImportance\(priorities\)/);
  assert.equal(LOT_SIZE_FEATURE.custom, false, 'cannot be renamed');
  assert.equal(LOT_SIZE_FEATURE.art, null);
});

/* ----------------------------------- hints ---------------------------------- */

test('ambiguous cards carry their hint on the card and in the sheet; Home to Buy cards have none', () => {
  const hints = (type) => Object.fromEntries(priorityCategoriesFor(fresh(type)).flatMap((category) => [...category.features, ...category.suggestions]).filter((feature) => feature.hint).map((feature) => [feature.text, feature.hint]));
  assert.deepEqual(hints('home_rent'), {
    'Extra Bedroom': 'An extra bedroom beyond the minimum you entered in Basics.',
    Landscaping: 'A well-kept, landscaped yard.',
  });
  assert.deepEqual(hints('apartment_rent'), { 'Private Garage': 'A garage for your unit only.' });
  assert.deepEqual(hints('home_buy'), {});
  // A chosen suggestion keeps its hint as a card.
  const p = setFeatureLevel(fresh('home_rent'), priorityCategoriesFor(fresh('home_rent')).find((c) => c.key === 'rent_layout').suggestions.find((s) => s.label === 'Extra Bedroom'), 'nice');
  assert.equal(categoryView(p, 'rent_layout').cards.find((card) => card.label === 'Extra Bedroom').hint, hints('home_rent')['Extra Bedroom']);
  assert.match(read('src/components/onboarding/priority/FeatureCard.jsx'), /\{feature\.hint && <span className="flh-ob-pf-card-hint">\{feature\.hint\}<\/span>\}/);
  assert.match(read('src/components/onboarding/priority/ImportanceSheet.jsx'), /\{feature\.hint && <p className="flh-ob-pf-sheet-hint">\{feature\.hint\}<\/p>\}/);
});

/* --------------------------------- release ---------------------------------- */

test('release safety: Match, SQL and the flag default are untouched by Stage 3', () => {
  for (const path of ['src/lib/matching.js', 'src/lib/homeFactCriteria.js']) assert.doesNotMatch(read(path), /petsMoving|petsAuto|lotSizeRankable|LOT_SIZE_FEATURE/, path);
  assert.match(read('src/lib/featureFlags.js'), /FLH_ONBOARDING_V3/);
});

test('the desktop step rail names every rental screen (never a raw step key)', () => {
  const source = read('src/components/onboarding/Onboarding.jsx');
  const labels = source.slice(source.indexOf('const STEP_LABELS = {'), source.indexOf('const LOCATION_LABEL_V4'));
  for (const type of ['home_rent', 'apartment_rent', 'home_buy']) {
    for (const step of onboardingStepsFor(4, { answers: { searchType: type } })) assert.match(labels, new RegExp(`\\b${step}: '`), `${type}: ${step}`);
  }
  assert.match(source, /BASICS_LABEL_V4 = \{ home_rent: 'Rental Basics', apartment_rent: 'Apartment Basics' \}/);
});
