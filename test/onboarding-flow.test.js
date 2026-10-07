import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_ONBOARDING_VERSION, advanceOnboarding, beginOnboarding, completeOnboardingState, isLegacyOnboardedProfile,
  normalizeOnboardingState, onboardingProgress, onboardingStepsFor, resumeOnboardingStep, retreatOnboarding, setOnboardingAnswer,
} from '../src/lib/onboardingFlow.js';

const OWN = { searchId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
const SHARED = { searchId: '22222222-2222-4222-8222-222222222222', role: 'co_buyer' };
const T0 = '2026-10-07T12:00:00.000Z';
const T1 = '2026-10-07T12:05:00.000Z';

test('the shipped flow stays version 1 until the V2 screens exist', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
});

test('a first visit starts fresh at the first screen and must be persisted', () => {
  const begun = beginOnboarding({ context: OWN, now: T0 });
  assert.equal(begun.version, 1);
  assert.equal(begun.fresh, true);
  assert.equal(begun.changed, true);
  assert.equal(begun.state.step, 'basics');
  assert.deepEqual(begun.state.context, OWN);
  assert.equal(begun.state.startedAt, T0);
});

test('an interrupted session resumes on the screen it was on, unchanged', () => {
  const first = beginOnboarding({ context: OWN, now: T0 });
  const moved = advanceOnboarding(1, first.state, 'basics', T1).state;
  assert.equal(moved.step, 'what_matters');
  const resumed = beginOnboarding({ storedVersion: 1, storedState: moved, context: OWN, now: '2026-10-08T09:00:00.000Z' });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.state.step, 'what_matters');
  assert.equal(resumed.changed, false, 'a plain resume needs no write');
  assert.deepEqual(resumed.state.completed, ['basics']);
});

test('Back moves one screen and never clears what was entered', () => {
  let state = beginOnboarding({ context: OWN, now: T0 }).state;
  state = advanceOnboarding(1, state, 'basics', T0).state;
  state = advanceOnboarding(1, state, 'what_matters', T0).state;
  const back = retreatOnboarding(1, state, 'rank', T1);
  assert.equal(back.step, 'what_matters');
  assert.deepEqual(back.completed, ['basics', 'what_matters']);
  assert.deepEqual(retreatOnboarding(1, back, 'basics').step, 'basics', 'Back on the first screen stays put');
});

test('the last screen reports done, and completion records every shown screen', () => {
  let state = beginOnboarding({ context: OWN, now: T0 }).state;
  state = advanceOnboarding(1, state, 'basics').state;
  state = advanceOnboarding(1, state, 'what_matters').state;
  const last = advanceOnboarding(1, state, 'rank');
  assert.equal(last.done, true);
  const complete = completeOnboardingState(1, last.state, T1);
  assert.equal(complete.completedAt, T1);
  assert.deepEqual(complete.completed, ['basics', 'what_matters', 'rank']);
});

test('stored progress can never trap someone: junk, unknown steps, and missing columns resolve safely', () => {
  for (const junk of [null, undefined, 'x', [], { step: 'dealbreakers', completed: 'nope', answers: { collaboration: 'everyone' }, context: { searchId: 'not-a-uuid', role: 'admin' } }]) {
    const state = normalizeOnboardingState(junk);
    assert.equal(state.step, null);
    assert.deepEqual(state.completed, []);
    assert.deepEqual(state.answers, {});
    assert.equal(state.context, null);
    assert.equal(resumeOnboardingStep(1, state), 'basics');
  }
  const begun = beginOnboarding({ storedVersion: 1, storedState: { step: 'dealbreakers', startedAt: T0 }, context: OWN });
  assert.equal(begun.state.step, 'basics');
  assert.throws(() => beginOnboarding({ context: null }), /search context/);
});

test('accepting a co-buyer invitation mid-way re-does search screens for the shared search', () => {
  let state = beginOnboarding({ context: OWN, now: T0 }).state;
  state = advanceOnboarding(1, state, 'basics').state;
  state = advanceOnboarding(1, state, 'what_matters').state;
  const joined = beginOnboarding({ storedVersion: 1, storedState: state, context: SHARED, now: T1 });
  assert.equal(joined.searchChanged, true);
  assert.equal(joined.changed, true);
  assert.deepEqual(joined.state.context, SHARED);
  assert.deepEqual(joined.state.completed, [], 'preferences entered for another search do not count here');
  assert.equal(joined.state.step, 'basics');
  assert.equal(joined.state.startedAt, T0, 'still the same onboarding session');
});

/* ------------------------------- V2 branching ------------------------------- */

