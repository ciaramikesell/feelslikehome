// Shared property facts (price, beds, Pets Allowed, …) belong to the home, not
// to whoever added it. Every decision-maker in a search (the owner and each
// co-buyer/co-renter) can edit them on any home in that search; nobody gains
// the ability to edit another person's priorities, ratings or Yes/No checks;
// Realtors and outsiders still can't edit shared facts at all.
//
// The bug: saving an existing home used an upsert (INSERT … ON CONFLICT), and
// Postgres applies the INSERT policy (only the adder may insert) even when the
// row exists, so a co-buyer's save of an owner-added home was rejected.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, resolvePriorities, saveHomePersonalAndShared, savePriorities,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('existing homes are saved with an UPDATE of their shared facts; new homes with an INSERT', () => {
  const fn = read('src/lib/supabase/collaboration.js').match(/export async function saveHomePersonalAndShared\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /const \{ id: homeId, user_id: _adder, search_id: _search, \.\.\.sharedFacts \} = sharedRow;/);
  assert.match(fn, /\? await supabase\.from\('homes'\)\.update\(sharedFacts\)\.eq\('id', homeId\)\.select\(HOME_SHARED_COLUMNS\)\.single\(\)/);
  assert.match(fn, /: await supabase\.from\('homes'\)\.insert\(sharedRow\)\.select\(HOME_SHARED_COLUMNS\)\.single\(\);/);
  assert.doesNotMatch(fn, /\.upsert\(sharedRow\)/);
});

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.facts@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.facts@example.com' });
  ids.realtor = db.createUser({ email: 'realtor.facts@example.com' });
  ids.outsider = db.createUser({ email: 'outsider.facts@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  for (const [email, role, user] of [['cobuyer.facts@example.com', 'co_buyer', ids.coBuyer], ['realtor.facts@example.com', 'realtor', ids.realtor]]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, email, role);
    assert.equal((await acceptInvitation(db.clientFor(user), invitation.token)).success, true);
  }
});
after(() => db?.drop());

const homeRow = (id) => db.admin(`select user_id, search_id, price, pets_allowed, in_unit_laundry from public.homes where id = '${id}'`)[0];
const stateRows = (homeId) => db.admin(`select user_id, checks, ratings, reaction from public.home_member_state where home_id = '${homeId}' order by user_id`);
const viewOf = async (user) => (await getHomesForUser(db.clientFor(user), user, ids.search))[0];
const denied = (error) => /row-level security|permission denied|immutable|expected one row/i.test(error?.message || String(error));

dbTest('a co-buyer edits shared facts on a home the owner added; ownership and everyone\'s personal state stay put', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), {
    address: '1 Kercheval Ave', price: '2400', status: 'Saved', checks: { 'exterior:Parking': true }, ratings: {}, reaction: 'love',
  }, ids.owner, ids.search);
  const ownerStateBefore = stateRows(added.id);

  const coBuyerView = await viewOf(ids.coBuyer);
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), {
    ...coBuyerView, price: '2300', petsAllowed: true, inUnitLaundry: false, checks: { 'exterior:Parking': 'no' },
  }, ids.coBuyer, ids.search);
  assert.equal(saved.id, added.id, 'the same home, never a duplicate');

  assert.deepEqual(homeRow(added.id), { user_id: ids.owner, search_id: ids.search, price: '2300', pets_allowed: true, in_unit_laundry: false });
  assert.equal(db.admin(`select count(*)::int as n from public.homes where search_id = '${ids.search}'`)[0].n, 1);
  // The owner's own Yes/No and reaction are untouched; the co-buyer's answer is theirs alone.
  const states = Object.fromEntries(stateRows(added.id).map((row) => [row.user_id, row]));
  assert.deepEqual(states[ids.owner], ownerStateBefore.find((row) => row.user_id === ids.owner));
  assert.deepEqual(states[ids.owner].checks, { 'exterior:Parking': true });
  assert.deepEqual(states[ids.coBuyer].checks, { 'exterior:Parking': 'no' });
  // Both see the same shared facts.
  assert.equal((await viewOf(ids.owner)).petsAllowed, true);
  assert.equal((await viewOf(ids.owner)).price, '2300');
});

