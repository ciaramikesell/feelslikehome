// My Clients: a Realtor's private client records (prospective_searches),
// executed against a real Postgres built from the repository SQL.
//
// Covers who can see and change a record (only the Realtor who owns it), that
// nothing private reaches a buyer (no policy, no preview field), that a record
// links to a buyer's search only by the buyer claiming its own invitation or
// the Realtor opening one for a search they are on now, that claiming never
// overwrites a buyer's existing priorities and connects the search they are
// actually using, and that removing a Realtor ends access to buyer-owned data
// at once while the Realtor's own notes remain.
// Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, claimProspectiveSearch, createClientRecord, createInvitation, createRealtorInvitation, deleteClientRecord,
  getClientRecord, getClientRecordForSearch, getClientRecords, getClientSearchPriorities, getRealtorRelationships,
  getRealtorSearchContext, inviteProspectiveClient, openConnectedClientRecord, previewInvitation, removeRealtor,
  saveHomePersonalAndShared, savePriorities, updateClientRecord,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const fails = (re) => (error) => re.test(error?.message || String(error));
const denied = (error) => /access denied|42501|permission denied|row-level security|not connected/i.test(error?.message || String(error));

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

let seq = 0;
const newUser = (name) => {
  seq += 1;
  const email = `${name}.${seq}@example.com`;
  return { id: db.createUser({ email, firstName: name[0].toUpperCase() + name.slice(1) }), email };
};
const as = (user) => db.clientFor(user.id);
const ownedSearch = (user) => db.admin(`select id from public.searches where user_id = '${user.id}'`)[0].id;
const searchCount = () => db.admin('select count(*)::int as n from public.searches')[0].n;
const roleIn = (search, user) => db.admin(`select role from public.search_members where search_id = '${search}' and user_id = '${user.id}'`)[0]?.role || null;
const prioritiesOf = (search, user) => db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${user.id}'`)[0]?.priorities ?? null;
const recordRow = (id) => db.admin(`select status, search_id, draft_priorities, notes, contact_phone from public.prospective_searches where id = '${id}'`)[0] || null;
const invitationRow = (token) => db.admin(`select status, search_id, prospective_search_id from public.search_invitations where token = '${token}'`)[0];

const PRIVATE = { notes: 'Pre-approved with First Bank; nervous about HOAs', contactPhone: '555-0142', preferredLocations: ['Maplewood', 'South Orange'] };
const DRAFT = { searchType: 'purchase', onboardingSearchType: 'home_buy', budget: { value: '600000', tier: 'dontcare' }, bedsMin: { value: '3', tier: 'dontcare' } };

async function prospect(realtor, extra = {}) {
  const id = await createClientRecord(as(realtor), { name: 'Jamie Rivera', draftPriorities: DRAFT, contactEmail: 'jamie@example.com', ...PRIVATE, ...extra });
  assert.match(String(id), /^[0-9a-f-]{36}$/);
  return id;
}

// An owner with a home and priorities, and a co-buyer who joined and set their own.
async function household() {
  const p = { owner: newUser('olive'), coBuyer: newUser('casey') };
  p.search = ownedSearch(p.owner);
  db.exec(`update public.profiles set onboarding_complete = true where id in ('${p.owner.id}', '${p.coBuyer.id}')`);
  await savePriorities(as(p.owner), { id: p.search }, p.owner.id, { searchType: 'purchase', budget: { value: '650000', tier: 'must' } });
  await saveHomePersonalAndShared(as(p.owner), { address: `1 Olive St ${seq}`, status: 'Saved', checks: {}, ratings: { overall: 4 }, reaction: 'love' }, p.owner.id, p.search);
  const invite = await createInvitation(as(p.owner), p.search, p.owner.id, p.coBuyer.email, 'co_buyer');
  assert.equal((await acceptInvitation(as(p.coBuyer), invite.token)).success, true);
  db.exec(`update public.profiles set active_search_id = '${p.search}' where id = '${p.coBuyer.id}'`);
  await savePriorities(as(p.coBuyer), { id: p.search }, p.coBuyer.id, { searchType: 'purchase', bedsMin: { value: '3', tier: 'must' } });
  return p;
}

