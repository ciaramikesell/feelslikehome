import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import {
  FREE_HOME_LIMIT, PAYWALL_ERROR_CODE, SEARCH_UNLOCK_PRODUCT, checkHomeAdmission, clearPendingAdmission,
  getSearchEntitlement, isPaywallError, normalizeEntitlement, paywallError, readPendingAdmission, savePendingAdmission,
} from '../src/lib/entitlements.js';
import { PURCHASE_UNAVAILABLE, getPurchaseProvider } from '../src/lib/purchases.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/2026-09-30-search-entitlements-phase-1.sql');
const migrationCode = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const paywall = read('src/components/Paywall.jsx');
const purchases = read('src/lib/purchases.js');
const homesBoard = read('src/components/HomesBoard.jsx');
const homeModal = read('src/components/HomeModal.jsx');
const suggestionsBoard = read('src/components/SuggestionsBoard.jsx');
const realtorSuggest = read('src/components/RealtorSuggestHome.jsx');

function rpcClient(responses) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return responses[name] ?? { data: null, error: { message: 'missing' } }; } };
}

// ---------------------------------------------------------------- client lib

test('the free allowance is three homes and the price is display-only', () => {
  assert.equal(FREE_HOME_LIMIT, 3);
  assert.equal(SEARCH_UNLOCK_PRODUCT.displayPrice, '$6.99');
  assert.ok(Object.isFrozen(SEARCH_UNLOCK_PRODUCT));
});

test('paywall errors are recognized from the server SQLSTATE or message only', () => {
  assert.equal(PAYWALL_ERROR_CODE, 'FL402');
  assert.equal(isPaywallError({ code: 'FL402', message: 'paywall_required' }), true);
  assert.equal(isPaywallError({ message: 'paywall_required' }), true);
  assert.equal(isPaywallError(paywallError()), true);
  assert.equal(isPaywallError({ code: '42501', message: 'new row violates row-level security policy' }), false);
  assert.equal(isPaywallError(null), false);
});

test('entitlement reads normalize the RPC row and never default to unlocked', async () => {
  const row = { search_id: 's1', status: 'free', unlocked_at: null, source: null, free_home_limit: 3, free_homes_used: 3, free_homes_remaining: 0 };
  assert.deepEqual(normalizeEntitlement(row), { searchId: 's1', unlocked: false, unlockedAt: null, source: null, freeHomeLimit: 3, freeHomesUsed: 3, freeHomesRemaining: 0 });
  const client = rpcClient({ get_search_entitlement: { data: [row], error: null } });
  assert.equal((await getSearchEntitlement(client, 's1')).unlocked, false);
  assert.deepEqual(client.calls[0], { name: 'get_search_entitlement', args: { p_search_id: 's1' } });
  // Unavailable (e.g. migration not applied) is null — not a pass.
  assert.equal(await getSearchEntitlement(rpcClient({}), 's1'), null);
  assert.equal(normalizeEntitlement({ search_id: 's1', status: 'bogus' }).unlocked, false);
});

test('admission preflight returns the server answer or null, never a synthesized allowance', async () => {
  for (const answer of ['existing', 'unlocked', 'free', 'paywall_required']) {
    const client = rpcClient({ check_home_admission: { data: answer, error: null } });
    assert.equal(await checkHomeAdmission(client, 's1', { listingUrl: 'https://x.test/1', address: '1 Main' }), answer);
    assert.deepEqual(client.calls[0].args, { p_search_id: 's1', p_listing_url: 'https://x.test/1', p_address: '1 Main' });
  }
  assert.equal(await checkHomeAdmission(rpcClient({ check_home_admission: { data: 'paid', error: null } }), 's1', {}), null);
  assert.equal(await checkHomeAdmission(rpcClient({}), 's1', {}), null);
});

test('the pending admission intent is preserved for the session and carries no entitlement', () => {
  const store = new Map();
  globalThis.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
  try {
    savePendingAdmission({ searchId: 's1', kind: 'add_home', listingUrl: 'https://x.test/4', address: '4 Main', unlocked: true });
    const intent = readPendingAdmission();
    assert.equal(intent.listingUrl, 'https://x.test/4');
    assert.equal(intent.kind, 'add_home');
    assert.equal('unlocked' in intent, false);
    savePendingAdmission({ searchId: 's1', kind: 'suggestion_promotion', suggestionId: 'sg1' });
    assert.equal(readPendingAdmission().suggestionId, 'sg1');
    clearPendingAdmission();
    assert.equal(readPendingAdmission(), null);
    // Storage failures never throw into the UI.
    globalThis.window = { sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } };
    savePendingAdmission({ searchId: 's1' });
    assert.equal(readPendingAdmission(), null);
    clearPendingAdmission();
  } finally { delete globalThis.window; }
});

