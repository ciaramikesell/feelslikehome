import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getItemlistCategories, normalizePriorities, foldLegacyCheckAliases, criterionDisplayLabel,
  hasQualifierOptions, qualifierOptions, selectedQualifiers, isGarageQualifierAny,
  toggleCriterionQualifier, setExclusiveQualifier, qualifierSummaryLabel, criterionCompactLabel,
  qualifierFactKey, qualifierFactRows,
} from '../src/lib/constants.js';
import { computeMatch, selectPriorityItem } from '../src/lib/matching.js';
import { ONBOARDING_SUGGESTIONS } from '../src/lib/onboarding.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const purchaseLabels = () => getItemlistCategories('purchase').flatMap((def) => [...def.coreItems, ...def.suggestedItems].map((item) => `${def.key}:${item.label}`));

function withSelected(priorities, categoryKey, label, tier, kind = 'check') {
  const def = getItemlistCategories(priorities.searchType).find((category) => category.key === categoryKey);
  return { ...priorities, [categoryKey]: selectPriorityItem(priorities[categoryKey], def, { label, kind }, tier) };
}

/* ------------------------------ Taxonomy: parent only, no flat children ------------------------------ */

test('Garage, Fenced yard, and First-Floor Bedroom are the sole canonical parents — their old flat children never appear as independent chips', () => {
  const labels = purchaseLabels();
  assert.ok(labels.includes('exterior:Garage'));
  assert.ok(labels.includes('exterior:Fenced yard'));
  assert.ok(labels.includes('features:First-Floor Bedroom'));
  for (const flatChild of ['exterior:Attached garage', 'exterior:Detached garage', 'exterior:Privacy Fencing', 'features:First-Floor Primary']) {
    assert.ok(!labels.includes(flatChild), `${flatChild} must not be an independent canonical chip`);
  }
  const onboardingBuyLabels = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.map((item) => `${item.categoryKey}:${item.label}`));
  for (const flatChild of ['exterior:Attached garage', 'exterior:Detached garage', 'exterior:Privacy Fencing', 'features:First-Floor Primary']) {
    assert.ok(!onboardingBuyLabels.includes(flatChild));
  }
});

test('qualifier registry is exactly Garage (Attached/Detached), Fenced yard (Privacy fence), First-Floor Bedroom (Primary/Guest)', () => {
  assert.deepEqual(qualifierOptions('exterior', 'Garage').map((o) => o.key), ['attached', 'detached']);
  assert.deepEqual(qualifierOptions('exterior', 'Fenced yard').map((o) => o.key), ['privacy']);
  assert.deepEqual(qualifierOptions('features', 'First-Floor Bedroom').map((o) => o.key), ['primary', 'guest']);
  assert.equal(hasQualifierOptions('exterior', 'Pool'), false);
  assert.equal(qualifierOptions('exterior', 'Pool'), null);
});

/* ------------------------------ Qualifier state helpers ------------------------------ */

test('Garage/Fenced Yard qualifiers behave as an exclusive replacement; "Any" always clears', () => {
  let catState = { tiers: { Garage: 'must' }, qualifiers: {} };
  catState = setExclusiveQualifier(catState, 'Garage', 'attached');
  assert.deepEqual(catState.qualifiers.Garage, ['attached']);
  catState = setExclusiveQualifier(catState, 'Garage', 'detached');
  assert.deepEqual(catState.qualifiers.Garage, ['detached']); // replaced, not appended
  catState = setExclusiveQualifier(catState, 'Garage', null);
  assert.deepEqual(catState.qualifiers.Garage, []); // explicit Any
});

test('First-Floor Bedroom qualifiers toggle independently so Primary + Guest can both be selected', () => {
  let catState = { tiers: { 'First-Floor Bedroom': 'important' }, qualifiers: {} };
  catState = toggleCriterionQualifier(catState, 'First-Floor Bedroom', 'primary');
  catState = toggleCriterionQualifier(catState, 'First-Floor Bedroom', 'guest');
  assert.deepEqual(catState.qualifiers['First-Floor Bedroom'].sort(), ['guest', 'primary']);
  catState = toggleCriterionQualifier(catState, 'First-Floor Bedroom', 'primary'); // toggling off removes just that one
  assert.deepEqual(catState.qualifiers['First-Floor Bedroom'], ['guest']);
  catState = toggleCriterionQualifier(catState, 'First-Floor Bedroom', null); // explicit Any clears both
  assert.deepEqual(catState.qualifiers['First-Floor Bedroom'], []);
});