/* ------------------------------ private records ----------------------------- */

dbTest('a Realtor creates, reads, edits and deletes their own private client; only a name is required', async () => {
  const realtor = newUser('riley');
  await assert.rejects(createClientRecord(as(realtor), { name: '   ' }), fails(/client name is required/));
  const minimal = await createClientRecord(as(realtor), { name: 'Sam' });
  assert.deepEqual((await getClientRecord(as(realtor), minimal)), {
    ...(await getClientRecord(as(realtor), minimal)), name: 'Sam', status: 'draft', contactEmail: '', contactPhone: '', preferredLocations: [], notes: '', searchId: null,
  });
  const id = await prospect(realtor);
  const record = await getClientRecord(as(realtor), id);
  assert.deepEqual([record.name, record.status, record.contactEmail, record.contactPhone, record.preferredLocations, record.notes, record.draftPriorities.budget.value],
    ['Jamie Rivera', 'draft', 'jamie@example.com', '555-0142', ['Maplewood', 'South Orange'], PRIVATE.notes, '600000']);

  await updateClientRecord(as(realtor), id, { name: 'Jamie R.', contactEmail: 'JAMIE@example.com', contactPhone: '', preferredLocations: ['Montclair'], notes: 'Prefers weekends', draftPriorities: { ...DRAFT, bathsMin: { value: '2', tier: 'dontcare' } } });
  const edited = await getClientRecord(as(realtor), id);
  assert.deepEqual([edited.name, edited.contactEmail, edited.contactPhone, edited.preferredLocations, edited.notes, edited.draftPriorities.bathsMin.value],
    ['Jamie R.', 'jamie@example.com', '', ['Montclair'], 'Prefers weekends', '2']);
  assert.deepEqual((await getClientRecords(as(realtor))).map((row) => row.id).sort(), [id, minimal].sort());

  await deleteClientRecord(as(realtor), minimal);
  assert.equal(recordRow(minimal), null);

  // Bounded fields.
  await assert.rejects(createClientRecord(as(realtor), { name: 'Long', notes: 'x'.repeat(5001) }), fails(/notes_check/));
  await assert.rejects(createClientRecord(as(realtor), { name: 'Many', preferredLocations: Array.from({ length: 13 }, (_, i) => `Town ${i}`) }), fails(/preferred_locations_check/));
});

dbTest('other Realtors, buyers and co-buyers cannot see, change or delete a Realtor’s private client', async () => {
  const realtor = newUser('riley');
  const otherRealtor = newUser('rowan');
  const p = await household();
  const id = await prospect(realtor);
  for (const user of [otherRealtor, p.owner, p.coBuyer]) {
    assert.deepEqual(await getClientRecords(as(user)), []);
    assert.equal(await getClientRecord(as(user), id), null);
    const changed = await as(user).from('prospective_searches').update({ notes: 'mine now' }).eq('id', id).select('id');
    assert.deepEqual(changed.data, [], 'RLS hides the row from updates');
    const removed = await as(user).from('prospective_searches').delete().eq('id', id).select('id');
    assert.deepEqual(removed.data, [], 'RLS hides the row from deletes');
  }
  assert.equal(recordRow(id).notes, PRIVATE.notes);

  // Nobody inserts directly, and nobody — the owner included — writes the link or the status.
  const insert = await as(realtor).from('prospective_searches').insert({ started_by: realtor.id, client_name: 'Direct' }).select('id');
  assert.ok(denied(insert.error), 'records are created only through create_client_record');
  for (const patch of [{ status: 'connected' }, { search_id: p.search }, { started_by: otherRealtor.id }, { invited_email: p.owner.email }]) {
    const result = await as(realtor).from('prospective_searches').update(patch).eq('id', id).select('id');
    assert.ok(denied(result.error), `${Object.keys(patch)[0]} is not client-writable`);
  }
  assert.deepEqual([recordRow(id).status, recordRow(id).search_id], ['draft', null]);
});

