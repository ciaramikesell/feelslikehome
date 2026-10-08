// Every invitation-acceptance path, executed for real against Postgres.
//
// accept_invitation / claim_prospective_search previously failed with 42702
// ("column reference search_id is ambiguous") on every call that reached their
// membership insert — see 2026-10-07-invitation-acceptance-conflict-targets.sql.
// Source-text tests could not catch that; these run the real functions as the
// real roles. Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, claimProspectiveSearch, createInvitation, createProspectiveSearch, createRealtorConnectionRequest,
  inviteProspectiveClient, resolvePriorities, saveRealtorNote, suggestHomeTour,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner@example.com' });
  ids.realtor = db.createUser({ email: 'realtor@example.com' });
  ids.existingBuyer = db.createUser({ email: 'existing.buyer@example.com' });
  ids.newClient = db.createUser({ email: 'new.client@example.com' });
  ids.searchOf = Object.fromEntries(db.admin('select user_id, id from public.searches').map((row) => [row.user_id, row.id]));
});
after(() => db?.drop());

const memberships = (searchId) => db.admin(`select user_id, role from public.search_members where search_id = '${searchId}' order by role`);

dbTest('buyer → Realtor invitation is accepted and creates exactly the realtor membership', async () => {
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.searchOf[ids.owner], ids.owner, 'realtor@example.com', 'realtor');
  const result = await acceptInvitation(db.clientFor(ids.realtor), invitation.token);
  assert.deepEqual({ success: result.success, search_id: result.search_id }, { success: true, search_id: ids.searchOf[ids.owner] });
  assert.deepEqual(memberships(ids.searchOf[ids.owner]), [{ user_id: ids.realtor, role: 'realtor' }]);
  // Re-accepting is a clean refusal, never a duplicate membership.
  assert.equal((await acceptInvitation(db.clientFor(ids.realtor), invitation.token)).success, false);
});

dbTest('Realtor → existing buyer connection request is accepted on the buyer\'s own search', async () => {
  const request = await createRealtorConnectionRequest(db.clientFor(ids.realtor), 'existing.buyer@example.com');
  const result = await acceptInvitation(db.clientFor(ids.existingBuyer), request.token);
  assert.equal(result.success, true);
  assert.equal(result.search_id, ids.searchOf[ids.existingBuyer]);
  assert.deepEqual(memberships(ids.searchOf[ids.existingBuyer]), [{ user_id: ids.realtor, role: 'realtor' }]);
});

dbTest('a Realtor-started search is claimed by the invited client with their confirmed priorities', async () => {
  const realtor = db.clientFor(ids.realtor);
  const draft = await createProspectiveSearch(realtor, normalizePriorities({ searchType: 'purchase', bedsMin: { value: '3', tier: 'must' } }), 'New Client');
  const invite = await inviteProspectiveClient(realtor, draft.id, 'new.client@example.com');

  const client = db.clientFor(ids.newClient);
  const confirmed = normalizePriorities({ searchType: 'purchase', bedsMin: { value: '4', tier: 'must' } });
  const result = await claimProspectiveSearch(client, invite.token, confirmed);
  assert.equal(result.success, true);
  assert.equal(result.search_id, ids.searchOf[ids.newClient]);
  assert.deepEqual(memberships(ids.searchOf[ids.newClient]), [{ user_id: ids.realtor, role: 'realtor' }]);
  // The client's confirmation, not the Realtor's draft, is what they own.
  const own = normalizePriorities(await resolvePriorities(client, { id: result.search_id }, ids.newClient));
  assert.equal(own.bedsMin.value, '4');
  assert.deepEqual(db.admin(`select onboarding_complete from public.profiles where id = '${ids.newClient}'`), [{ onboarding_complete: true }]);
});

dbTest('Realtor notes and tour suggestions (the other ON CONFLICT RPCs) execute', async () => {
  const owner = db.clientFor(ids.owner);
  const home = await owner.from('homes').insert({ user_id: ids.owner, search_id: ids.searchOf[ids.owner], address: '2 Kercheval Ave, Grosse Pointe, MI 48236' }).select('id').single();
  // Add Home writes the adder's personal state; that is what makes it a contender.
  assert.equal((await owner.from('home_member_state').upsert({ home_id: home.data.id, user_id: ids.owner, status: 'Saved' }, { onConflict: 'home_id,user_id' })).error, null);
  const realtor = db.clientFor(ids.realtor);
  await saveRealtorNote(realtor, ids.searchOf[ids.owner], home.data.id, 'Roof is newer than it looks.');
  await saveRealtorNote(realtor, ids.searchOf[ids.owner], home.data.id, 'Roof replaced 2021.');
  await suggestHomeTour(realtor, ids.searchOf[ids.owner], home.data.id);
  await suggestHomeTour(realtor, ids.searchOf[ids.owner], home.data.id);
  assert.deepEqual(db.admin(`select content from public.realtor_notes where home_id = '${home.data.id}'`), [{ content: 'Roof replaced 2021.' }]);
  assert.equal(db.admin(`select count(*)::int as n from public.tour_suggestions where home_id = '${home.data.id}'`)[0].n, 1);
});
