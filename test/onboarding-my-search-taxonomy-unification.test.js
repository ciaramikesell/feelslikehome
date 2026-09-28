import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getItemlistCategories, normalizePriorities, foldLegacyCheckAliases, criterionDisplayLabel, isSchoolsSuppressed } from '../src/lib/constants.js';
import { computeMatch, evaluateSearchBasics, splitCategoryItems, selectPriorityItem } from '../src/lib/matching.js';
import { ONBOARDING_SUGGESTIONS } from '../src/lib/onboarding.js';

// Mirrors how the real UI (Onboarding / My Search's Rank Priorities editor) selects a canonical
// (non-core, "suggested") item — promoting it into customItems, exactly what
// selectPriorityItem does — since a tier alone with no customItems entry never
// renders as a selected priority for a purchase category (every purchase
// category's coreItems is empty; see LOCATION_CORE/FEATURES_CORE/EXTERIOR_CORE).
function withSelected(priorities, categoryKey, label, tier, kind = 'check') {
  const def = getItemlistCategories(priorities.searchType).find((category) => category.key === categoryKey);
  return { ...priorities, [categoryKey]: selectPriorityItem(priorities[categoryKey], def, { label, kind }, tier) };
}

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const purchaseLabels = () => getItemlistCategories('purchase').flatMap((def) => [...def.coreItems, ...def.suggestedItems].map((item) => `${def.key}:${item.label}`));

/* ------------------------------ Taxonomy ------------------------------ */

test('one canonical Home Office, Fenced Yard, and Guest Bedroom — no casing-drift duplicates in the purchase catalog', () => {
  const labels = purchaseLabels();
  assert.equal(labels.filter((key) => key.toLowerCase() === 'features:home office').length, 1);
  assert.equal(labels.filter((key) => key.toLowerCase() === 'exterior:fenced yard').length, 1);
  assert.equal(labels.filter((key) => key.toLowerCase() === 'features:guest bedroom').length, 1);
  assert.ok(labels.includes('features:Home office'));
  assert.ok(labels.includes('exterior:Fenced yard'));
  assert.ok(labels.includes('features:Guest Bedroom'));
  // Guest / In-Law Suite is no longer offered (Guest Bedroom is the one guest-space criterion).
  assert.ok(!labels.includes('features:Guest / In-Law Suite'));
  assert.equal(criterionDisplayLabel('features', 'Home office'), 'Home Office');
  assert.equal(criterionDisplayLabel('exterior', 'Fenced yard'), 'Fenced Yard');
});

test('Immediate Street / Surroundings and generic Walkability can never be newly created for purchase; Garage is the one garage criterion', () => {
  const labels = purchaseLabels();
  assert.ok(!labels.includes('location:Immediate Street / Surroundings'));
  assert.ok(!labels.includes('location:Walkability'));
  // Authenticated-mobile redesign: Garage is the weighted criterion; Attached/Detached
  // is an optional qualifier, never a separate criterion.
  assert.equal(labels.filter((key) => /garage/i.test(key)).join(','), 'exterior:Garage');
  // Onboarding derives from the exact same catalog, so it offers the same set.
  const onboardingBuyLabels = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.map((item) => `${item.categoryKey}:${item.label}`));
  assert.ok(!onboardingBuyLabels.includes('location:Immediate Street / Surroundings'));
  assert.ok(!onboardingBuyLabels.includes('location:Walkability'));
  assert.ok(onboardingBuyLabels.includes('exterior:Garage'));
  assert.ok(!onboardingBuyLabels.includes('exterior:Attached garage'));
  assert.ok(!onboardingBuyLabels.includes('exterior:Detached garage'));
});

test('No HOA exists under Location; Reputable Schools and Walkable Schools are distinct', () => {
  const location = getItemlistCategories('purchase').find((def) => def.key === 'location');
  const labels = location.suggestedItems.map((item) => item.label);
  assert.ok(labels.includes('No HOA'));
  assert.ok(labels.includes('Reputable Schools'));
  assert.ok(labels.includes('Walkable schools'));
  assert.notEqual('Reputable Schools', criterionDisplayLabel('location', 'Walkable schools'));
});