dbTest('an invitation shows the buyer only the proposed criteria and name, never notes, contact details or locations', async () => {
  const realtor = newUser('riley');
  const buyer = newUser('blair');
  const id = await prospect(realtor);
  const invite = await inviteProspectiveClient(as(realtor), id, buyer.email);
  const preview = await previewInvitation(as(buyer), invite.token);
  assert.equal(preview.valid, true);
  assert.deepEqual(Object.keys(preview).sort(), ['client_name', 'draft_priorities', 'invitation_direction', 'inviter_display_name', 'reason', 'relationship_type', 'requires_confirmation', 'valid']);
  const shown = JSON.stringify(preview);
  for (const secret of [PRIVATE.notes, PRIVATE.contactPhone, 'Maplewood', 'jamie@example.com']) assert.ok(!shown.includes(secret), `preview never contains ${secret}`);
  assert.equal(preview.draft_priorities.budget.value, '600000');
  // Someone else opening the link learns nothing at all.
  const stranger = await previewInvitation(as(newUser('sky')), invite.token);
  assert.deepEqual([stranger.valid, stranger.reason, stranger.draft_priorities, stranger.client_name], [false, 'wrong_account', null, null]);
});

/* ---------------------------------- claiming --------------------------------- */

dbTest('a buyer with no priorities yet confirms the proposal; the record is kept and linked, its draft cleared, notes kept', async () => {
  const realtor = newUser('riley');
  const buyer = newUser('blair');
  const search = ownedSearch(buyer);
  assert.equal(prioritiesOf(search, buyer), null, 'a new buyer has no priorities document yet');
  const id = await prospect(realtor);
  const { token } = await inviteProspectiveClient(as(realtor), id, buyer.email);
  const before = searchCount();

  assert.equal((await claimProspectiveSearch(as(buyer), token, null)).reason, 'confirmation_required', 'never applied without explicit confirmation');
  assert.equal(roleIn(search, realtor), null);

  const confirmed = { searchType: 'purchase', budget: { value: '575000', tier: 'must' } };
  const result = await claimProspectiveSearch(as(buyer), token, confirmed, search);
  assert.deepEqual([result.success, result.reason, result.search_id], [true, null, search]);
  assert.equal(prioritiesOf(search, buyer).budget.value, '575000', 'the buyer’s confirmed document is the one stored');
  assert.equal(roleIn(search, realtor), 'realtor');
  assert.equal(searchCount(), before, 'no search is created');
  assert.deepEqual(recordRow(id), { status: 'connected', search_id: search, draft_priorities: {}, notes: PRIVATE.notes, contact_phone: PRIVATE.contactPhone });
  assert.deepEqual(invitationRow(token), { status: 'accepted', search_id: search, prospective_search_id: null });
  // Re-opening the link is idempotent and changes nothing.
  assert.deepEqual(await claimProspectiveSearch(as(buyer), token, confirmed), { success: true, reason: 'already_claimed', search_id: search });

  // The buyer still cannot see the Realtor's record linked to their own search.
  assert.deepEqual(await getClientRecords(as(buyer)), []);
  assert.equal(await getClientRecordForSearch(as(buyer), search), null);
});

dbTest('claiming never overwrites priorities a buyer already has; keeping theirs connects without touching them', async () => {
  const realtor = newUser('riley');
  const p = await household();
  const ownerBefore = prioritiesOf(p.search, p.owner);
  const coBuyerBefore = prioritiesOf(p.search, p.coBuyer);
  const id = await prospect(realtor);
  const { token } = await inviteProspectiveClient(as(realtor), id, p.owner.email);

  const refused = await claimProspectiveSearch(as(p.owner), token, { searchType: 'purchase', budget: { value: '1', tier: 'must' } });
  assert.deepEqual([refused.success, refused.reason], [false, 'priorities_exist']);
  assert.deepEqual(prioritiesOf(p.search, p.owner), ownerBefore);
  assert.equal(roleIn(p.search, realtor), null);
  assert.equal(invitationRow(token).status, 'pending');
  assert.equal(recordRow(id).status, 'invited');

  const kept = await claimProspectiveSearch(as(p.owner), token, null, p.search);
  assert.deepEqual([kept.success, kept.search_id], [true, p.search]);
  assert.deepEqual(prioritiesOf(p.search, p.owner), ownerBefore, 'owner priorities unchanged');
  assert.deepEqual(prioritiesOf(p.search, p.coBuyer), coBuyerBefore, 'co-buyer priorities unchanged');
  assert.equal(roleIn(p.search, realtor), 'realtor');
  assert.deepEqual([recordRow(id).status, recordRow(id).search_id, recordRow(id).draft_priorities], ['connected', p.search, {}]);
});

