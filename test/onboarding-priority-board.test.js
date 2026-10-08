import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIER_META, normalizePriorities } from '../src/lib/constants.js';
import { normalizeSearchIntent } from '../src/lib/searchIntent.js';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applyOnboardingSelections, applySearchChoice, flatOnboardingSuggestions, onboardingOverview, onboardingPriorityCounts } from '../src/lib/onboarding.js';
import { selectPriorityItem } from '../src/lib/matching.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const displayed = (choice) => ONBOARDING_SUGGESTIONS[choice].flatMap(([, items]) => items.map((entry) => entry.displayLabel));

test('new users see exactly the three product choices while historical Investment stays compatible', () => {
  assert.deepEqual(NEW_SEARCH_CHOICES.map(({ label }) => label), ['Home to buy', 'Home to rent', 'Apartment to rent']);
  assert.ok(!NEW_SEARCH_CHOICES.some(({ intent }) => intent === 'investment'));
  assert.equal(normalizeSearchIntent('investment'), 'investment');
  assert.equal(normalizePriorities({ searchType: 'investment' }).searchType, 'investment');
});

test('new choices map to canonical intents and existing property-type preferences without a schema', () => {
  const buy = applySearchChoice({}, 'home_buy');
  const homeRent = applySearchChoice({}, 'home_rent');
  const apartment = applySearchChoice({}, 'apartment_rent');
  assert.deepEqual([buy.searchType, homeRent.searchType, apartment.searchType], ['purchase', 'rental', 'rental']);
  assert.deepEqual([buy.preferredPropertyTypes.values, homeRent.preferredPropertyTypes.values, apartment.preferredPropertyTypes.values], [['house'], ['house'], ['apartment']]);
});

test('Home to Buy curated suggestions are exactly the canonical purchase taxonomy — one shared catalog with My Search, no Home Feel group', () => {
  assert.deepEqual(displayed('home_buy'), [
    'Reputable Schools', 'Walkable to Town', 'Parks Nearby', 'Quiet Street', 'Bustling Street', 'Near Waterfront', 'Walkable Schools', 'No HOA',
    'Finished Basement', 'Walkout Basement', 'First-Floor Primary', 'Guest Bedroom', 'Primary Ensuite', 'First-Floor Laundry', 'Home Office', 'Central Air', 'Fireplace',
    'Deck / Patio', 'Fenced Yard', 'Privacy Fencing', 'Garage', 'Large Backyard', 'Front Porch', 'Pool', 'Landscaping',
  ]);
  assert.deepEqual(ONBOARDING_SUGGESTIONS.home_buy.map(([title]) => title), ['Location', 'Home Features', 'Exterior & Property']);
  for (const retired of ['Neighborhood', 'Walkability', 'Immediate Street / Surroundings', 'Basement', 'Yard', 'Overall Condition', 'Layout / Flow', 'Natural Light', 'Character / Charm']) {
    assert.ok(!displayed('home_buy').includes(retired));
  }
  // Not weighted criteria in the approved model: Home Condition lives in Basics,
  // Guest Bedroom replaces Guest / In-Law Suite, Garage has an Attached/Detached qualifier.
  for (const absent of ['Charming Neighborhood', 'Guest / In-Law Suite', 'Move-in Ready', 'Renovation Potential', 'New Construction', 'Attached Garage', 'Detached Garage']) {
    assert.ok(!displayed('home_buy').includes(absent), `${absent} must not be offered`);
  }
});

test('Home to Rent curated suggestions are exactly the canonical Home criteria without No HOA', () => {
  assert.deepEqual(displayed('home_rent'), displayed('home_buy').filter((label) => label !== 'No HOA'));
  assert.ok(!displayed('home_rent').includes('No HOA'));
});

test('Apartment to Rent curated suggestions are exact', () => {
  assert.deepEqual(displayed('apartment_rent'), ['In-Unit Laundry','Central Air','Dishwasher','Updated Interior','Balcony / Patio','Home Office Space','Parking','Fitness Center','Pool','Secure Entry','Outdoor Space','Elevator','Pet-Friendly','Quiet Community','Social Community','On-Site Management','Privacy','Surrounding Neighborhood']);
});

test('selected priorities become Important, dealbreakers become Must Have, and Nice is not assigned', () => {
  let priorities = applySearchChoice({}, 'home_buy');
  const keys = new Set(['features:Fireplace', 'exterior:Pool']);
  priorities = applyOnboardingSelections(priorities, keys, new Set(['features:Fireplace']));
  assert.equal(priorities.features.tiers.Fireplace, 'must');
  assert.equal(priorities.exterior.tiers.Pool, 'important');
  assert.ok(!flatOnboardingSuggestions('home_buy').some(({ categoryKey, label }) => priorities[categoryKey].tiers[label] === 'nice'));
});

test('zero dealbreakers and zero Nice to Haves remain truthful', () => {
  let priorities = applySearchChoice({}, 'home_buy');
  priorities = applyOnboardingSelections(priorities, new Set(['features:Fireplace']), new Set());
  assert.deepEqual(onboardingPriorityCounts(priorities), { must: 0, important: 1, nice: 0 });
});