test('selecting both Garage qualifiers is semantically identical to Any', () => {
  assert.equal(isGarageQualifierAny([]), true);
  assert.equal(isGarageQualifierAny(undefined), true);
  assert.equal(isGarageQualifierAny(['attached']), false);
  assert.equal(isGarageQualifierAny(['attached', 'detached']), true);
});

test('compact My Search display text reads "Parent · Qualifier"', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { qualifiers: { Garage: ['attached'], 'Fenced yard': ['privacy'] } }, features: { qualifiers: { 'First-Floor Bedroom': ['primary', 'guest'] } } });
  assert.equal(qualifierSummaryLabel('exterior', 'Garage', selectedQualifiers(priorities, 'exterior', 'Garage')), 'Attached');
  assert.equal(criterionCompactLabel('exterior', 'Garage', priorities), 'Garage · Attached');
  assert.equal(criterionCompactLabel('exterior', 'Fenced yard', priorities), 'Fenced Yard · Privacy Fence');
  assert.equal(criterionCompactLabel('features', 'First-Floor Bedroom', priorities), 'First-Floor Bedroom · Primary + Guest');
  const anyPriorities = normalizePriorities({ searchType: 'purchase' });
  assert.equal(criterionCompactLabel('exterior', 'Garage', anyPriorities), 'Garage · Any');
  assert.equal(criterionCompactLabel('exterior', 'Fenced yard', anyPriorities), 'Fenced Yard · Any Fence');
  assert.equal(criterionCompactLabel('exterior', 'Pool', anyPriorities), 'Pool'); // unqualified criterion unaffected
});

/* ------------------------------ Safe fold: flat legacy selections -> parent + qualifier ------------------------------ */

test('Attached garage + Detached garage both previously selected fold into Garage with no qualifier (Any) and the stronger tier', () => {
  const priorities = normalizePriorities({
    searchType: 'purchase',
    exterior: { tiers: { 'Attached garage': 'nice', 'Detached garage': 'must' }, customItems: [{ label: 'Attached garage', kind: 'check' }, { label: 'Detached garage', kind: 'check' }] },
  });
  assert.equal(priorities.exterior.tiers.Garage, 'must'); // stronger of nice/must wins
  assert.deepEqual(priorities.exterior.qualifiers.Garage, []);
  assert.equal(priorities.exterior.tiers['Attached garage'], undefined);
  assert.equal(priorities.exterior.tiers['Detached garage'], undefined);
  assert.ok(!priorities.exterior.customItems.some((item) => item.label === 'Attached garage' || item.label === 'Detached garage'));
});

test('only Attached garage previously selected folds into Garage with the Attached qualifier — never guessed as Any', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { tiers: { 'Attached garage': 'important' } } });
  assert.equal(priorities.exterior.tiers.Garage, 'important');
  assert.deepEqual(priorities.exterior.qualifiers.Garage, ['attached']);
});

test('Privacy Fencing folds into Fenced yard + privacy qualifier; First-Floor Primary folds into First-Floor Bedroom + primary qualifier', () => {
  const priorities = normalizePriorities({
    searchType: 'purchase',
    exterior: { tiers: { 'Privacy Fencing': 'must' } },
    features: { tiers: { 'First-Floor Primary': 'nice' } },
  });
  assert.equal(priorities.exterior.tiers['Fenced yard'], 'must');
  assert.deepEqual(priorities.exterior.qualifiers['Fenced yard'], ['privacy']);
  assert.equal(priorities.features.tiers['First-Floor Bedroom'], 'nice');
  assert.deepEqual(priorities.features.qualifiers['First-Floor Bedroom'], ['primary']);
});

test('an existing explicit Garage selection is never demoted by a weaker legacy flat selection, only strengthened', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { tiers: { Garage: 'must', 'Attached garage': 'nice' } } });
  assert.equal(priorities.exterior.tiers.Garage, 'must');
  assert.deepEqual(priorities.exterior.qualifiers.Garage, ['attached']);
});

