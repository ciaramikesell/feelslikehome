import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/2026-09-16-realtor-suggestions.sql');
const schema = read('supabase/schema.sql');
const collaboration = read('src/lib/supabase/collaboration.js');
const buyer = read('src/components/SuggestionsBoard.jsx');
const realtor = read('src/components/RealtorSuggestHome.jsx');
const workspace = read('src/components/RealtorWorkspace.jsx');
const homesPage = read('src/app/(app)/homes/page.js');
const modal = read('src/components/HomeModal.jsx');
const roster = read('supabase/migrations/2026-09-16-realtor-search-view.sql');

function rpc(name) {
  return migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?end; \\$\\$;`, 'i'))?.[0] || '';
}

test('suggestions are distinct durable records backed by staged canonical homes', () => {
  assert.match(migration, /create table if not exists public\.realtor_suggestions/);
  assert.match(migration, /home_id uuid not null unique references public\.homes/);
  assert.match(migration, /suggestion_staged boolean not null default false/);
  assert.match(collaboration, /eq\('suggestion_staged', false\)/);
  assert.match(migration, /update public\.homes set suggestion_staged=false/);
  assert.match(schema, /create table if not exists public\.realtor_suggestions/);
});

test('Realtor creation is relationship-scoped, revoked access fails, and duplicates are idempotent', () => {
  const fn = rpc('create_realtor_suggestion');
  assert.match(fn, /caller uuid := auth\.uid\(\)/);
  assert.match(fn, /not public\.is_search_realtor\(p_search_id, caller\)/);
  assert.match(fn, /for update|unique_violation/);
  for (const outcome of ['already_in_homes','already_suggested','previously_dismissed']) assert.match(fn, new RegExp(outcome));
  assert.match(migration, /unique \(search_id, listing_identity\)/);
  assert.match(migration, /revoke all on function public\.create_realtor_suggestion/);
});

test('RLS isolates suggestions and participant-owned feedback', () => {
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /suggested_by = auth\.uid\(\) and public\.is_search_realtor/);
  assert.match(migration, /user_id = auth\.uid\(\).*is_search_decision_maker/s);
  assert.doesNotMatch(migration, /create policy[^;]+realtor[^;]+(?:insert|update)[^;]+suggestion_dispositions/is);
  assert.match(migration, /not suggestion_staged and public\.is_search_decision_maker/);
});

test('dismissal is immediate, independently owned, multi-reason, and full dismissal stays history', () => {
  const fn = rpc('dismiss_realtor_suggestion');
  assert.match(fn, /on conflict\(suggestion_id,user_id\) do update/);
  assert.match(fn, /role='co_buyer'/);
  assert.match(fn, /status='dismissed'/);
  assert.match(migration, /reasons text\[\] not null/);
  assert.match(migration, /char_length\(coalesce\(other_text,''\)\) <= 280/);
  assert.match(buyer, /your dismissal is already saved/);
  assert.match(buyer, /Dismissed by your co-buyer/);
});

test('promotion is one-decision-maker, transactional, and retry/concurrency safe', () => {
  const fn = rpc('promote_realtor_suggestion');
  assert.match(fn, /for update/);
  assert.match(fn, /is_search_decision_maker/);
  assert.match(fn, /if suggestion\.status='accepted' then return suggestion\.home_id/);
  assert.match(fn, /on conflict\(home_id,user_id\) do nothing/);
  assert.match(fn, /promoted_by=caller/);
  assert.doesNotMatch(fn, /is_search_realtor/);
});

test('canonical importer and participant Match remain separate with Unknown semantics', () => {
  assert.match(realtor, /<HomeModal/);
  assert.match(modal, /matchPerspectives\.map/);
  assert.match(modal, /computeMatch\(form, perspective\.priorities\)/);
  assert.match(modal, /Unknown details are not counted as misses/);
  assert.doesNotMatch(modal, /Household Match|Realtor Match/);
  assert.match(buyer, /!item\.evaluated \? 'Unknown'/);
});

test('buyer queue, Homes indication, provenance, and Realtor outcomes are present', () => {
  assert.match(homesPage, /hh-suggestions-entry/);
  assert.match(homesPage, /status === 'pending'/);
  assert.match(buyer, /New \/ Pending Suggestions/);
  assert.match(buyer, /Past Suggestions/);
  assert.match(buyer, /Add to My Homes/);
  assert.match(buyer, /Suggested by \{suggestion\.suggestedByName\}/);
  assert.match(workspace, /Added to My Homes/);
  assert.match(workspace, /Dismissed by/);
  assert.match(collaboration, /suggestedBy: provenanceByHome/);
});

test('#79 roster RPC remains its original narrow authorized projection', () => {
  assert.match(roster, /returns table \(search_id uuid, user_id uuid, display_name text, relationship text\)/);
  assert.match(roster, /public\.is_search_realtor\(participants\.search_id, auth\.uid\(\)\)/);
  assert.match(roster, /participants\.search_id = any\(p_search_ids\)/);
  assert.match(roster, /revoke execute on function public\.get_realtor_client_roster\(uuid\[\]\) from anon, service_role/);
  assert.doesNotMatch(roster, /select u\.\*|phone|metadata|last_sign_in/);
  assert.doesNotMatch(migration, /get_realtor_client_roster/);
});
