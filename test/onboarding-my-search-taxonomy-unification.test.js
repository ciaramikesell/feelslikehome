import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getItemlistCategories, normalizePriorities, foldLegacyCheckAliases, criterionDisplayLabel, isSchoolsSuppressed } from '../src/lib/constants.js';
import { computeMatch, splitCategoryItems, selectPriorityItem } from '../src/lib/matching.js';
import { ONBOARDING_SUGGESTIONS } from '../src/lib/onboarding.js';

// Mirrors how the real UI (PriorityBoard/Onboarding) selects a canonical
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

test('one canonical Home Office and Fenced Yard — no casing-drift duplicates in the purchase catalog', () => {
  const labels = purchaseLabels();
  assert.equal(labels.filter((key) => key.toLowerCase() === 'features:home office').length, 1);
  assert.equal(labels.filter((key) => key.toLowerCase() === 'exterior:fenced yard').length, 1);
  assert.ok(labels.includes('features:Home office'));
  assert.ok(labels.includes('exterior:Fenced yard'));
  assert.equal(criterionDisplayLabel('features', 'Home office'), 'Home Office');
  assert.equal(criterionDisplayLabel('exterior', 'Fenced yard'), 'Fenced Yard');
});

// Small criteria cleanup: 'Guest / In-Law Suite' is retired a second time (it was
// briefly restored during the 2026 taxonomy unification) in favor of one canonical
// 'Guest Bedroom' — no longer its own selectable identity, but the two concepts
// weren't distinct enough to justify separately keeping both.
test('Guest / In-Law Suite is no longer a selectable canonical criterion — only Guest Bedroom is', () => {
  const labels = purchaseLabels();
  assert.ok(!labels.includes('features:Guest / In-Law Suite'));
  assert.ok(labels.includes('features:Guest Bedroom'));
});

test('Immediate Street / Surroundings and generic Walkability can never be newly created for purchase; Garage is the sole remaining parent (no flat Attached/Detached chips)', () => {
  const labels = purchaseLabels();
  assert.ok(!labels.includes('location:Immediate Street / Surroundings'));
  assert.ok(!labels.includes('location:Walkability'));
  assert.ok(labels.includes('exterior:Garage'));
  assert.ok(!labels.includes('exterior:Attached garage'));
  assert.ok(!labels.includes('exterior:Detached garage'));
  // 2026 Basics/taxonomy correction: Fenced Yard/Privacy Fencing and First-Floor
  // Primary/Guest Bedroom are independent flat chips again (parent/qualifier reverted).
  assert.ok(labels.includes('exterior:Fenced yard'));
  assert.ok(labels.includes('exterior:Privacy Fencing'));
  assert.ok(labels.includes('features:First-Floor Primary'));
  assert.ok(labels.includes('features:Guest Bedroom'));
  assert.ok(!labels.includes('features:First-Floor Bedroom'));
  // Charming Neighborhood, Move-in Ready, Renovation Potential, and New Construction are
  // removed from the weighted, selectable catalog — Charming Neighborhood is deferred to
  // future Post-Tour criteria, the other three now live exclusively under Basics -> Home
  // Condition (see HOME_CONDITION_OPTIONS).
  for (const removed of ['location:Charming Neighborhood', 'features:Move-in Ready', 'features:Renovation Potential', 'features:New Construction']) {
    assert.ok(!labels.includes(removed), `${removed} must not be a newly selectable weighted criterion`);
  }
  // Onboarding derives from the exact same catalog, so it can't offer them either.
  const onboardingBuyLabels = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.map((item) => `${item.categoryKey}:${item.label}`));
  assert.ok(!onboardingBuyLabels.includes('location:Immediate Street / Surroundings'));
  assert.ok(!onboardingBuyLabels.includes('location:Walkability'));
  assert.ok(onboardingBuyLabels.includes('exterior:Garage'));
  assert.ok(!onboardingBuyLabels.includes('exterior:Attached garage'));
  assert.ok(!onboardingBuyLabels.includes('exterior:Detached garage'));
  assert.ok(!onboardingBuyLabels.includes('features:First-Floor Bedroom'));
  for (const removed of ['location:Charming Neighborhood', 'features:Move-in Ready', 'features:Renovation Potential', 'features:New Construction']) {
    assert.ok(!onboardingBuyLabels.includes(removed));
  }
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

test('legacy aliasing never fires for Investment, whose own real canonical identity uses the Title Case spelling', () => {
  const investmentPriorities = normalizePriorities({ searchType: 'investment', features: { tiers: { 'Home Office': 'important' } } });
  assert.equal(investmentPriorities.features.tiers['Home Office'], 'important');
  assert.equal(investmentPriorities.features.tiers['Home office'], undefined);
});

// 2026 Home-to-Rent parity pass: a rented HOUSE now shares Home to Buy's exact
// canonical identity, so it needs the same safe casing fold purchase already had —
// see RENTAL_HOME_LEGACY_LABEL_ALIASES — or re-selecting the new canonical chip from
// My Search would silently create a visible duplicate for the same idea.
test('legacy aliasing now fires for Home to Rent (a rented house), which shares Home to Buy\'s canonical identity — but never for Apartment to Rent, whose old catalog is retired by its own new taxonomy', () => {
  const homeRentalPriorities = normalizePriorities({ searchType: 'rental', features: { tiers: { 'Home Office': 'important' } } });
  assert.equal(homeRentalPriorities.features.tiers['Home office'], 'important');
  assert.equal(homeRentalPriorities.features.tiers['Home Office'], undefined);

  const apartmentPriorities = normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent', features: { tiers: { 'Home Office': 'important' } } });
  assert.equal(apartmentPriorities.features.tiers['Home Office'], 'important');
  assert.equal(apartmentPriorities.features.tiers['Home office'], undefined);
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

// Small criteria cleanup: an existing 'Guest / In-Law Suite' priority now folds onto
// the single canonical 'Guest Bedroom' at read time (never a SQL migration), preserving
// the buyer's tier — a merge of stored identity, not a loss of Match credit.
test('an existing Guest / In-Law Suite priority folds onto Guest Bedroom, preserving its tier and still counting toward Match', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'Guest / In-Law Suite': 'important' }, customItems: [{ label: 'Guest / In-Law Suite', kind: 'check' }] } });
  assert.equal(priorities.features.tiers['Guest Bedroom'], 'important');
  assert.equal(priorities.features.tiers['Guest / In-Law Suite'], undefined);
  assert.ok(!priorities.features.customItems.some((item) => item.label === 'Guest / In-Law Suite'));
  const match = computeMatch({ checks: { 'features:Guest / In-Law Suite': true } }, priorities);
  assert.ok(match.allSelected.some((item) => item.key === 'features:Guest Bedroom' && item.evaluated && item.met));
});

