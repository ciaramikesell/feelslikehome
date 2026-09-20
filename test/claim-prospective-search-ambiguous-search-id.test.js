import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const fix = read('supabase/migrations/2026-09-26-claim-prospective-search-ambiguous-search-id-fix.sql');

function fn(name) { return fix.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?end; (?:\\$\\$|\\$${name}\\$);`, 'i'))?.[0] || ''; }

test('root cause: neither ON CONFLICT clause uses the ambiguous column-list form — both reference their unique constraint by name', () => {
  const claim = fn('claim_prospective_search');
  assert.doesNotMatch(claim, /on conflict\(search_id,user_id\)/);
  assert.doesNotMatch(claim, /on conflict \(search_id, ?user_id\)/);
  assert.match(claim, /on conflict on constraint search_member_priorities_search_id_user_id_key do update set priorities=excluded\.priorities,updated_at=now\(\);/);
  assert.match(claim, /on conflict on constraint search_members_search_id_user_id_key do nothing;/);
});

test('the fix adds the same stage-tracked exception handler accept_invitation already has — an unexpected DB error now returns a sanitized reason instead of an uncaught raw exception', () => {
  const claim = fn('claim_prospective_search');
  assert.match(claim, /stage text := 'start'/);
  assert.match(claim, /exception when others then/);
  assert.match(claim, /return query select false, \('error_' \|\| stage \|\| '_' \|\| sqlstate\), null::uuid;/);
});

test('every risky statement (both inserts, the invitation update, onboarding completion, draft cleanup) sits inside the guarded block, before the exception handler', () => {
  const claim = fn('claim_prospective_search');
  const exceptionIndex = claim.indexOf('exception when others then');
  for (const marker of [
    'on conflict on constraint search_member_priorities_search_id_user_id_key',
    'on conflict on constraint search_members_search_id_user_id_key',
    "update public.search_invitations set status='accepted'",
    'update public.profiles set onboarding_complete=true',
    'delete from public.prospective_searches',
  ]) {
    const idx = claim.indexOf(marker);
    assert.ok(idx > -1, `expected to find: ${marker}`);
    assert.ok(idx < exceptionIndex, `${marker} must be inside the guarded block, before the exception handler`);
  }
});

test('acceptance semantics are otherwise unchanged: token/status/expiry/role/wrong-account/self-invite validation, already-claimed idempotency, and the atomic claim/backfill/cleanup sequence all still present', () => {
  const claim = fn('claim_prospective_search');
  for (const marker of [
    "if caller is null then return query select false,'not_authenticated'",
    "if jsonb_typeof\\(coalesce\\(p_confirmed_priorities,'\\{\\}'::jsonb\\)\\) <> 'object'",
    "if inv\\.id is null then return query select false,'not_found'",
    "if inv\\.status='accepted' and target_search is not null and exists\\(select 1 from public\\.search_members sm where sm\\.search_id=target_search and sm\\.user_id=inv\\.invited_by and sm\\.role='realtor'\\) then return query select true,'already_claimed'",
    "if inv\\.status<>'pending' then return query select false,inv\\.status",
    "if inv\\.expires_at<now\\(\\) then return query select false,'expired'",
    "if inv\\.invitation_direction<>'realtor_to_buyer' or inv\\.prospective_search_id is null then return query select false,'not_prospective'",
    "if caller_email is distinct from lower\\(inv\\.invited_email\\) then return query select false,'wrong_account'",
    "if inv\\.invited_by=caller then return query select false,'self_invite'",
    "if draft\\.id is null then return query select false,'draft_unavailable'",
    "if target_search is null then return query select false,'search_not_ready'",
  ]) {
    assert.match(claim, new RegExp(marker));
  }
});

test('security/RLS/grants are unchanged: SECURITY DEFINER, search_path pinned empty, revoked from public/anon/service_role, granted only to authenticated', () => {
  const claim = fn('claim_prospective_search');
  assert.match(claim, /security definer/);
  assert.match(claim, /set search_path = ''/);
  assert.match(fix, /revoke all on function public\.claim_prospective_search\(uuid, jsonb\) from public;/);
  assert.match(fix, /revoke execute on function public\.claim_prospective_search\(uuid, jsonb\) from anon, service_role;/);
  assert.match(fix, /grant execute on function public\.claim_prospective_search\(uuid, jsonb\) to authenticated;/);
});

test('the constraints this migration relies on are the same unique (search_id, user_id) constraints search_members and search_member_priorities have always had — no schema/relationship-architecture change', () => {
  const foundation = read('supabase/migrations/2026-09-05-cobuyer-phase-a-foundation.sql');
  assert.match(foundation, /create table if not exists public\.search_member_priorities \([\s\S]*?unique \(search_id, user_id\)/);
  assert.doesNotMatch(fix, /create table|alter table.*search_member(_priorities)?.*add column|drop constraint search_member(s|_priorities)_search_id_user_id_key/);
});

test('this migration reloads PostgREST\'s schema/RPC cache', () => {
  assert.match(fix, /notify pgrst, 'reload schema';/);
});

test('a #variable_conflict pragma was not used — the ambiguous construct is removed from the SQL, not resolved by a preference setting', () => {
  const claim = fn('claim_prospective_search');
  assert.doesNotMatch(claim, /variable_conflict/i);
});
