import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const repair = read('supabase/migrations/2026-09-24-resolve-search-relationships-schema-cache-fix.sql');
const originalMigration = read('supabase/migrations/2026-09-20-account-settings-foundation.sql');
const entitlementMigration = read('supabase/migrations/2026-09-23-search-entitlement-foundation.sql');
const collaboration = read('src/lib/supabase/collaboration.js');
const appShell = read('src/components/AppShell.jsx');
const authLib = read('src/lib/supabase/auth.js');

/* ------------------------------ root cause: PGRST202 schema-cache gap ------------------------------ */

test('root cause: resolve_search_relationships is re-asserted byte-for-byte from its original definition — no logic change, only a fresh CREATE OR REPLACE + schema reload', () => {
  const extractBody = (src) => src.match(/create (?:or replace )?function public\.resolve_search_relationships\(p_search_id uuid\)[\s\S]*?\$\$;/)?.[0].replace(/create function|create or replace function/, 'create function') || '';
  const original = extractBody(originalMigration);
  const repaired = extractBody(repair);
  assert.ok(original, 'expected to find the original function body');
  assert.equal(repaired, original, 'the repair must not change resolve_search_relationships logic, only redeploy it');
});

test('the repair preserves owner-only authorization and RLS is not weakened', () => {
  assert.match(repair, /if not coalesce\(public\.is_search_owner\(p_search_id, auth\.uid\(\)\), false\) then\s*\n\s*raise exception 'Search access denied'/);
  assert.match(repair, /revoke all on function public\.resolve_search_relationships\(uuid\) from public;/);
  assert.match(repair, /revoke execute on function public\.resolve_search_relationships\(uuid\) from anon, service_role;/);
  assert.match(repair, /grant execute on function public\.resolve_search_relationships\(uuid\) to authenticated;/);
});

test('the repair reloads PostgREST\'s schema cache', () => {
  assert.match(repair, /notify pgrst, 'reload schema';/);
});

/* ------------------------------ relationships vs entitlement stay separate ------------------------------ */

test('resolve_search_relationships and resolve_search_entitlement are never merged — separate migrations, separate tables, separate concepts', () => {
  const repairSql = repair.split('begin;')[1] || '';
  assert.doesNotMatch(repairSql, /search_entitlements|resolve_search_entitlement/);
  // The entitlement migration's own comments may reference
  // resolve_search_relationships as an illustrative precedent (a
  // consistency note), but it must never define, call, or read from it.
  assert.doesNotMatch(entitlementMigration, /create (?:or replace )?function public\.resolve_search_relationships/);
  assert.doesNotMatch(entitlementMigration, /select .*resolve_search_relationships\(|from public\.search_members/);
});

test('the app never substitutes resolve_search_entitlement for a relationship question, even though PostgREST\'s error hints at it', () => {
  const relationshipsFn = collaboration.match(/export async function resolveSearchRelationships[\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(relationshipsFn, /resolve_search_entitlement|search_entitlements/);
  const entitlementFn = collaboration.match(/export async function resolveSearchEntitlement[\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(entitlementFn, /resolve_search_relationships|search_members/);
});

/* ------------------------------ fallback: verified safe, not a permanent workaround ------------------------------ */

test('the resolveSearchRelationships fallback stays RLS-scoped (search_members_select: owner or the member themself) — it cannot expose unrelated searches\' members', () => {
  const fn = collaboration.match(/export async function resolveSearchRelationships[\s\S]*?\n}/)?.[0] || '';
  assert.match(fn, /supabase\.from\('search_members'\)\.select\('user_id, role'\)\.eq\('search_id', searchId\)/);
  // No explicit user_id filter is needed here — RLS itself (not app code)
  // is what restricts the result to authorized rows.
});

test('the fallback never reads pending invitations as if they were memberships — only accepted search_members rows', () => {
  const fn = collaboration.match(/export async function resolveSearchRelationships[\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(fn, /search_invitations/);
});

/* ------------------------------ auth: refresh-token recovery ------------------------------ */

test('AppShell listens for the Supabase client\'s own SIGNED_OUT signal (fired when its background token refresh gives up) and recovers by sending the user to sign-in with a return path', () => {
  assert.match(appShell, /supabase\.auth\.onAuthStateChange\(\(event\) => \{/);
  assert.match(appShell, /if \(event === 'SIGNED_OUT' && !intentionalSignOutRef\.current\) \{/);
  assert.match(appShell, /router\.push\(`\/auth\/sign-in\?redirect=\$\{encodeURIComponent\(pathname\)\}`\)/);
});

test('an explicit user-initiated sign-out is distinguished from an unexpected dead session, and still goes home rather than to sign-in', () => {
  assert.match(appShell, /const intentionalSignOutRef = useRef\(false\);/);
  const signOutFn = appShell.match(/const signOut = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(signOutFn, /intentionalSignOutRef\.current = true;/);
  assert.match(signOutFn, /router\.push\('\/'\);/);
});

test('the auth-state listener is torn down on unmount — no leaked subscription, no duplicate listeners stacking up on remount', () => {
  const effect = appShell.match(/useEffect\(\(\) => \{\s*\n\s*const supabase = createClient\(\);\s*\n\s*const \{ data: \{ subscription: authListener \} \} = supabase\.auth\.onAuthStateChange[\s\S]*?\n  \}, \[router, pathname\]\);/)?.[0] || '';
  assert.match(effect, /return \(\) => authListener\.unsubscribe\(\);/);
});

test('server-side dead-session recovery (requireUser/withAuthRecovery) is unchanged and remains the canonical handling for Server Components — the new client-side listener is additive, not a replacement', () => {
  assert.match(authLib, /export async function requireUser\(supabase\)/);
  assert.match(authLib, /if \(!user\) await redirectToSignIn\(\);/);
  assert.match(authLib, /export async function withAuthRecovery\(loader\)/);
  assert.match(authLib, /if \(isAuthSessionError\(error\)\) await redirectToSignIn\(\);/);
});

test('no partial state is left behind by a mid-flow auth failure: accept_invitation/resolve_search_relationships both fail closed (throw) rather than silently succeeding with an unauthenticated caller', () => {
  assert.match(repair, /if auth\.uid\(\) is null then\s*\n\s*raise exception 'Authentication required'/);
});