test('this fold never fires for Rental/Investment — Attached Garage remains whatever it means there', () => {
  const priorities = normalizePriorities({ searchType: 'rental', features: { tiers: {} }, exterior: { tiers: { 'Attached garage': 'important' } } });
  assert.equal(priorities.exterior.tiers['Attached garage'], 'important');
  assert.equal(priorities.exterior.tiers.Garage, undefined);
});

test('a legacy per-home fact recorded under a flat child key stays visible as the new qualifier fact', () => {
  const folded = foldLegacyCheckAliases({ 'exterior:Attached garage': true, 'exterior:Privacy Fencing': 'no', 'features:First-Floor Primary': true }, 'purchase');
  assert.equal(folded[qualifierFactKey('exterior', 'Garage', 'attached')], true);
  assert.equal(folded[qualifierFactKey('exterior', 'Fenced yard', 'privacy')], 'no');
  assert.equal(folded[qualifierFactKey('features', 'First-Floor Bedroom', 'primary')], true);
});

/* ------------------------------ Match semantics: UNKNOWN never becomes MISMATCH ------------------------------ */

test('Garage: a confirmed detached garage matches Any and Detached, and mismatches Attached (never Unknown, since the type is reliably known)', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'exterior', 'Garage', 'must');
  const home = { garageSpaces: '1', checks: { [qualifierFactKey('exterior', 'Garage', 'detached')]: true } };
  const anyResult = computeMatch(home, priorities).allSelected[0];
  assert.deepEqual([anyResult.evaluated, anyResult.met], [true, true]);

  const detachedWant = { ...priorities, exterior: setExclusiveQualifier(priorities.exterior, 'Garage', 'detached') };
  const detachedResult = computeMatch(home, detachedWant).allSelected[0];
  assert.deepEqual([detachedResult.evaluated, detachedResult.met], [true, true]);

  const attachedWant = { ...priorities, exterior: setExclusiveQualifier(priorities.exterior, 'Garage', 'attached') };
  const attachedResult = computeMatch(home, attachedWant).allSelected[0];
  assert.deepEqual([attachedResult.evaluated, attachedResult.met], [true, false]); // confirmed mismatch, not Unknown
});

test('Garage: type cannot reliably be determined — Any matches (garage exists) but Attached/Detached stay Unknown', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'exterior', 'Garage', 'must');
  const home = { garageSpaces: '2', checks: {} }; // garage confirmed to exist, type unrecorded
  const anyResult = computeMatch(home, priorities).allSelected[0];
  assert.deepEqual([anyResult.evaluated, anyResult.met], [true, true]);

  for (const qualifier of ['attached', 'detached']) {
    const wanted = { ...priorities, exterior: setExclusiveQualifier(priorities.exterior, 'Garage', qualifier) };
    const result = computeMatch(home, wanted).allSelected[0];
    assert.equal(result.evaluated, false, `${qualifier} should be Unknown, not a mismatch, when only "garage exists" is known`);
  }
});

test('Garage: no reliable garage information at all — Any is Unknown', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'exterior', 'Garage', 'must');
  const home = { checks: {} }; // garageSpaces unset entirely
  const match = computeMatch(home, priorities);
  assert.equal(match.allSelected[0].evaluated, false);
  assert.equal(match.pct, null);
});

test('Fenced Yard: a reliable privacy fence satisfies both Any and Privacy Fence', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'exterior', 'Fenced yard', 'must');
  const anyHome = { checks: { [qualifierFactKey('exterior', 'Fenced yard', 'privacy')]: true } }; // base fact never separately recorded
  const anyResult = computeMatch(anyHome, priorities).allSelected[0];
  assert.deepEqual([anyResult.evaluated, anyResult.met], [true, true]); // privacy fence implies fenced yard

  const wantPrivacy = { ...priorities, exterior: setExclusiveQualifier(priorities.exterior, 'Fenced yard', 'privacy') };
  const privacyResult = computeMatch(anyHome, wantPrivacy).allSelected[0];
  assert.deepEqual([privacyResult.evaluated, privacyResult.met], [true, true]);
});

test('Fenced Yard: a reliable non-privacy fence satisfies Any but not Privacy Fence', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'exterior', 'Fenced yard', 'must');
  const home = { checks: { 'exterior:Fenced yard': true, [qualifierFactKey('exterior', 'Fenced yard', 'privacy')]: 'no' } };
  const anyResult = computeMatch(home, priorities).allSelected[0];
  assert.deepEqual([anyResult.evaluated, anyResult.met], [true, true]);

  const wantPrivacy = { ...priorities, exterior: setExclusiveQualifier(priorities.exterior, 'Fenced yard', 'privacy') };
  const privacyResult = computeMatch(home, wantPrivacy).allSelected[0];
  assert.deepEqual([privacyResult.evaluated, privacyResult.met], [true, false]);
});

