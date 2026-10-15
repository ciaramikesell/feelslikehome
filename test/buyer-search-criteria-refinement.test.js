// Buyer search criteria & priority catalog refinement (beta feedback):
// an unmistakable search-type choice, one optional Home preferences section on
// The Basics, its choices ranked with everything else (Important by default),
// the refreshed Home to Buy What Matters catalog, multi-value layout/condition
// facts in Edit Home, and honest Unknown behavior throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUY_CATALOG_RETIRED_OFFERINGS, RETIRED_PURCHASE_BUILT_IN_KEYS, getItemlistCategories, isDiscontinuedOffering, normalizePriorities,
} from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { ONBOARDING_SUGGESTIONS } from '../src/lib/onboarding.js';
import { CURRENT_ONBOARDING_VERSION, onboardingStepsFor } from '../src/lib/onboardingFlow.js';
import { homePreferenceCriterionKeys, homePreferenceRows, homePreferencesSummary, toggleHomePreference } from '../src/lib/homePreferences.js';
import { derivePriorityCheckPatch } from '../src/lib/importReview.js';
import {
  addCriterion, availableCriteriaGroups, basicsFieldsFor, isCriterionSelected, moveCriterion, offeredCriteriaGroups, priorityLevels,
} from '../src/lib/searchProfile.js';
import { switchSearchType, whatMattersSections } from '../src/lib/whatMattersCatalog.js';
import { moveGroup, priorityLevelsWithGroups } from '../src/lib/whatMattersGroups.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const start = (type) => switchSearchType(normalizePriorities({}), type).priorities;
const option = (priorities, rowKey, text) => {
  const found = homePreferenceRows(priorities).find((row) => row.key === rowKey)?.options.find((entry) => entry.text === text);
  assert.ok(found, `${rowKey}: ${text}`);
  return found;
};
const choose = (priorities, ...picks) => picks.reduce((next, [rowKey, text]) => toggleHomePreference(next, option(next, rowKey, text)), priorities);
const ranked = (priorities) => Object.fromEntries(priorityLevelsWithGroups(priorities).map((level) => [level.tier, level.items.map((item) => (item.qualifier ? `${item.displayLabel} (${item.qualifier})` : item.displayLabel))]));
const status = (home, priorities, key) => {
  const entry = computeMatch({ checks: {}, ratings: {}, ...home }, priorities)?.allSelected.find((item) => item.key === key);
  return entry ? (entry.evaluated ? entry.met : 'unknown') : 'absent';
};

/* ------------------------------ search type ------------------------------ */

