// Run from repository root against a disposable, socket-only PostgreSQL cluster.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test, { after, before } from 'node:test';
import { createTestDatabase } from '../../test/support/supabaseDb.mjs';

const host = process.env.FLH_TEST_PGHOST;
assert.ok(process.env.FLH_GUEST_TRANSFER_LOCAL === '1' && host?.startsWith('/'),
  'Use an explicitly authorized disposable local Unix-socket cluster');

const dir = 'docs/founder-qa-phase-1b';
const admin = process.env.FLH_TEST_PGUSER || 'postgres';
const writer = 'flh_guest_writer';
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const json = (value) => quote(JSON.stringify(value)) + '::jsonb';
const preferences = { searchType: 'purchase', onboardingSearchType: 'home_buy' };
const progress = {
  schema: 1, step: 'review',
  completed: ['search_type', 'setup_path', 'basics', 'cat_layout', 'cat_kitchen', 'cat_living',
    'cat_bath', 'cat_garage', 'cat_exterior', 'cat_neighborhood', 'review'],
  answers: { searchType: 'home_buy', setupPath: 'personalize' }, skipped: [],
  startedAt: '2026-11-16T12:00:00.000Z',
};
let db;
let roleCreated = false;

function connection(user, database = db.name) {
  return ['-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', host,
    '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', user, '-d', database];
}

function query(sql, user = admin, database = db.name) {
  const result = spawnSync('psql', connection(user, database), { encoding: 'utf8', input: sql, timeout: 15000 });
  if (result.error) throw result.error;
  return result;
}

