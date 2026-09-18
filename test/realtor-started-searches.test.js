import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/2026-09-16-realtor-started-searches.sql');
const signup = read('src/app/auth/sign-up/page.js');
const authForm = read('src/components/auth/AuthForm.jsx');
const root = read('src/app/page.js');
const layout = read('src/app/(app)/layout.js');
const onboardingPage = read('src/app/onboarding/page.js');
const people = read('src/app/(app)/people/page.js');
const setup = read('src/components/ClientSearchSetup.jsx');
const invite = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
const collaboration = read('src/lib/supabase/collaboration.js');
const fn = (name) => migration.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?end; \\$\\$;`, 'i'))?.[0] || '';

test('Realtor signup intent changes routing, never relationship authorization', () => {
  assert.match(authForm, /redirectTo === '\/' && isRealtorEntry \? '\/realtor' : redirectTo/);
  assert.match(root, /account_entry_intent === 'realtor'\) redirect\('\/realtor'\)/);
  assert.doesNotMatch(onboardingPage, /account_entry_intent/);
  assert.match(layout, /isRealtorEntry && isRealtorWorkspace \? \{ \.\.\.storedProfile, onboarding_complete: true \}/);
  assert.doesNotMatch(migration, /account_entry_intent/);
  assert.doesNotMatch(migration, /profiles[^\n]*role|users[^\n]*role/);
});

test('People workspace has professional empty and pending states without CRM language', () => {
  for (const phrase of ["People I’m Helping", 'Help a buyer get their search organized from the start', 'Start a client search', 'Invitation pending', 'Search started']) assert.ok(people.includes(phrase));
  assert.match(people, /InviteBuyer/);
  assert.doesNotMatch(people, /Leads|Prospects|Pipeline|Conversion|Client database/i);
});

test('zero-client Realtor workspace does not require or invent an active buyer search', () => {
  const realtorBranch = layout.match(/if \(isRealtorWorkspace\) \{[\s\S]*?^    \}/m)?.[0] || '';
  assert.match(realtorBranch, /workspace="realtor"/);
  assert.match(realtorBranch, /activeSearchId=\{null\}/);
  assert.doesNotMatch(realtorBranch, /resolveActiveSearch|resolvePriorities|getSearchParticipantIds|search\.id/);
  assert.match(people, /relationships\.length/);
  assert.match(people, /prospective\.length === 0/);
  assert.match(people, /You don&apos;t have any client searches yet/);
  assert.match(people, /href="\/people\/start"/);
});

test('prospective criteria are isolated draft state with owner-only RLS', () => {
  assert.match(migration, /create table public\.prospective_searches/);
  assert.match(migration, /draft_priorities jsonb/);
  assert.match(migration, /started_by = auth\.uid\(\)/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(fn('create_prospective_search'), /search_member_priorities|home_member_state|search_members/);
  assert.match(fn('create_prospective_search'), /coalesce\(p_draft_priorities,'\{\}'::jsonb\)/);
  assert.match(setup, /Add as much or as little as you know/);
  assert.match(setup, /ONBOARDING_SUGGESTIONS/);
});

test('invitation is email-bound and remains distinct from membership', () => {
  const create = fn('invite_prospective_client');
  const preview = fn('preview_invitation');
  assert.match(create, /p\.started_by=caller/);
  assert.match(create, /search_invitations/);
  assert.doesNotMatch(create, /search_members/);
  assert.match(preview, /caller_email is distinct from lower\(inv\.invited_email\)/);
  assert.match(invite, /Review my search/);
  assert.match(invite, /\/invite\/\$\{token\}\/confirm/);
  assert.match(collaboration, /invite_prospective_client/);
});

test('buyer confirmation atomically promotes only confirmed participant state', () => {
  const claim = fn('claim_prospective_search');
  assert.match(claim, /for update/);
  assert.match(claim, /inv\.status='accepted'/);
  assert.match(claim, /lower\(inv\.invited_email\)/);
  assert.match(claim, /p\.started_by=inv\.invited_by/);
  assert.match(claim, /search_member_priorities\(search_id,user_id,priorities\).*caller,p_confirmed_priorities/s);
  assert.match(claim, /search_members\(search_id,user_id,role\).*inv\.invited_by,'realtor'/s);
  assert.match(claim, /delete from public\.prospective_searches/);
  assert.match(claim, /on conflict\(search_id,user_id\) do update/);
  assert.match(fn('accept_invitation'), /confirmation_required/);
  assert.match(setup, /Selected items become Must Have; everything else stays Important/);
  assert.doesNotMatch(setup, /Nice to Have/);
});

test('privileged draft RPCs use controlled paths and authenticated-only grants', () => {
  for (const name of ['create_prospective_search','invite_prospective_client','preview_invitation','claim_prospective_search']) {
    assert.match(fn(name), /security definer/);
    assert.match(fn(name), /set search_path = ''/);
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}`));
  }
  assert.match(migration, /revoke execute[\s\S]*from anon, service_role/);
});