dbTest('a co-buyer claims into the shared search they use, not their own empty one; their own perspective only', async () => {
  const realtor = newUser('riley');
  const p = await household();
  const coBuyerOwn = ownedSearch(p.coBuyer);
  const id = await prospect(realtor);
  const { token } = await inviteProspectiveClient(as(realtor), id, p.coBuyer.email);
  const ownerBefore = prioritiesOf(p.search, p.owner);

  // The screen named a different search than the one in use: refused.
  assert.equal((await claimProspectiveSearch(as(p.coBuyer), token, null, coBuyerOwn)).reason, 'search_changed');
  const result = await claimProspectiveSearch(as(p.coBuyer), token, null, p.search);
  assert.deepEqual([result.success, result.search_id], [true, p.search]);
  assert.equal(roleIn(p.search, realtor), 'realtor');
  assert.equal(roleIn(coBuyerOwn, realtor), null, 'the co-buyer’s own search is untouched');
  assert.deepEqual(prioritiesOf(p.search, p.owner), ownerBefore);
  assert.equal(recordRow(id).search_id, p.search);
});

dbTest('a co-buyer without priorities in the shared search confirms only their own perspective there', async () => {
  const realtor = newUser('riley');
  const owner = newUser('olive');
  const coBuyer = newUser('casey');
  const search = ownedSearch(owner);
  await savePriorities(as(owner), { id: search }, owner.id, { searchType: 'purchase', budget: { value: '700000', tier: 'must' } });
  const invite = await createInvitation(as(owner), search, owner.id, coBuyer.email, 'co_buyer');
  assert.equal((await acceptInvitation(as(coBuyer), invite.token)).success, true);
  db.exec(`update public.profiles set active_search_id = '${search}' where id = '${coBuyer.id}'`);
  const ownerBefore = prioritiesOf(search, owner);

  const id = await prospect(realtor);
  const { token } = await inviteProspectiveClient(as(realtor), id, coBuyer.email);
  const result = await claimProspectiveSearch(as(coBuyer), token, { searchType: 'purchase', bedsMin: { value: '4', tier: 'must' } }, search);
  assert.equal(result.success, true, result.reason);
  assert.equal(prioritiesOf(search, coBuyer).bedsMin.value, '4');
  assert.deepEqual(prioritiesOf(search, owner), ownerBefore, 'the owner’s document is never touched');
  assert.equal(prioritiesOf(ownedSearch(coBuyer), coBuyer), null);
});

dbTest('with no safe search (a stale active search) nothing is connected or written', async () => {
  const realtor = newUser('riley');
  const p = await household();
  const id = await prospect(realtor);
  const { token } = await inviteProspectiveClient(as(realtor), id, p.coBuyer.email);
  // The co-buyer was removed from the shared search but it is still their active one.
  db.exec(`delete from public.search_members where search_id = '${p.search}' and user_id = '${p.coBuyer.id}'`);
  const result = await claimProspectiveSearch(as(p.coBuyer), token, { searchType: 'purchase' });
  assert.deepEqual([result.success, result.reason], [false, 'active_search_unavailable']);
  assert.equal(roleIn(p.search, realtor), null);
  assert.equal(roleIn(ownedSearch(p.coBuyer), realtor), null);
  assert.equal(prioritiesOf(ownedSearch(p.coBuyer), p.coBuyer), null);
  assert.equal(recordRow(id).status, 'invited');
});

