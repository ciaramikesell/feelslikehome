import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/2026-09-16-realtor-notes-tours-buyer-invitations.sql');
const schema = read('supabase/schema.sql');
const detail = read('src/components/RealtorContributions.jsx');
const invite = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
const people = read('src/app/(app)/people/page.js');
const collaboration = read('src/lib/supabase/collaboration.js');
function fn(name) { return migration.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?end; \\$\\$;`, 'i'))?.[0] || ''; }

test('Realtor notes are authored, search/home scoped, isolated, and owner-only mutable', () => {
  assert.match(migration, /create table public\.realtor_notes/);
  assert.match(migration, /unique \(search_id, home_id, author_id\)/);
  assert.match(fn('save_realtor_note'), /auth\.uid\(\)/);
  assert.match(fn('save_realtor_note'), /is_search_realtor\(p_search_id,caller\)/);
  assert.match(fn('save_realtor_note'), /h\.id=p_home_id and h\.search_id=p_search_id and not h\.suggestion_staged/);
  assert.match(fn('save_realtor_note'), /on conflict\(search_id,home_id,author_id\) do update/);
  assert.match(fn('delete_realtor_note'), /n\.author_id=caller/);
  assert.doesNotMatch(migration, /realtor_notes[^;]*property/i);
  assert.match(detail, /From \{note\.author_display_name\}/);
  assert.match(detail, /note\.author_id === viewerId/);
});

test('tour suggestions are active-contender-only, deduplicated, and never write WTT', () => {
  const tour = fn('suggest_home_tour');
  assert.match(migration, /unique \(search_id, home_id, suggested_by\)/);
  assert.match(tour, /not h\.suggestion_staged/);
  assert.match(tour, /s\.status <> 'Archived'/);
  assert.match(tour, /is_search_realtor/);
  assert.doesNotMatch(tour, /Want to Tour|home_member_state\s*\(/);
  assert.match(detail, /Your Want to Tour choice stays yours/);
  assert.match(detail, /alreadySuggested \? 'Tour suggested' : 'Suggest a tour'/);
  assert.match(detail, /!archived && contributions\.tours/);
});

test('reverse invitations reuse secure tokens and require explicit buyer acceptance', () => {
  const create = fn('create_buyer_invitation'); const accept = fn('accept_invitation');
  assert.match(migration, /alter table public\.search_invitations/);
  assert.match(create, /exists\(select 1 from public\.search_members sm where sm\.user_id=caller and sm\.role='realtor'\)/);
  assert.match(create, /status='pending' and i\.expires_at>now\(\)/);
  assert.match(accept, /lower\(caller_email\) is distinct from lower\(inv\.invited_email\)/);
  assert.match(accept, /select s\.id into target_search from public\.searches s where s\.user_id=caller/);
  assert.match(accept, /values\(target_search,inv\.invited_by,'realtor'\)/);
  assert.match(accept, /on conflict\(search_id,user_id\) do nothing/);
  assert.match(invite, /Review my search/);
  assert.match(invite, /\/invite\/\$\{token\}\/confirm/);
  assert.match(invite, /This remains your search/);
  assert.match(people, /InviteBuyer/);
  assert.match(collaboration, /create_buyer_invitation/);
});

test('privileged surface is authenticated-only and canonical schema contains #82', () => {
  for (const name of ['save_realtor_note','delete_realtor_note','suggest_home_tour','create_buyer_invitation']) {
    assert.match(migration, new RegExp(`grant execute on function public\\.[\\s\\S]*${name}`));
    assert.ok(schema.includes(`public.${name}`));
  }
  assert.match(migration, /revoke execute[\s\S]*from anon, service_role/);
  assert.doesNotMatch(migration, /get_realtor_client_roster/);
});