function ok(sql, user, database) {
  const result = query(sql, user, database);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function roleSql(user, sql, role = 'authenticated') {
  return `set role ${role}; set request.jwt.claim.sub = ${quote(user)}; ${sql}`;
}

function createAccount({ marker = true, confirmed = true, anonymous = false, realtor = false, expired = false } = {}) {
  const id = randomUUID();
  const draft = randomUUID();
  const secret = randomBytes(32).toString('hex');
  const email = `${id}@example.test`;
  const digest = createHash('sha256').update(`${secret}:${draft}:${email}`).digest('hex');
  const metadata = { ...(marker && { flh_guest_signup_v1: digest }), ...(realtor && { account_entry_intent: 'realtor' }) };
  db.exec(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, is_anonymous, created_at)
    values (${quote(id)}, ${quote(email)}, ${json(metadata)}, ${confirmed ? 'now()' : 'null'},
      ${anonymous}, ${expired ? "now() - interval '8 days'" : 'now()'});`);
  const [{ search }] = db.admin(`select id as search from public.searches where user_id = ${quote(id)}`);
  return { id, draft, secret, email, digest, search };
}

function call(account, { id = account.id, draft = account.draft, secret = account.secret, prefs = preferences, state = progress } = {}) {
  return `select flh_guest_transfer.save_guest_onboarding_v1(
    ${quote(id)}, ${quote(draft)}, ${quote(secret)}, ${json(prefs)}, ${json(state)});`;
}

const save = (account, options) => ok(call(account, options), writer);
const receipt = (account) => db.admin(`select search_id, saved_at from flh_guest_transfer.attempts where user_id = ${quote(account.id)}`);
const details = (account) => db.admin(`select search_id, priorities from public.search_member_priorities where user_id = ${quote(account.id)}`);
const profile = (account) => db.admin(`select onboarding_complete, onboarding_version, onboarding_state
 from public.profiles where id = ${quote(account.id)}`)[0];

function invite(from, to, direction, relationship) {
  const token = randomUUID();
  db.exec(`insert into public.search_invitations (search_id, invited_by, invited_email, token, invitation_direction, relationship_type)
    values (${direction === 'realtor_to_buyer' ? 'null' : quote(from.search)}, ${quote(from.id)}, ${quote(to.email)},
            ${quote(token)}, ${quote(direction)}, ${quote(relationship)});`);
  return direction === 'realtor_to_buyer'
    ? `select success::int from public.approve_realtor_connection(${quote(token)}, ${quote(to.search)});`
    : `select success::int from public.accept_invitation(${quote(token)});`;
}

// Hold an actual open transaction on another connection until the assertion
// is done. The marker arrives only after the statement acquired its locks.
async function session(user, fn) {
  const process = spawn('psql', connection(user), { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  let closed = false;
  process.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  process.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk; });
  const exit = new Promise((resolve) => process.once('close', () => { closed = true; resolve(); }));
  const send = (sql) => process.stdin.write(sql + '\n');
  const wait = async (marker) => {
    for (let i = 0; i < 150 && !closed; i++) {
      if (output.includes(marker)) return;
      await delay(30);
    }
    assert.fail(`Missing ${marker}. Output: ${output}. Errors: ${errors}`);
  };
  try {
    await fn({ send, wait });
  } finally {
    if (!closed) process.stdin.end('rollback;\n');
    await exit;
  }
}

before(() => {
  assert.equal(ok('show listen_addresses;', admin, 'postgres'), '', 'database must have TCP disabled');
  ok(readFileSync(`${dir}/proposed-provision-writer.sql`, 'utf8'), admin, 'postgres');
  roleCreated = true;
  db = createTestDatabase();
  db.exec('alter table auth.users add column email_confirmed_at timestamptz, add column is_anonymous boolean not null default false;');
  const migration = db.applyFile('supabase/migrations/2026-11-18-guest-onboarding-transfer.sql');
  assert.deepEqual(migration, { ok: true, error: null });
});

after(() => {
  db?.drop();
  if (roleCreated) ok('drop role flh_guest_writer;', admin, 'postgres');
});

test('migration, ordered signup capture, and direct-RPC role isolation', () => {
  const account = createAccount();
  assert.deepEqual(receipt(account), [{ search_id: account.search, saved_at: null }]);
  assert.deepEqual(db.admin(`select tgname::text from pg_trigger where tgrelid = 'auth.users'::regclass
     and not tgisinternal order by tgname`).map(({ tgname }) => tgname),
  ['on_auth_user_created', 'zz_flh_guest_transfer_capture_signup']);
  assert.equal(ok(`select count(*) from pg_proc where proname = 'save_guest_onboarding_v1'
    and pronamespace = 'public'::regnamespace;`), '0');
  const malformed = call(account, { prefs: { ...preferences, features: { tiers: { Garage: 'forged' } } } });
  for (const role of ['authenticated', 'anon', 'service_role']) {
    for (const sql of [call(account), malformed, 'set role flh_guest_writer;']) {
      const result = query(`set session authorization ${role}; ${roleSql(account.id, sql, role)}`);
      assert.match(result.stderr, /42501/);
    }
  }
  for (const table of ['flh_guest_transfer.attempts', 'auth.users', 'public.search_member_priorities',
    'public.profiles', 'public.searches']) {
    assert.match(query(`select * from ${table};`, writer).stderr, /42501/);
  }
  assert.match(query('select flh_guest_transfer.capture_signup();', writer).stderr, /42501/);
  assert.match(query(roleSql(account.id, 'select * from public.searches;', 'anon')).stdout, /^$/);
  assert.deepEqual(details(account), []);
});

test('signup proof requires verification, original account, cookie secret and draft ID', () => {
  const account = createAccount({ confirmed: false });
  const other = createAccount();
  const existing = createAccount({ marker: false });
  db.exec(`update auth.users set raw_user_meta_data = ${json({ flh_guest_signup_v1: account.digest })}
    where id = ${quote(existing.id)};`);
  assert.deepEqual(receipt(existing), []);
  assert.deepEqual(receipt(createAccount({ anonymous: true })), []);
  assert.deepEqual(receipt(createAccount({ realtor: true })), []);
  assert.equal(save(account), 'unavailable');
  db.exec(`update auth.users set email_confirmed_at = now() where id = ${quote(account.id)};`);
  assert.equal(save(account, { id: other.id }), 'unavailable');
  assert.equal(save(account, { id: existing.id }), 'unavailable');
  assert.equal(save(account, { secret: '' }), 'unavailable');
  assert.equal(save(account, { secret: randomBytes(32).toString('hex') }), 'unavailable');
  assert.equal(save(account, { draft: randomUUID() }), 'unavailable');
  assert.equal(save(createAccount({ expired: true })), 'expired');
  assert.equal(save(account), 'saved');
  assert.deepEqual(details(other), []);
  assert.deepEqual(details(existing), []);
});

test('replay is idempotent and later edits survive; existing rows and active search block saves', () => {
  const account = createAccount();
  assert.equal(save(account, { state: { ...progress, context: { searchId: randomUUID() } } }), 'invalid_draft');
  assert.equal(save(account), 'saved');
  const initialReceipt = receipt(account);
  const edited = { ...preferences, edited: true };
  db.exec(`update public.search_member_priorities set priorities = ${json(edited)} where user_id = ${quote(account.id)};`);
  assert.equal(save(account), 'already_saved');
  assert.equal(save(account, { prefs: edited }), 'conflict');
  assert.deepEqual(receipt(account), initialReceipt);
  assert.deepEqual(details(account), [{ search_id: account.search, priorities: edited }]);
  assert.equal(profile(account).onboarding_version, 4);
  assert.equal(profile(account).onboarding_state.context.searchId, account.search);

  const existing = createAccount();
  db.exec(`insert into public.search_member_priorities (user_id, search_id, priorities)
    values (${quote(existing.id)}, ${quote(existing.search)}, ${json(edited)});`);
  assert.equal(save(existing), 'conflict');
  assert.deepEqual(details(existing), [{ search_id: existing.search, priorities: edited }]);
  assert.equal(profile(existing).onboarding_complete, false);

  const switching = createAccount();
  db.exec(`update public.profiles set active_search_id = ${quote(account.search)} where id = ${quote(switching.id)};`);
  assert.equal(save(switching), 'conflict');
  assert.deepEqual(details(switching), []);
});

test('simultaneous identical saves serialize through the auth row lock', async () => {
  const account = createAccount();
  await session(writer, async ({ send, wait }) => {
    send(`begin; ${call(account)}`);
    await wait('saved');
    assert.equal(save(account), 'retry');
    send('commit;');
  });
  assert.equal(save(account), 'already_saved');
  assert.equal(details(account).length, 1);
});

const invitationCases = [
  { direction: 'buyer_to_realtor', role: 'co_buyer' },
  { direction: 'buyer_to_realtor', role: 'realtor' },
  { direction: 'realtor_to_buyer', role: 'realtor' },
];
for (const { direction, role } of invitationCases) {
  test(`concurrent acceptance of ${direction} ${role} protects both searches`, async () => {
    const from = createAccount({ marker: false });
    const to = createAccount();
    const acceptance = invite(from, to, direction, role);
    await session(admin, async ({ send, wait }) => {
      send(`begin; ${roleSql(to.id, acceptance)}\n\\echo acceptance_held`);
      await wait('1\nacceptance_held');
      assert.equal(save(to), 'retry');
      send('commit;');
    });
    assert.equal(save(to), 'conflict');
    assert.deepEqual(details(from), []);
    assert.deepEqual(details(to), []);
  });
}

for (const { direction, role } of invitationCases) {
  test(`${direction} ${role} waits when transfer takes the FK key first`, async () => {
    const from = createAccount({ marker: false });
    const to = createAccount();
    const acceptance = invite(from, to, direction, role);
    const queryMarker = 'flh_accept_wait_probe';
    await session(writer, async (saving) => {
      saving.send(`begin; ${call(to)}`);
      await saving.wait('saved');
      await session(admin, async (inviting) => {
        inviting.send(`set application_name = '${queryMarker}'; ${roleSql(to.id, acceptance)}\n\\echo accepted`);
        let blocked = false;
        for (let i = 0; i < 50 && !blocked; i++) {
          blocked = ok(`select exists (select 1 from pg_stat_activity where application_name = '${queryMarker}'
            and wait_event_type = 'Lock' and cardinality(pg_blocking_pids(pid)) > 0);`) === 't';
          if (!blocked) await delay(30);
        }
        saving.send('commit;');
        assert.ok(blocked, 'existing acceptance waits on the transfer');
        await inviting.wait('1\naccepted');
      });
    });
    assert.deepEqual(details(to), [{ search_id: to.search, priorities: preferences }]);
    assert.deepEqual(details(from), []);
  });
}

test('profile switching holds the profile lock and prevents transfer on retry', async () => {
  const account = createAccount();
  const other = createAccount({ marker: false });
  assert.equal(ok(roleSql(account.id, invite(other, account, 'buyer_to_realtor', 'co_buyer'))), '1');
  await session(admin, async ({ send, wait }) => {
    send(`begin; ${roleSql(account.id, `update public.profiles set active_search_id = ${quote(other.search)}
      where id = ${quote(account.id)};`)}\n\\echo switch_held`);
    await wait('switch_held');
    assert.equal(save(account), 'retry');
    send('commit;');
  });
  assert.equal(save(account), 'conflict');
  assert.deepEqual(details(account), []);
});

test('injected fault after priority insert rolls back priorities, profile and receipt', () => {
  const account = createAccount();
  db.exec(`create function public.flh_test_fail_receipt() returns trigger language plpgsql as
    $$ begin raise exception 'injected receipt failure'; end; $$;
    create trigger flh_test_fail_receipt before update on flh_guest_transfer.attempts
    for each row execute function public.flh_test_fail_receipt();`);
  try {
    assert.match(query(call(account), writer).stderr, /injected receipt failure/);
    assert.deepEqual(details(account), []);
    assert.equal(profile(account).onboarding_complete, false);
    assert.equal(receipt(account)[0].saved_at, null);
  } finally {
    db.exec('drop trigger flh_test_fail_receipt on flh_guest_transfer.attempts; drop function public.flh_test_fail_receipt();');
  }
  assert.equal(save(account), 'saved');
});

test('guarded owner autosave cannot overwrite a completed transfer', () => {
  const account = createAccount();
  const pending = createAccount();
  const stale = { ...preferences, budget: { value: '1', tier: 'must' } };
  const autosave = searchId => `select public.save_incomplete_owner_onboarding(
    ${quote(searchId)}, ${json(stale)}, 4::smallint, null);`;
  assert.equal(ok(roleSql(pending.id, autosave(pending.search))), 't');
  assert.equal(save(pending), 'conflict');
  assert.equal(save(account), 'saved');
  assert.equal(ok(roleSql(account.id, autosave(account.search))), 'f');
  assert.equal(ok(roleSql(pending.id, autosave(account.search))), 'f');
  assert.deepEqual(details(account), [{ search_id: account.search, priorities: preferences }]);
});

test('disable SQL closes the only endpoint and preserves data and ordinary signup', () => {
  const account = createAccount();
  assert.equal(save(account), 'saved');
  const previous = receipt(account);
  assert.deepEqual(db.applyFile(`${dir}/proposed-disable.sql`), { ok: true, error: null });
  assert.match(query(call(account), writer).stderr, /42501/);
  assert.deepEqual(receipt(account), previous);
  assert.deepEqual(details(account), [{ search_id: account.search, priorities: preferences }]);
  assert.deepEqual(receipt(createAccount()), []);
});
