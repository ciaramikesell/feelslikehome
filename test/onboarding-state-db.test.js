// Phase 1: persisted onboarding version/progress, against real Postgres where
// it matters (RLS, constraints, the invited co-buyer path) and against a stub
// client for the "migration not applied yet" path.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { advanceOnboarding, beginOnboarding, isLegacyOnboardedProfile } from '../src/lib/onboardingFlow.js';

register('./support/aliasHooks.mjs', import.meta.url);
const { completeOnboarding, getProfile, saveOnboardingProgress } = await import('../src/lib/supabase/data.js');
const { acceptInvitation, createInvitation, resolveOnboardingSearch, setActiveSearch } = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const quietly = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.veteran = db.createUser({ email: 'veteran@example.com' });
  ids.ciara = db.createUser({ email: 'ciara@example.com' });
  ids.andrew = db.createUser({ email: 'andrew@example.com' });
  // An account that finished onboarding long before versioning existed.
  db.exec(`update public.profiles set onboarding_complete = true where id = '${ids.veteran}';`);
  ids.searchOf = Object.fromEntries(db.admin('select user_id, id from public.searches').map((row) => [row.user_id, row.id]));
});
after(() => db?.drop());

// Exactly what src/app/onboarding/page.js does on each visit.
async function openOnboarding(userId) {
  const client = db.clientFor(userId);
  const profile = await getProfile(client, userId);
  const { search, role } = await resolveOnboardingSearch(client, userId);
  return { client, profile, ...beginOnboarding({ storedVersion: profile.onboarding_version, storedState: profile.onboarding_state, context: { searchId: search.id, role } }) };
}

dbTest('existing accounts are untouched by the migration: no version, empty state, still complete', async () => {
  const profile = await getProfile(db.clientFor(ids.veteran), ids.veteran);
  assert.equal(profile.onboarding_complete, true);
  assert.equal(profile.onboarding_version, null);
  assert.deepEqual(profile.onboarding_state, {});
  assert.equal(isLegacyOnboardedProfile(profile), true);
});

dbTest('a new buyer\'s progress persists on their own profile and resumes where they left off', async () => {
  const first = await openOnboarding(ids.ciara);
  assert.equal(first.fresh, true);
  assert.equal(await saveOnboardingProgress(first.client, ids.ciara, { version: first.version, state: first.state }), true);
  const moved = advanceOnboarding(first.version, first.state, 'basics').state;
  assert.equal(await saveOnboardingProgress(first.client, ids.ciara, { version: first.version, state: moved }), true);

  const again = await openOnboarding(ids.ciara);
  assert.equal(again.resumed, true);
  assert.equal(again.state.step, 'what_matters');
  assert.equal(again.profile.onboarding_version, 1);
  assert.deepEqual(again.state.context, { searchId: ids.searchOf[ids.ciara], role: 'owner' });
});

dbTest('nobody can write another person\'s onboarding progress', async () => {
  const before = db.admin(`select onboarding_state from public.profiles where id = '${ids.andrew}'`)[0];
  const { data } = await db.clientFor(ids.ciara).from('profiles')
    .update({ onboarding_version: 1, onboarding_state: { step: 'rank' } }).eq('id', ids.andrew).select('id');
  assert.deepEqual(data, []);
  assert.deepEqual(db.admin(`select onboarding_state from public.profiles where id = '${ids.andrew}'`)[0], before);
});

dbTest('the database rejects malformed progress, and the app treats that as "not saved", never as a crash', async () => {
  const client = db.clientFor(ids.ciara);
  const saved = await quietly(() => Promise.all([
    saveOnboardingProgress(client, ids.ciara, { version: 1, state: ['not', 'an', 'object'] }),
    saveOnboardingProgress(client, ids.ciara, { version: 0, state: {} }),
    saveOnboardingProgress(client, ids.ciara, { version: 1, state: { padding: 'x'.repeat(20000) } }),
  ]));
  assert.deepEqual(saved, [false, false, false]);
  assert.equal(db.admin(`select onboarding_state->>'step' as step from public.profiles where id = '${ids.ciara}'`)[0].step, 'what_matters');
});

dbTest('an invited co-buyer\'s onboarding progress is tied to the shared search, not their own', async () => {
  const andrew = db.clientFor(ids.andrew);
  // Andrew started on his own before opening the invitation link.
  const solo = await openOnboarding(ids.andrew);
  const soloMoved = advanceOnboarding(solo.version, solo.state, 'basics').state;
  await saveOnboardingProgress(andrew, ids.andrew, { version: solo.version, state: soloMoved });

  const invitation = await createInvitation(db.clientFor(ids.ciara), ids.searchOf[ids.ciara], ids.ciara, 'andrew@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(andrew, invitation.token)).success, true);
  await setActiveSearch(andrew, ids.andrew, ids.searchOf[ids.ciara]);

  const joined = await openOnboarding(ids.andrew);
  assert.equal(joined.searchChanged, true);
  assert.deepEqual(joined.state.context, { searchId: ids.searchOf[ids.ciara], role: 'co_buyer' });
  assert.equal(joined.state.step, 'basics', 'preferences entered for his own search do not count for the shared one');
  assert.equal(joined.state.answers.collaboration, 'co_buyer');
  assert.equal(joined.state.startedAt, solo.state.startedAt);
  await saveOnboardingProgress(andrew, ids.andrew, { version: joined.version, state: joined.state });

  const done = await completeOnboarding(andrew, ids.andrew, { version: joined.version, state: { ...joined.state, completedAt: new Date().toISOString() } });
  assert.equal(done, undefined);
  const profile = db.admin(`select onboarding_complete, onboarding_version, onboarding_state->'context'->>'searchId' as search_id from public.profiles where id = '${ids.andrew}'`)[0];
  assert.deepEqual(profile, { onboarding_complete: true, onboarding_version: 1, search_id: ids.searchOf[ids.ciara] });
});

/* -------------------- before the migration is applied (stub client) -------------------- */

function stubClient(responses) {
  const calls = [];
  return {
    calls,
    from: (table) => ({
      update: (row) => ({
        eq: async () => { calls.push({ table, row }); return responses.shift() || { error: null }; },
      }),
    }),
  };
}

test('if the onboarding columns don\'t exist yet, progress quietly isn\'t saved and onboarding continues', async () => {
  const client = stubClient([{ error: { code: 'PGRST204', message: "Could not find the 'onboarding_state' column of 'profiles'" } }]);
  const warn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    assert.equal(await saveOnboardingProgress(client, 'u', { version: 1, state: {} }), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned, false, 'an expected pre-migration state is not noise');
});

test('finishing onboarding saves the gate first, and a failed progress write cannot undo it', async () => {
  const client = stubClient([{ error: null }, { error: { code: '42703', message: 'column "onboarding_state" does not exist' } }]);
  await completeOnboarding(client, 'u', { version: 1, state: {} });
  assert.deepEqual(client.calls[0].row, { onboarding_complete: true });
  assert.deepEqual(Object.keys(client.calls[1].row), ['onboarding_version', 'onboarding_state']);

  const gateFails = stubClient([{ error: { code: '500', message: 'down' } }]);
  await assert.rejects(completeOnboarding(gateFails, 'u', { version: 1, state: {} }));
  assert.equal(gateFails.calls.length, 1, 'progress is never recorded as complete if the gate was not saved');
});