dbTest('matching email addresses never link anything: only the invited account, through its own invitation', async () => {
  const realtor = newUser('riley');
  const buyer = newUser('blair');
  // The Realtor writes down the buyer's real email as a contact detail. No invitation exists.
  const id = await prospect(realtor, { contactEmail: buyer.email });
  assert.deepEqual([recordRow(id).status, recordRow(id).search_id], ['draft', null]);
  assert.equal(roleIn(ownedSearch(buyer), realtor), null);
  assert.deepEqual(await getRealtorRelationships(as(realtor), realtor.id), []);

  // An invitation to a different address cannot be claimed by this buyer.
  const { token } = await inviteProspectiveClient(as(realtor), id, 'someone.else@example.com');
  assert.equal((await claimProspectiveSearch(as(buyer), token, { searchType: 'purchase' })).reason, 'wrong_account');
  assert.equal(roleIn(ownedSearch(buyer), realtor), null);
  assert.equal(recordRow(id).search_id, null);
});

/* ----------------------------- connected clients ----------------------------- */

dbTest('a Realtor keeps one private record per client they are connected to; others cannot open one', async () => {
  const realtor = newUser('riley');
  const otherRealtor = newUser('rowan');
  const p = await household();
  await assert.rejects(openConnectedClientRecord(as(realtor), p.search), denied, 'not connected yet');
  const inv = await createRealtorInvitation(as(p.owner), p.search, realtor.email);
  assert.equal((await acceptInvitation(as(realtor), inv.token)).success, true);

  const id = await openConnectedClientRecord(as(realtor), p.search);
  assert.equal(await openConnectedClientRecord(as(realtor), p.search), id, 'idempotent: no duplicate record');
  assert.deepEqual([recordRow(id).status, recordRow(id).search_id, recordRow(id).draft_priorities], ['connected', p.search, {}]);
  for (const user of [otherRealtor, p.owner, p.coBuyer]) await assert.rejects(openConnectedClientRecord(as(user), p.search), denied);

  await updateClientRecord(as(realtor), id, { name: 'Olive & Casey', contactPhone: '555-0100', preferredLocations: [], notes: 'Wants to close before school starts' });
  assert.equal((await getClientRecordForSearch(as(realtor), p.search)).notes, 'Wants to close before school starts');
  // A connected record never takes proposed criteria and is never invited again.
  await assert.rejects(updateClientRecord(as(realtor), id, { name: 'x', preferredLocations: [], draftPriorities: DRAFT }), fails(/link_check/));
  await assert.rejects(inviteProspectiveClient(as(realtor), id, p.owner.email), fails(/already connected/));
  // Buyers never see it.
  for (const user of [p.owner, p.coBuyer]) assert.equal(await getClientRecordForSearch(as(user), p.search), null);
});

dbTest('removing the Realtor ends access to buyer-owned data at once; the Realtor’s own notes remain and expose nothing', async () => {
  const realtor = newUser('riley');
  const p = await household();
  const id = await prospect(realtor);
  const { token } = await inviteProspectiveClient(as(realtor), id, p.owner.email);
  assert.equal((await claimProspectiveSearch(as(p.owner), token, null, p.search)).success, true);
  // While connected the Realtor reads the buyers' search.
  assert.equal((await as(realtor).from('homes').select('id').eq('search_id', p.search)).data.length, 1);
  assert.equal((await getClientSearchPriorities(as(realtor), [p.search])).length, 2);

  await removeRealtor(as(p.coBuyer), p.search, realtor.id);

  assert.equal(roleIn(p.search, realtor), null);
  assert.equal(await getRealtorSearchContext(as(realtor), realtor.id, p.search), null);
  assert.deepEqual(await getRealtorRelationships(as(realtor), realtor.id), []);
  assert.deepEqual(await getClientSearchPriorities(as(realtor), [p.search]), []);
  assert.deepEqual((await as(realtor).from('homes').select('id').eq('search_id', p.search)).data, []);
  const roster = await as(realtor).rpc('get_realtor_client_roster', { p_search_ids: [p.search] });
  assert.deepEqual(roster.data || [], []);
  const states = await as(realtor).from('home_member_state').select('home_id').in('home_id', db.admin(`select id from public.homes where search_id = '${p.search}'`).map((row) => row.id));
  assert.deepEqual(states.data, []);
  await assert.rejects(openConnectedClientRecord(as(realtor), p.search), denied);

  // The record is still the Realtor's, and holds only what they wrote.
  const record = await getClientRecord(as(realtor), id);
  assert.deepEqual([record.status, record.searchId, record.notes, record.draftPriorities], ['connected', p.search, PRIVATE.notes, {}]);
  const stored = JSON.stringify(db.admin(`select * from public.prospective_searches where id = '${id}'`));
  // (invited_email is the address the Realtor typed to invite them: their own entry, kept as it was.)
  for (const buyerValue of ['650000', 'Olive St', 'Olive', 'Casey', 'love']) assert.ok(!stored.includes(buyerValue), `record holds no buyer data (${buyerValue})`);
  // The old invitation reveals nothing either.
  const preview = await previewInvitation(as(p.owner), token);
  assert.deepEqual([preview.valid, preview.draft_priorities, preview.client_name], [false, null, null]);

  // The Realtor can still delete their own record.
  await deleteClientRecord(as(realtor), id);
  assert.equal(recordRow(id), null);
});

