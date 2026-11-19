// Milestone 2 (docs/onboarding-paths-explore-priorities.md): two first-time
// setup paths and a revisitable Explore My Priorities, behind FLH_ONBOARDING_V3.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const read = (p) => fs.readFileSync(p, 'utf8');
const {
  CURRENT_ONBOARDING_VERSION, SETUP_PATHS, advanceOnboarding, beginOnboarding, completeOnboardingState, isQuickStartState,
  normalizeOnboardingState, onboardingStepsFor, resumeOnboardingStep, setOnboardingSetupPath, skipOnboardingStep,
} = await import('../src/lib/onboardingFlow.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { prioritiesForExplicitSave } = await import('../src/lib/searchIntent.js');
const { addOwnFeature, featureLevel, setFeatureLevel, setGarageImportance, switchPrioritySearchType, priorityCategoriesFor } = await import('../src/lib/priorityCategories.js');
const { switchSearchType } = await import('../src/lib/whatMattersCatalog.js');
const { EXPLORE_KEY, exploreEntryStep, exploreIndex, exploreProgress, exploreSteps, neighborExploreStep, recordExploreVisit } = await import('../src/lib/explorePriorities.js');
const { onboardingV3Enabled } = await import('../src/lib/featureFlags.js');

const T0 = '2026-11-20T12:00:00.000Z';
const OWN = { searchId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
const TYPES = ['home_buy', 'home_rent', 'apartment_rent'];
const ITEM_CATEGORIES = ['location', 'features', 'exterior', 'homeFeel'];
const fresh = (type) => prioritiesForExplicitSave(switchPrioritySearchType(normalizePriorities({}), type).priorities);
const dontcares = (p) => ITEM_CATEGORIES.flatMap((key) => Object.entries(p[key]?.tiers || {}).filter(([, tier]) => tier === 'dontcare').map(([label]) => `${key}:${label}`));

/* ------------------------------ Part A: two paths ------------------------------ */

test('flow 4 asks the setup path right after the kind of search; personalize keeps every category and Review', () => {
  assert.deepEqual([...SETUP_PATHS], ['personalize', 'as_i_go']);
  for (const type of TYPES) {
    const unanswered = onboardingStepsFor(4, { answers: { searchType: type } });
    const personalize = onboardingStepsFor(4, { answers: { searchType: type, setupPath: 'personalize' } });
    assert.deepEqual(personalize, unanswered, `${type}: unanswered behaves as personalize`);
    assert.deepEqual(personalize.slice(0, 3), ['search_type', 'setup_path', 'basics'], type);
    assert.equal(personalize.at(-1), 'review');
    assert.ok(personalize.some((step) => step.startsWith('cat_')), type);
  }
});

test('quick start keeps only what is needed: kind of search → setup path → optional Basics → finish', () => {
  for (const type of TYPES) {
    const state = { answers: { searchType: type, setupPath: 'as_i_go' } };
    assert.deepEqual(onboardingStepsFor(4, state), ['search_type', 'setup_path', 'basics'], type);
    assert.equal(isQuickStartState(state), true);
    // Continue and Skip on Basics both end the flow.
    assert.equal(advanceOnboarding(4, { ...state, step: 'basics' }, 'basics', T0).done, true);
    assert.equal(skipOnboardingStep(4, { ...state, step: 'basics' }, 'basics', T0).done, true);
  }
  assert.equal(isQuickStartState({ answers: { setupPath: 'personalize' } }), false);
  assert.equal(isQuickStartState({}), false);
});

test('the setup path is an onboarding-only answer: validated, never a priority', () => {
  const state = normalizeOnboardingState({ answers: { setupPath: 'sideways', searchType: 'home_buy' } });
  assert.equal(state.answers.setupPath, undefined);
  assert.equal(setOnboardingSetupPath(state, 'as_i_go', T0).answers.setupPath, 'as_i_go');
  assert.equal(setOnboardingSetupPath(state, 'bogus', T0).answers.setupPath, undefined);
  const quick = setOnboardingSetupPath(state, 'as_i_go', T0);
  assert.equal(setOnboardingSetupPath(quick, 'as_i_go', '2027-01-01T00:00:00.000Z').updatedAt, T0, 'choosing the same path again records no change');
  assert.equal(normalizeOnboardingState(quick).answers.setupPath, 'as_i_go', 'round-trips through normalisation');
});

test('switching paths changes only which screens follow; completion covers exactly the screens seen', () => {
  const quick = { answers: { searchType: 'home_buy', setupPath: 'as_i_go' }, completed: ['search_type', 'setup_path'], step: 'basics' };
  const finished = completeOnboardingState(4, quick, T0);
  assert.deepEqual(finished.completed, ['search_type', 'setup_path', 'basics']);
  // Changing their mind later (Back to the choice) brings the categories back with nothing lost.
  const personal = setOnboardingSetupPath(quick, 'personalize', T0);
  assert.equal(advanceOnboarding(4, personal, 'basics', T0).state.step, 'cat_layout');
});

test('existing sessions: anyone already past the new choice carries on (never sent back); a fresh start sees it', () => {
  const midway = { step: 'cat_kitchen', completed: ['search_type', 'basics', 'cat_layout'], answers: { searchType: 'home_buy' }, startedAt: T0, context: OWN };
  assert.equal(resumeOnboardingStep(4, midway), 'cat_kitchen');
  const stale = { ...midway, step: 'locations' };
  assert.equal(resumeOnboardingStep(4, stale), 'cat_kitchen', 'first unfinished, skipping the choice they implicitly made');
  assert.equal(beginOnboarding({ storedVersion: 4, storedState: stale, context: OWN, targetVersion: 4, now: T0 }).state.step, 'cat_kitchen');
  assert.equal(resumeOnboardingStep(4, { ...midway, step: null, completed: ['search_type'] }), 'setup_path');
  assert.equal(beginOnboarding({ context: OWN, targetVersion: 4, now: T0 }).state.step, 'search_type');
  // Live flow and the default version are untouched.
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
});

test('quick start writes no answers nobody gave: no dontcare, no features, no Match % for any kind of search', () => {
  for (const type of TYPES) {
    const p = fresh(type);
    assert.deepEqual(dontcares(p), [], `${type}: no Not important written`);
    for (const key of ITEM_CATEGORIES) assert.deepEqual(p[key].customItems, [], `${type} ${key}`);
    assert.deepEqual(p.preferredPropertyTypes.values, [], 'no home type assumed');
    for (const home of [{}, { price: '350000', beds: '3', garageSpaces: '2' }]) assert.equal(computeMatch(home, p), null, `${type}: nothing to match against yet`);
  }
});

test('the search-type switch still clears a real earlier answer that no longer applies (absent stays absent)', () => {
  let p = fresh('home_buy');
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Finished basement', custom: false }, 'must');
  const apt = switchSearchType(p, 'apartment_rent').priorities;
  assert.equal(apt.features.tiers['Finished basement'], 'dontcare', 'a chosen basement is cleared for an apartment');
  assert.equal(Object.hasOwn(apt.exterior.tiers, 'Fenced yard'), false, 'never answered: still absent');
  // Garage "Not important" is a real answer and survives the round trip untouched by the fix.
  const garage = setGarageImportance(fresh('home_buy'), 'not_important');
  assert.equal(garage.exterior.tiers.Garage, 'dontcare');
});

/* -------------------------- Part B: Explore My Priorities -------------------------- */

test('Explore offers the same category pages as onboarding, for the search’s own kind', () => {
  assert.deepEqual(exploreSteps(fresh('home_buy')), ['cat_layout', 'cat_kitchen', 'cat_living', 'cat_bath', 'cat_garage', 'cat_exterior', 'cat_neighborhood']);
  assert.deepEqual(exploreSteps(fresh('home_rent')), ['cat_essentials', 'cat_rent_layout', 'cat_rent_features', 'cat_exterior', 'cat_neighborhood']);
  assert.deepEqual(exploreSteps(fresh('apartment_rent')), ['cat_essentials', 'cat_apt_unit', 'cat_apt_property']);
  // A document from the live flow (no onboardingSearchType) still gets its categories.
  assert.ok(exploreSteps(normalizePriorities({ searchType: 'purchase' })).includes('cat_kitchen'));
  for (const type of TYPES) {
    const onboarding = onboardingStepsFor(4, { answers: { searchType: type } }).filter((step) => step.startsWith('cat_'));
    assert.deepEqual(exploreSteps(fresh(type)), onboarding, type);
  }
});

test('the index shows what is already chosen, per category', () => {
  let p = fresh('home_buy');
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'must');
  const own = addOwnFeature(p, 'kitchen', 'Pot filler');
  p = setFeatureLevel(own.priorities, own.feature, 'nice');
  const index = exploreIndex(p);
  assert.equal(index.find((entry) => entry.key === 'kitchen').chosenCount, 2);
  assert.equal(index.find((entry) => entry.key === 'bath').chosenCount, 0);
  assert.ok(index.every((entry) => entry.title && entry.step));
});

test('visits are remembered in a namespaced key; navigation without anything new writes nothing', () => {
  const p = fresh('home_buy');
  const kitchen = recordExploreVisit(p, 'cat_kitchen', T0);
  assert.deepEqual(kitchen[EXPLORE_KEY], { lastStep: 'cat_kitchen', visited: ['cat_kitchen'], updatedAt: T0 });
  assert.equal(recordExploreVisit(kitchen, 'cat_kitchen', T0), kitchen, 'same place again: the same object, so no save');
  const bath = recordExploreVisit(kitchen, 'cat_bath', T0);
  assert.deepEqual(exploreProgress(bath), { lastStep: 'cat_bath', visited: ['cat_kitchen', 'cat_bath'], updatedAt: T0 });
  assert.equal(recordExploreVisit(p, 'cat_apt_unit', T0), p, 'a page this search does not show is ignored');
  // Nothing else in the document changes.
  const { [EXPLORE_KEY]: _, ...rest } = bath;
  assert.deepEqual(rest, normalizePriorities(p));
});

test('stored progress is trusted only as far as it names a real page; switching the kind of search keeps it harmless', () => {
  const junk = { ...fresh('home_buy'), [EXPLORE_KEY]: { lastStep: 'cat_attic', visited: ['cat_bath', 'nope', 7], updatedAt: 'yesterday' } };
  assert.deepEqual(exploreProgress(junk), { lastStep: null, visited: ['cat_bath'], updatedAt: null });
  const rent = switchPrioritySearchType(recordExploreVisit(fresh('home_buy'), 'cat_kitchen', T0), 'home_rent').priorities;
  assert.equal(exploreProgress(rent).lastStep, null, 'Kitchen is not a rental page: start from the index');
  assert.equal(exploreProgress(normalizePriorities({ [EXPLORE_KEY]: 'nonsense' })).lastStep, null);
});

test('deep entry: ?category= accepts a step or a key; anything else opens the index', () => {
  const p = fresh('home_buy');
  assert.equal(exploreEntryStep(p, 'cat_kitchen'), 'cat_kitchen');
  assert.equal(exploreEntryStep(p, 'kitchen'), 'cat_kitchen');
  assert.equal(exploreEntryStep(p, 'cat_apt_unit'), null);
  assert.equal(exploreEntryStep(p, undefined), null);
  assert.equal(neighborExploreStep(p, 'cat_kitchen', 1), 'cat_living');
  assert.equal(neighborExploreStep(p, 'cat_layout', -1), null);
  assert.equal(neighborExploreStep(p, 'cat_neighborhood', 1), null);
});

test('the explore key never changes Match, and every reader keeps it', () => {
  let p = fresh('home_buy');
  p.budget = { ...p.budget, value: '400000' };
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'must');
  p = setGarageImportance(p, 'important');
  const withExplore = recordExploreVisit(recordExploreVisit(p, 'cat_kitchen', T0), 'cat_garage', T0);
  for (const home of [{}, { price: '380000', garageSpaces: '2', checks: { 'features:Kitchen Island': true } }, { price: '520000', garageSpaces: '0' }]) {
    assert.deepEqual(computeMatch(home, withExplore), computeMatch(home, p));
  }
  assert.deepEqual(normalizePriorities(withExplore)[EXPLORE_KEY], withExplore[EXPLORE_KEY]);
  assert.deepEqual(prioritiesForExplicitSave(withExplore)[EXPLORE_KEY], withExplore[EXPLORE_KEY]);
  assert.equal(read('src/lib/matching.js').includes('explore'), false, 'the JS scorer never reads it');
});