test('Fenced Yard: fence exists but type unknown — Any may match while Privacy Fence remains Unknown', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'exterior', 'Fenced yard', 'must');
  const home = { checks: { 'exterior:Fenced yard': true } };
  const anyResult = computeMatch(home, priorities).allSelected[0];
  assert.deepEqual([anyResult.evaluated, anyResult.met], [true, true]);

  const wantPrivacy = { ...priorities, exterior: setExclusiveQualifier(priorities.exterior, 'Fenced yard', 'privacy') };
  const privacyResult = computeMatch(home, wantPrivacy).allSelected[0];
  assert.equal(privacyResult.evaluated, false);
});

test('First-Floor Bedroom: a known first-floor bedroom with unknown role matches Any while Primary/Guest remain Unknown', () => {
  const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'features', 'First-Floor Bedroom', 'must');
  const home = { checks: { 'features:First-Floor Bedroom': true } };
  const anyResult = computeMatch(home, priorities).allSelected[0];
  assert.deepEqual([anyResult.evaluated, anyResult.met], [true, true]);

  const wantPrimary = { ...priorities, features: toggleCriterionQualifier(priorities.features, 'First-Floor Bedroom', 'primary') };
  const primaryResult = computeMatch(home, wantPrimary).allSelected[0];
  assert.equal(primaryResult.evaluated, false);
});

test('First-Floor Bedroom: wanting both Primary and Guest requires both to be reliably known before scoring at all', () => {
  let priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'features', 'First-Floor Bedroom', 'must');
  priorities = { ...priorities, features: toggleCriterionQualifier(toggleCriterionQualifier(priorities.features, 'First-Floor Bedroom', 'primary'), 'First-Floor Bedroom', 'guest') };

  const onlyPrimaryKnown = { checks: { [qualifierFactKey('features', 'First-Floor Bedroom', 'primary')]: true } };
  assert.equal(computeMatch(onlyPrimaryKnown, priorities).allSelected[0].evaluated, false);

  const bothKnownBothMet = { checks: { [qualifierFactKey('features', 'First-Floor Bedroom', 'primary')]: true, [qualifierFactKey('features', 'First-Floor Bedroom', 'guest')]: true } };
  const fullMatch = computeMatch(bothKnownBothMet, priorities).allSelected[0];
  assert.deepEqual([fullMatch.evaluated, fullMatch.score, fullMatch.met], [true, 1, true]);

  const bothKnownOneMet = { checks: { [qualifierFactKey('features', 'First-Floor Bedroom', 'primary')]: true, [qualifierFactKey('features', 'First-Floor Bedroom', 'guest')]: 'no' } };
  const partial = computeMatch(bothKnownOneMet, priorities).allSelected[0];
  assert.deepEqual([partial.evaluated, partial.score, partial.met], [true, 0.5, false]);
});

/* ------------------------------ UI wiring ------------------------------ */

test('qualifier controls are revealed only once the parent is selected, in both Onboarding and My Search', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(onboarding, /if \(!selected\(criterion\) \|\| !hasQualifierOptions\(criterion\.categoryKey, criterion\.label\)\) return \[chip\];/);
  assert.match(board, /hasQualifierOptions\(item\.categoryKey, item\.label\) && \(/);
  assert.match(onboarding, /import QualifierPicker from '@\/components\/QualifierPicker'/);
  assert.match(board, /import QualifierPicker from '@\/components\/QualifierPicker'/);
});

test('My Search shows the compact "Parent · Qualifier" label on the resting priority row', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /<span>\{criterionCompactLabel\(item\.categoryKey, item\.label, priorities\)\}<\/span>/);
});

test('Edit Home never shows a redundant manual Garage yes/no row (garageSpaces already answers it) but does ask about a chosen qualifier', () => {
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /!\(category\.key === 'exterior' && item\.label === 'Garage'\)/);
  assert.match(modal, /qualifierFactRows\(category\.key, item\.label, priorities\)/);
});
