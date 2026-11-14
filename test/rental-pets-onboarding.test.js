// Rental Foundations, Stage 2: the pets answer and FLH's automatic ownership
// of Pet-Friendly. docs/rental-foundations-onboarding-spec.md §7 (D2, D7, D8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePriorities } from '../src/lib/constants.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { applyOnboardingSelections } from '../src/lib/onboarding.js';
import { computeMatch } from '../src/lib/matching.js';
import {
  addCriterion, addCustomCriterion, availableCriteriaGroups, moveCriterion, priorityLevels, toggleCriterion,
} from '../src/lib/searchProfile.js';
import { addOwnFeature, featureLevel, otherChosenPriorities, setFeatureLevel, switchPrioritySearchType } from '../src/lib/priorityCategories.js';
import {
  PETS_ANSWERS, PETS_CRITERION, clearPetsAuto, petsAutoMarker, petsChangeMessage, petsMovingAnswer, petsProvenance, petsTier,
  restorePets, setPetsMoving, snapshotPets,
} from '../src/lib/rentalPets.js';

const T0 = '2026-11-14T12:00:00.000Z';
const PETS = { categoryKey: 'features', label: 'Pets Allowed', custom: false };
const fresh = (type = 'home_rent') => chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
const yes = (raw) => setPetsMoving(raw, 'yes', T0);
const tierOf = (raw) => raw.features.tiers['Pets Allowed'];
const RENT_HOME = { price: '2400', checks: {}, ratings: {} };
// The features keys this module may touch; the contract tests check nothing else moves.
const otherFeatureKeys = (raw) => { const { tiers, customItems, petsMoving, petsAuto, ...rest } = raw.features; return { rest, tiers: { ...tiers, 'Pets Allowed': undefined } }; };

test('the answer is one of three; skipping writes nothing', () => {
  assert.deepEqual([...PETS_ANSWERS], ['yes', 'no', 'not_sure']);
  const p = fresh();
  for (const answer of [undefined, null, '', 'maybe', 'dog', 2]) {
    const result = setPetsMoving(p, answer, T0);
    assert.deepEqual([result.priorities, result.change], [p, null], String(answer));
  }
  assert.equal(petsMovingAnswer(p), null);
});

test('Yes makes Pet-Friendly a Must Have, records the earlier level, and is not a manual edit', () => {
  const p = fresh();
  const { priorities, change } = yes(p);
  assert.equal(change, 'set_must');
  assert.equal(tierOf(priorities), 'must');
  assert.equal(petsMovingAnswer(priorities), 'yes');
  assert.deepEqual(petsAutoMarker(priorities), { previousTier: null, setAt: T0 });
  assert.ok(priorities.features.customItems.some((item) => item.label === 'Pets Allowed' && item.kind === 'check'), 'promoted exactly as addCriterion does');
  assert.deepEqual(priorities.features.customItems, addCriterion(p, PETS_CRITERION, 'must').features.customItems);
  assert.equal(petsChangeMessage(priorities, change, 'yes'), 'Pet-Friendly is now a Must Have.');
  assert.deepEqual(petsProvenance(priorities), { answer: 'yes', tier: 'must', automatic: true });
  // Yes again changes nothing.
  assert.deepEqual(yes(priorities).priorities, priorities);
  assert.equal(yes(priorities).change, null);
});

test('No / Not sure create no anti-pet requirement and nothing about any home', () => {
  for (const answer of ['no', 'not_sure']) {
    const p = fresh();
    const { priorities, change } = setPetsMoving(p, answer, T0);
    assert.equal(change, null);
    assert.equal(petsMovingAnswer(priorities), answer);
    assert.deepEqual({ ...priorities, features: { ...priorities.features, petsMoving: undefined } }, { ...p, features: { ...p.features, petsMoving: undefined } }, 'only the answer is stored');
    assert.equal(tierOf(priorities), undefined);
    const text = JSON.stringify(priorities);
    assert.doesNotMatch(text, /"no pets"|No Pets|pets_allowed|petsAllowed/i);
    // Match is unchanged: the answer is not a Match input.
    for (const pets of [true, 'no', undefined]) {
      assert.deepEqual(computeMatch({ ...RENT_HOME, petsAllowed: pets }, priorities), computeMatch({ ...RENT_HOME, petsAllowed: pets }, p));
    }
  }
});