test('a brand-new search has no kind of search chosen, nothing preset, and Continue explains instead of proceeding', () => {
  const blank = normalizePriorities({});
  assert.equal(blank.onboardingSearchType, undefined);
  assert.deepEqual(blank.preferredPropertyTypes.values, []);
  const basics = read('src/components/onboarding/BasicsStep.jsx');
  // Three visible choices (radios), none checked until chosen.
  assert.match(basics, /NEW_SEARCH_CHOICES\.map\(\(option\) => \{/);
  assert.match(basics, /home_buy: \{ title: 'Home to Buy', note: 'Purchase budget'/);
  assert.match(basics, /home_rent: \{ title: 'Home to Rent', note: 'Monthly rent'/);
  assert.match(basics, /apartment_rent: \{ title: 'Apartment to Rent', note: 'Monthly rent'/);
  assert.match(basics, /const choice = priorities\.onboardingSearchType \|\| '';/);
  assert.doesNotMatch(basics, /<select/);
  // Friendly inline validation, focus moves to the choices, and Continue is never a dead disabled button.
  assert.match(basics, /setInvalid\(true\);\n\s+typeRef\.current\?\.querySelector\('input'\)\?\.focus\(\);/);
  assert.match(basics, /aria-invalid=\{invalid \|\| undefined\}/);
  assert.doesNotMatch(basics, /OnboardingAction disabled=/);
  // Choosing for the first time removes nothing and presets no property type.
  for (const type of ['home_buy', 'home_rent', 'apartment_rent']) {
    const { priorities, removed } = switchSearchType(blank, type);
    assert.deepEqual(removed, [], type);
    assert.deepEqual(priorities.preferredPropertyTypes.values, [], `${type}: nothing assumed`);
    assert.equal(priorities.onboardingSearchType, type);
  }
});

test('a saved kind of search is kept when resuming, and choosing it again changes nothing', () => {
  const saved = choose(start('home_buy'), ['homeType', 'Condominium'], ['garage', 'Attached']);
  const again = switchSearchType(saved, 'home_buy');
  assert.deepEqual(again.removed, []);
  assert.deepEqual(again.priorities, normalizePriorities(saved));
  assert.match(read('src/components/onboarding/BasicsStep.jsx'), /if \(key === choice\) return;/);
});

test('the budget reads as a purchase budget or a monthly rent', () => {
  assert.equal(basicsFieldsFor('home_buy').budgetLabel, 'Maximum budget');
  assert.equal(basicsFieldsFor('home_rent').budgetLabel, 'Maximum monthly rent');
  assert.equal(basicsFieldsFor('apartment_rent').budgetLabel, 'Maximum monthly rent');
});

test('switching kinds of search keeps compatible Home preferences and lists what it removes', () => {
  let buyer = choose(start('home_buy'), ['homeType', 'Single Family'], ['homeType', 'Condominium'], ['layout', 'Ranch'], ['garage', 'Detached'], ['basement', 'Finished'], ['yard', 'Fenced']);
  buyer = { ...buyer, budget: { value: '500000', tier: 'important' }, lotSizeTarget: { value: '0.5', tier: 'dontcare' } };
  const rent = switchSearchType(buyer, 'home_rent');
  // Home to Rent asks home type and garage in Home preferences and still offers a
  // finished basement and fenced yard in What Matters, so only layout is removed.
  assert.deepEqual(rent.removed, ['Ranch']);
  assert.equal(isCriterionSelected(rent.priorities, 'features', 'Finished basement'), true);
  assert.deepEqual(rent.priorities.preferredPropertyTypes.values, ['house', 'condo']);
  assert.equal(isCriterionSelected(rent.priorities, 'exterior', 'Garage'), true);
  assert.equal(rent.priorities.exterior.garagePreference, 'detached');
  assert.equal(rent.priorities.budget.value, '500000');
  const apartment = switchSearchType(rent.priorities, 'apartment_rent');
  assert.deepEqual(apartment.removed, ['Finished Basement', 'Garage', 'Fenced yard', 'House', 'Ideal lot size']);
  assert.deepEqual(homePreferenceRows(apartment.priorities), [], 'apartments have no Home preferences');
  // Undo returns the exact earlier document (BasicsStep keeps it).
  assert.match(read('src/components/onboarding/BasicsStep.jsx'), /return all\.length \? \{ removed: all, previous: earlier\?\.previous \|\| priorities \} : null;/);
});

/* ---------------------------- Home preferences ---------------------------- */

test('Home preferences: one optional section, collapsed by default, with the approved rows per kind of search', () => {
  assert.deepEqual(homePreferenceRows(start('home_buy')).map((row) => [row.label, row.options.map((entry) => entry.text)]), [
    ['Home type', ['Single Family', 'Condominium', 'Multi-Family']],
    ['Layout', ['Ranch', 'Two-Story', 'Split Level', 'First-Floor Primary']],
    ['Condition', ['New Construction', 'Move-in Ready', 'Renovation Potential']],
    ['Garage', ['Any Garage', 'Attached', 'Detached']],
    ['Basement', ['Finished', 'Walkout']],
    ['Yard', ['Fenced', 'Privacy Fence', 'Unfenced']],
  ]);
  assert.deepEqual(homePreferenceRows(start('home_rent')).map((row) => row.key), ['homeType', 'garage']);
  // Nothing chosen is genuinely unset: no level, no Match entry.
  const blank = start('home_buy');
  assert.equal(homePreferencesSummary(blank).count, 0);
  assert.deepEqual(ranked(blank), { must: [], important: [], nice: [] });
  assert.equal(computeMatch({ checks: {}, ratings: {}, propertyType: 'condo', homeLayout: ['Ranch / Single Story'], garageSpaces: '0' }, blank), null);
  const basics = read('src/components/onboarding/BasicsStep.jsx');
  assert.match(basics, /function HomePreferences\(\{ priorities, patch \}\) \{\n\s+const id = useId\(\);\n\s+const \[open, setOpen\] = useState\(false\);/);
  assert.match(basics, /aria-expanded=\{open\}/);
  assert.match(basics, /hidden=\{!open\}/);
  // One section replaces the Garage preferences and More about the home accordions.
  assert.doesNotMatch(basics, /Garage preferences|More about the home|How much does a garage matter/);
});

test('the collapsed summary and count say exactly what is chosen', () => {
  const chosen = choose(start('home_buy'), ['layout', 'Ranch'], ['layout', 'Two-Story'], ['layout', 'First-Floor Primary'], ['garage', 'Attached'], ['basement', 'Finished'], ['basement', 'Walkout'], ['yard', 'Fenced'], ['yard', 'Privacy Fence']);
  assert.deepEqual(homePreferencesSummary(chosen), {
    count: 8,
    parts: ['Ranch or Two-Story + First-Floor Primary', 'Attached garage', 'Finished + Walkout basement', 'Fenced Yard + Privacy Fence'],
    text: 'Ranch or Two-Story + First-Floor Primary · Attached garage · Finished + Walkout basement · Fenced Yard + Privacy Fence',
  });
});

test('Garage is one choice — Any, Attached or Detached — and clearing it leaves nothing behind', () => {
  let priorities = choose(start('home_buy'), ['garage', 'Attached']);
  assert.deepEqual(ranked(priorities).important, ['Garage (Attached)']);
  priorities = choose(priorities, ['garage', 'Detached']);
  assert.equal(priorities.exterior.garagePreference, 'detached');
  assert.equal(priorityLevels(priorities).flatMap((level) => level.items).filter((item) => item.label === 'Garage').length, 1, 'never two Garage priorities');
  // Tapping the chosen option clears it: no criterion and no lingering qualifier.
  priorities = choose(priorities, ['garage', 'Detached']);
  assert.equal(isCriterionSelected(priorities, 'exterior', 'Garage'), false);
  assert.equal(priorities.exterior.garagePreference, 'any');
  assert.equal(homePreferencesSummary(priorities).count, 0);
  // Garage size and "No garage" need Match support first (deferred): never stored or shown.
  assert.doesNotMatch(JSON.stringify(homePreferenceRows(start('home_buy'))), /car|No Garage/i);
  // Match checks whether there is a garage; the qualifier never changes that (said in the UI).
  const attached = choose(start('home_buy'), ['garage', 'Attached']);
  assert.equal(status({ garageSpaces: '2' }, attached, 'exterior:Garage'), true);
  assert.equal(status({ garageSpaces: '0' }, attached, 'exterior:Garage'), false);
  assert.equal(status({}, attached, 'exterior:Garage'), 'unknown');
  assert.match(read('src/components/onboarding/BasicsStep.jsx'), /Match checks whether a home has a garage; attached or detached is saved with your preference\./);
});

test('a basement can be Finished and Walkout, and a yard Fenced with a Privacy Fence; Unfenced replaces both', () => {
  let priorities = choose(start('home_buy'), ['basement', 'Finished'], ['basement', 'Walkout'], ['yard', 'Fenced'], ['yard', 'Privacy Fence']);
  assert.deepEqual(ranked(priorities).important, ['Finished Basement', 'Walkout Basement', 'Fenced Yard', 'Privacy Fence']);
  // Each is its own fact: both must hold, and each is judged on its own.
  const home = { checks: { 'features:Finished basement': true, 'features:Walkout basement': 'no' } };
  assert.equal(status(home, priorities, 'features:Finished basement'), true);
  assert.equal(status(home, priorities, 'features:Walkout basement'), false);
  assert.equal(status(home, priorities, 'exterior:Fenced yard'), 'unknown');
  priorities = choose(priorities, ['yard', 'Unfenced']);
  assert.deepEqual(homePreferenceRows(priorities).find((row) => row.key === 'yard').options.filter((entry) => entry.selected).map((entry) => entry.text), ['Unfenced']);
  priorities = choose(priorities, ['yard', 'Privacy Fence']);
  assert.deepEqual(homePreferenceRows(priorities).find((row) => row.key === 'yard').options.filter((entry) => entry.selected).map((entry) => entry.text), ['Privacy Fence']);
});

test('alternatives stay one item: Move-in Ready or Renovation Potential, any of several layouts, any home type', () => {
  let priorities = choose(start('home_buy'), ['condition', 'Move-in Ready'], ['condition', 'Renovation Potential'], ['layout', 'Two-Story'], ['layout', 'First-Floor Primary'], ['homeType', 'Multi-Family']);
  assert.deepEqual(ranked(priorities).important, ['First-Floor Primary', 'Home type (Multi-Family)', 'Layout (Two-Story)', 'Condition (Move-in Ready or Renovation Potential)']);
  priorities = moveGroup(priorities, 'homeCondition', 'must');
  // A home that is both counts once; either one meets it; unknown is never a miss.
  assert.equal(status({ homeCondition: ['Move-In Ready', 'Renovation Potential'] }, priorities, 'homeCondition'), true);
  assert.equal(status({ homeCondition: ['Renovation Potential'] }, priorities, 'homeCondition'), true);
  assert.equal(status({ homeCondition: ['New Construction'] }, priorities, 'homeCondition'), false);
  assert.equal(status({}, priorities, 'homeCondition'), 'unknown');
  // First-Floor Primary combines with Two-Story (its own fact, not an alternative layout).
  assert.equal(status({ homeLayout: ['Two Story'], checks: { 'features:First-Floor Primary': true } }, priorities, 'homeLayout'), true);
  assert.equal(status({ homeLayout: ['Two Story'], checks: { 'features:First-Floor Primary': true } }, priorities, 'features:First-Floor Primary'), true);
});

/* ---------------------------- ranking & My Search ---------------------------- */

test('every Home preference starts Important (never Must-Have) and is re-rankable on Rank Priorities and in My Search', () => {
  let priorities = choose(start('home_buy'), ['homeType', 'Single Family'], ['garage', 'Any Garage'], ['basement', 'Walkout']);
  const items = priorityLevelsWithGroups(priorities).flatMap((level) => level.items);
  assert.ok(items.every((item) => item.tier === 'important'));
  priorities = moveCriterion(priorities, 'exterior', 'Garage', 'must');
  priorities = moveGroup(priorities, 'preferredPropertyTypes', 'nice');
  assert.deepEqual(ranked(priorities), { must: ['Garage'], important: ['Walkout Basement'], nice: ['Home type (Single Family)'] });
  // Re-choosing a ranked option keeps its level (it's already chosen).
  assert.equal(choose(priorities, ['basement', 'Finished']).exterior.tiers.Garage, 'must');
  // The live Rank step, My Search's Rank Priorities and the overview all show grouped Basics.
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /const levels = priorityLevelsWithGroups\(priorities\);/);
  assert.match(read('src/components/RankPrioritiesEditor.jsx'), /const levels = priorityLevelsWithGroups\(draft\);/);
  assert.match(read('src/components/MySearchPanel.jsx'), /const levels = priorityLevelsWithGroups\(priorities\);/);
});

test('Home preferences are asked once: never repeated in What Matters, but addable later in My Search', () => {
  const buyer = start('home_buy');
  const whatMatters = [...ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, entries]) => entries), ...whatMattersSections(buyer).flatMap((section) => section.chips)]
    .map((entry) => `${entry.categoryKey}:${entry.label}`);
  for (const key of homePreferenceCriterionKeys(buyer)) assert.ok(!whatMatters.includes(key), key);
  const group = offeredCriteriaGroups(buyer).find((entry) => entry.title === 'Home Preferences');
  assert.deepEqual(group.items.map((item) => item.displayLabel), ['Garage', 'First-Floor Primary', 'Finished Basement', 'Walkout Basement', 'Fenced Yard', 'Privacy Fence', 'Unfenced Yard']);
  // My Search never offers a contradictory yard choice beside a chosen one.
  const fenced = choose(buyer, ['yard', 'Fenced']);
  const available = availableCriteriaGroups(fenced).flatMap((entry) => entry.items.map((item) => item.label));
  assert.ok(!available.includes('Unfenced Yard') && available.includes('Privacy Fencing'));
  // What Matters lists them under neither the chips nor "Your own".
  for (const file of ['src/components/onboarding/Onboarding.jsx', 'src/components/onboarding/WhatMattersStepV2.jsx']) {
    assert.match(read(file), /!fromBasics\.has\(item\.key\)/, file);
  }
});

/* ------------------------------ catalog safety ------------------------------ */

test('removed Home to Buy choices stay on existing boards and keep counting; they are not offered again', () => {
  const existing = normalizePriorities({
    searchType: 'purchase', onboardingSearchType: 'home_buy',
    location: { tiers: { 'Quiet street': 'must', 'Reputable Schools': 'important' }, customItems: [{ label: 'Quiet street', kind: 'check' }, { label: 'Reputable Schools', kind: 'check' }] },
    features: { tiers: { 'Guest Bedroom': 'nice' }, customItems: [{ label: 'Guest Bedroom', kind: 'check' }] },
    exterior: { tiers: { 'Large backyard': 'nice' }, customItems: [{ label: 'Large backyard', kind: 'check' }] },
  });
  assert.deepEqual(ranked(existing), { must: ['Quiet Street'], important: ['Reputable Schools'], nice: ['Guest Bedroom', 'Large Backyard'] });
  assert.equal(status({ checks: { 'location:Quiet street': 'no' } }, existing, 'location:Quiet street'), false);
  const offered = offeredCriteriaGroups(existing).flatMap((group) => group.items.map((item) => `${item.categoryKey}:${item.label}`));
  for (const key of BUY_CATALOG_RETIRED_OFFERINGS) {
    assert.ok(!offered.includes(key), key);
    const [categoryKey, label] = key.split(':');
    assert.equal(isDiscontinuedOffering(categoryKey, { label }, 'purchase'), true, key);
    assert.equal(isDiscontinuedOffering(categoryKey, { label }, 'rental'), false, `${key} is still offered to renters`);
  }
  // Switching away and back keeps them (they still count for a buyer).
  const back = switchSearchType(switchSearchType(existing, 'home_rent').priorities, 'home_buy');
  assert.deepEqual(ranked(back.priorities), ranked(existing));
});

test('the refreshed catalog adds no scoring path: new choices are Yes / No / Unknown checks, Unknown is never a miss', () => {
  const buyer = start('home_buy');
  let all = buyer;
  for (const entry of ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, entries]) => entries)) all = addCriterion(all, entry);
  const match = computeMatch({ checks: {}, ratings: {} }, all);
  assert.equal(match.allSelected.length, 33);
  assert.equal(match.evaluatedCount, 0);
  assert.equal(match.missing.length, 0);
  assert.equal(match.pct, null);
  // A buyer's own No is the only thing that makes a miss.
  assert.equal(status({ checks: { 'features:Kitchen Island': 'no' } }, all, 'features:Kitchen Island'), false);
  assert.equal(status({ checks: { 'features:Kitchen Island': true } }, all, 'features:Kitchen Island'), true);
  // Listing text never fills in the new choices (no parsing was added), so they stay Unknown.
  assert.deepEqual(derivePriorityCheckPatch('Cul-de-sac lot with kitchen island, soaking tub and fire pit.', all, {}), {});
  // Still-supported import rules keep working for Home preferences.
  const prefs = choose(buyer, ['basement', 'Finished'], ['yard', 'Fenced']);
  assert.deepEqual(derivePriorityCheckPatch('Finished basement. Fully fenced backyard.', prefs, {}), { 'features:Finished basement': true, 'exterior:Fenced yard': true });
  // Mudroom is retired in both scorers (JS and SQL); it is not offered until the parity migration lands.
  assert.ok(RETIRED_PURCHASE_BUILT_IN_KEYS.includes('features:Mudroom'));
  assert.ok(!getItemlistCategories('purchase').some((def) => def.suggestedItems.some((item) => item.label === 'Mudroom')));
});