dbTest('deleting a record withdraws its unanswered invitation, so it can never connect the Realtor', async () => {
  const realtor = newUser('riley');
  const buyer = newUser('blair');
  const id = await prospect(realtor);
  const { token } = await inviteProspectiveClient(as(realtor), id, buyer.email);
  await deleteClientRecord(as(realtor), id);
  assert.equal(invitationRow(token).status, 'revoked');
  assert.equal((await acceptInvitation(as(buyer), token)).reason, 'revoked');
  assert.equal((await claimProspectiveSearch(as(buyer), token, { searchType: 'purchase' })).reason, 'revoked');
  assert.equal(roleIn(ownedSearch(buyer), realtor), null);
});

dbTest('My Clients adds no way for a Realtor to change buyer priorities, ratings, reactions or homes', async () => {
  const realtor = newUser('riley');
  const p = await household();
  const inv = await createRealtorInvitation(as(p.owner), p.search, realtor.email);
  assert.equal((await acceptInvitation(as(realtor), inv.token)).success, true);
  await openConnectedClientRecord(as(realtor), p.search);
  const ownerBefore = prioritiesOf(p.search, p.owner);
  const home = db.admin(`select id from public.homes where search_id = '${p.search}'`)[0].id;
  const stateBefore = db.admin(`select reaction, ratings from public.home_member_state where home_id = '${home}' and user_id = '${p.owner.id}'`)[0];

  await as(realtor).from('search_member_priorities').update({ priorities: { hacked: true } }).eq('search_id', p.search).select('id');
  await as(realtor).from('search_member_priorities').insert({ search_id: p.search, user_id: realtor.id, priorities: { hacked: true } }).select('id');
  await as(realtor).from('home_member_state').update({ reaction: 'hate', ratings: { overall: 1 } }).eq('home_id', home).select('home_id');
  await as(realtor).from('homes').update({ price: 1 }).eq('id', home).select('id');
  await as(realtor).from('homes').delete().eq('id', home).select('id');

  assert.deepEqual(prioritiesOf(p.search, p.owner), ownerBefore);
  assert.equal(prioritiesOf(p.search, realtor), null);
  assert.deepEqual(db.admin(`select reaction, ratings from public.home_member_state where home_id = '${home}' and user_id = '${p.owner.id}'`)[0], stateBefore);
  assert.equal(db.admin(`select count(*)::int as n from public.homes where id = '${home}' and price is distinct from '1'`)[0].n, 1);
});

/* --------------------------- production preflight --------------------------- */