dbTest('the owner edits shared facts on a home a co-buyer added', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), { address: '2 Lake Shore Rd', status: 'Saved', checks: {}, ratings: {} }, ids.coBuyer, ids.search);
  const ownerView = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).find((home) => home.id === added.id);
  await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...ownerView, utilitiesIncluded: true }, ids.owner, ids.search);
  assert.equal(db.admin(`select utilities_included, user_id from public.homes where id = '${added.id}'`)[0].utilities_included, true);
  assert.equal(db.admin(`select user_id from public.homes where id = '${added.id}'`)[0].user_id, ids.coBuyer, 'the adder never changes');
});

dbTest('nobody can take over a home\'s identity, even with direct writes', async () => {
  const [home] = db.admin(`select id from public.homes where user_id = '${ids.owner}' limit 1`);
  for (const patch of [{ user_id: ids.coBuyer }, { search_id: db.admin(`select id from public.searches where user_id = '${ids.coBuyer}'`)[0].id }]) {
    const { error } = await db.clientFor(ids.coBuyer).from('homes').update(patch).eq('id', home.id).select('id');
    assert.ok(denied(error), JSON.stringify(patch));
  }
  assert.equal(homeRow(home.id).user_id, ids.owner);
});

dbTest('Realtors and outsiders still cannot edit shared facts', async () => {
  const [home] = db.admin(`select id from public.homes where user_id = '${ids.owner}' limit 1`);
  const before = homeRow(home.id);
  const realtorView = await viewOf(ids.realtor).catch(() => null);
  await assert.rejects(saveHomePersonalAndShared(db.clientFor(ids.realtor), { ...(realtorView || { id: home.id, address: '1 Kercheval Ave', checks: {}, ratings: {} }), id: home.id, userId: ids.owner, price: '1' }, ids.realtor, ids.search), denied);
  await assert.rejects(saveHomePersonalAndShared(db.clientFor(ids.outsider), { id: home.id, userId: ids.owner, address: '1 Kercheval Ave', price: '1', checks: {}, ratings: {} }, ids.outsider, ids.search), denied);
  assert.deepEqual(homeRow(home.id), before);
  // …and cannot add homes to the search either.
  await assert.rejects(saveHomePersonalAndShared(db.clientFor(ids.outsider), { address: '9 Nowhere', checks: {}, ratings: {} }, ids.outsider, ids.search), denied);
});

dbTest('editing shared facts never grants access to another person\'s priorities, ratings or checks', async () => {
  const [home] = db.admin(`select id from public.homes where user_id = '${ids.owner}' limit 1`);
  await savePriorities(db.clientFor(ids.owner), { id: ids.search }, ids.owner, { searchType: 'rental', budget: { value: '2500', tier: 'must' } });
  const ownerPriorities = db.admin(`select priorities from public.search_member_priorities where user_id = '${ids.owner}'`)[0].priorities;

  // Overwrite the owner's personal state or priorities: refused.
  const impersonation = await db.clientFor(ids.coBuyer).from('home_member_state').upsert({ home_id: home.id, user_id: ids.owner, checks: { 'exterior:Parking': 'no' }, ratings: { x: 1 } }, { onConflict: 'home_id,user_id' });
  assert.ok(impersonation.error, 'cannot write the owner\'s Yes/No or ratings');
  const hijack = await db.clientFor(ids.coBuyer).from('search_member_priorities').update({ priorities: { hijacked: true } }).eq('user_id', ids.owner).select('user_id');
  assert.ok(hijack.error || (hijack.data || []).length === 0, 'cannot write the owner\'s priorities');
  await assert.rejects(savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.owner, { hijacked: true }));

  assert.deepEqual(db.admin(`select priorities from public.search_member_priorities where user_id = '${ids.owner}'`)[0].priorities, ownerPriorities);
  assert.deepEqual(db.admin(`select checks from public.home_member_state where home_id = '${home.id}' and user_id = '${ids.owner}'`)[0].checks, { 'exterior:Parking': true });
  assert.equal((await resolvePriorities(db.clientFor(ids.owner), { id: ids.search, user_id: ids.owner }, ids.owner)).budget.value, '2500');
});