test('Yes → No (and Yes → Not sure) restores the earlier level', () => {
  for (const answer of ['no', 'not_sure']) {
    const { priorities, change } = setPetsMoving(yes(fresh()).priorities, answer, T0);
    assert.equal(change, 'restored');
    assert.equal(tierOf(priorities), 'dontcare', 'never chosen before → back to not selected');
    assert.equal(petsAutoMarker(priorities), null);
    assert.equal(petsChangeMessage(priorities, change, answer), 'Pet-Friendly is no longer one of your priorities.');
  }
  // An existing Important → Yes → No restores Important.
  const important = addCriterion(fresh(), PETS_CRITERION, 'important');
  const up = yes(important);
  assert.deepEqual([tierOf(up.priorities), petsAutoMarker(up.priorities).previousTier], ['must', 'important']);
  const back = setPetsMoving(up.priorities, 'no', T0);
  assert.deepEqual([tierOf(back.priorities), back.change], ['important', 'restored']);
  assert.equal(petsChangeMessage(back.priorities, back.change, 'no'), 'Pet-Friendly is back to Important.');
  // Nice to Have likewise.
  assert.equal(tierOf(setPetsMoving(yes(addCriterion(fresh(), PETS_CRITERION, 'nice')).priorities, 'not_sure', T0).priorities), 'nice');
});

test('Yes when the renter already made Pet-Friendly a Must Have: their choice, no marker, and No changes nothing', () => {
  const own = addCriterion(fresh(), PETS_CRITERION, 'must');
  const result = yes(own);
  assert.equal(result.change, null);
  assert.equal(petsAutoMarker(result.priorities), null);
  assert.equal(petsProvenance(result.priorities).automatic, false);
  const no = setPetsMoving(result.priorities, 'no', T0);
  assert.deepEqual([tierOf(no.priorities), no.change], ['must', null]);
  assert.equal(petsChangeMessage(no.priorities, no.change, 'no'), 'Pet-Friendly stays a Must Have because you set it yourself.');
});

test('founder test: Yes → manual Important → manual Must → No keeps the renter’s Must Have', () => {
  let p = yes(fresh()).priorities;
  assert.deepEqual(petsAutoMarker(p), { previousTier: null, setAt: T0 });
  p = setFeatureLevel(p, PETS, 'important');
  assert.equal(petsAutoMarker(p), null, 'the manual Important ends automatic ownership');
  p = setFeatureLevel(p, PETS, 'must');
  assert.equal(petsAutoMarker(p), null, 'the manual Must Have is the renter’s own');
  const before = p;
  const { priorities, change } = setPetsMoving(p, 'no', T0);
  assert.equal(change, null);
  assert.equal(tierOf(priorities), 'must');
  assert.deepEqual({ ...priorities.features, petsMoving: 'yes' }, before.features, 'only petsMoving changed');
  assert.equal(petsChangeMessage(priorities, change, 'no'), 'Pet-Friendly stays a Must Have because you set it yourself.');
  assert.deepEqual(petsProvenance(priorities), { answer: 'no', tier: 'must', automatic: false });
});

test('provenance never relies on the tier still being Must Have', () => {
  // A manual edit that lands on Must Have again still ends ownership.
  const p = setFeatureLevel(yes(fresh()).priorities, PETS, 'must');
  assert.equal(petsAutoMarker(p), null);
  assert.equal(setPetsMoving(p, 'no', T0).change, null);
});

test('Undo restores Pet-Friendly’s tier, customItems, the answer and the marker exactly', () => {
  const starts = [
    fresh(),
    addCriterion(fresh(), PETS_CRITERION, 'important'),
    setPetsMoving(fresh(), 'not_sure', T0).priorities,
    yes(fresh()).priorities,
    setFeatureLevel(yes(fresh()).priorities, PETS, 'nice'),
  ];
  for (const start of starts) {
    for (const answer of PETS_ANSWERS) {
      const { priorities, undo } = setPetsMoving(start, answer, T0);
      assert.deepEqual(restorePets(priorities, undo), normalizePriorities(start), `${answer} from ${JSON.stringify(start.features.tiers)}`);
    }
  }
  // Undo leaves every other change made since untouched.
  const { priorities, undo } = yes(fresh());
  const later = setFeatureLevel(priorities, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'nice');
  const undone = restorePets(later, undo);
  assert.equal(undone.features.tiers['Kitchen Island'], 'nice');
  assert.equal(tierOf(undone), undefined);
  assert.equal(petsMovingAnswer(undone), null);
  assert.deepEqual(snapshotPets(undone), snapshotPets(fresh()));
});

