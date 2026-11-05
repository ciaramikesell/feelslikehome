// Match Reveal persistence (2026-11-05-match-reveals.sql) against real Postgres:
// one reveal per buyer and home, owners and co-buyers independently, safe under
// repeated and concurrent claims, private to each buyer, and never earned by a
// Realtor, a removed member, an outsider or a pending suggestion. Skips unless
// FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, createRealtorSuggestion, saveHomePersonalAndShared, claimMatchReveal, removeMember,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const MIGRATION = 'supabase/migrations/2026-11-05-match-reveals.sql';

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

let seq = 0;
async function household(target = db) {
  seq += 1;
  const user = (name) => target.createUser({ email: `${name}.reveal${seq}@example.com`, firstName: name });
  const people = { owner: user('owner'), coBuyer: user('cobuyer'), realtor: user('realtor'), outsider: user('outsider') };
  people.search = target.admin(`select id from public.searches where user_id = '${people.owner}'`)[0].id;
  for (const [id, role] of [[people.coBuyer, 'co_buyer'], [people.realtor, 'realtor']]) {
    const email = target.admin(`select email from auth.users where id = '${id}'`)[0].email;
    const invitation = await createInvitation(target.clientFor(people.owner), people.search, people.owner, email, role);
    assert.equal((await acceptInvitation(target.clientFor(id), invitation.token)).success, true);
  }
  people.home = (await saveHomePersonalAndShared(target.clientFor(people.owner), { address: `${seq} Reveal Rd, Troy, MI 48084`, status: 'Saved', checks: {}, ratings: {} }, people.owner, people.search)).id;
  return people;
}
const rpc = (target, userId, homeId) => target.clientFor(userId).rpc('claim_match_reveal', { p_home_id: homeId });
const denied = (error) => error && (error.code === '42501' || /not available|Authentication required|permission denied/i.test(error.message));

dbTest('once per buyer and home: the first claim wins, every later one is false, across sessions', async () => {
  const p = await household();
  assert.equal(await claimMatchReveal(db.clientFor(p.owner), p.home), true);
  assert.equal(await claimMatchReveal(db.clientFor(p.owner), p.home), false, 'a reload / second device / reinstall');
  assert.equal(await claimMatchReveal(db.clientFor(p.owner), p.home), false);
  assert.equal(db.admin(`select count(*)::int as n from public.match_reveals where home_id = '${p.home}' and user_id = '${p.owner}'`)[0].n, 1);
});

dbTest('owner and co-buyer each earn their own reveal on the same shared home', async () => {
  const p = await household();
  assert.equal(await claimMatchReveal(db.clientFor(p.coBuyer), p.home), true, 'the co-buyer first');
  assert.equal(await claimMatchReveal(db.clientFor(p.owner), p.home), true, 'the owner is independent');
  assert.equal(await claimMatchReveal(db.clientFor(p.coBuyer), p.home), false);
  // A second home is a separate reveal.
  const other = (await saveHomePersonalAndShared(db.clientFor(p.owner), { address: `${seq} Second Rd, Troy, MI 48084`, status: 'Saved', checks: {}, ratings: {} }, p.owner, p.search)).id;
  assert.equal(await claimMatchReveal(db.clientFor(p.owner), other), true);
});

dbTest('rapid repeated saves and several open tabs: exactly one claim wins', async () => {
  const p = await household();
  const results = await Promise.all(Array.from({ length: 8 }, () => claimMatchReveal(db.clientFor(p.owner), p.home)));
  assert.equal(results.filter(Boolean).length, 1, JSON.stringify(results));
});

dbTest('a Realtor, an outsider, anon and a removed co-buyer can never claim; the helper just says false', async () => {
  const p = await household();
  for (const who of ['realtor', 'outsider']) {
    const { error } = await rpc(db, p[who], p.home);
    assert.ok(denied(error), `${who}: ${error?.message}`);
    assert.equal(await claimMatchReveal(db.clientFor(p[who]), p.home), false, `${who} via the helper`);
  }
  // anon: no execute privilege at all.
  assert.equal(db.admin(`select has_function_privilege('anon', 'public.claim_match_reveal(uuid)', 'execute') as ok`)[0].ok, false);
  await removeMember(db.clientFor(p.owner), p.search, p.coBuyer);
  assert.ok(denied((await rpc(db, p.coBuyer, p.home)).error), 'removed co-buyer');
  assert.equal(db.admin(`select count(*)::int as n from public.match_reveals where home_id = '${p.home}'`)[0].n, 0);
});

dbTest('a pending Realtor suggestion earns nothing until a buyer accepts it', async () => {
  const p = await household();
  const created = await createRealtorSuggestion(db.clientFor(p.realtor), p.search, { address: `${seq} Suggested Way, Troy, MI 48084`, listingUrl: `https://example.com/reveal-${seq}` });
  assert.equal(created.result, 'created');
  assert.ok(denied((await rpc(db, p.owner, created.home_id)).error));
});

dbTest('the reveal record is private: nobody can read or write the table directly, and it never touches answers', async () => {
  const p = await household();
  assert.equal(await claimMatchReveal(db.clientFor(p.owner), p.home), true);
  for (const who of ['owner', 'coBuyer', 'realtor', 'outsider']) {
    const read = await db.clientFor(p[who]).from('match_reveals').select('*');
    assert.ok(read.error && /permission denied/i.test(read.error.message), `${who} read: ${JSON.stringify(read)}`);
    const write = await db.clientFor(p[who]).from('match_reveals').insert({ home_id: p.home, user_id: p[who] });
    assert.ok(write.error, `${who} direct insert`);
  }
  const state = db.admin(`select checks, ratings from public.home_member_state where home_id = '${p.home}' and user_id = '${p.owner}'`)[0];
  assert.deepEqual([state.checks, state.ratings], [{}, {}]);
});

dbTest('deleting a home removes its reveals; the migration re-runs cleanly and only adds a table and a function', async () => {
  const p = await household();
  assert.equal(await claimMatchReveal(db.clientFor(p.owner), p.home), true);
  db.exec(`delete from public.homes where id = '${p.home}'`);
  assert.equal(db.admin(`select count(*)::int as n from public.match_reveals where home_id = '${p.home}'`)[0].n, 0);
  assert.equal(db.applyFile(MIGRATION).error, null, 're-runnable');
  const fn = db.admin(`select p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
    from pg_proc p where p.proname = 'claim_match_reveal'`)[0];
  assert.deepEqual([fn.prosecdef, fn.proconfig, fn.auth, fn.anon], [true, ['search_path=""'], true, false]);
  assert.equal(db.admin(`select count(*)::int as n from pg_policies where tablename = 'match_reveals'`)[0].n, 0);
});

dbTest('before the migration the app degrades to "no reveal", never an error in the save path', async () => {
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const owner = legacy.createUser({ email: 'owner.reveal.legacy@example.com', firstName: 'Owner' });
    const search = legacy.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
    const home = (await saveHomePersonalAndShared(legacy.clientFor(owner), { address: '1 Legacy Ln, Troy, MI 48084', status: 'Saved', checks: {}, ratings: {} }, owner, search)).id;
    assert.equal(await claimMatchReveal(legacy.clientFor(owner), home), false);
  } finally {
    legacy.drop();
  }
});