test('an explicit current Guest Bedroom selection is never overwritten by a stale legacy Guest / In-Law Suite tier — current intent wins, no duplicate row', () => {
  const priorities = normalizePriorities({
    searchType: 'purchase',
    features: { tiers: { 'Guest / In-Law Suite': 'nice', 'Guest Bedroom': 'must' }, customItems: [{ label: 'Guest / In-Law Suite', kind: 'check' }, { label: 'Guest Bedroom', kind: 'check' }] },
  });
  assert.equal(priorities.features.tiers['Guest Bedroom'], 'must');
  assert.equal(priorities.features.tiers['Guest / In-Law Suite'], undefined);
  assert.equal(priorities.features.customItems.filter((item) => item.label === 'Guest Bedroom').length, 1);
});

test('a legacy "Guest suite" (the original pre-2026 label) also folds onto Guest Bedroom directly', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'Guest suite': 'nice' } } });
  assert.equal(priorities.features.tiers['Guest Bedroom'], 'nice');
  assert.equal(priorities.features.tiers['Guest suite'], undefined);
});

/* ------------------------------ My Search / schools ------------------------------ */

test('the schools yes/no toggle is gone; the historical suppression it wrote is still safely honored', () => {
  const board = read('src/components/PriorityBoard.jsx');
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

test('first-run My Search banner is orientation + payoff — the drag coachmark on the board itself now teaches the interaction', () => {
  const panel = read('src/components/MySearchPanel.jsx');
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(panel, /Here&apos;s what we heard\./);
  assert.match(panel, /Ready to see your Match\?/);
  assert.match(panel, /Bring in the first home you&apos;re considering and we&apos;ll show you how it stacks up against your priorities\./);
  // The banner itself no longer carries the drag-and-drop teaching paragraph.
  assert.doesNotMatch(panel, /Drag your priorities between/);
  assert.match(panel, /firstRun=\{firstRun\}/);
  assert.match(board, /dragCoachmarkOpen && \(/);
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
  const renovation = match.allSelected.find((item) => item.key === 'features:Renovation Potential');
  const condition = match.allSelected.find((item) => item.key === 'homeCondition');
  assert.ok(renovation && condition && renovation !== condition);
});