test('contract: every user-facing write to Pet-Friendly clears the marker and changes no other features key', () => {
  const owned = () => yes(addCriterion(fresh(), { categoryKey: 'features', label: 'Kitchen Island', kind: 'check' }, 'nice')).priorities;
  const paths = {
    'moveCriterion (My Search ranking board, Home preferences)': (p) => moveCriterion(p, 'features', 'Pets Allowed', 'important'),
    'moveCriterion to dontcare (remove from board)': (p) => moveCriterion(p, 'features', 'Pets Allowed', 'dontcare'),
    'addCriterion (add a priority anywhere)': (p) => addCriterion(p, PETS_CRITERION, 'must'),
    'toggleCriterion (My Search chip)': (p) => toggleCriterion(p, PETS_CRITERION),
    'addCustomCriterion (typed in My Search)': (p) => addCustomCriterion(p, 'features', 'pets allowed'),
    'setFeatureLevel (V3 importance sheet)': (p) => setFeatureLevel(p, PETS, 'nice'),
    'setFeatureLevel none (V3 Not important)': (p) => setFeatureLevel(p, PETS, 'none'),
    'V3 Add your own then the sheet': (p) => { const r = addOwnFeature(p, 'rent_features', 'pet friendly'); return setFeatureLevel(r.priorities, r.feature, 'important'); },
    'applyOnboardingSelections (live flow 1)': (p) => applyOnboardingSelections({ ...p, onboardingSearchType: 'apartment_rent' }, new Set(['features:Pets Allowed'])),
  };
  for (const [name, write] of Object.entries(paths)) {
    const before = owned();
    const after = write(before);
    assert.equal(petsAutoMarker(after), null, name);
    assert.equal(petsMovingAnswer(after), 'yes', `${name}: the answer itself is kept`);
    if (!name.startsWith('applyOnboardingSelections')) assert.deepEqual(otherFeatureKeys(after), otherFeatureKeys(before), `${name}: nothing else in features changed`);
  }
  // Writes to any other criterion leave the marker alone.
  const p = owned();
  assert.deepEqual(petsAutoMarker(moveCriterion(p, 'features', 'Kitchen Island', 'must')), petsAutoMarker(p));
  assert.deepEqual(petsAutoMarker(addCriterion(p, { categoryKey: 'features', label: 'Dishwasher', kind: 'check' }, 'must')), petsAutoMarker(p));
  assert.deepEqual(petsAutoMarker(moveCriterion(p, 'exterior', 'Pets Allowed', 'must')), petsAutoMarker(p), 'only features:Pets Allowed');
  // clearPetsAuto is a no-op for anything else, and returns the same object.
  const state = p.features;
  assert.equal(clearPetsAuto(state, 'features', 'Dishwasher'), state);
  assert.equal(clearPetsAuto(undefined, 'features', 'Pets Allowed'), undefined);
});

test('the only priority ever written is features:Pets Allowed; nothing collects pet details', () => {
  const p = fresh();
  for (const answer of PETS_ANSWERS) {
    const { priorities } = setPetsMoving(yes(p).priorities, answer, T0);
    for (const key of ['location', 'exterior', 'homeFeel', 'budget', 'bedsMin']) assert.deepEqual(priorities[key], p[key], `${answer} ${key}`);
    assert.deepEqual(Object.keys(priorities.features.tiers), ['Pets Allowed']);
  }
  const source = readFileSync(new URL('../src/lib/rentalPets.js', import.meta.url), 'utf8');
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\b(breed|weight|petType|petCount|petName|pets_allowed|petsAllowed)\b/i);
  assert.doesNotMatch(code, /from '\.\/(supabase|matchCriteria|homeFactCriteria)/, 'never writes to a home');
});

test('search-type switch: rental ↔ rental keeps the answer, the level and the marker', () => {
  let p = yes(fresh('home_rent')).priorities;
  const marker = petsAutoMarker(p);
  for (const type of ['apartment_rent', 'home_rent', 'apartment_rent']) {
    const result = switchPrioritySearchType(p, type);
    p = result.priorities;
    assert.equal(p.onboardingSearchType, type);
    assert.deepEqual([petsMovingAnswer(p), petsTier(p), petsAutoMarker(p)], ['yes', 'must', marker], type);
    assert.ok(!result.removed.includes('Pet-Friendly'), type);
  }
  // Still FLH's: No restores the level from before Yes.
  assert.deepEqual([tierOf(setPetsMoving(p, 'no', T0).priorities), setPetsMoving(p, 'no', T0).change], ['dontcare', 'restored']);
  // A renter-owned level and a No answer survive the switch too.
  const own = setPetsMoving(addCriterion(fresh('apartment_rent'), PETS_CRITERION, 'important'), 'no', T0).priorities;
  const moved = switchPrioritySearchType(own, 'home_rent').priorities;
  assert.deepEqual([petsMovingAnswer(moved), petsTier(moved), petsAutoMarker(moved)], ['no', 'important', null]);
});

