import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/2026-09-23-search-entitlement-foundation.sql');
const collaboration = read('src/lib/supabase/collaboration.js');
const page = read('src/app/(app)/account/page.js');
const accountSettings = read('src/components/account/AccountSettings.jsx');
const searchAccess = read('src/components/account/SearchAccess.jsx');
const connections = read('src/components/account/Connections.jsx');

function fn(name) { return migration.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?end; \\$\\$;`, 'i'))?.[0] || ''; }

/* ------------------------------ model: search-scoped, not global ------------------------------ */

test('entitlement is a search-scoped table, never a person-level column', () => {
  assert.match(migration, /create table if not exists public\.search_entitlements \(\s*\n\s*search_id uuid primary key references public\.searches\(id\) on delete cascade,/);
  assert.doesNotMatch(migration, /profiles\.is_plus|users\.is_plus|add column.*is_plus|alter table public\.profiles/i);
});

test('source distinguishes beta/purchase/admin/promo, with no subscription/expiration concept', () => {
  const tableDdl = migration.match(/create table if not exists public\.search_entitlements \([\s\S]*?\);/)?.[0] || '';
  assert.match(tableDdl, /check \(source in \('beta', 'purchase', 'admin', 'promo'\)\)/);
  assert.doesNotMatch(tableDdl, /expires_at|renewal|recurring|subscription|billing_period/i);
});

/* ------------------------------ canonical resolver ------------------------------ */

test('resolve_search_entitlement is the one canonical resolver, authorized the same way as every other search-scoped read (can_access_search), and never fabricates access', () => {
  const resolver = fn('resolve_search_entitlement');
  assert.match(resolver, /if not public\.can_access_search\(p_search_id, caller\) then raise exception 'Search access denied'/);
  assert.match(resolver, /if entitlement\.search_id is null then\s*\n\s*return query select false, null::text, null::timestamptz;/);
  assert.match(resolver, /return query select true, entitlement\.source, entitlement\.granted_at;/);
});

test('the JS layer calls one canonical resolveSearchEntitlement — no scattered beta||paid||realtor checks in the UI', () => {
  const resolverFn = collaboration.match(/export async function resolveSearchEntitlement[\s\S]*?\n}/)?.[0] || '';
  assert.match(resolverFn, /supabase\.rpc\('resolve_search_entitlement', \{ p_search_id: searchId \}\)/);
  assert.match(page, /resolveSearchEntitlement\(supabase, ownedSearch\.id\)/);
  assert.doesNotMatch(accountSettings, /relationships\.length > 0/);
  assert.doesNotMatch(searchAccess, /hasFlhPlus \|\| .*realtor|isBeta \|\| isPurchased|beta \|\| paid/i);
});

test('resolveSearchEntitlement falls back to a plain search_entitlements read when the RPC is unavailable, without fabricating a source', () => {
  const resolverFn = collaboration.match(/export async function resolveSearchEntitlement[\s\S]*?\n}/)?.[0] || '';
  assert.match(resolverFn, /if \(!rpcResult\.error\) \{/);
  assert.match(resolverFn, /supabase\.from\('search_entitlements'\)\.select\('source'\)\.eq\('search_id', searchId\)\.maybeSingle\(\);/);
  assert.match(resolverFn, /hasFlhPlus: Boolean\(fallback\.data\), source: fallback\.data\?\.source \|\| null/);
});

/* ------------------------------ security: no client self-grant, RLS not weakened ------------------------------ */

test('no INSERT/UPDATE/DELETE policy exists for authenticated on search_entitlements — a normal client cannot grant, alter, or revoke any entitlement', () => {
  assert.doesNotMatch(migration, /for insert|for update|for delete/i);
  assert.match(migration, /revoke all on public\.search_entitlements from public, anon, authenticated;/);
  assert.match(migration, /grant select on public\.search_entitlements to authenticated;/);
});

test('SELECT on search_entitlements is scoped to can_access_search (owner, co-buyer, or Realtor) — the same authorization already used for every other search-scoped read', () => {
  assert.match(migration, /create policy "search_entitlements_select" on public\.search_entitlements\s*\n\s*for select using \(public\.can_access_search\(search_id, auth\.uid\(\)\)\);/);
});

test('the backfill and the resolver are the only writers/readers of source — no RLS is disabled and no blanket grant is issued', () => {
  assert.doesNotMatch(migration, /disable row level security/i);
  assert.doesNotMatch(migration, /grant all on/i);
  assert.match(migration, /alter table public\.search_entitlements enable row level security;/);
});

/* ------------------------------ backfill: idempotent, correctly scoped ------------------------------ */

test('the beta backfill targets only real completed-onboarding buyer searches — the same signal /account/page.js already uses to exclude a Realtor-only account\'s unused default search', () => {
  assert.match(migration, /insert into public\.search_entitlements \(search_id, source, granted_by, granted_at\)\nselect s\.id, 'beta', null, now\(\)\nfrom public\.searches s\njoin public\.profiles p on p\.id = s\.user_id\nwhere p\.onboarding_complete = true/);
  assert.match(page, /hasBuyerSearch = Boolean\(profile\?\.onboarding_complete && ownedSearch\)/);
});

test('the backfill is idempotent — running it twice grants no duplicate/second entitlement row', () => {
  assert.match(migration, /on conflict \(search_id\) do nothing;/);
  // search_id is the primary key, so a second insert for the same search can
  // only ever be a no-op, never a duplicate row.
  assert.match(migration, /search_id uuid primary key references public\.searches\(id\)/);
});

test('the backfill never grants entitlement via a co-buyer/Realtor relationship row — search_members/search_invitations are not the source of this insert', () => {
  const backfill = migration.match(/insert into public\.search_entitlements[\s\S]*?on conflict \(search_id\) do nothing;/)?.[0] || '';
  assert.doesNotMatch(backfill, /search_members|search_invitations/);
});

/* ------------------------------ Account Settings: truthful, source-aware presentation ------------------------------ */

test('a beta-granted search shows truthful "Included during beta" copy, never a fabricated $7.99-purchased claim', () => {
  assert.match(searchAccess, /entitlementSource === 'beta' \? 'Included during beta' : 'Unlocked for this search'/);
});

test('Account Settings passes the resolved entitlement (not a derived heuristic) down to SearchAccess', () => {
  assert.match(accountSettings, /hasFlhPlus = false, entitlementSource = null/);
  assert.match(accountSettings, /<SearchAccess hasFlhPlus=\{hasFlhPlus\} entitlementSource=\{entitlementSource\} homeCount=\{homeCount\} \/>/);
});

test('an entitlement-resolution failure surfaces the honest shared error notice rather than silently defaulting a beta/purchased search to Free', () => {
  const entitlementBlock = page.match(/try \{\s*const entitlement = await resolveSearchEntitlement[\s\S]*?\} catch \(error\) \{[\s\S]*?\}/)?.[0] || '';
  assert.ok(entitlementBlock, 'expected an isolated try/catch around resolveSearchEntitlement');
  assert.match(entitlementBlock, /searchDataError = true;/);
});

/* ------------------------------ collaborator behavior: one entitlement per search ------------------------------ */

test('an existing co-buyer/Realtor relationship is always shown and manageable, regardless of hasFlhPlus — gating only blocks starting a NEW invite, and a transient entitlement hiccup can never hide a real connection', () => {
  assert.match(connections, /coBuyer \? \(\s*\n\s*<ConnectedRelationship icon=\{Users\}/);
  assert.match(connections, /\) : !hasFlhPlus \? \(\s*\n\s*<GatedRelationship/);
  assert.match(connections, /realtor \? \(\s*\n\s*<ConnectedRelationship icon=\{HomeIcon\}/);
});

test('no separate per-collaborator entitlement row is created — one search_entitlements row covers the owner, co-buyer, and Realtor alike via can_access_search', () => {
  assert.doesNotMatch(migration, /search_entitlements.*user_id|search_member.*entitlement/i);
  assert.match(migration, /search_id uuid primary key/);
});