test('renters keep their own catalogs and never inherit buyer-only choices', () => {
  for (const type of ['home_rent', 'apartment_rent']) {
    const offered = offeredCriteriaGroups(start(type)).flatMap((group) => group.items.map((item) => item.label));
    assert.equal(offered.slice(0, 6).join(','), 'Pets Allowed,In-Unit Laundry,Utilities Included,Parking,Central Air,Dishwasher', `${type}: Rental essentials first`);
    for (const buyerOnly of ['Cul-de-Sac', 'Kitchen Island', 'No HOA', 'Workshop Space', 'Unfenced Yard']) assert.ok(!offered.includes(buyerOnly), `${type}: ${buyerOnly}`);
  }
});

/* ------------------------------ Edit Home facts ------------------------------ */

test('Edit Home records layout and condition as multi-value shared facts; Unknown is empty, never No', () => {
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /<StructuredFactChips key=\{definition\.key\}/);
  // Gated by the existing shared-fact eligibility (both participants' priorities), unchanged.
  assert.match(modal, /MULTISELECT_CATEGORIES\.filter\(\(definition\) => sharedFactAwareness\[definition\.key\]\?\.eligibleForSharedFactCapture\)/);
  const collaboration = read('src/lib/supabase/collaboration.js');
  assert.match(collaboration, /home_layout: home\.homeLayout \|\| \[\]/);
  assert.match(collaboration, /home_condition: Array\.isArray\(home\.homeCondition\)/);
  // Garage spaces: empty is Unknown, 0 is a known "no garage".
  assert.match(modal, /label="Garage spaces"[^\n]*placeholder="Unknown · 0 = none"/);
  const garage = choose(start('home_buy'), ['garage', 'Any Garage']);
  assert.equal(status({ garageSpaces: '' }, garage, 'exterior:Garage'), 'unknown');
  assert.equal(status({ garageSpaces: '0' }, garage, 'exterior:Garage'), false);
  // Personal Yes / No / Unknown answers stay per participant (home_member_state via checks).
  assert.match(modal, /\[\['yes', 'Yes', true\], \['no', 'No', 'no'\], \['unknown', 'Unknown', undefined\]\]/);
});

/* ------------------------------- flow safety ------------------------------- */

test('the live three-step flow stays live and the six-step flow stays inactive', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  assert.deepEqual(onboardingStepsFor(3, {}), ['basics', 'locations', 'collaboration', 'priorities', 'rank', 'review']);
  // Each participant's choices are saved to their own preferences row.
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /savePriorities\(createClient\(\), \{ id: searchId \}, userId, next\)/);
});