test('UNKNOWN ≠ NO and UNANSWERED ≠ NOT IMPORTANT: a skipped category leaves its features absent', () => {
  const p = recordExploreVisit(fresh('home_buy'), 'cat_bath', T0);
  for (const category of priorityCategoriesFor(p)) {
    for (const feature of category.features) assert.equal(featureLevel(p, feature), null, feature.id);
  }
  assert.deepEqual(dontcares(p), []);
});

/* --------------------------- wiring and release safety --------------------------- */

test('Explore is behind FLH_ONBOARDING_V3 (off by default): not found and no My Search entry when off', () => {
  assert.equal(onboardingV3Enabled({}), false);
  const page = read('src/app/(app)/search/explore/page.js');
  assert.match(page, /if \(!onboardingV3Enabled\(\)\) notFound\(\);/);
  assert.match(page, /resolveActiveSearch\(supabase, user\.id\)/);
  assert.match(page, /resolvePriorities\(supabase, search, user\.id\)/);
  assert.match(read('src/app/(app)/search/page.js'), /exploreEnabled=\{onboardingV3Enabled\(\)\}/);
  const panel = read('src/components/MySearchPanel.jsx');
  assert.match(panel, /\{exploreEnabled && <ExploreMyPriorities priorities=\{priorities\} \/>\}/);
  assert.match(panel, /Walk through the things that make a home feel right\. Change your mind anytime\./);
  assert.match(panel, /<WhatMattersMost levels=\{levels\} \/>/, 'Quick Edit (Rank Priorities) is unchanged');
});

