import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const fix = read('supabase/migrations/2026-09-25-accept-invitation-ambiguous-search-id-fix.sql');
const collaboration = read('src/lib/supabase/collaboration.js');

function fn(name) { return fix.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?end; \\$\\$;`, 'i'))?.[0] || ''; }

test('root cause: neither search_members insert uses the ambiguous ON CONFLICT column-list form — both reference the unique constraint by name instead', () => {
  const accept = fn('accept_invitation');
  assert.doesNotMatch(accept, /on conflict\(search_id,user_id\)/);
  assert.doesNotMatch(accept, /on conflict \(search_id, ?user_id\)/);
  assert.equal((accept.match(/on conflict on constraint search_members_search_id_user_id_key do nothing;/g) || []).length, 2, 'expected both the realtor_to_buyer and co_buyer inserts to use the constraint-name form');
});

test('the fix does not use a #variable_conflict pragma — the ambiguous construct is removed from the SQL, not resolved by a preference setting', () => {
  const accept = fn('accept_invitation');
  assert.doesNotMatch(accept, /variable_conflict/i);
});

test('every other bare search_id reference in the function stays in a grammar position PL/pgSQL does not treat as ambiguous (verified empirically, not by inspection alone — see the .db.test.js regression test)', () => {
  const accept = fn('accept_invitation');
  // inv.search_id: record field access, qualified via `inv.`
  assert.match(accept, /target_search:=inv\.search_id;/);
  // UPDATE ... SET search_id = target_search: SET's target-column position
  assert.match(accept, /update public\.search_invitations set status='accepted',responded_at=now\(\),search_id=target_search where id=inv\.id;/);
  // INSERT's own column list: target-column position, distinct from ON CONFLICT's
  assert.match(accept, /insert into public\.search_members\(search_id,user_id,role\) values/);
});

test('acceptance semantics are otherwise unchanged: validation order, self-invite/expired/wrong-account checks, relationship_conflict check, and the exception-wrapped stage tracking all still present', () => {
  const accept = fn('accept_invitation');
  for (const marker of [
    "if caller is null then return query select false,'not_authenticated'",
    "if inv\\.id is null then return query select false,'not_found'",
    "if inv\\.prospective_search_id is not null then return query select false,'confirmation_required'",
    "if inv\\.status<>'pending' then return query select false,inv\\.status",
    "if inv\\.expires_at<now\\(\\) then return query select false,'expired'",
    "if inv\\.invited_by=caller then return query select false,'self_invite'",
    "if lower\\(caller_email\\) is distinct from lower\\(inv\\.invited_email\\) then return query select false,'wrong_account'",
    "if exists\\(select 1 from public\\.search_members sm where sm\\.search_id=target_search and sm\\.user_id=caller and sm\\.role<>inv\\.relationship_type\\) then return query select false,'relationship_conflict'",
  ]) {
    assert.match(accept, new RegExp(marker));
  }
  assert.match(accept, /stage text := 'start'/);
  assert.match(accept, /exception when others then/);
});

test('security/RLS/grants are unchanged: SECURITY DEFINER, search_path pinned empty, revoked from public/anon/service_role, granted only to authenticated', () => {
  const accept = fn('accept_invitation');
  assert.match(accept, /security definer/);
  assert.match(accept, /set search_path = ''/);
  assert.match(fix, /revoke all on function public\.accept_invitation\(uuid\) from public;/);
  assert.match(fix, /revoke execute on function public\.accept_invitation\(uuid\) from anon, service_role;/);
  assert.match(fix, /grant execute on function public\.accept_invitation\(uuid\) to authenticated;/);
});

test('the constraint this migration relies on is the same unique (search_id, user_id) constraint search_members has always had — no schema/relationship-architecture change', () => {
  const foundation = read('supabase/migrations/2026-09-05-cobuyer-phase-a-foundation.sql');
  assert.match(foundation, /unique \(search_id, user_id\)/);
  assert.doesNotMatch(fix, /create table|alter table.*search_members.*add column|drop constraint search_members_search_id_user_id_key/);
});

test('this migration reloads PostgREST\'s schema/RPC cache', () => {
  assert.match(fix, /notify pgrst, 'reload schema';/);
});

test('the client-side acceptInvitation() call and its RPC name/shape are unchanged — this was purely a database-side fix', () => {
  const acceptFn = collaboration.match(/export async function acceptInvitation[\s\S]*?\n}/)?.[0] || '';
  assert.match(acceptFn, /supabase\.rpc\('accept_invitation', \{ p_token: token \}\)/);
});
