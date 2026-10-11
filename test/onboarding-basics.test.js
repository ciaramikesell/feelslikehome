// Onboarding V2, Step 1 (The Basics). Formatting, steppers with a real unset
// state, garage preferences on existing storage, and the approved copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { applySearchChoice } from '../src/lib/onboarding.js';
import { basicsSummary, isCriterionSelected } from '../src/lib/searchProfile.js';
import {
  STEPPERS, chooseSearchType, editFormattedNumber, formatThousands, garageLevel, isUnset, setGarageLevel,
  stepDown, stepUp,
} from '../src/lib/onboardingBasics.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('budget and square footage show commas but store plain digits', () => {
  assert.equal(formatThousands('650000'), '650,000');
  assert.equal(formatThousands(''), '');
  assert.equal(formatThousands('0007'), '7');
  assert.deepEqual(editFormattedNumber('1,234,5678', 10), { digits: '12345678', display: '12,345,678', caret: 10 });
  // Typing a digit after "1,2" keeps the caret right after it.
  assert.deepEqual(editFormattedNumber('1,29,345', 4), { digits: '129345', display: '129,345', caret: 3 });
  // Clearing the field leaves it unset, never 0.
  assert.deepEqual(editFormattedNumber('', 0), { digits: '', display: '', caret: 0 });
});

test('steppers start unset, never invent 0, and clear at the minimum', () => {
  const beds = STEPPERS.bedsMin;
  const baths = STEPPERS.bathsMin;
  assert.equal(isUnset(''), true);
  assert.equal(stepUp('', beds), '1');
  assert.equal(stepUp('3', beds), '4');
  assert.equal(stepDown('2', beds), '1');
  assert.equal(stepDown('1', beds), '');
  assert.equal(stepDown('', beds), '');
  assert.equal(stepUp('10', beds), '10');
  assert.equal(stepUp('', baths), '1');
  assert.equal(stepUp('1', baths), '1.5');
  // An existing off-step value (from My Search) is kept until changed, then snaps.
  assert.equal(stepUp('1.75', baths), '2');
  assert.equal(stepDown('1.75', baths), '1.5');
  assert.equal(stepDown('1', baths), '');
});

test('unset Basics are not scored by Match; set ones are', () => {
  const home = { beds: 2, baths: 1, sqft: 900, price: 300000 };
  const unset = applySearchChoice(normalizePriorities({}), 'home_buy');
  const scoredUnset = computeMatch(home, unset);
  const set = { ...unset, bedsMin: { ...unset.bedsMin, value: stepUp('2', STEPPERS.bedsMin) } };
  const scoredSet = computeMatch(home, set);
  const labels = (result) => JSON.stringify(result);
  assert.doesNotMatch(labels(scoredUnset), /Minimum bedrooms/);
  assert.match(labels(scoredSet), /Minimum bedrooms/);
  assert.deepEqual(basicsSummary(unset).numbers || [], []);
});

test('garage preferences use the existing Garage criterion and qualifier, with a real unset state', () => {
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  assert.equal(garageLevel(priorities), 'unset');
  priorities = setGarageLevel(priorities, 'important', 'home_buy');
  assert.equal(garageLevel(priorities), 'important');
  assert.equal(isCriterionSelected(priorities, 'exterior', 'Garage'), true);
  priorities = setGarageLevel(priorities, 'must', 'home_buy');
  assert.equal(garageLevel(priorities), 'must');
  priorities = setGarageLevel(priorities, 'unset', 'home_buy');
  assert.equal(garageLevel(priorities), 'unset');
  assert.equal(isCriterionSelected(priorities, 'exterior', 'Garage'), false);
});

test('changing the kind of search keeps a garage answer (except for Apartment) and the other Basics', () => {
  let priorities = chooseSearchType(normalizePriorities({}), 'home_buy');
  priorities = { ...priorities, budget: { ...priorities.budget, value: '500000' } };
  priorities = setGarageLevel(priorities, 'nice', 'home_buy');
  const rent = chooseSearchType(priorities, 'home_rent');
  assert.equal(rent.onboardingSearchType, 'home_rent');
  assert.equal(garageLevel(rent), 'nice');
  assert.equal(rent.budget.value, '500000');
  const apartment = chooseSearchType(priorities, 'apartment_rent');
  assert.equal(garageLevel(apartment), 'unset');
  // An unanswered garage question stays unanswered after a change.
  assert.equal(garageLevel(chooseSearchType(chooseSearchType(normalizePriorities({}), 'home_buy'), 'home_rent')), 'unset');
});

test('the Basics step uses the approved copy and keeps search type required', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const basics = read('src/components/onboarding/BasicsStep.jsx');
  assert.match(onboarding, /title=\{<>The Basics of <em>Your Search<\/em><\/>\} lead="What does home look like to you\? You can adjust these anytime\."/);
  assert.match(onboarding, /`Step \$\{progress\.position\} · \$\{STEP_LABELS\[step\]\}`/);
  assert.match(onboarding, /basics: 'The Basics'/);
  // Nothing is preselected and Continue waits for a kind of search.
  assert.match(basics, /checked=\{choice === option\.key\}/);
  assert.match(basics, /<OnboardingAction disabled=\{!choice\} onClick=\{onNext\}>Continue<\/OnboardingAction>/);
  // No slider anywhere on the step.
  assert.doesNotMatch(basics, /type="range"/);
  // Home types, layout and condition remain editable (collapsed) rather than dropped.
  assert.match(basics, /title="More about the home"/);
  // Shared-search setup keeps its own heading and reassurance.
  assert.match(onboarding, /title=\{`Set up your preferences for \$\{sharedFor\}\.`\}/);
});

test('the floating Feedback tab is not rendered on onboarding, and stays everywhere else', () => {
  assert.doesNotMatch(read('src/components/onboarding/Onboarding.jsx'), /<BetaFeedback/);
  assert.match(read('src/components/AppShell.jsx'), /<BetaFeedback userId=\{userId\}/);
});

test('Basics styles are scoped to onboarding', () => {
  const css = read('src/app/globals.css');
  const block = css.slice(css.indexOf('/* ── Onboarding V2 — Step 1: The Basics'));
  for (const selector of block.match(/^[^@\s/}][^{]*\{/gm) || []) {
    assert.match(selector, /\.flh-onboarding-root|\.flh-ob-/, `unscoped selector: ${selector}`);
  }
});
