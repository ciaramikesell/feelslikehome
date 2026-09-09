import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = '../supabase/migrations/2026-09-09-pass-3c1a-privacy-foundation.sql';
const source = await readFile(new URL(migrationPath, import.meta.url), 'utf8');
const functionBody = source.match(/create or replace function public\.resolve_cobuyer_lifecycle_signals[\s\S]+?\n\$\$;/i)?.[0] || '';
const membershipSchema = await readFile(new URL('../supabase/migrations/2026-09-05-cobuyer-phase-a-foundation.sql', import.meta.url), 'utf8');
const invitationWorkflow = await readFile(new URL('../supabase/migrations/2026-09-05-cobuyer-phase-d-invitations.sql', import.meta.url), 'utf8');
const verification = await readFile(new URL('../supabase/3c1a-production-verification.sql', import.meta.url), 'utf8');

test('lifecycle RPC exposes only its five allowlisted typed columns', () => {
  const returns = functionBody.match(/returns table \(([\s\S]*?)\)\nlanguage/i)?.[1] || '';
  assert.deepEqual(
    [...returns.matchAll(/^\s*(\w+)\s+(uuid|boolean),?$/gm)].map((match) => match[1]),
    ['home_id', 'co_buyer_wants_to_tour', 'co_buyer_favorited', 'co_buyer_archived', 'all_participants_archived'],
  );
  for (const privateColumn of ['user_id', 'status', 'reaction', 'toured_at', 'is_favorite', 'rejection_reason', 'ratings', 'checks']) {
    assert.ok(!returns.includes(privateColumn), `${privateColumn} is not returned`);
  }
});

test('lifecycle RPC authenticates, authorizes, scopes, and bounds every batch', () => {
  assert.match(functionBody, /v_caller uuid := auth\.uid\(\)/);
  assert.match(functionBody, /if v_caller is null/);
  assert.match(functionBody, /public\.can_access_search\(p_search_id, v_caller\)/);
  assert.match(functionBody, /cardinality\(v_home_ids\) > 200/);
  assert.match(functionBody, /h\.search_id = p_search_id[\s\S]*h\.id = any\(v_home_ids\)/);
  assert.match(functionBody, /raise exception 'Invalid home batch'/);
});

test('duplicate IDs deduplicate, the cap counts input elements, and empty or NULL batches return no homes', () => {
  assert.match(functionBody, /v_home_ids uuid\[\] := coalesce\(p_home_ids, '\{\}'::uuid\[\]\)/);
  assert.match(functionBody, /cardinality\(v_home_ids\) > 200/);
  assert.match(functionBody, /count\(distinct requested\.home_id\)/);
  assert.match(functionBody, /requested_homes as \([\s\S]*from public\.homes h[\s\S]*h\.id = any\(v_home_ids\)/);
  assert.match(functionBody, /NULL and '\{\}' both resolve to an empty array and safely return zero rows/);
});

test('lifecycle aggregation includes every participant and excludes caller only from co-buyer signals', () => {
  assert.match(functionBody, /select s\.user_id[\s\S]*union[\s\S]*select sm\.user_id/);
  assert.doesNotMatch(functionBody, /limit\s+1/i);
  assert.match(functionBody, /filter \(where rs\.user_id <> v_caller\)/);
  assert.match(functionBody, /bool_and\(coalesce\(rs\.status = 'Archived', false\)\)/);
  assert.match(functionBody, /bool_or\(rs\.is_favorite\)/);
  assert.match(functionBody, /bool_or\(coalesce\(rs\.status = 'Archived', false\)\)/);
  assert.match(functionBody, /rs\.status = 'Want to Tour'[\s\S]*rs\.toured_at is not null or rs\.status = 'Toured'/);
});

test('participant row wins and only the original adder receives legacy fallback', () => {
  assert.match(functionBody, /when hms\.id is not null then hms\.status/);
  assert.match(functionBody, /when p\.user_id = h\.user_id then h\.status/);
  assert.match(functionBody, /else null/);
});

test('participant set documents the accepted/current membership relation', () => {
  assert.match(functionBody, /search_members is the current-membership relation/);
  assert.match(functionBody, /acceptance creates this row, and remove\/leave deletes it/);
  const table = membershipSchema.match(/create table if not exists public\.search_members \([\s\S]+?\n\);/)?.[0] || '';
  assert.doesNotMatch(table, /\bstatus\b|expires_at|inactive|declined/);
  assert.match(membershipSchema, /Owner may remove a member; a member may remove themselves \(leave\)/);
  assert.match(invitationWorkflow, /insert into public\.search_members \(search_id, user_id, role\) values \(inv\.search_id, caller, 'member'\)/);
  assert.match(invitationWorkflow, /update public\.search_invitations si set status = 'accepted'/);
});

test('bootstraps are exact, additive, conflict-safe, and leave legacy sources untouched', () => {
  assert.match(source, /insert into public\.home_member_state \([\s\S]*h\.status, h\.reaction, h\.toured_at, h\.is_favorite,[\s\S]*h\.rejection_reason, h\.ratings, h\.checks[\s\S]*on conflict \(home_id, user_id\) do nothing/);
  assert.match(source, /insert into public\.search_member_priorities \(search_id, user_id, priorities\)[\s\S]*s\.priorities[\s\S]*on conflict \(search_id, user_id\) do nothing/);
  assert.doesNotMatch(source, /update\s+public\.(homes|searches|home_member_state|search_member_priorities)/i);
  assert.doesNotMatch(source, /delete\s+from/i);
});

test('SECURITY DEFINER has a fixed path, qualified references, and narrow ACLs', () => {
  assert.match(functionBody, /security definer[\s\S]*set search_path = ''/i);
  for (const table of ['searches', 'search_members', 'homes', 'home_member_state']) {
    assert.match(functionBody, new RegExp(`public\\.${table}`));
  }
  assert.match(source, /revoke all on function public\.resolve_cobuyer_lifecycle_signals\(uuid, uuid\[\]\) from public/);
  assert.match(source, /revoke execute on function public\.resolve_cobuyer_lifecycle_signals\(uuid, uuid\[\]\) from anon/);
  assert.match(source, /revoke execute on function public\.resolve_cobuyer_lifecycle_signals\(uuid, uuid\[\]\) from service_role/);
  assert.match(source, /grant execute on function public\.resolve_cobuyer_lifecycle_signals\(uuid, uuid\[\]\) to authenticated/);
});

test('production verification emits one bootstrap row and recognizes PostgreSQL empty search_path serialization', () => {
  assert.match(verification, /with home_check as \([\s\S]*priority_check as \([\s\S]*cross join priority_check p/);
  for (const column of [
    'owner_home_state_gap', 'owner_priority_gap', 'homes_with_legacy_personal_state',
    'searches_with_legacy_priorities', 'owner_state_rows_different_from_legacy_preserved',
    'owner_priority_rows_different_from_legacy_preserved',
  ]) assert.match(verification, new RegExp(`\\b${column}\\b`));
  assert.match(verification, /raw_proconfig/);
  assert.match(verification, /search_path_configuration/);
  assert.match(verification, /configured_search_path_value/);
  assert.match(verification, /c\.setting = 'search_path=""'/);
  assert.doesNotMatch(verification, /array\['search_path='\]/);
});