test('V2 order puts who-you-search-with before any criteria', () => {
  const steps = onboardingStepsFor(2, setOnboardingAnswer(beginOnboarding({ context: OWN, targetVersion: 2 }).state, 'collaboration', 'co_buyer'));
  assert.deepEqual(steps, ['welcome', 'collaboration', 'collaboration_intro', 'basics', 'locations', 'priorities', 'rank', 'tour_discoveries', 'import_lesson']);
  assert.ok(steps.indexOf('collaboration') < steps.indexOf('basics'));
});

test('V2 solo searchers never see collaboration education', () => {
  const solo = setOnboardingAnswer(beginOnboarding({ context: OWN, targetVersion: 2 }).state, 'collaboration', 'solo');
  assert.ok(!onboardingStepsFor(2, solo).includes('collaboration_intro'));
  const unanswered = beginOnboarding({ context: OWN, targetVersion: 2 }).state;
  assert.ok(!onboardingStepsFor(2, unanswered).includes('collaboration_intro'));
  for (const choice of ['co_buyer', 'realtor', 'co_buyer_and_realtor']) {
    assert.ok(onboardingStepsFor(2, setOnboardingAnswer(solo, 'collaboration', choice)).includes('collaboration_intro'), choice);
  }
});

test('V2 changing the collaboration answer re-routes Next without discarding anything', () => {
  let state = beginOnboarding({ context: OWN, targetVersion: 2, now: T0 }).state;
  state = advanceOnboarding(2, state, 'welcome').state;
  state = setOnboardingAnswer(state, 'collaboration', 'co_buyer');
  assert.equal(advanceOnboarding(2, state, 'collaboration').state.step, 'collaboration_intro');
  state = setOnboardingAnswer(state, 'collaboration', 'solo');
  const next = advanceOnboarding(2, state, 'collaboration').state;
  assert.equal(next.step, 'basics');
  assert.equal(next.answers.collaboration, 'solo');
  assert.equal(retreatOnboarding(2, next, 'basics').step, 'collaboration');
});

test('V2 invited co-buyer: skips the who-with question, gets the own-list intro, cannot be marked solo', () => {
  const begun = beginOnboarding({ context: SHARED, targetVersion: 2, now: T0 });
  assert.equal(begun.state.answers.collaboration, 'co_buyer');
  const steps = onboardingStepsFor(2, begun.state);
  assert.ok(!steps.includes('collaboration'));
  assert.ok(steps.includes('collaboration_intro'));
  assert.equal(advanceOnboarding(2, begun.state, 'welcome').state.step, 'collaboration_intro');
  assert.throws(() => setOnboardingAnswer(begun.state, 'collaboration', 'solo'), /co-buyer/);
  assert.equal(setOnboardingAnswer(begun.state, 'collaboration', 'co_buyer_and_realtor').answers.collaboration, 'co_buyer_and_realtor');
  // Someone who had answered "with a Realtor" and then joined as a co-buyer is searching with both.
  const realtorFirst = setOnboardingAnswer(beginOnboarding({ context: OWN, targetVersion: 2 }).state, 'collaboration', 'realtor');
  assert.equal(beginOnboarding({ storedVersion: 2, storedState: realtorFirst, context: SHARED, targetVersion: 2 }).state.answers.collaboration, 'co_buyer_and_realtor');
});

test('a session started in flow 1 continues in flow 2 with its finished screens carried across', () => {
  let v1 = beginOnboarding({ context: OWN, now: T0 }).state;
  v1 = advanceOnboarding(1, v1, 'basics').state;
  v1 = advanceOnboarding(1, v1, 'what_matters').state;
  const v2 = beginOnboarding({ storedVersion: 1, storedState: v1, context: OWN, targetVersion: 2, now: T1 });
  assert.equal(v2.version, 2);
  assert.equal(v2.changed, true);
  assert.deepEqual(v2.state.completed, ['basics', 'priorities']);
  assert.equal(v2.state.step, 'rank');
});

test('progress reflects only the screens this person sees', () => {
  const solo = setOnboardingAnswer(beginOnboarding({ context: OWN, targetVersion: 2 }).state, 'collaboration', 'solo');
  assert.deepEqual(onboardingProgress(2, solo, 'basics').position, 3);
  assert.deepEqual(onboardingProgress(2, solo, 'basics').total, 8);
  assert.deepEqual(onboardingProgress(1, {}, 'rank'), { index: 2, position: 3, total: 3, steps: ['basics', 'what_matters', 'rank'] });
});

test('accounts that finished before versioning are recognized as legacy, never as unfinished', () => {
  assert.equal(isLegacyOnboardedProfile({ onboarding_complete: true, onboarding_version: null }), true);
  assert.equal(isLegacyOnboardedProfile({ onboarding_complete: true }), true, 'column not yet migrated');
  assert.equal(isLegacyOnboardedProfile({ onboarding_complete: true, onboarding_version: 1 }), false);
  assert.equal(isLegacyOnboardedProfile({ onboarding_complete: false, onboarding_version: null }), false);
});