test('Explore writes only the participant’s own priorities through the My Search save path — never onboarding state', () => {
  const explore = read('src/components/explore/ExplorePriorities.jsx');
  assert.match(explore, /savePriorities\(createClient\(\), search, userId, next\)/);
  assert.match(explore, /useReliableOptimisticState\(normalizePriorities\(initialPriorities\), persist\)/);
  assert.doesNotMatch(explore, /saveOnboardingProgress|completeOnboarding|onboarding_state|onboarding_complete|onboarding_version|from\('profiles'\)|setActiveSearch/);
  assert.doesNotMatch(read('src/lib/explorePriorities.js').replace(/^\s*\/\/.*$/gm, ''), /onboarding_|profiles|supabase/);
  // Same category screens as onboarding.
  assert.match(explore, /<CategoryScreen/);
  assert.match(read('src/components/onboarding/priority/PriorityFlow.jsx'), /<CategoryScreen\n\s+key=\{category\.key\}\n\s+category=\{category\}/);
  // Back, Skip and Done; Skip changes nothing.
  assert.match(explore, /onSkip=\{goNext\}/);
  assert.match(explore, /onBack=\{goBack\}/);
  assert.match(explore, />\{leaving \? 'Saving…' : 'Done'\}</);
});

test('quick start finishes onboarding through the existing services and opens Add Home (deep links first)', () => {
  const flow = read('src/components/onboarding/Onboarding.jsx');
  assert.match(flow, /if \(done && isQuickStartState\(next\)\) \{/);
  assert.match(flow, /await \(sharedSetup \? finish\(\) : finishToDestination\('\/homes\?add=1'\)\);/);
  assert.match(flow, /leave\(pendingRedirect \|\| destination\);/, 'a pending deep link wins over Add Home');
  assert.match(flow, /const chooseSetupPath = \(path\) => moveOn\('setup_path', \{ path \}\);/);
  const ui = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(ui, /Let’s personalize your search/);
  assert.match(ui, /Walk through the features that matter to you, one room at a time\./);
  assert.match(ui, /I’ll figure it out as I go/);
  assert.match(ui, /Start saving homes now\. You can tell us what matters later\./);
  assert.match(ui, /label: sharedFor \? 'Save and see the homes' : 'Start saving homes'/);
});

test('Match empty states point to Explore only when the flag is on; flag off is byte-for-byte the old copy', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /<p className="hh-match-empty">Set your priorities in <em>My Search<\/em> to see a match score\.<\/p>/);
  assert.match(board, /guidedPriorities\n[\s\S]*?\? <p className="hh-match-empty">No Match yet—it starts once you tell FLH what matters\. <Link href="\/search\/explore">Explore My Priorities<\/Link><\/p>/);
  const overlay = read('src/components/HomeOverlay.jsx');
  assert.match(overlay, /No priorities are set for this search yet\. <a href="\/search">Set them in My Search<\/a>\./);
  assert.match(overlay, /<a href="\/search\/explore">Explore My Priorities<\/a>/);
  assert.match(read('src/app/(app)/layout.js'), /const features = \{ guidedPriorities: onboardingV3Enabled\(\) \};/);
  assert.match(read('src/components/FeatureFlags.jsx'), /createContext\(Object\.freeze\(\{\}\)\)/, 'outside the provider every flag is off');
});