import { readFileSync } from 'node:fs';
import { POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';
const MIGRATION = 'supabase/migrations/2026-10-16-realtor-my-clients.sql';
const PREFLIGHT = readFileSync(new URL('../supabase/realtor-my-clients-preflight.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '').trim().replace(/;$/, '');
const notOk = (rows, stage) => rows.filter((row) => row.stage === stage && row.ok !== true).map((row) => `${row.item} ${row.detail || ''}`);
const withoutMigration = () => createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });

dbTest('the read-only preflight passes before the migration, confirms it after, and changes nothing; existing drafts survive', () => {
  const pre = withoutMigration();
  try {
    const realtor = pre.createUser({ email: 'pre.realtor@example.com', firstName: 'Pre' });
    pre.exec(`insert into public.prospective_searches (started_by, client_name, draft_priorities, status, invited_email)
      values ('${realtor}', 'Existing draft', '{"budget":{"value":"500000"}}', 'draft', null),
             ('${realtor}', 'Existing invite', '{}', 'invited', 'invitee@example.com')`);
    const fingerprint = () => pre.admin(`select
      (select json_agg(p order by p.tablename, p.policyname) from pg_policies p where p.schemaname = 'public') as policies,
      (select json_agg(f.proname order by f.proname) from pg_proc f where f.pronamespace = 'public'::regnamespace) as functions,
      (select json_agg(r order by r.client_name) from public.prospective_searches r) as records`)[0];
    const before = fingerprint();
    const report = pre.admin(PREFLIGHT);
    assert.deepEqual(notOk(report, 'required'), []);
    assert.ok(notOk(report, 'after').length > 0, 'nothing to confirm yet');
    assert.ok(report.some((row) => row.section === 4 && row.detail === 'not present: will be created'));
    assert.deepEqual(fingerprint(), before, 'the preflight writes nothing');

    const policiesElsewhere = () => pre.admin(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename <> 'prospective_searches' order by 1, 2`);
    const othersBefore = policiesElsewhere();
    assert.equal(pre.applyFile(MIGRATION).error, null);
    assert.deepEqual(policiesElsewhere(), othersBefore, 'no policy on any other table changes');
    const records = pre.admin(`select client_name, status, search_id, draft_priorities, preferred_locations from public.prospective_searches order by client_name`);
    assert.deepEqual(records, [
      { client_name: 'Existing draft', status: 'draft', search_id: null, draft_priorities: { budget: { value: '500000' } }, preferred_locations: [] },
      { client_name: 'Existing invite', status: 'invited', search_id: null, draft_priorities: {}, preferred_locations: [] },
    ]);
    const after = pre.admin(PREFLIGHT);
    assert.deepEqual(notOk(after, 'required'), []);
    assert.deepEqual(notOk(after, 'after'), [], 'columns, checks, owner-only policies, column grants, definer functions');
    assert.equal(pre.applyFile(MIGRATION).error, null, 're-runnable');
    assert.deepEqual(notOk(pre.admin(PREFLIGHT), 'after'), []);
  } finally {
    pre.drop();
  }
});

dbTest('the preflight flags a missing prerequisite, a conflicting function, a wider policy and widened grants', () => {
  const pre = withoutMigration();
  try {
    pre.exec('drop function public.approve_realtor_connection(uuid, uuid);');
    pre.exec(`create function public.create_client_record(p_name text) returns uuid language sql as $$ select null::uuid $$;`);
    pre.exec(`create policy "prospective_searches_anyone_select" on public.prospective_searches for select to authenticated using (true);`);
    const failing = notOk(pre.admin(PREFLIGHT), 'required');
    assert.ok(failing.some((line) => line.includes('2026-10-15 buyer-realtor-management applied')), failing.join('\n'));
    assert.ok(failing.some((line) => line.startsWith('no other function named create_client_record') && line.includes('create_client_record(p_name text)')), failing.join('\n'));
    assert.ok(failing.some((line) => line.includes('policies are owner-only')), failing.join('\n'));
  } finally {
    pre.drop();
  }
  const post = createTestDatabase();
  try {
    post.exec('grant update (status, search_id) on public.prospective_searches to authenticated;');
    post.exec('grant execute on function public.open_connected_client_record(uuid) to anon;');
    const failing = notOk(post.admin(PREFLIGHT), 'after');
    assert.deepEqual(failing.map((line) => line.trim()).sort(), [
      'authenticated UPDATE on search_id is not granted',
      'authenticated UPDATE on status is not granted',
      'open_connected_client_record: EXECUTE for authenticated only',
    ]);
  } finally {
    post.drop();
  }
});