test('the Phase 1 purchase provider can never report a purchase or restore as successful', async () => {
  const provider = getPurchaseProvider();
  assert.equal(provider.available, false);
  assert.equal((await provider.purchaseSearchUnlock({ searchId: 's1' })).status, PURCHASE_UNAVAILABLE);
  assert.equal((await provider.restorePurchases({ searchId: 's1' })).status, PURCHASE_UNAVAILABLE);
  assert.doesNotMatch(purchases, /status:\s*['"](success|purchased|restored|unlocked)['"]/);
  assert.doesNotMatch(purchases, /paid\s*[:=]\s*true|unlocked\s*[:=]\s*true/);
  assert.match(purchases, /PHASE 2 CONNECTION POINT/);
  assert.match(purchases, /record_search_entitlement_unlock/);
});

// ------------------------------------------------------------------- paywall

test('the paywall uses the approved copy', () => {
  for (const copy of [
    'You’ve found more than three worth considering.',
    'Keep comparing without limits. Unlock Feels Like Home once and use it for the rest of your home search.',
    "'Unlimited homes'", "'Keep comparing every serious contender.'",
    "'Search together'", "'Your co-buyer stays included.'",
    "'One purchase. No subscription.'", 'once. That’s it.',
    '`Unlock Feels Like Home — ${SEARCH_UNLOCK_PRODUCT.displayPrice}`',
    "'Restore purchase'", 'Your first three homes are always free.',
  ]) assert.ok(paywall.includes(copy), `missing paywall copy: ${copy}`);
});

test('paywall buttons only report unlocked when the server entitlement says so', () => {
  assert.doesNotMatch(paywall, /unlocked:\s*true|status:\s*'unlocked'/);
  const unlockCalls = paywall.match(/onUnlocked\?\.\(entitlement\)/g) || [];
  assert.equal(unlockCalls.length, 2);
  assert.equal((paywall.match(/if \(entitlement\?\.unlocked\) \{/g) || []).length, 2);
  assert.match(paywall, /getSearchEntitlement\(createClient\(\), searchId\)/);
  assert.match(paywall, /PURCHASE_UNAVAILABLE/);
  assert.match(paywall, /<Sheet open=\{open\}/);
});

// ------------------------------------------------------------- integrations

test('Add Home preflights new homes and opens the paywall only on the server refusal', () => {
  assert.match(homesBoard, /checkHomeAdmission\(createClient\(\), searchId, \{ listingUrl: home\.listingUrl, address: home\.address \}\)/);
  assert.match(homesBoard, /if \(result !== 'paywall_required'\) return true;/);
  assert.match(homesBoard, /if \(!home\.id && isPaywallError\(err\)\) \{/);
  assert.match(homesBoard, /savePendingAdmission\(\{ searchId, kind: 'add_home'/);
  assert.equal((homesBoard.match(/onBeforeCreate=\{beforeCreateHome\}/g) || []).length, 2);
  assert.equal((homesBoard.match(/<Paywall open=\{paywallOpen\}/g) || []).length, 2);
  // Only a brand-new home consults the preflight; edits never do.
  assert.match(homeModal, /if \(!form\.id && onBeforeCreate && !\(await onBeforeCreate\(form\)\)\)/);
  assert.match(homeModal, /if \(isPaywallError\(saveErr\)\) \{ setSaveErrorMsg\(PAYWALL_SAVE_NOTE\);/);
  assert.doesNotMatch(homesBoard, /length\s*>=\s*3|FREE_HOME_LIMIT/);
});

test('Realtor suggestion creation has no limit; promotion keeps the suggestion when refused', () => {
  assert.doesNotMatch(realtorSuggest, /onBeforeCreate|Paywall|entitlement/i);
  assert.match(suggestionsBoard, /if \(!isPaywallError\(err\)\) \{ setError\("Couldn't add this home\. Try again\."\); return; \}/);
  assert.match(suggestionsBoard, /kind: 'suggestion_promotion', suggestionId: suggestion\.id/);
  assert.match(suggestionsBoard, /This suggestion is still here\./);
  assert.match(suggestionsBoard, /<Paywall open=\{paywallOpen\} searchId=\{searchId\}/);
});

// ----------------------------------------------------------------- database

test('entitlement tables are closed to clients and unlock is service-role only', () => {
  for (const table of ['search_entitlements', 'search_entitlement_transactions', 'search_home_admissions']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
    assert.doesNotMatch(migration, new RegExp(`create policy[^;]+on public\\.${table}`));
  }
  assert.match(migration, /revoke all on function public\.record_search_entitlement_unlock\([^)]*\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.record_search_entitlement_unlock\([^)]*\) to service_role;/);
  assert.match(migration, /revoke all on function public\.admit_search_home\([^)]*\) from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(migration, /grant execute on function public\.admit_search_home/);
  assert.match(migration, /if p_source in \('apple', 'web'\) and nullif\(trim\(coalesce\(p_provider_transaction_id, ''\)\), ''\) is null then/);
  // Client RPCs expose status, never provider transaction identifiers.
  const clientRpc = migration.slice(migration.indexOf('create or replace function public.get_search_entitlement'), migration.indexOf('create or replace function public.check_home_admission'));
  assert.doesNotMatch(clientRpc, /provider_transaction_id|search_entitlement_transactions/);
  assert.match(clientRpc, /is_search_decision_maker\(p_search_id, caller\)/);
});

test('one admission gate covers buyer inserts and suggestion promotion, serialized per search', () => {
  assert.match(migration, /after insert on public\.homes\s+for each row when \(not new\.suggestion_staged\)\s+execute function public\.enforce_home_admission\(\);/);
  assert.match(migration, /after update of suggestion_staged on public\.homes\s+for each row when \(old\.suggestion_staged and not new\.suggestion_staged\)/);
  assert.match(migration, /select \* into ent from public\.search_entitlements where search_id = p_search_id for update;/);
  assert.match(migration, /raise exception 'paywall_required'\s+using errcode = 'FL402'/);
  assert.match(migration, /unique \(search_id, listing_identity\)/);
  assert.match(migration, /first_home_id uuid references public\.homes\(id\) on delete set null/);
  // Grandfathering is additive: existing homes are only read.
  assert.doesNotMatch(migrationCode, /delete from public\.homes|update public\.homes|suggestion_staged\s*=\s*true/);
  assert.match(migration, /'grandfathered', true, coalesce\(h\.created_at, now\(\)\)/);
  // The backfill runs before the triggers exist.
  assert.ok(migration.indexOf('admission_source, counted_against_free, admitted_at)') < migration.indexOf('create trigger enforce_home_admission_insert'));
});

// Optional live verification against a disposable local Postgres. Set
// FLH_TEST_PG="-h <socket dir> -p <port> -U postgres" to run it.
const pgArgs = process.env.FLH_TEST_PG ? process.env.FLH_TEST_PG.split(/\s+/).filter(Boolean) : null;
const psql = (args, input) => spawnSync('psql', [...pgArgs, ...args], { encoding: 'utf8', input });

test('database scenarios: free slots, duplicates, deletes, grandfathering, co-buyer, realtor, security, unlock', { skip: !pgArgs && 'FLH_TEST_PG not set' }, () => {
  psql(['-qc', 'drop database if exists flh_entitlements_test']);
  assert.equal(psql(['-qc', 'create database flh_entitlements_test']).status, 0);
  const db = ['-d', 'flh_entitlements_test', '-v', 'ON_ERROR_STOP=1', '-q'];
  for (const file of ['test/sql/search-entitlements-scaffold.sql', 'supabase/migrations/2026-09-30-search-entitlements-phase-1.sql']) {
    const run = psql([...db, '-f', file]);
    assert.equal(run.status, 0, run.stderr);
  }
  // Re-running the migration is safe.
  assert.equal(psql([...db, '-f', 'supabase/migrations/2026-09-30-search-entitlements-phase-1.sql']).status, 0);
  const scenarios = psql([...db, '-At', '-f', 'test/sql/search-entitlements-scenarios.sql']);
  assert.equal(scenarios.status, 0, scenarios.stderr);
  assert.match(scenarios.stdout, /ALL PASS/);
});

test('database concurrency: two simultaneous adds cannot both take the final free slot', { skip: !pgArgs && 'FLH_TEST_PG not set' }, async () => {
  const db = ['-d', 'flh_entitlements_test', '-qAt'];
  const as = "set role authenticated; set test.uid='aaaaaaaa-0000-0000-0000-000000000004';";
  const add = (address) => `insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000d','aaaaaaaa-0000-0000-0000-000000000004','${address}');`;
  assert.equal(psql([...db, '-c', `${as} ${add('1 D')} ${add('2 D')}`]).status, 0);
  const run = (sql) => new Promise((resolve) => {
    const child = spawn('psql', [...pgArgs, ...db, '-c', sql]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stderr }));
  });
  const first = run(`${as} begin; ${add('3 D')} select pg_sleep(1.5); commit;`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const second = await run(`${as} ${add('4 D')}`);
  const firstResult = await first;
  assert.equal(firstResult.code, 0, firstResult.stderr);
  assert.notEqual(second.code, 0);
  assert.match(second.stderr, /paywall_required/);
  const count = psql([...db, '-c', "select count(*) from homes where search_id='00000000-0000-0000-0000-00000000000d'"]);
  assert.equal(count.stdout.trim(), '3');
});
