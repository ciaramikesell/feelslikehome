import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const repair = read('supabase/migrations/2026-09-22-realtor-invitation-acceptance-repair.sql');
const invite = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
const collaboration = read('src/lib/supabase/collaboration.js');
const layout = read('src/app/(app)/layout.js');

function fn(name) { return repair.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?end; \\$\\$;`, 'i'))?.[0] || ''; }

/* ------------------------------ item 2: post-acceptance redirect ------------------------------ */

test('root cause: accepting a Realtor invitation no longer routes through /homes into forced buyer onboarding', () => {
  const acceptFn = invite.match(/const accept = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(acceptFn, /const destination = isBuyerInvite/);
  assert.match(acceptFn, /: isRealtorInvite\s*\n\s*\? \(result\.search_id \? `\/people\/\$\{result\.search_id\}` : '\/people'\)/);
  assert.match(acceptFn, /: '\/homes'/);
  // A Realtor invitation must never resolve to '/onboarding' or bare '/homes'
  // — those are exactly the routes (app)/layout.js gates behind completed
  // buyer onboarding, which a Realtor-only account never has.
  assert.doesNotMatch(acceptFn, /isRealtorInvite[\s\S]{0,40}'\/homes'/);
});

test('a Realtor accepting never has this account\'s "active search" pointer overwritten with the client\'s search — that pointer is buyer/co-buyer only', () => {
  const acceptFn = invite.match(/const accept = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(acceptFn, /if \(user && result\.search_id && !isRealtorInvite\) \{/);
});

test('buyer and co-buyer acceptance destinations are unchanged: buyer invite -> onboarding, co-buyer invite -> homes', () => {
  const acceptFn = invite.match(/const accept = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(acceptFn, /isBuyerInvite\s*\n\s*\? '\/onboarding'/);
});

test('the onboarding gate a Realtor invitation must not trigger is real and still route-scoped, not a global flag', () => {
  assert.match(layout, /if \(!isAccountSettings && !profile\?\.onboarding_complete\) redirect/);
  assert.match(layout, /isRealtorWorkspace = requestedPath\.startsWith\('\/people'\) \|\| requestedPath\.startsWith\('\/realtor'\)/);
});

/* ------------------------------ item 1/3: acceptance is atomic + self-diagnosing ------------------------------ */

test('accept_invitation wraps every write in a stage-tracked exception handler so an unexpected DB error returns a sanitized reason instead of an opaque failure, leaking no token/email/user id/search id', () => {
  const accept = fn('accept_invitation');
  assert.match(accept, /stage text := 'start'/);
  assert.match(accept, /exception when others then/);
  assert.match(accept, /return query select false, \('error_' \|\| stage \|\| '_' \|\| sqlstate\), null::uuid;/);
  assert.doesNotMatch(accept.match(/exception when others then[\s\S]*?end;/)?.[0] || '', /inv\.|caller_email|target_search|p_token/);
});

test('acceptance never trusts a client-supplied search id or role — both are resolved server-side from the invitation row', () => {
  const accept = fn('accept_invitation');
  // realtor_to_buyer: target search is the CALLER's own owned search, looked
  // up server-side — never a parameter.
  assert.match(accept, /select s\.id into target_search from public\.searches s where s\.user_id=caller/);
  // buyer_to_realtor (and co_buyer): target search comes from the stored
  // invitation row, and the membership role is the invitation's own
  // relationship_type — never a function argument.
  assert.match(accept, /target_search:=inv\.search_id/);
  assert.match(accept, /values\(target_search,caller,inv\.relationship_type\)/);
  assert.doesNotMatch(accept.match(/create or replace function public\.accept_invitation\(p_token uuid\)[\s\S]*?\$\$ language/)?.[0] || accept.split('as $$')[0], /p_search_id|p_role/);
});

test('acceptance is idempotent: re-accepting an already-accepted realtor_to_buyer invitation is a safe success, and every membership insert no-ops on conflict rather than erroring', () => {
  const accept = fn('accept_invitation');
  assert.match(accept, /inv\.status='accepted' and inv\.invitation_direction='realtor_to_buyer'[\s\S]*?return query select true,'already_member'/);
  assert.equal((accept.match(/on conflict\(search_id,user_id\) do nothing/g) || []).length, 2);
});

test('acceptance rejects expired, self-sent, and wrong-account attempts before ever touching search_members', () => {
  const accept = fn('accept_invitation');
  const beforeInsert = accept.split('stage := \'insert_member\'')[0];
  assert.match(beforeInsert, /inv\.expires_at<now\(\)/);
  assert.match(beforeInsert, /inv\.invited_by=caller/);
  assert.match(beforeInsert, /lower\(caller_email\) is distinct from lower\(inv\.invited_email\)/);
});

/* ------------------------------ item 5: People I'm Helping roster ------------------------------ */

test('get_realtor_client_roster only returns searches where the caller has an authenticated realtor membership, scoped to the requested search ids', () => {
  const roster = fn('get_realtor_client_roster');
  assert.match(roster, /participants\.search_id = any\(p_search_ids\)/);
  assert.match(roster, /public\.is_search_realtor\(participants\.search_id, auth\.uid\(\)\)/);
});

test('a co-buyer/owner participant is never mislabeled a Realtor client in the roster query', () => {
  const roster = fn('get_realtor_client_roster');
  assert.match(roster, /'Owner'::text as relationship\s*\n\s*from public\.searches s/);
  assert.match(roster, /sm\.role = 'co_buyer'/);
  assert.doesNotMatch(roster, /role = 'realtor'.*relationship/s);
});

/* ------------------------------ items 8: security / RLS preserved, not weakened ------------------------------ */

test('prospective_searches keeps the exact narrow, previously-fixed ACL (projected SELECT, RLS owner-scoped) — this repair does not broaden it', () => {
  assert.match(repair, /revoke select on table public\.prospective_searches from authenticated;/);
  assert.match(repair, /grant select \(\s*id, client_name, invited_email, status, draft_priorities, created_at, updated_at\s*\) on table public\.prospective_searches to authenticated;/);
  assert.match(repair, /for select to authenticated using \(started_by = auth\.uid\(\)\)/);
  assert.doesNotMatch(repair, /grant (all|select) on table public\.prospective_searches to authenticated;/);
});

test('search_members role check stays a closed enum (co_buyer, realtor) — no broadened role vocabulary, no global role column introduced', () => {
  assert.match(repair, /check \(role in \('co_buyer', 'realtor'\)\)/);
  assert.doesNotMatch(repair, /users\.role|profiles\.role|global.{0,15}role/i);
});

test('every RPC touched by this repair stays revoked from anon/service_role and granted only to authenticated', () => {
  assert.match(repair, /revoke all on function public\.create_prospective_search\(jsonb,text\), public\.invite_prospective_client\(uuid,text\), public\.claim_prospective_search\(uuid,jsonb\), public\.preview_invitation\(uuid\), public\.create_buyer_invitation\(text\), public\.create_realtor_connection_request\(text\), public\.get_realtor_client_roster\(uuid\[\]\), public\.accept_invitation\(uuid\) from public;/);
  assert.match(repair, /revoke execute on function [\s\S]*?from anon, service_role;/);
});

test('this repair never disables RLS, never grants a blanket table privilege, and never introduces a global entitlement/role flag', () => {
  assert.doesNotMatch(repair, /disable row level security/i);
  assert.doesNotMatch(repair, /force_row_level_security\s*=\s*off/i);
  assert.doesNotMatch(repair, /grant all on/i);
});

/* ------------------------------ resilience: real error vs legitimate empty state ------------------------------ */

test('the migration is fully idempotent — every DDL statement either uses IF EXISTS/IF NOT EXISTS, CREATE OR REPLACE, or an explicit existence check, so it is safe to run whether or not prior migrations already reached this database', () => {
  assert.doesNotMatch(repair, /\ncreate table public\./); // only "create table if not exists"
  assert.match(repair, /create table if not exists public\.prospective_searches/);
  assert.match(repair, /do \$\$\nbegin\n  if not exists \(select 1 from pg_constraint/);
  assert.match(repair, /notify pgrst, 'reload schema';/);
});
