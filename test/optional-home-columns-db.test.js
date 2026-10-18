// Optional home columns (OPTIONAL_HOME_COLUMNS, currently laundry_location) on
// every read that selects HOME_SHARED_COLUMNS — direct and embedded.
//
// The production outage: My Homes (homes/(board)/layout.js) loads Realtor
// suggestions with the full home embedded, `homes(${HOME_SHARED_COLUMNS})`.
// On a database without 2026-10-18-laundry-location.sql PostgREST answers
// 42703 "column homes_1.laundry_location does not exist" and the page fails,
// although the direct homes read already fell back. These tests run the real
// getSuggestions — embed included — against real Postgres without the column,
// as buyers and as a Realtor, then with it. Skips the DB part unless
// FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, createRealtorSuggestion, getHomesForUser, getSuggestions, promoteSuggestion,
  saveHomePersonalAndShared, OPTIONAL_HOME_COLUMNS,
} = await import('../src/lib/supabase/collaboration.js');

const MIGRATION = 'supabase/migrations/2026-10-18-laundry-location.sql';
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* ------------------------- pure: the fallback contract ------------------------- */

// A supabase-js-shaped client whose `realtor_suggestions` read answers with
// `respond(selectedColumns)`; every other table returns no rows.
function fakeClient(respond) {
  const selects = [];
  const client = {
    from(table) {
      const query = {
        columns: '',
        select(columns) { query.columns = columns; if (table === 'realtor_suggestions') selects.push(columns); return query; },
        eq() { return query; }, in() { return query; }, order() { return query; },
        then(resolve, reject) {
          const result = table === 'realtor_suggestions' ? respond(query.columns) : { data: [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { client, selects };
}
const SUGGESTION_ROW = { id: 's1', search_id: 'q1', home_id: 'h1', suggested_by: 'r1', suggested_by_display_name: 'Riley', status: 'pending', created_at: '2026-10-18T00:00:00Z', homes: { id: 'h1', address: '1 Test St' } };
// Exactly what PostgREST returns for the embed on a database without the column.
const MISSING_EMBEDDED_LAUNDRY = { code: '42703', details: null, hint: null, message: 'column homes_1.laundry_location does not exist' };

test('getSuggestions retries without an optional column when the embedded read reports 42703 homes_1.laundry_location', async () => {
  const { client, selects } = fakeClient((columns) => (columns.includes('laundry_location')
    ? { data: null, error: MISSING_EMBEDDED_LAUNDRY }
    : { data: [SUGGESTION_ROW], error: null }));
  const suggestions = await getSuggestions(client, 'q1');
  assert.equal(selects.length, 2, 'one retry, no more');
  assert.match(selects[0], /homes\([^)]*laundry_location/);
  assert.doesNotMatch(selects[1], /laundry_location/);
  assert.equal(suggestions[0].home.address, '1 Test St');
  assert.equal(suggestions[0].home.laundryLocation, undefined, 'unknown to this database: hidden, not Unknown');
});

test('getSuggestions does not suppress genuine database errors', async () => {
  const genuine = [
    { code: '42703', message: 'column homes_1.garage_type does not exist' }, // a required (Match-adjacent) column: fail visibly
    { code: '42501', message: 'permission denied for table homes' },
    { code: '42P01', message: 'relation "public.realtor_suggestions" does not exist' },
    { code: 'PGRST301', message: 'JWT expired' },
    { message: 'Failed to fetch' },
  ];
  for (const error of genuine) {
    const { client, selects } = fakeClient(() => ({ data: null, error }));
    await assert.rejects(getSuggestions(client, 'q1'), (thrown) => thrown === error, error.message);
    assert.equal(selects.length, 1, `no retry for: ${error.message}`);
  }
  // The retry itself failing is reported, not swallowed.
  const second = { code: '42501', message: 'permission denied for table homes' };
  const { client } = fakeClient((columns) => ({ data: null, error: columns.includes('laundry_location') ? MISSING_EMBEDDED_LAUNDRY : second }));
  await assert.rejects(getSuggestions(client, 'q1'), (thrown) => thrown === second);
});

// Every runtime read or write that names the full shared projection must go
// through the optional-column fallback. A new `homes(${HOME_SHARED_COLUMNS})`
// embed or `.select(HOME_SHARED_COLUMNS)` elsewhere fails here first.
test('every HOME_SHARED_COLUMNS use in src goes through the optional-column fallback', () => {
  const files = [];
  const walk = (dir) => readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(c?js|jsx|mjs)$/.test(name)) files.push(path);
  });
  walk(new URL('../src', import.meta.url).pathname);
  const uses = files.flatMap((file) => readFileSync(file, 'utf8').split('\n').map((line, index) => ({ file, line: index + 1, text: line }))
    .filter(({ text }) => /\bHOME_SHARED_COLUMNS\b(?!_)/.test(text) && !/^\s*(?:\/\/|\*)/.test(text)));
  // The definition, and the one place that reads with it: withOptionalHomeColumns.
  const sanctioned = uses.filter(({ text }) => /^export const HOME_SHARED_COLUMNS =/.test(text.trim())
    || text.trim() === 'const result = await read(HOME_SHARED_COLUMNS);');
  const unguarded = uses.filter((use) => !sanctioned.includes(use)).map(({ file, line, text }) => `${file.split('/src/')[1]}:${line}: ${text.trim()}`);
  // The full-row write keeps its own drop-the-column retry (saveHomePersonalAndShared).
  const writes = unguarded.filter((entry) => /from\('homes'\)\.(?:update|insert)\(/.test(entry));
  assert.equal(writes.length, 2, 'the two full-row writes (update / insert) in saveHomePersonalAndShared');
  assert.match(read('src/lib/supabase/collaboration.js'), /const missing = missingOptionalColumn\(sharedError\);/);
  assert.deepEqual(unguarded.filter((entry) => !writes.includes(entry)), []);
});

test('the release checklist no longer claims every read path tolerates a missing column', () => {
  const checklist = read('docs/home-overlay-release-checklist.md');
  assert.doesNotMatch(checklist, /both orders are safe/);
  assert.match(checklist, /migration first/i);
});

/* ------------------------------ real Postgres ------------------------------ */

let seq = 0;
async function household(target) {
  seq += 1;
  const user = (name) => target.createUser({ email: `${name}.optional.${seq}@example.com`, firstName: name });
  const people = { owner: user('owner'), coBuyer: user('cobuyer'), realtor: user('realtor') };
  people.search = target.admin(`select id from public.searches where user_id = '${people.owner}'`)[0].id;
  for (const [member, role] of [[people.coBuyer, 'co_buyer'], [people.realtor, 'realtor']]) {
    const email = target.admin(`select email from auth.users where id = '${member}'`)[0].email;
    const invitation = await createInvitation(target.clientFor(people.owner), people.search, people.owner, email, role);
    assert.equal((await acceptInvitation(target.clientFor(member), invitation.token)).success, true);
  }
  return people;
}

// What My Homes' layout reads (homes/(board)/layout.js), in the same order of
// importance: the homes, then the Realtor suggestions with their homes embedded.
async function myHomesReads(target, people, user) {
  const client = target.clientFor(user);
  return { homes: await getHomesForUser(client, user, people.search), suggestions: await getSuggestions(client, people.search) };
}

async function seed(target, people) {
  const own = await saveHomePersonalAndShared(target.clientFor(people.owner), { address: '1 Owner Way', status: 'Saved', checks: {}, ratings: {}, garageSpaces: '2' }, people.owner, people.search);
  const pending = await createRealtorSuggestion(target.clientFor(people.realtor), people.search, { address: '2 Pending Pl', listingUrl: 'https://example.com/2' });
  const accepted = await createRealtorSuggestion(target.clientFor(people.realtor), people.search, { address: '3 Accepted Ave', listingUrl: 'https://example.com/3' });
  await promoteSuggestion(target.clientFor(people.owner), accepted.suggestion_id);
  return { own, pending, accepted };
}

dbTest('without the laundry_location column: My Homes and the Realtor suggestions load for buyers and the Realtor', async () => {
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    assert.deepEqual(legacy.admin(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'homes' and column_name = 'laundry_location'`), []);
    const people = await household(legacy);
    const { own, pending, accepted } = await seed(legacy, people);

    // The production failure, reproduced on the raw embed: PostgREST's alias, 42703.
    const raw = await legacy.clientFor(people.owner).from('realtor_suggestions').select(`id,homes(id,${OPTIONAL_HOME_COLUMNS.join(',')})`).eq('search_id', people.search);
    assert.equal(raw.error?.code, '42703');
    assert.match(raw.error.message, /column homes_1\.laundry_location does not exist/);

    for (const user of [people.owner, people.coBuyer]) {
      const { homes, suggestions } = await myHomesReads(legacy, people, user);
      assert.deepEqual(homes.map((home) => home.id).sort(), [own.id, accepted.home_id].sort());
      assert.deepEqual(suggestions.map((row) => row.id).sort(), [pending.suggestion_id, accepted.suggestion_id].sort());
      const embedded = suggestions.find((row) => row.id === pending.suggestion_id).home;
      assert.equal(embedded.address, '2 Pending Pl', 'the embedded home is still read');
      assert.equal(embedded.laundryLocation, undefined, 'unknown to this database: hidden, never Unknown');
      assert.equal(homes.find((home) => home.id === own.id).garageSpaces, '2');
    }
    // The Realtor workspace reads the same suggestions (getRealtorSearchContext).
    const realtorSuggestions = await getSuggestions(legacy.clientFor(people.realtor), people.search);
    assert.deepEqual(realtorSuggestions.map((row) => row.id).sort(), [pending.suggestion_id, accepted.suggestion_id].sort());
    assert.equal(realtorSuggestions.find((row) => row.id === pending.suggestion_id).home.address, '2 Pending Pl');

    // A genuine error on the same path still fails visibly.
    await assert.rejects(getSuggestions({ from: () => legacy.clientFor(people.owner).from('no_such_table') }, people.search), (error) => error.code === '42P01' && /no_such_table/.test(error.message));

    // Applying the migration afterwards: the same reads now carry the column as Unknown.
    assert.equal(legacy.applyFile(MIGRATION).error, null);
    const migrated = await myHomesReads(legacy, people, people.owner);
    assert.equal(migrated.suggestions.find((row) => row.id === pending.suggestion_id).home.laundryLocation, null);
    assert.equal(migrated.homes.find((home) => home.id === own.id).laundryLocation, null);
  } finally {
    legacy.drop();
  }
});

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('with the laundry_location column: one read, values intact, Realtor sees only what RLS allows', async () => {
  const people = await household(db);
  const { pending, accepted } = await seed(db, people);
  db.exec(`update public.homes set laundry_location = 'basement' where id = '${pending.home_id}'`);
  const { suggestions } = await myHomesReads(db, people, people.owner);
  assert.equal(suggestions.find((row) => row.id === pending.suggestion_id).home.laundryLocation, 'basement');
  assert.equal(suggestions.find((row) => row.id === accepted.suggestion_id).home.laundryLocation, null);
  const realtor = await getSuggestions(db.clientFor(people.realtor), people.search);
  assert.equal(realtor.find((row) => row.id === pending.suggestion_id).home.laundryLocation, 'basement');
  // No retry happened: a database that has the column is read once.
  let reads = 0;
  const counting = { from: (table) => { if (table === 'realtor_suggestions') reads += 1; return db.clientFor(people.owner).from(table); } };
  await getSuggestions(counting, people.search);
  assert.equal(reads, 1);
});
