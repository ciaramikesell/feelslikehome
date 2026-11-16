// Founder decision (PR #185): FLH is a decision tool for homes people have
// already found, not a listing search. Mobile Priority Onboarding V3 (flow 4)
// no longer asks "Where are you looking?" for any kind of search, on phones or
// desktop. Saved areas and places are kept; Places That Matter stays in My
// Search; the live flow and finished accounts are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../src/lib/constants.js');
const { chooseSearchType } = await import('../src/lib/onboardingBasics.js');
const { addSearchArea, searchAreasOf } = await import('../src/lib/searchAreas.js');
const { switchPrioritySearchType } = await import('../src/lib/priorityCategories.js');
const {
  CURRENT_ONBOARDING_VERSION, ONBOARDING_FLOWS, beginOnboarding, isLegacyOnboardedProfile, normalizeOnboardingState, onboardingStepsFor,
  resumeOnboardingStep, retreatOnboarding,
} = await import('../src/lib/onboardingFlow.js');
const { desktopSteps } = await import('../src/lib/priorityBoard.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const OWN = { searchId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
const T0 = '2026-11-15T12:00:00.000Z';
const TYPES = { home_buy: 'cat_layout', home_rent: 'cat_essentials', apartment_rent: 'cat_essentials' };

test('flow 4 has no geography screen for any kind of search, on phones or desktop', () => {
  for (const [type, afterBasics] of Object.entries(TYPES)) {
    const steps = onboardingStepsFor(4, { answers: { searchType: type } });
    assert.equal(steps.includes('locations'), false, type);
    assert.equal(steps[steps.indexOf('basics') + 1], afterBasics, `${type}: Basics is followed by the first priority screen`);
    assert.equal(desktopSteps(steps).includes('locations'), false, `${type} desktop`);
    assert.equal(retreatOnboarding(4, { answers: { searchType: type }, step: afterBasics }, afterBasics, T0).step, 'basics', `${type}: Back skips straight to Basics`);
  }
  assert.equal(ONBOARDING_FLOWS[4].steps.some((step) => step.key === 'locations'), false);
});

test('the live flow, the six-step preview and finished accounts are unchanged', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  assert.deepEqual(ONBOARDING_FLOWS[3].steps.map((step) => step.key), ['basics', 'locations', 'collaboration', 'priorities', 'rank', 'review']);
  assert.equal(isLegacyOnboardedProfile({ onboarding_complete: true, onboarding_version: null }), true);
  assert.equal(normalizeOnboardingState({ step: 'locations' }).step, 'locations', 'a stored locations step is still a known key (flows 2 and 3)');
});

test('an in-progress V3 session stored on the old geography screen resumes at the next valid screen', () => {
  for (const [type, next] of Object.entries(TYPES)) {
    const stored = { step: 'locations', completed: ['search_type', 'basics'], skipped: [], answers: { searchType: type }, startedAt: T0, context: OWN };
    assert.equal(resumeOnboardingStep(4, stored), next, type);
    const resumed = beginOnboarding({ storedVersion: 4, storedState: stored, context: OWN, now: T0, targetVersion: 4 });
    assert.equal(resumed.state.step, next, `${type}: begin`);
    assert.equal(resumed.changed, true, 'the corrected position is saved');
    // Already past it, or skipped it: carry on where they were; nothing is lost.
    const later = { ...stored, step: null, completed: ['search_type', 'basics', 'locations', next], skipped: ['locations'] };
    assert.notEqual(resumeOnboardingStep(4, later), 'locations');
    // Never got as far as Basics: the setup-path choice (Milestone 2) comes first.
    assert.equal(resumeOnboardingStep(4, { ...stored, completed: ['search_type'] }), 'setup_path');
  }
});

test('saved areas are kept in the document and survive a search-type switch; nothing deletes them', () => {
  let p = chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });
  p = addSearchArea(p, { placeId: 'gp', name: 'Grosse Pointe', secondary: 'Michigan, USA', type: 'city', source: 'google_places' });
  const areas = searchAreasOf(p);
  assert.equal(areas.length, 1);
  for (const type of ['home_rent', 'apartment_rent', 'home_buy']) {
    p = switchPrioritySearchType(p, type).priorities;
    assert.deepEqual(searchAreasOf(normalizePriorities(p)), areas, type);
  }
  const sources = ['src/components/onboarding/priority/PriorityFlow.jsx', 'src/components/onboarding/priority/PriorityReview.jsx', 'src/components/onboarding/priority/PriorityBoard.jsx', 'src/lib/onboardingFlow.js'].map(read).join('\n');
  assert.doesNotMatch(sources, /searchAreas\s*=\s*\[\]|delete\s+\w+\.searchAreas|removeSearchArea/);
});

test('flow 4 screens and Review no longer show or link to geography; My Search keeps Places That Matter', () => {
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.doesNotMatch(flow, /LocationsStep|step === 'locations'/);
  const review = read('src/components/onboarding/priority/PriorityReview.jsx');
  assert.doesNotMatch(review, /Where you’re looking|onEdit\('locations'\)|areasSummary|placesSummary/);
  // The live / six-step flows keep their own screens and Review.
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /!priorityFlow && step === 'locations'/);
  assert.match(read('src/components/onboarding/ReviewStep.jsx'), /Places That Matter/);
  // Places That Matter (with commute distances) stays an optional My Search setting.
  assert.match(read('src/components/MySearchPanel.jsx'), /href="\/search\/places"/);
  assert.match(read('src/app/(app)/search/places/page.js'), /getCommuteDestinations/);
  // /onboarding only loads saved places for a flow that still shows them.
  assert.match(read('src/app/onboarding/page.js'), /includes\('locations'\)\) return \{ initialPlaces: \[\], placesError: null \}/);
});
