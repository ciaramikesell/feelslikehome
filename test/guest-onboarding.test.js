import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { defaultPriorities } from '../src/lib/constants.js';
import { applySearchChoice } from '../src/lib/onboarding.js';
import { onboardingStepsFor } from '../src/lib/onboardingFlow.js';
import { addOwnFeature, priorityCategoriesFor, setFeatureLevel, switchPrioritySearchType } from '../src/lib/priorityCategories.js';
import { setPetsMoving } from '../src/lib/rentalPets.js';
import { validateGuestTransfer, readGuestJson } from '../src/lib/guest/validation.js';
import { guestOnboardingEnabled } from '../src/lib/guest/config.js';

const draft = (searchType = 'home_buy', setupPath = 'personalize', priorities = applySearchChoice(defaultPriorities(), searchType)) => {
  const progress = { schema: 1, step: setupPath === 'personalize' ? 'review' : 'basics',
    answers: { searchType, setupPath }, startedAt: new Date().toISOString(), skipped: [] };
  progress.completed = onboardingStepsFor(4, progress);
  return { draftId: randomUUID(), priorities, progress };
};

test('all V3 modes, offered tiers, custom features and rental pets use the same transfer schema', () => {
  for (const type of ['home_buy', 'home_rent', 'apartment_rent']) {
    const ready = draft(type);
    const categories = priorityCategoriesFor(ready.priorities);
    for (const category of categories) for (const option of [...category.features, ...category.suggestions]) {
      const selected = setFeatureLevel(ready.priorities, option, 'must');
      assert.ok(validateGuestTransfer({ ...ready, priorities: selected }), `${type} ${option.label}`);
    }
    const category = categories.find(category => category.features.length && category.storage);
    const added = addOwnFeature(ready.priorities, category.key, 'Reading nook light');
    assert.ok(validateGuestTransfer({ ...ready, priorities: setFeatureLevel(added.priorities, added.feature, 'nice') }));
    if (type !== 'home_buy') assert.ok(validateGuestTransfer({ ...ready, priorities: setPetsMoving(ready.priorities, 'yes').priorities }));
    assert.ok(validateGuestTransfer(draft(type, 'as_i_go')));
    assert.ok(!onboardingStepsFor(4, ready.progress).includes('locations'));
  }
});

test('search-type switching preserves legitimate parked preferences', () => {
  const start = draft();
  const kitchen = priorityCategoriesFor(start.priorities).find(category => category.key === 'kitchen');
  const selected = setFeatureLevel(start.priorities, kitchen.features[0], 'must');
  const switched = switchPrioritySearchType(selected, 'apartment_rent').priorities;
  assert.ok(validateGuestTransfer(draft('apartment_rent', 'personalize', switched)));
});

test('transfer rejects injected identities, malformed priorities, forged tiers, geography, and expired progress', () => {
  const initial = draft();
  for (const modify of [
    body => { body.userId = randomUUID(); },
    body => { body.priorities.features.tiers['Kitchen Island'] = 'extreme'; },
    body => { body.priorities.features.customItems = [{ label: 'fake', kind: 'rating', source: 'custom' }]; },
    body => { body.priorities.location.commuteDestinations = [{ address: '1 Main' }]; },
    body => { body.progress.answers.role = 'owner'; },
    body => { body.progress.completed.push('locations'); },
    body => { body.progress.skipped.push('search_type'); },
    body => { body.progress.startedAt = '2020-01-01T00:00:00.000Z'; },
    body => { body.progress.completed = []; },
  ]) {
    const body = structuredClone(initial);
    modify(body);
    assert.equal(validateGuestTransfer(body), null);
  }
});

test('request reader enforces byte and depth limits even without a Content-Length header', async () => {
  const request = body => new Request('https://localhost/api/guest-transfer', { method: 'POST', body });
  await assert.rejects(readGuestJson(request('{"value":"' + 'a'.repeat(78_000) + '"}')));
  await assert.rejects(readGuestJson(request('{"x":' + '['.repeat(20) + '1' + ']'.repeat(20) + '}')));
  await assert.rejects(readGuestJson(request('{"__proto__":{"admin":true}}')));
});

test('guest entry is disabled without the separate flag and private writer configuration', () => {
  assert.equal(guestOnboardingEnabled({ FLH_ONBOARDING_V3: 'on' }), false);
  assert.equal(guestOnboardingEnabled({ FLH_GUEST_ONBOARDING: 'on', FLH_GUEST_APP_ORIGIN: 'https://example.test' }), false);
  assert.equal(guestOnboardingEnabled({ FLH_GUEST_ONBOARDING: 'on', FLH_GUEST_APP_ORIGIN: 'http://example.test', FLH_GUEST_WRITER_DATABASE_URL: 'writer' }), false);
});