test('search-type switch: rental → Home to Buy clears all three, Undo (the earlier document) restores them; buy → rental writes nothing', () => {
  const before = yes(fresh('apartment_rent')).priorities;
  const { priorities, removed } = switchPrioritySearchType(before, 'home_buy');
  assert.deepEqual([petsMovingAnswer(priorities), petsAutoMarker(priorities), petsTier(priorities)], [null, null, null]);
  assert.ok(!Object.hasOwn(priorities.features, 'petsMoving') && !Object.hasOwn(priorities.features, 'petsAuto'));
  assert.ok(removed.some((label) => /pet/i.test(label)), JSON.stringify(removed));
  // The flow's Undo puts back the whole earlier document (SearchTypeStep keeps it).
  const flow = readFileSync(new URL('../src/components/onboarding/priority/PriorityFlow.jsx', import.meta.url), 'utf8');
  assert.match(flow, /const undo = \(\) => \{ patch\(\(\) => switched\.previous\);/);
  assert.deepEqual([petsMovingAnswer(before), petsTier(before), petsAutoMarker(before)?.previousTier], ['yes', 'must', null]);
  // Back to renting: the question is unanswered.
  const again = switchPrioritySearchType(priorities, 'home_rent').priorities;
  assert.deepEqual([petsMovingAnswer(again), petsAutoMarker(again), petsTier(again)], [null, null, null]);
  // Buy → rental writes nothing pet-related.
  const rent = switchPrioritySearchType(fresh('home_buy'), 'apartment_rent').priorities;
  assert.deepEqual([petsMovingAnswer(rent), petsAutoMarker(rent), rent.features.tiers['Pets Allowed']], [null, null, undefined]);
});

test('co-renters: each answer and level is the person’s own', () => {
  const a0 = fresh('home_rent');
  const b0 = addCriterion(fresh('home_rent'), PETS_CRITERION, 'nice');
  const bSnapshot = JSON.stringify(b0);
  const a1 = yes(a0).priorities;
  assert.equal(JSON.stringify(b0), bSnapshot, 'B’s document is untouched by A’s answer');
  const a2 = setFeatureLevel(a1, PETS, 'important');
  const b1 = yes(b0).priorities;
  assert.deepEqual([petsTier(a2), petsAutoMarker(a2)], ['important', null], 'A’s manual edit is A’s');
  assert.deepEqual([petsTier(b1), petsAutoMarker(b1).previousTier], ['must', 'nice'], 'B’s later Yes is B’s');
  // Each Match uses its own tier with the same shared fact.
  for (const petsAllowed of [true, 'no', undefined]) {
    const home = { ...RENT_HOME, petsAllowed };
    assert.equal(computeMatch(home, a2).selectedCount, 1);
    assert.equal(computeMatch(home, b1).selectedCount, 1);
  }
});

test('M0: a Pet-Friendly Must Have with an unknown pet policy is Unknown, never a miss', () => {
  const p = { ...yes(fresh('apartment_rent')).priorities, budget: { value: '3000', tier: 'must' } };
  const unknown = computeMatch({ ...RENT_HOME, petsAllowed: null }, p);
  assert.deepEqual([unknown.selectedCount, unknown.evaluatedCount, unknown.pct], [2, 1, 100]);
  const allowed = computeMatch({ ...RENT_HOME, petsAllowed: true }, p);
  assert.deepEqual([allowed.evaluatedCount, allowed.pct], [2, 100]);
  const notAllowed = computeMatch({ ...RENT_HOME, petsAllowed: false }, p);
  assert.deepEqual([notAllowed.evaluatedCount, notAllowed.pct], [2, 50], 'No only when the policy says so; weights unchanged (4/8)');
});

test('existing renters keep Pet-Friendly exactly; it stays one ordinary priority on the board', () => {
  const saved = addCriterion(fresh('apartment_rent'), PETS_CRITERION, 'important');
  assert.equal(petsMovingAnswer(saved), null, 'unanswered');
  assert.equal(featureLevel(saved, PETS), 'important');
  const items = priorityLevels(yes(saved).priorities).flatMap((level) => level.items).filter((item) => item.label === 'Pets Allowed');
  assert.deepEqual(items.map((item) => [item.displayLabel, item.tier]), [['Pet-Friendly', 'must']], 'one Pet-Friendly, no duplicate');
  // Not offered again while chosen; still under More of your priorities until the Stage 3 Review row exists.
  assert.ok(!availableCriteriaGroups(yes(saved).priorities).some((group) => group.items.some((item) => item.key === 'features:Pets Allowed')));
  assert.ok(otherChosenPriorities(yes(saved).priorities).some((item) => item.id === 'features:Pets Allowed'));
});

test('Match code, scoring weights and SQL are untouched by the pets helper', () => {
  const matching = readFileSync(new URL('../src/lib/matching.js', import.meta.url), 'utf8');
  assert.doesNotMatch(matching, /petsMoving|petsAuto|rentalPets/);
  assert.doesNotMatch(readFileSync(new URL('../src/lib/homeFactCriteria.js', import.meta.url), 'utf8'), /petsMoving|petsAuto/);
});