test('onboarding and My Search share one canonical taxonomy — Home to Buy is derived from getItemlistCategories, not a second hand-authored list', () => {
  const onboardingLabels = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.map((item) => `${item.categoryKey}:${item.label}`));
  assert.deepEqual(onboardingLabels, purchaseLabels());
});

/* ------------------------------ Legacy aliasing ------------------------------ */

test('safe direct aliases fold a legacy label onto its canonical identity without creating a duplicate visible priority', () => {
  const priorities = normalizePriorities({
    searchType: 'purchase',
    features: { tiers: { 'Home Office': 'must', 'Central Air': 'nice' }, customItems: [{ label: 'Home Office', kind: 'check' }, { label: 'Central Air', kind: 'check' }] },
    exterior: { tiers: { 'Fenced Yard': 'important' }, customItems: [{ label: 'Fenced Yard', kind: 'check' }] },
  });
  assert.equal(priorities.features.tiers['Home Office'], undefined);
  assert.equal(priorities.features.tiers['Home office'], 'must');
  assert.equal(priorities.features.tiers['Central air'], 'nice');
  assert.equal(priorities.exterior.tiers['Fenced yard'], 'important');
  assert.ok(!priorities.features.customItems.some((item) => item.label === 'Home Office' || item.label === 'Central Air'));
  assert.ok(!priorities.exterior.customItems.some((item) => item.label === 'Fenced Yard'));
  // Rendering it produces exactly one entry per concept, not two.
  const featuresDef = getItemlistCategories('purchase').find((def) => def.key === 'features');
  const { core, custom } = splitCategoryItems(featuresDef, priorities);
  assert.equal([...core, ...custom].filter((item) => item.label.toLowerCase() === 'home office').length, 1);
});

test('an explicit canonical choice always wins over a stale legacy tier when both exist', () => {
  const priorities = normalizePriorities({
    searchType: 'purchase',
    features: { tiers: { 'Home Office': 'nice', 'Home office': 'must' } },
  });
  assert.equal(priorities.features.tiers['Home office'], 'must');
  assert.equal(priorities.features.tiers['Home Office'], undefined);
});

test('legacy aliasing never fires for Rental/Investment, whose own real canonical identity uses the Title Case spelling', () => {
  const rentalPriorities = normalizePriorities({ searchType: 'rental', features: { tiers: { 'Home Office': 'important' } } });
  assert.equal(rentalPriorities.features.tiers['Home Office'], 'important');
  assert.equal(rentalPriorities.features.tiers['Home office'], undefined);
});

test('a legacy-labeled home fact stays visible to Match once the search priority has folded onto the canonical label', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'Home Office': 'must' } } });
  assert.equal(priorities.features.tiers['Home office'], 'must');
  const home = { checks: { 'features:Home Office': true } };
  const match = computeMatch(home, priorities);
  const entry = match.allSelected.find((item) => item.key === 'features:Home office');
  assert.equal(entry.evaluated, true);
  assert.equal(entry.met, true);
  // An explicit canonical-key answer is never overwritten by the legacy one.
  const folded = foldLegacyCheckAliases({ 'features:Home Office': true, 'features:Home office': false }, 'purchase');
  assert.equal(folded['features:Home office'], false);
});

test('un-retiring Guest / In-Law Suite restores Match credit for anyone who already selected it — a restoration of intent, not a new choice', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'Guest / In-Law Suite': 'important' }, customItems: [{ label: 'Guest / In-Law Suite', kind: 'check' }] } });
  const match = computeMatch({ checks: { 'features:Guest / In-Law Suite': true } }, priorities);
  assert.ok(match.allSelected.some((item) => item.key === 'features:Guest / In-Law Suite' && item.evaluated && item.met));
});

/* ------------------------------ My Search / schools ------------------------------ */

