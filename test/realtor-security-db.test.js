// Realtor and departed-member access, executed for real against Postgres.
//
// Before 2026-10-12-realtor-access-and-home-ownership.sql:
// * a suggested home keeps the Realtor as its adder (homes.user_id), and the
//   original "adder may read / delete" policies let the Realtor delete it after
//   a buyer accepted it (cascading every buyer's ratings and reactions), and
//   keep reading it, buyers' later notes included, after being removed;
// * buyers could not delete an accepted Realtor-suggested home, or a home
//   added by a co-buyer who had left;
// * a removed Realtor's pending suggestions stayed visible and acceptable;
// * a departed co-buyer kept reading (and could delete) homes they had added,
//   and the Realtor kept reading the departed co-buyer's private priorities,
//   home assessments and places;
// * a home outside any search stayed readable and deletable by its adder.
//
// Roles: owner, co-buyer, connected Realtor, removed Realtor, outsider, and a
// departed co-buyer. Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, createRealtorSuggestion, dismissSuggestion, getHomesForUser, getRealtorRelationships,
  leaveSearch, promoteSuggestion, removeMember, saveHomePersonalAndShared,
  savePriorities, saveRealtorNote, suggestHomeTour,
} = await import('../src/lib/supabase/collaboration.js');
const { deleteHome } = await import('../src/lib/supabase/data.js');

const MIGRATION = 'supabase/migrations/2026-10-12-realtor-access-and-home-ownership.sql';
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const denied = (error) => /row-level security|permission denied|access denied|42501|no longer available/i.test(error?.message || String(error));

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

/* -------------------------------- fixtures -------------------------------- */

