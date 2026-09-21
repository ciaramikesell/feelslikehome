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

/* ------------------------------ Taxonomy: Garage is the sole remaining parent ------------------------------ */

test('Garage is the sole canonical parent — Fenced Yard/Privacy Fencing and First-Floor Primary/Guest Bedroom are independent flat chips (2026 reversion)', () => {
  const labels = purchaseLabels();
  assert.ok(labels.includes('exterior:Garage'));
  for (const flatChild of ['exterior:Attached garage', 'exterior:Detached garage']) {
    assert.ok(!labels.includes(flatChild), `${flatChild} must not be an independent canonical chip`);
  }
  for (const flat of ['exterior:Fenced yard', 'exterior:Privacy Fencing', 'features:First-Floor Primary', 'features:Guest Bedroom']) {
    assert.ok(labels.includes(flat), `${flat} must be an independent canonical chip`);
  }
  assert.ok(!labels.includes('features:First-Floor Bedroom'), 'First-Floor Bedroom must not exist as a new-selectable parent chip');
  const onboardingBuyLabels = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.map((item) => `${item.categoryKey}:${item.label}`));
  for (const flatChild of ['exterior:Attached garage', 'exterior:Detached garage', 'features:First-Floor Bedroom']) {
    assert.ok(!onboardingBuyLabels.includes(flatChild));
  }
  for (const flat of ['exterior:Fenced yard', 'exterior:Privacy Fencing', 'features:First-Floor Primary', 'features:Guest Bedroom']) {
    assert.ok(onboardingBuyLabels.includes(flat));
  }
});

test('qualifier registry contains only Garage (Attached/Detached) — Fenced Yard and First-Floor Bedroom have no qualifier options', () => {
  assert.deepEqual(qualifierOptions('exterior', 'Garage').map((o) => o.key), ['attached', 'detached']);
  assert.equal(qualifierOptions('exterior', 'Fenced yard'), null);
  assert.equal(qualifierOptions('features', 'First-Floor Bedroom'), null);
  assert.equal(hasQualifierOptions('exterior', 'Fenced yard'), false);
  assert.equal(hasQualifierOptions('features', 'First-Floor Bedroom'), false);
  assert.equal(hasQualifierOptions('exterior', 'Pool'), false);
});

/* ------------------------------ Qualifier state helpers (Garage only) ------------------------------ */

test('Garage qualifiers behave as an exclusive replacement; "Any" always clears', () => {
  let catState = { tiers: { Garage: 'must' }, qualifiers: {} };
  catState = setExclusiveQualifier(catState, 'Garage', 'attached');
  assert.deepEqual(catState.qualifiers.Garage, ['attached']);
  catState = setExclusiveQualifier(catState, 'Garage', 'detached');
  assert.deepEqual(catState.qualifiers.Garage, ['detached']); // replaced, not appended
  catState = setExclusiveQualifier(catState, 'Garage', null);
  assert.deepEqual(catState.qualifiers.Garage, []); // explicit Any
});

test('selecting both Garage qualifiers is semantically identical to Any', () => {
  assert.equal(isGarageQualifierAny([]), true);
  assert.equal(isGarageQualifierAny(undefined), true);
  assert.equal(isGarageQualifierAny(['attached']), false);
  assert.equal(isGarageQualifierAny(['attached', 'detached']), true);
});

test('compact My Search display text reads "Parent · Qualifier" for Garage; unqualified criteria show their plain label', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { qualifiers: { Garage: ['attached'] } } });
  assert.equal(qualifierSummaryLabel('exterior', 'Garage', selectedQualifiers(priorities, 'exterior', 'Garage')), 'Attached');
  assert.equal(criterionCompactLabel('exterior', 'Garage', priorities), 'Garage · Attached');
  const anyPriorities = normalizePriorities({ searchType: 'purchase' });
  assert.equal(criterionCompactLabel('exterior', 'Garage', anyPriorities), 'Garage · Any');
  assert.equal(criterionCompactLabel('exterior', 'Fenced yard', anyPriorities), 'Fenced Yard');
  assert.equal(criterionCompactLabel('exterior', 'Privacy Fencing', anyPriorities), 'Privacy Fencing');
  assert.equal(criterionCompactLabel('features', 'First-Floor Primary', anyPriorities), 'First-Floor Primary');
  assert.equal(criterionCompactLabel('features', 'Guest Bedroom', anyPriorities), 'Guest Bedroom');
});

/* ------------------------------ Safe fold: flat legacy Garage selections -> parent + qualifier ------------------------------ */

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

test('a legacy per-home Garage fact recorded under a flat child key stays visible as the new qualifier fact', () => {
  const folded = foldLegacyCheckAliases({ 'exterior:Attached garage': true }, 'purchase');
  assert.equal(folded[qualifierFactKey('exterior', 'Garage', 'attached')], true);
});

/* ------------------------------ Safe fold: Fenced Yard/First-Floor Bedroom parent+qualifier -> flat (2026 reversion) ------------------------------ */

test('Fenced yard selected with no qualifier (Any) stays exactly as the flat Fenced Yard criterion', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { tiers: { 'Fenced yard': 'must' }, qualifiers: { 'Fenced yard': [] } } });
  assert.equal(priorities.exterior.tiers['Fenced yard'], 'must');
  assert.equal(priorities.exterior.tiers['Privacy Fencing'], undefined);
  assert.deepEqual(priorities.exterior.qualifiers['Fenced yard'], undefined); // cleaned up, no longer meaningful
});