test('the schools yes/no toggle is gone; the historical suppression it wrote is still safely honored', () => {
  const board = read('src/components/RankBoard.jsx');
  const panel = read('src/components/MySearchPanel.jsx');
  assert.doesNotMatch(board, /SchoolsRelevanceGate/);
  assert.doesNotMatch(panel, /SchoolsRelevanceGate/);
  assert.doesNotMatch(board, /Will schools factor into your decision/);
  // No new code can ever set schoolsRelevance again, but a search that already
  // has it stored keeps behaving exactly as before — no hidden Match change.
  assert.ok(isSchoolsSuppressed({ location: { schoolsRelevance: 'no' } }));
  const priorities = normalizePriorities({ searchType: 'purchase', location: { tiers: { Schools: 'important' }, schoolsRelevance: 'no' } });
  const match = computeMatch({ checks: { 'location:Schools': true } }, priorities);
  assert.equal(match, null); // suppressed exactly as it was before the toggle UI was removed
});

test('removing the schools boolean does not touch the new Reputable Schools / Walkable Schools criteria', () => {
  let priorities = normalizePriorities({ searchType: 'purchase', location: { schoolsRelevance: 'no' } });
  priorities = withSelected(priorities, 'location', 'Reputable Schools', 'must');
  const match = computeMatch({ checks: {} }, priorities);
  assert.equal(match.allSelected[0].key, 'location:Reputable Schools');
  assert.equal(match.allSelected[0].evaluated, false); // Unknown, never suppressed and never a mismatch
});

test('ranking is taught prominently in onboarding step 3 (not as fine print), and first-run My Search uses ready language', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const profile = read('src/lib/searchProfile.js');
  assert.match(onboarding, /title="Now rank what matters most\."/);
  assert.match(onboarding, /Everything you chose began as Important\. Drag a priority between levels, or tap it and choose where it belongs\./);
  assert.match(onboarding, /className="flh-lead"/);
  assert.match(profile, /if \(firstRun\) return \{ title: 'Your search is ready\.'/);
});

/* ------------------------------ Match safety for new criteria ------------------------------ */

test('unknown data never becomes a mismatch for any newly introduced criterion', () => {
  const newCriteria = [
    ['location', 'Charming Neighborhood'], ['location', 'Reputable Schools'], ['location', 'Walkable to Town'],
    ['location', 'Bustling Street'], ['location', 'No HOA'], ['features', 'First-Floor Primary'],
    ['features', 'Move-in Ready'], ['features', 'Renovation Potential'], ['features', 'New Construction'],
    ['exterior', 'Privacy Fencing'],
  ];
  for (const [categoryKey, label] of newCriteria) {
    const priorities = withSelected(normalizePriorities({ searchType: 'purchase' }), categoryKey, label, 'must');
    const match = computeMatch({ checks: {} }, priorities);
    assert.equal(match.allSelected[0].evaluated, false, `${categoryKey}:${label} should be Unknown, not evaluated, when the home has no recorded fact`);
    assert.equal(match.pct, null);
  }
});

test('Move-in Ready / Renovation Potential / New Construction stay independent of the existing Home Condition multiselect', () => {
  let priorities = normalizePriorities({ searchType: 'purchase', homeCondition: { values: ['Move-In Ready'], tier: 'important' } });
  priorities = withSelected(priorities, 'features', 'Renovation Potential', 'must');
  const match = computeMatch({ checks: {}, homeCondition: ['Move-In Ready'] }, priorities);
  // The legacy ranked priority keeps counting in Match; Home Condition is a Search
  // Basic, compared separately and never weighted.
  const renovation = match.allSelected.find((item) => item.key === 'features:Renovation Potential');
  assert.ok(renovation);
  assert.ok(!match.allSelected.some((item) => item.key === 'homeCondition'));
  const condition = evaluateSearchBasics({ homeCondition: ['Move-In Ready'] }, priorities).find((item) => item.key === 'homeCondition');
  assert.equal(condition.met, true);
});