let seq = 0;
// A fresh search with an owner, a co-buyer and a Realtor (plus an outsider),
// so each test starts from known membership.
async function household(target = db) {
  seq += 1;
  const user = (name) => target.createUser({ email: `${name}.${seq}@example.com`, firstName: name });
  const people = { owner: user('owner'), coBuyer: user('cobuyer'), realtor: user('realtor'), outsider: user('outsider') };
  people.search = target.admin(`select id from public.searches where user_id = '${people.owner}'`)[0].id;
  await invite(target, people, people.coBuyer, 'co_buyer');
  await invite(target, people, people.realtor, 'realtor');
  return people;
}
async function invite(target, people, user, role) {
  const email = target.admin(`select email from auth.users where id = '${user}'`)[0].email;
  const invitation = await createInvitation(target.clientFor(people.owner), people.search, people.owner, email, role);
  assert.equal((await acceptInvitation(target.clientFor(user), invitation.token)).success, true);
}
const as = (user, target = db) => target.clientFor(user);
const addHome = (target, user, search, address, extra = {}) => saveHomePersonalAndShared(as(user, target), {
  address, status: 'Saved', checks: { 'exterior:Garage': true }, ratings: { overall: 4 }, reaction: 'love', ...extra,
}, user, search);
const suggest = async (target, people, address) => createRealtorSuggestion(as(people.realtor, target), people.search, { address, listingUrl: `https://example.com/${encodeURIComponent(address)}` });
async function acceptedSuggestion(target, people, address) {
  const created = await suggest(target, people, address);
  assert.equal(created.result, 'created');
  await promoteSuggestion(as(people.owner, target), created.suggestion_id);
  // Both buyers have their own private assessment of the accepted home.
  const view = (await getHomesForUser(as(people.coBuyer, target), people.coBuyer, people.search)).find((home) => home.id === created.home_id);
  await saveHomePersonalAndShared(as(people.coBuyer, target), { ...view, ratings: { overall: 2 }, reaction: 'unsure', notes: 'Buyer note: seller motivated' }, people.coBuyer, people.search);
  return created;
}
const homeExists = (id, target = db) => target.admin(`select count(*)::int as n from public.homes where id = '${id}'`)[0].n === 1;
const statesFor = (homeId, target = db) => target.admin(`select user_id, ratings, reaction from public.home_member_state where home_id = '${homeId}' order by user_id`);
const visible = async (user, table, column, value, target = db) => {
  const { data, error } = await as(user, target).from(table).select(column).eq(column, value);
  assert.equal(error, null, `${table} read should be filtered, not error`);
  return data;
};
// What SuggestionsBoard and the Realtor workspace read (getSuggestions, minus
// the embedded home, which the test client does not support).
const getSuggestions = async (client, searchId) => {
  const { data, error } = await client.from('realtor_suggestions').select('id,status,suggested_by').eq('search_id', searchId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
};
// The Realtor workspace's reads (getRealtorSearchContext), table by table.
async function realtorContext(client, userId, searchId) {
  const membership = await client.from('search_members').select('search_id').eq('search_id', searchId).eq('user_id', userId).eq('role', 'realtor');
  if (!(membership.data || []).length) return null;
  const homes = await getHomesForUser(client, userId, searchId);
  const priorities = (await client.from('search_member_priorities').select('user_id,priorities').eq('search_id', searchId)).data;
  const states = homes.length ? (await client.from('home_member_state').select('home_id,user_id,status,ratings,checks').in('home_id', homes.map((home) => home.id))).data : [];
  return { homes, priorities, states, suggestions: await getSuggestions(client, searchId) };
}
const getRealtorSearchContext = realtorContext;
const PREFLIGHT = readFileSync(new URL('../supabase/realtor-access-preflight.sql', import.meta.url), 'utf8')
  .replace(/^--.*$/gm, '').trim().replace(/;$/, '');
const preflight = (target) => target.admin(PREFLIGHT);
const suggestionStatuses = (searchId, target = db) => Object.fromEntries(target.admin(`select id, status from public.realtor_suggestions where search_id = '${searchId}'`).map((row) => [row.id, row.status]));
const rpcRows = async (user, fn, args, target = db) => as(user, target).rpc(fn, args);

/* -------------------------- connected Realtor (+) -------------------------- */

dbTest('a connected Realtor reads the client search and suggests, but never edits or deletes buyer homes', async () => {
  const p = await household();
  const ownerHome = await addHome(db, p.owner, p.search, '10 Owner Way');
  await savePriorities(as(p.coBuyer), { id: p.search }, p.coBuyer, { searchType: 'purchase', bedsMin: { value: '3', tier: 'must' } });
  const accepted = await acceptedSuggestion(db, p, '11 Suggested St');
  const pending = await suggest(db, p, '12 Pending Pl');

  const context = await getRealtorSearchContext(as(p.realtor), p.realtor, p.search);
  assert.deepEqual(context.homes.map((home) => home.id).sort(), [ownerHome.id, accepted.home_id].sort());
  assert.ok(context.priorities.some((row) => row.user_id === p.coBuyer), 'co-buyer priorities are visible to the connected Realtor');
  assert.ok(context.states.some((row) => row.user_id === p.coBuyer && row.home_id === accepted.home_id));
  assert.ok(context.suggestions.some((row) => row.id === pending.suggestion_id && row.status === 'pending'));

  for (const id of [ownerHome.id, accepted.home_id, pending.home_id]) {
    await deleteHome(as(p.realtor), id);
    assert.ok(homeExists(id), 'the Realtor cannot delete any home in the client search, including their own suggestions');
  }
  assert.equal(statesFor(accepted.home_id).length, 2, 'buyer assessments survive the attempt');
  const update = await as(p.realtor).from('homes').update({ notes: 'overwritten' }).eq('id', accepted.home_id).select('id');
  assert.deepEqual(update.data || [], [], 'the Realtor cannot edit an accepted home they suggested');
  assert.equal(db.admin(`select notes from public.homes where id = '${accepted.home_id}'`)[0].notes, 'Buyer note: seller motivated');
});

/* ----------------------- buyers control accepted homes ---------------------- */

dbTest('the owner and the co-buyer can each delete an accepted Realtor-suggested home; outsiders cannot', async () => {
  const p = await household();
  const first = await acceptedSuggestion(db, p, '20 First Ave');
  const second = await acceptedSuggestion(db, p, '21 Second Ave');
  const pending = await suggest(db, p, '22 Staged Ave');

  await deleteHome(as(p.outsider), first.home_id);
  assert.ok(homeExists(first.home_id), 'an outsider cannot delete it');

  await deleteHome(as(p.owner), first.home_id);
  assert.ok(!homeExists(first.home_id), 'the owner can delete it');
  await deleteHome(as(p.coBuyer), second.home_id);
  assert.ok(!homeExists(second.home_id), 'a co-buyer can delete it');

  // A pending suggestion is the Realtor's proposal, not a buyer home: buyers
  // dismiss it rather than delete it, and the suggestion workflow is unchanged.
  await deleteHome(as(p.owner), pending.home_id);
  assert.ok(homeExists(pending.home_id), 'a staged (pending) suggestion is not deletable as a home');
  assert.equal(db.admin(`select status from public.realtor_suggestions where id = '${pending.suggestion_id}'`)[0].status, 'pending');
});

dbTest('buyers still cannot delete each other\'s own homes (unchanged)', async () => {
  const p = await household();
  const ownerHome = await addHome(db, p.owner, p.search, '30 Mine Rd');
  const coBuyerHome = await addHome(db, p.coBuyer, p.search, '31 Theirs Rd');
  await deleteHome(as(p.coBuyer), ownerHome.id);
  await deleteHome(as(p.owner), coBuyerHome.id);
  assert.ok(homeExists(ownerHome.id) && homeExists(coBuyerHome.id));
  await deleteHome(as(p.coBuyer), coBuyerHome.id);
  assert.ok(!homeExists(coBuyerHome.id), 'the adder can still delete their own home');
});

/* ------------------------------ removed Realtor ----------------------------- */

dbTest('a removed Realtor loses every home, assessment and suggestion; buyers keep accepted homes and provenance', async () => {
  const p = await household();
  const ownerHome = await addHome(db, p.owner, p.search, '40 Keep Ln');
  const accepted = await acceptedSuggestion(db, p, '41 Accepted Ln');
  const pending = await suggest(db, p, '42 Pending Ln');
  db.exec(`insert into public.commute_destinations (search_id, user_id, label, address) values ('${p.search}', '${p.coBuyer}', 'Work', '1 Office Plaza')`);
  const before = { homes: db.admin(`select id, notes from public.homes where search_id = '${p.search}' order by id`), states: statesFor(accepted.home_id) };

  await removeMember(as(p.owner), p.search, p.realtor);

  // Nothing about the search remains readable to the removed Realtor.
  for (const [table, column, value] of [
    ['homes', 'id', accepted.home_id], ['homes', 'id', ownerHome.id], ['homes', 'id', pending.home_id], ['homes', 'search_id', p.search],
    ['home_member_state', 'home_id', accepted.home_id], ['search_member_priorities', 'search_id', p.search],
    ['commute_destinations', 'search_id', p.search], ['realtor_suggestions', 'search_id', p.search], ['searches', 'id', p.search],
  ]) assert.deepEqual(await visible(p.realtor, table, column, value), [], `${table} hidden from the removed Realtor`);
  assert.equal(await getRealtorSearchContext(as(p.realtor), p.realtor, p.search), null);
  assert.deepEqual(await getRealtorRelationships(as(p.realtor), p.realtor), []);
  assert.deepEqual((await rpcRows(p.realtor, 'get_realtor_client_roster', { p_search_ids: [p.search] })).data, []);

  // …nor deletable, writable or suggestible.
  await deleteHome(as(p.realtor), accepted.home_id);
  await assert.rejects(suggest(db, p, '43 Late Ln'), denied);
  await assert.rejects(saveRealtorNote(as(p.realtor), p.search, accepted.home_id, 'still here?'), denied);
  await assert.rejects(suggestHomeTour(as(p.realtor), p.search, accepted.home_id), denied);

  // Buyers' homes, assessments and accepted provenance are untouched.
  assert.deepEqual(db.admin(`select id, notes from public.homes where search_id = '${p.search}' order by id`), before.homes);
  assert.deepEqual(statesFor(accepted.home_id), before.states);
  const ownerHomes = await getHomesForUser(as(p.owner), p.owner, p.search);
  assert.equal(ownerHomes.find((home) => home.id === accepted.home_id).suggestedBy, 'realtor');
  assert.ok(!ownerHomes.some((home) => home.id === pending.home_id), 'a staged home never appears in My Homes');

  // The pending suggestion is withdrawn: hidden, and it can no longer be acted on.
  for (const buyer of [p.owner, p.coBuyer]) {
    const suggestions = await getSuggestions(as(buyer), p.search);
    assert.deepEqual(suggestions.map((row) => row.id), [accepted.suggestion_id], 'only the accepted suggestion remains visible');
  }
  await assert.rejects(promoteSuggestion(as(p.owner), pending.suggestion_id), denied);
  await assert.rejects(dismissSuggestion(as(p.coBuyer), pending.suggestion_id, ['Too far']), denied);
  const direct = await as(p.owner).from('suggestion_dispositions').insert({ suggestion_id: pending.suggestion_id, user_id: p.owner, disposition: 'dismissed' }).select('id');
  assert.ok(direct.error, 'a disposition cannot be written against a withdrawn suggestion');
  assert.equal(db.admin(`select suggestion_staged from public.homes where id = '${pending.home_id}'`)[0].suggestion_staged, true);
  // It is marked withdrawn; nothing was deleted to achieve that.
  assert.deepEqual(suggestionStatuses(p.search), { [accepted.suggestion_id]: 'accepted', [pending.suggestion_id]: 'withdrawn' });

  // Buyers keep full control of the accepted home after the Realtor is gone.
  const view = ownerHomes.find((home) => home.id === accepted.home_id);
  await saveHomePersonalAndShared(as(p.owner), { ...view, price: '500000' }, p.owner, p.search);
  assert.equal(db.admin(`select price from public.homes where id = '${accepted.home_id}'`)[0].price, '500000');
  await deleteHome(as(p.owner), accepted.home_id);
  assert.ok(!homeExists(accepted.home_id));
});

dbTest('a Realtor who leaves is treated exactly like one who was removed', async () => {
  const p = await household();
  const accepted = await acceptedSuggestion(db, p, '50 Leave Ct');
  const pending = await suggest(db, p, '51 Leave Ct');
  await leaveSearch(as(p.realtor), p.realtor, p.search);
  assert.deepEqual(await visible(p.realtor, 'homes', 'id', accepted.home_id), []);
  await deleteHome(as(p.realtor), accepted.home_id);
  assert.ok(homeExists(accepted.home_id));
  assert.deepEqual((await getSuggestions(as(p.owner), p.search)).map((row) => row.id), [accepted.suggestion_id]);
  await assert.rejects(promoteSuggestion(as(p.owner), pending.suggestion_id), denied);
});

dbTest('repeat removal: withdrawn suggestions stay withdrawn when the Realtor returns; withdrawal is idempotent', async () => {
  const p = await household();
  const accepted = await acceptedSuggestion(db, p, '59 Again Dr');
  const pending = await suggest(db, p, '60 Again Dr');
  await removeMember(as(p.owner), p.search, p.realtor);
  const withdrawnAt = db.admin(`select updated_at from public.realtor_suggestions where id = '${pending.suggestion_id}'`)[0].updated_at;
  // Removing someone who is already gone is a harmless no-op.
  await removeMember(as(p.owner), p.search, p.realtor);
  assert.equal(db.admin(`select updated_at from public.realtor_suggestions where id = '${pending.suggestion_id}'`)[0].updated_at, withdrawnAt);
  assert.deepEqual(suggestionStatuses(p.search), { [accepted.suggestion_id]: 'accepted', [pending.suggestion_id]: 'withdrawn' });

  // Invited back: access returns, the old suggestion does not.
  await invite(db, p, p.realtor, 'realtor');
  assert.deepEqual((await getSuggestions(as(p.owner), p.search)).map((row) => row.id), [accepted.suggestion_id]);
  assert.deepEqual((await getSuggestions(as(p.realtor), p.search)).map((row) => row.id), [accepted.suggestion_id], 'hidden from the Realtor too');
  await assert.rejects(promoteSuggestion(as(p.owner), pending.suggestion_id), denied);
  assert.ok(homeExists(accepted.home_id));

  // Suggesting the same listing again is a deliberate new suggestion: the
  // withdrawn record is reopened (never duplicated) and credited to them.
  const again = await suggest(db, p, '60 Again Dr');
  assert.deepEqual([again.result, again.suggestion_id, again.home_id], ['created', pending.suggestion_id, pending.home_id]);
  assert.equal(db.admin(`select count(*)::int as n from public.realtor_suggestions where search_id = '${p.search}'`)[0].n, 2);
  assert.deepEqual((await getSuggestions(as(p.owner), p.search)).map((row) => [row.id, row.status]).sort(), [[accepted.suggestion_id, 'accepted'], [pending.suggestion_id, 'pending']].sort());

  // Removed again: withdrawn again, and still nothing deleted.
  await removeMember(as(p.owner), p.search, p.realtor);
  assert.deepEqual(suggestionStatuses(p.search), { [accepted.suggestion_id]: 'accepted', [pending.suggestion_id]: 'withdrawn' });
  assert.deepEqual((await getSuggestions(as(p.owner), p.search)).map((row) => row.id), [accepted.suggestion_id]);
});

dbTest('another Realtor suggesting a withdrawn listing reopens it under their name', async () => {
  const p = await household();
  const pending = await suggest(db, p, '61 Handover Dr');
  await removeMember(as(p.owner), p.search, p.realtor);
  const next = db.createUser({ email: `next.realtor.${seq}@example.com`, firstName: 'Next' });
  await invite(db, p, next, 'realtor');
  const result = await createRealtorSuggestion(as(next), p.search, { address: '61 Handover Dr', listingUrl: `https://example.com/${encodeURIComponent('61 Handover Dr')}` });
  assert.deepEqual([result.result, result.suggestion_id], ['created', pending.suggestion_id]);
  const [row] = db.admin(`select status, suggested_by, suggested_by_display_name from public.realtor_suggestions where id = '${pending.suggestion_id}'`);
  assert.deepEqual(row, { status: 'pending', suggested_by: next, suggested_by_display_name: 'Next' });
  assert.equal(await promoteSuggestion(as(p.coBuyer), pending.suggestion_id).then((r) => r[0]), pending.home_id);
});

dbTest('only the owner (or the Realtor themselves) can remove a Realtor (unchanged)', async () => {
  const p = await household();
  for (const user of [p.coBuyer, p.outsider]) {
    await removeMember(as(user), p.search, p.realtor);
    assert.equal(db.admin(`select count(*)::int as n from public.search_members where search_id = '${p.search}' and user_id = '${p.realtor}'`)[0].n, 1);
  }
});

dbTest('a Realtor\'s account cannot be deleted out from under buyers\' accepted homes', async () => {
  const p = await household();
  const accepted = await acceptedSuggestion(db, p, '70 Account Way');
  const before = statesFor(accepted.home_id);
  assert.throws(() => db.exec(`delete from auth.users where id = '${p.realtor}'`), /foreign key|violates/i);
  assert.ok(homeExists(accepted.home_id));
  assert.deepEqual(statesFor(accepted.home_id), before);
});

/* ---------------------------- departed co-buyer ---------------------------- */

dbTest('a departed co-buyer loses the search, including homes they added, and the Realtor loses their private data', async () => {
  const p = await household();
  const ownerHome = await addHome(db, p.owner, p.search, '80 Stay St');
  const theirHome = await addHome(db, p.coBuyer, p.search, '81 Added St');
  await savePriorities(as(p.coBuyer), { id: p.search }, p.coBuyer, { searchType: 'purchase', budget: { value: '700000', tier: 'must' } });
  db.exec(`insert into public.commute_destinations (search_id, user_id, label, address) values ('${p.search}', '${p.coBuyer}', 'Gym', '2 Fitness Rd')`);
  const accepted = await acceptedSuggestion(db, p, '82 Suggested St');
  await saveRealtorNote(as(p.realtor), p.search, accepted.home_id, 'Realtor note');
  // The owner keeps working on the home the co-buyer added.
  const ownerView = (await getHomesForUser(as(p.owner), p.owner, p.search)).find((home) => home.id === theirHome.id);
  await saveHomePersonalAndShared(as(p.owner), { ...ownerView, notes: 'Owner note after they left' }, p.owner, p.search);

  await leaveSearch(as(p.coBuyer), p.coBuyer, p.search);

  for (const [table, column, value] of [
    ['homes', 'id', ownerHome.id], ['homes', 'id', theirHome.id], ['homes', 'search_id', p.search], ['searches', 'id', p.search],
    ['realtor_suggestions', 'search_id', p.search], ['realtor_notes', 'search_id', p.search], ['tour_suggestions', 'search_id', p.search],
    ['search_members', 'search_id', p.search],
  ]) assert.deepEqual(await visible(p.coBuyer, table, column, value), [], `${table} hidden from the departed co-buyer`);
  const ownerStates = await as(p.coBuyer).from('home_member_state').select('*').eq('user_id', p.owner);
  assert.deepEqual(ownerStates.data, []);
  const ownerPriorities = await as(p.coBuyer).from('search_member_priorities').select('*').eq('user_id', p.owner);
  assert.deepEqual(ownerPriorities.data, []);
  for (const fn of ['resolve_collaborator_search_context', 'resolve_shared_fact_priority_awareness']) {
    const result = await rpcRows(p.coBuyer, fn, { p_search_id: p.search });
    assert.ok(result.error || !(result.data || []).some((row) => Object.values(row).some((value) => value && value !== p.search)), `${fn} returns nothing for a departed co-buyer`);
  }
  for (const fn of ['resolve_cobuyer_compare_perspectives', 'resolve_cobuyer_lifecycle_signals']) {
    const result = await rpcRows(p.coBuyer, fn, { p_search_id: p.search, p_home_ids: [ownerHome.id, theirHome.id] });
    assert.ok(result.error || (result.data || []).length === 0, `${fn} returns nothing for a departed co-buyer`);
  }

  // Nor can they delete or edit the home they added, which the owner still uses.
  await deleteHome(as(p.coBuyer), theirHome.id);
  assert.ok(homeExists(theirHome.id));
  const edit = await as(p.coBuyer).from('homes').update({ notes: 'gone' }).eq('id', theirHome.id).select('id');
  assert.deepEqual(edit.data || [], []);
  assert.equal(db.admin(`select notes from public.homes where id = '${theirHome.id}'`)[0].notes, 'Owner note after they left');
  assert.ok((await getHomesForUser(as(p.owner), p.owner, p.search)).some((home) => home.id === theirHome.id));

  // The Realtor no longer sees the departed co-buyer's private data…
  const context = await getRealtorSearchContext(as(p.realtor), p.realtor, p.search);
  assert.ok(!context.priorities.some((row) => row.user_id === p.coBuyer), 'priorities');
  assert.ok(!context.states.some((row) => row.user_id === p.coBuyer), 'home assessments');
  const places = await as(p.realtor).from('commute_destinations').select('*').eq('user_id', p.coBuyer);
  assert.deepEqual(places.data, [], 'places');
  // …but still sees the owner's, as before.
  assert.ok(context.states.some((row) => row.user_id === p.owner));

  // Their own data is still theirs (dormant), and returns if they are re-invited.
  assert.equal((await visible(p.coBuyer, 'search_member_priorities', 'search_id', p.search)).length, 1);
  await invite(db, p, p.coBuyer, 'co_buyer');
  assert.ok((await getHomesForUser(as(p.coBuyer), p.coBuyer, p.search)).some((home) => home.id === theirHome.id));
  assert.ok((await getRealtorSearchContext(as(p.realtor), p.realtor, p.search)).priorities.some((row) => row.user_id === p.coBuyer));
});

dbTest('current buyers can delete a home added by a former co-buyer; its impact is limited to that home', async () => {
  const p = await household();
  const second = db.createUser({ email: `second.cobuyer.${seq}@example.com` });
  await invite(db, p, second, 'co_buyer');
  const theirHome = await addHome(db, p.coBuyer, p.search, '85 Former St');
  const keptHome = await addHome(db, p.coBuyer, p.search, '86 Former St');
  const ownerHome = await addHome(db, p.owner, p.search, '87 Owner St');
  for (const user of [p.owner, second]) {
    for (const home of [theirHome, keptHome, ownerHome]) {
      const view = (await getHomesForUser(as(user), user, p.search)).find((row) => row.id === home.id);
      await saveHomePersonalAndShared(as(user), { ...view, ratings: { overall: 3 }, reaction: 'like' }, user, p.search);
    }
  }
  await saveRealtorNote(as(p.realtor), p.search, theirHome.id, 'Note on the former co-buyer home');
  await suggestHomeTour(as(p.realtor), p.search, theirHome.id);

  // While they are still in the search, nobody else may delete their home.
  for (const user of [p.owner, second, p.realtor]) await deleteHome(as(user), theirHome.id);
  assert.ok(homeExists(theirHome.id));

  await leaveSearch(as(p.coBuyer), p.coBuyer, p.search);
  // Neither the Realtor, an outsider, nor the departed adder may delete it now.
  for (const user of [p.realtor, p.outsider, p.coBuyer]) await deleteHome(as(user), theirHome.id);
  assert.ok(homeExists(theirHome.id));

  const others = () => db.admin(`select home_id, user_id, ratings, reaction from public.home_member_state where home_id <> '${theirHome.id}' order by home_id, user_id`);
  const before = others();
  // A current co-buyer (not only the owner) may delete it.
  await deleteHome(as(second), theirHome.id);
  assert.ok(!homeExists(theirHome.id));
  // Impact: that home's assessments (everyone's), Realtor note and tour
  // suggestion go with it; nothing about any other home changes.
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${theirHome.id}'`)[0].n, 0);
  assert.equal(db.admin(`select count(*)::int as n from public.realtor_notes where home_id = '${theirHome.id}'`)[0].n, 0);
  assert.equal(db.admin(`select count(*)::int as n from public.tour_suggestions where home_id = '${theirHome.id}'`)[0].n, 0);
  assert.deepEqual(others(), before);

  // The owner may delete the other one; the owner's own home is still not deletable by the co-buyer.
  await deleteHome(as(p.owner), keptHome.id);
  assert.ok(!homeExists(keptHome.id));
  await deleteHome(as(second), ownerHome.id);
  assert.ok(homeExists(ownerHome.id));
});

dbTest('homes outside any search are unreachable through the API, and searches with homes cannot be orphaned', async () => {
  const p = await household();
  const accepted = await acceptedSuggestion(db, p, '88 Orphan Rd');
  // A search that still has homes cannot be deleted: the home-identity guard
  // refuses the ON DELETE SET NULL, so no new orphan can be created this way.
  const attempt = await as(p.owner).from('searches').delete().eq('id', p.search).select('id');
  assert.ok(attempt.error);
  assert.throws(() => db.exec(`delete from public.searches where id = '${p.search}'`), /immutable/);
  assert.ok(homeExists(accepted.home_id));

  // A legacy orphan (search_id null), added by a removed Realtor and by a buyer:
  // neither adder can read or delete it.
  await removeMember(as(p.owner), p.search, p.realtor);
  db.exec(`insert into public.homes (user_id, search_id, address, notes) values
    ('${p.realtor}', null, '89 Orphan Rd', 'buyer notes'), ('${p.owner}', null, '90 Orphan Rd', 'legacy')`);
  const orphans = db.admin(`select id, user_id from public.homes where address in ('89 Orphan Rd', '90 Orphan Rd')`);
  assert.equal(orphans.length, 2);
  for (const { id, user_id: adder } of orphans) {
    assert.deepEqual(await visible(adder, 'homes', 'id', id), []);
    await deleteHome(as(adder), id);
    assert.ok(homeExists(id), 'kept for an operator to resolve, not deleted');
    const edit = await as(adder).from('homes').update({ notes: 'x' }).eq('id', id).select('id');
    assert.ok(edit.error || (edit.data || []).length === 0);
  }
});

/* ---------------------------- bypass attempts ---------------------------- */

dbTest('direct-write bypasses are refused for Realtors, removed Realtors and outsiders', async () => {
  const p = await household();
  const pending = await suggest(db, p, '90 Bypass Blvd');
  const accepted = await acceptedSuggestion(db, p, '91 Bypass Blvd');

  // Un-staging or re-owning a suggestion directly, instead of via acceptance.
  for (const user of [p.realtor, p.outsider]) {
    for (const patch of [{ suggestion_staged: false }, { user_id: user }, { search_id: db.admin(`select id from public.searches where user_id = '${user}'`)[0].id }]) {
      const result = await as(user).from('homes').update(patch).eq('id', pending.home_id).select('id');
      assert.ok(result.error || (result.data || []).length === 0, `${JSON.stringify(patch)} by ${user === p.realtor ? 'Realtor' : 'outsider'}`);
    }
    for (const patch of [{ status: 'accepted' }, { suggested_by: user }]) {
      const result = await as(user).from('realtor_suggestions').update(patch).eq('id', pending.suggestion_id).select('id');
      assert.ok(result.error || (result.data || []).length === 0);
    }
    // Writing a buyer's private assessment.
    const state = await as(user).from('home_member_state').upsert({ home_id: accepted.home_id, user_id: p.owner, ratings: { overall: 1 } }, { onConflict: 'home_id,user_id' }).select('id');
    assert.ok(state.error);
    // Self-promotion into the search.
    const join = await as(user).from('search_members').insert({ search_id: p.search, user_id: user, role: 'co_buyer' }).select('id');
    assert.ok(join.error);
  }
  assert.equal(db.admin(`select suggestion_staged from public.homes where id = '${pending.home_id}'`)[0].suggestion_staged, true);
  assert.equal(db.admin(`select status from public.realtor_suggestions where id = '${pending.suggestion_id}'`)[0].status, 'pending');

  // A Realtor cannot accept or dismiss on the buyers' behalf; outsiders cannot either.
  for (const user of [p.realtor, p.outsider]) {
    await assert.rejects(promoteSuggestion(as(user), pending.suggestion_id), denied);
    await assert.rejects(dismissSuggestion(as(user), pending.suggestion_id, []), denied);
  }

  // After removal, the Realtor cannot re-add themselves or reach the search by guessing ids.
  await removeMember(as(p.owner), p.search, p.realtor);
  const rejoin = await as(p.realtor).from('search_members').insert({ search_id: p.search, user_id: p.realtor, role: 'realtor' }).select('id');
  assert.ok(rejoin.error);
  await assert.rejects(createRealtorSuggestion(as(p.realtor), p.search, { address: '92 Bypass Blvd' }), denied);
  assert.deepEqual(await visible(p.realtor, 'homes', 'id', accepted.home_id), []);
  // An accepted suggestion stays accepted (idempotent) whoever suggested it.
  // (The test client returns a scalar RPC result as a one-row array.)
  assert.deepEqual(await promoteSuggestion(as(p.owner), accepted.suggestion_id), [accepted.home_id]);
});

/* ------------------------ existing production rows ------------------------ */

dbTest('the migration secures Realtor-added homes and suggestions that already exist, without changing any row', async () => {
  // Build the pre-fix database, create data the old way, then apply the fix.
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const p = await household(legacy);
    const accepted = await acceptedSuggestion(legacy, p, '100 Legacy Rd');
    const pending = await suggest(legacy, p, '101 Legacy Rd');
    const removedPending = await suggest(legacy, p, '102 Legacy Rd');
    const departing = await household(legacy);
    const departedHome = await addHome(legacy, departing.coBuyer, departing.search, '103 Legacy Rd');
    // A Realtor removed before the migration, with a suggestion still pending.
    const gone = await household(legacy);
    const goneAccepted = await acceptedSuggestion(legacy, gone, '105 Legacy Rd');
    const gonePending = await suggest(legacy, gone, '106 Legacy Rd');
    await removeMember(as(gone.owner, legacy), gone.search, gone.realtor);
    assert.equal((await getSuggestions(as(gone.owner, legacy), gone.search)).length, 2, 'pre-fix: the removed Realtor\'s pending suggestion is still shown');

    // The bugs, reproduced on the pre-fix schema.
    await removeMember(as(departing.owner, legacy), departing.search, departing.coBuyer);
    assert.equal((await visible(departing.coBuyer, 'homes', 'id', departedHome.id, legacy)).length, 1, 'pre-fix: a departed co-buyer still reads the home they added');
    await deleteHome(as(p.realtor, legacy), accepted.home_id);
    assert.ok(!homeExists(accepted.home_id, legacy), 'pre-fix: the Realtor deletes an accepted home');
    const again = await acceptedSuggestion(legacy, p, '104 Legacy Rd');
    await deleteHome(as(p.owner, legacy), again.home_id);
    assert.ok(homeExists(again.home_id, legacy), 'pre-fix: the owner cannot delete it');

    const snapshot = () => legacy.admin(`select
      (select json_agg(h order by h.id) from public.homes h) as homes,
      (select json_agg(s order by s.id) from public.home_member_state s) as states,
      (select json_agg(r order by r.id) from public.realtor_suggestions r) as suggestions,
      (select json_agg(m order by m.id) from public.search_members m) as members`)[0];
    const before = snapshot();
    // The read-only preflight: valid SQL, every requirement met, the counts it
    // reports match this data, and it changes nothing.
    const report = preflight(legacy);
    assert.deepEqual(report.filter((row) => row.check === 'required' && row.ok !== true), []);
    const info = (prefix) => report.find((row) => row.item.startsWith(prefix))?.detail;
    assert.match(info('create_realtor_suggestion body'), /^expected: 2026-09-19/);
    assert.match(info('promote_realtor_suggestion body'), /^expected: 2026-09-16/);
    assert.match(info('dismiss_realtor_suggestion body'), /^expected: 2026-09-16/);
    assert.equal(info('pending suggestions whose Realtor already left'), '1');
    assert.equal(info('of those, added by a former co-buyer'), '1');
    assert.ok(report.some((row) => row.section === 3 && row.item.startsWith('homes.homes_select_own')));
    assert.deepEqual(snapshot(), before, 'the preflight writes nothing');
    const applied = legacy.applyFile(MIGRATION);
    assert.equal(applied.error, null);
    assert.deepEqual(snapshot(), before, 'the migration changes no rows');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 'the migration is re-runnable');
    const after = preflight(legacy);
    assert.deepEqual(after.filter((row) => row.check === 'required' && row.ok !== true), []);
    for (const fn of ['create', 'promote', 'dismiss']) {
      assert.match(after.find((row) => row.item === `${fn}_realtor_suggestion body`).detail, /^ALREADY APPLIED/);
    }

    // Existing rows now follow the fixed rules.
    await deleteHome(as(p.realtor, legacy), again.home_id);
    assert.ok(homeExists(again.home_id, legacy), 'the Realtor can no longer delete an existing accepted home');
    await removeMember(as(p.owner, legacy), p.search, p.realtor);
    assert.deepEqual(await visible(p.realtor, 'homes', 'id', again.home_id, legacy), []);
    assert.deepEqual((await getSuggestions(as(p.owner, legacy), p.search)).map((row) => row.status), ['accepted']);
    // Removed after the migration: withdrawn by the trigger.
    assert.equal(suggestionStatuses(p.search, legacy)[pending.suggestion_id], 'withdrawn');
    assert.equal(suggestionStatuses(p.search, legacy)[removedPending.suggestion_id], 'withdrawn');
    await assert.rejects(promoteSuggestion(as(p.owner, legacy), removedPending.suggestion_id), denied);
    // Removed before it: the row stays 'pending' (no backfill) but is hidden
    // and refused; it is marked withdrawn, not shown, if they are invited back.
    assert.equal(suggestionStatuses(gone.search, legacy)[gonePending.suggestion_id], 'pending');
    assert.deepEqual((await getSuggestions(as(gone.owner, legacy), gone.search)).map((row) => row.id), [goneAccepted.suggestion_id]);
    await assert.rejects(promoteSuggestion(as(gone.owner, legacy), gonePending.suggestion_id), denied);
    await invite(legacy, gone, gone.realtor, 'realtor');
    assert.equal(suggestionStatuses(gone.search, legacy)[gonePending.suggestion_id], 'withdrawn');
    assert.deepEqual((await getSuggestions(as(gone.owner, legacy), gone.search)).map((row) => row.id), [goneAccepted.suggestion_id]);
    assert.ok(homeExists(goneAccepted.home_id, legacy));
    await deleteHome(as(p.coBuyer, legacy), again.home_id);
    assert.ok(!homeExists(again.home_id, legacy), 'a buyer can now delete the existing accepted home');
    assert.deepEqual(await visible(departing.coBuyer, 'homes', 'id', departedHome.id, legacy), []);
  } finally {
    legacy.drop();
  }
});

dbTest('the migration refuses to apply over a leftover policy that would keep the old access', () => {
  const drifted = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    drifted.exec(`create policy "hms_select_members" on public.home_member_state for select using (public.can_access_home(home_id, auth.uid()))`);
    const flagged = preflight(drifted).find((row) => row.item.startsWith('no unexpected permissive'));
    assert.deepEqual([flagged.ok, flagged.detail], [false, 'home_member_state.hms_select_members (SELECT)']);
    const applied = drifted.applyFile(MIGRATION);
    assert.match(applied.error || '', /Unexpected policies would keep the old access: home_member_state\.hms_select_members/);
    // Nothing was applied: the transaction rolled back as a whole.
    const [own] = drifted.admin(`select qual from pg_policies where tablename = 'homes' and policyname = 'homes_select_own'`);
    assert.equal(own.qual, '(auth.uid() = user_id)');
    assert.equal(drifted.admin(`select count(*)::int as n from pg_policies where policyname = 'homes_delete_accepted_suggestion'`)[0].n, 0);
  } finally {
    drifted.drop();
  }
});