test('Fenced yard + privacy qualifier folds onto Privacy Fencing alone (not both) at the same tier — this is what the qualifier branch actually scored', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { tiers: { 'Fenced yard': 'must' }, qualifiers: { 'Fenced yard': ['privacy'] } } });
  assert.equal(priorities.exterior.tiers['Privacy Fencing'], 'must');
  assert.equal(priorities.exterior.tiers['Fenced yard'], undefined);
  assert.equal(priorities.exterior.qualifiers['Fenced yard'], undefined);
  assert.ok(priorities.exterior.customItems.some((item) => item.label === 'Privacy Fencing'));
  assert.ok(!priorities.exterior.customItems.some((item) => item.label === 'Fenced yard'));
});

test('a newly selected independent Privacy Fencing priority never folds back into Fenced yard', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { tiers: { 'Privacy Fencing': 'nice' } } });
  assert.equal(priorities.exterior.tiers['Privacy Fencing'], 'nice');
  assert.equal(priorities.exterior.tiers['Fenced yard'], undefined);
});

test('First-Floor Bedroom + only the Primary qualifier folds onto First-Floor Primary alone', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'First-Floor Bedroom': 'important' }, qualifiers: { 'First-Floor Bedroom': ['primary'] } } });
  assert.equal(priorities.features.tiers['First-Floor Primary'], 'important');
  assert.equal(priorities.features.tiers['Guest Bedroom'], undefined);
  assert.equal(priorities.features.tiers['First-Floor Bedroom'], undefined);
});

test('First-Floor Bedroom + only the Guest qualifier folds onto Guest Bedroom alone', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'First-Floor Bedroom': 'nice' }, qualifiers: { 'First-Floor Bedroom': ['guest'] } } });
  assert.equal(priorities.features.tiers['Guest Bedroom'], 'nice');
  assert.equal(priorities.features.tiers['First-Floor Primary'], undefined);
});

test('First-Floor Bedroom + both Primary and Guest qualifiers folds onto both independent criteria at the same tier', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'First-Floor Bedroom': 'must' }, qualifiers: { 'First-Floor Bedroom': ['primary', 'guest'] } } });
  assert.equal(priorities.features.tiers['First-Floor Primary'], 'must');
  assert.equal(priorities.features.tiers['Guest Bedroom'], 'must');
  assert.equal(priorities.features.tiers['First-Floor Bedroom'], undefined);
});

test('First-Floor Bedroom selected with NO qualifier (Any) has no exact equivalent and is preserved untouched as a legacy item, never guessed', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'First-Floor Bedroom': 'must' }, customItems: [{ label: 'First-Floor Bedroom', kind: 'check' }] } });
  assert.equal(priorities.features.tiers['First-Floor Bedroom'], 'must');
  assert.equal(priorities.features.tiers['First-Floor Primary'], undefined);
  assert.equal(priorities.features.tiers['Guest Bedroom'], undefined);
  assert.equal(hasQualifierOptions('features', 'First-Floor Bedroom'), false); // no qualifier UI reappears for it
});

test('a legacy per-home fact recorded under the old Fenced yard/First-Floor Bedroom qualifier keys stays visible under the new flat canonical fact keys', () => {
  const folded = foldLegacyCheckAliases({
    [qualifierFactKey('exterior', 'Fenced yard', 'privacy')]: true,
    [qualifierFactKey('features', 'First-Floor Bedroom', 'primary')]: true,
    [qualifierFactKey('features', 'First-Floor Bedroom', 'guest')]: 'no',
  }, 'purchase');
  assert.equal(folded['exterior:Privacy Fencing'], true);
  assert.equal(folded['features:First-Floor Primary'], true);
  assert.equal(folded['features:Guest Bedroom'], 'no');
});

test('an explicit canonical-key fact is never overwritten by the legacy qualifier-key fact', () => {
  const folded = foldLegacyCheckAliases({
    'features:First-Floor Primary': false,
    [qualifierFactKey('features', 'First-Floor Bedroom', 'primary')]: true,
  }, 'purchase');
  assert.equal(folded['features:First-Floor Primary'], false);
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

test('Fenced Yard and Privacy Fencing score independently as plain check-kind criteria', () => {
  let priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'exterior', 'Fenced yard', 'must');
  priorities = withSelected(priorities, 'exterior', 'Privacy Fencing', 'nice');
  const home = { checks: { 'exterior:Fenced yard': true, 'exterior:Privacy Fencing': 'no' } };
  const match = computeMatch(home, priorities);
  const fenced = match.allSelected.find((c) => c.key === 'exterior:Fenced yard');
  const privacy = match.allSelected.find((c) => c.key === 'exterior:Privacy Fencing');
  assert.deepEqual([fenced.evaluated, fenced.met], [true, true]);
  assert.deepEqual([privacy.evaluated, privacy.met], [true, false]);
});

test('First-Floor Primary and Guest Bedroom score independently as plain check-kind criteria', () => {
  let priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), 'features', 'First-Floor Primary', 'must');
  priorities = withSelected(priorities, 'features', 'Guest Bedroom', 'important');
  const home = { checks: { 'features:First-Floor Primary': true } }; // Guest Bedroom left unknown
  const match = computeMatch(home, priorities);
  const primary = match.allSelected.find((c) => c.key === 'features:First-Floor Primary');
  const guest = match.allSelected.find((c) => c.key === 'features:Guest Bedroom');
  assert.deepEqual([primary.evaluated, primary.met], [true, true]);
  assert.equal(guest.evaluated, false);
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