test('Step 4 overview only includes values the participant entered', () => {
  const priorities = applySearchChoice({ budget: { value: '450,000', tier: 'important' }, bedsMin: { value: '', tier: 'important' } }, 'home_buy');
  assert.deepEqual(onboardingOverview(priorities), ['Home to buy', '$450,000 max']);
});

test('custom priorities use the same canonical JSON structure and default to Important', () => {
  const priorities = normalizePriorities({ searchType: 'purchase' });
  const selected = selectPriorityItem(priorities.homeFeel, { coreItems: [], suggestedItems: [] }, { label: 'Morning coffee spot', kind: 'rating' }, 'important');
  assert.equal(selected.tiers['Morning coffee spot'], 'important');
  assert.deepEqual(selected.customItems.at(-1), { label: 'Morning coffee spot', kind: 'rating' });
});

test('three-step journey preserves choices on Back, persists before completion, and ends on a ready state', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  // No Dealbreakers screen, no separate "My Search Criteria" summary screen.
  assert.doesNotMatch(onboarding, /Dealbreaker|dealbreaker/);
  assert.doesNotMatch(onboarding, /SummaryStep|My Search Criteria/);
  assert.match(onboarding, /onBack=\{\(\) => goBack\('what_matters'\)\}/);
  assert.match(onboarding, /onBack=\{\(\) => goBack\('rank'\)\}/);
  assert.match(onboarding, /Rank my priorities/);
  // Every step change flushes pending saves; completion flushes before marking onboarding complete.
  assert.match(onboarding, /const goTo = async \(fromStep\) => \{\n\s+await flush\(\);\n\s+const \{ state: next \} = advanceOnboarding\(version, progressRef\.current, fromStep\);/);
  assert.match(onboarding, /await flush\(\);\n(?:\s+\/\/.*\n)*\s+await persistPriorities\(priorities\);\n\s+await completeOnboarding\(createClient\(\), userId, \{ version, state: completeOnboardingState\(version, progressRef\.current\) \}\);/);
  // #73: a pending share-intake destination (see (app)/layout.js) takes over when present.
  assert.match(onboarding, /if \(pendingRedirect\) \{ router\.push\(pendingRedirect\); router\.refresh\(\); return; \}/);
  assert.match(onboarding, /Your search is ready\./);
  assert.match(onboarding, /Now let’s see how your first home measures up\./);
  assert.match(onboarding, /Add your first home <ArrowRight/);
  assert.match(onboarding, /onAddHome=\{\(\) => leave\('\/homes\?add=1'\)\}/);
  assert.match(onboarding, /onViewSearch=\{\(\) => leave\('\/search\?welcome=1'\)\}/);
  assert.match(onboarding, /Unknown information never counts against a home\./);
});

test('onboarding is tap-first and responsive, and ranking offers explicit level actions', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const board = read('src/components/RankBoard.jsx');
  const css = read('src/app/globals.css');
  assert.doesNotMatch(onboarding, /draggable|CommuteDestinations/);
  assert.match(onboarding, /<ChoiceChip key=\{`\$\{criterion\.categoryKey\}:\$\{criterion\.label\}`\} selected=\{isCriterionSelected\(priorities, criterion\.categoryKey, criterion\.label\)\}/);
  assert.match(onboarding, /<RankBoard/);
  assert.match(board, /LEVEL_COPY\[tier\]\.heading/);
  assert.match(board, />Remove priority<\/button>/);
  assert.match(css, /\.flh-choice-chip \{[^}]*min-height: 38px/);
  assert.match(css, /\.flh-chip-row \{ display: flex; flex-wrap: wrap;/);
  assert.deepEqual(Object.fromEntries(Object.entries(TIER_META).map(([tier, meta]) => [tier, meta.weight])), { must: 4, important: 2, nice: 1, dontcare: 0 });
});

test('the old Dealbreakers onboarding state cannot trap an existing user', () => {
  // Onboarding V2 Phase 1 deliberately persists progress (profiles.onboarding_state)
  // so an interrupted session resumes. The original guarantee still holds:
  // gating is the single boolean profiles.onboarding_complete, and a stored
  // step only steers — an unknown/retired step (e.g. the old Dealbreakers
  // screen) resolves to a screen this person can see. Behavior is covered in
  // onboarding-flow.test.js; this pins the wiring.
  const dataLib = read('src/lib/supabase/data.js');
  assert.match(dataLib, /update\(\{ onboarding_complete: true \}\)/);
  const page = read('src/app/onboarding/page.js');
  // A finished account re-enters only to set up its own preferences on a shared
  // search it joined as a co-buyer (cobuyer-journey-db.test.js).
  assert.match(page, /if \(profile\?\.onboarding_complete && !\(await needsSharedSearchSetup\(supabase, user\.id, search, role === 'owner'\)\)\) redirect\('\/homes'\);/);
  assert.match(page, /beginOnboarding\(\{/);
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /const \[progressState, setProgressState\] = useState\(initialProgress\.state\);/);
  assert.doesNotMatch(onboarding, /localStorage/);
});

