import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql');
const realtorHome = read('src/app/(app)/realtor/page.js');
const layout = read('src/app/(app)/layout.js');
const root = read('src/app/page.js');
const appShell = read('src/components/AppShell.jsx');
const connectBuyer = read('src/components/ConnectBuyer.jsx');
const inviteBuyer = read('src/components/InviteBuyer.jsx');
const collaboration = read('src/lib/supabase/collaboration.js');
const people = read('src/app/(app)/people/page.js');
const invite = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
const css = read('src/app/globals.css');
const startedSearchesMigration = read('supabase/migrations/2026-09-16-realtor-started-searches.sql');
// Every RPC's most recently applied definition wins — most were last touched
// by the name-capture migration, but accept_invitation/create_buyer_invitation
// were last redefined by realtor-started-searches and this migration doesn't
// need to touch them again, so both sources are searched.
const fnIn = (source, name) => source.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?\\nend;?\\s*\\$\\$;`, 'i'))?.[0]
  || source.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0] || '';
const fn = (name) => fnIn(migration, name) || fnIn(startedSearchesMigration, name);

test('a new Realtor with no explicit continuation lands on Realtor Home, not People/Homes/onboarding', () => {
  assert.match(root, /account_entry_intent === 'realtor'\) redirect\('\/realtor'\)/);
  assert.doesNotMatch(root, /account_entry_intent === 'realtor'\) redirect\('\/(homes|people|search)'\)/);
});

test('Realtor Home and People workspace share the same non-buyer app shell and bypass buyer onboarding identically', () => {
  assert.match(layout, /isRealtorWorkspace = requestedPath\.startsWith\('\/people'\) \|\| requestedPath\.startsWith\('\/realtor'\)/);
  const realtorBranch = layout.match(/if \(isRealtorWorkspace\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(realtorBranch, /workspace="realtor"/);
  assert.match(realtorBranch, /activeSearchId=\{null\}/);
  assert.doesNotMatch(realtorBranch, /resolveActiveSearch|resolvePriorities|getSearchParticipantIds/);
});

test('Realtor Home renders three distinct, equally-weighted pathways using existing/new infrastructure', () => {
  assert.match(realtorHome, /Connect with a buyer who already uses FLH/);
  assert.match(realtorHome, /<ConnectBuyer \/>/);
  assert.match(realtorHome, /Invite a buyer to Feels Like Home/);
  assert.match(realtorHome, /<InviteBuyer \/>/);
  assert.match(realtorHome, /Start a buyer&apos;s search/);
  assert.match(realtorHome, /href="\/people\/start"/);
  assert.match(css, /\.hh-realtor-home-cards \{[^}]*grid-template-columns: repeat\(3, minmax\(0,1fr\)\)/);
});

test('option 1 (connect) creates a request, never a membership, and never discloses account existence', () => {
  const createRequest = fn('create_realtor_connection_request');
  assert.doesNotMatch(createRequest, /search_members/);
  assert.match(createRequest, /insert into public\.search_invitations/);
  assert.match(createRequest, /invitation_direction = 'realtor_to_buyer'/);
  // No branch on whether the invited email belongs to an existing account —
  // the same invitation row is created either way.
  assert.doesNotMatch(createRequest, /auth\.users.*where.*email/is);
  assert.match(collaboration, /export async function createRealtorConnectionRequest/);
  assert.match(connectBuyer, /createRealtorConnectionRequest/);
  assert.match(connectBuyer, /Requires buyer approval|approve/i);
});

test('accepting a connection request only adds realtor membership to the buyer\'s own existing search, never touching priorities/homes', () => {
  const accept = fn('accept_invitation');
  assert.match(accept, /prospective_search_id is not null.*confirmation_required/s);
  assert.match(accept, /select s\.id into target_search from public\.searches s where s\.user_id=caller/);
  assert.match(accept, /insert into public\.search_members\(search_id,user_id,role\) values\(target_search,inv\.invited_by,'realtor'\)/);
  assert.doesNotMatch(accept, /search_member_priorities|home_member_state/);
});

test('a direct connection request skips the buyer priorities-confirmation step; a Realtor-authored draft still requires it', () => {
  assert.match(migration, /requires_confirmation boolean/);
  assert.match(migration, /\(inv\.prospective_search_id is not null\)/);
  assert.match(invite, /requiresConfirmation = isBuyerInvite && Boolean\(initialPreview\.requires_confirmation\)/);
  assert.match(invite, /if \(requiresConfirmation\) \{/);
  assert.match(invite, /\/invite\/\$\{token\}\/confirm/);
});

test('option 2 (invite) still creates its own prospective draft, so the buyer confirms/chooses their own priorities', () => {
  const createInvite = fn('create_buyer_invitation');
  assert.match(createInvite, /prospective_searches/);
  assert.match(inviteBuyer, /createBuyerInvitation/);
  assert.match(realtorHome, /keep ownership/i);
});

test('option 3 (start a search) reuses the canonical Realtor-started-search flow and creates no fake buyer identity', () => {
  assert.doesNotMatch(realtorHome, /prospective_searches|search_members|fake.?buyer/i);
  assert.match(realtorHome, /people\/start/);
});

test('Realtor Home never becomes a user directory or CRM pipeline', () => {
  assert.doesNotMatch(realtorHome, /\buser directory\b|\bbrowse\b|\bsearch users\b|\blead\b|\bpipeline\b/i);
  // The page's own comment explicitly disclaims "not a CRM dashboard" —
  // check for an unqualified/affirming use of the term instead of any mention.
  assert.doesNotMatch(realtorHome, /(?<!not a )CRM(?! dashboard)/);
  assert.doesNotMatch(migration, /select .*from auth\.users.*where.*ilike|user directory|list_users/i);
});

test('People I’m Helping remains a separate client roster, unmerged with the launchpad', () => {
  assert.match(people, /People I.m Helping/);
  assert.match(people, /InviteBuyer/);
  assert.doesNotMatch(people, /ConnectBuyer|hh-realtor-home-cards/);
});

test('authenticated navigation exposes Realtor Home alongside People I’m Helping for realtor-workspace and dual-role users, without removing buyer nav', () => {
  assert.match(appShell, /href="\/realtor" className=\{`hh-shell-action hh-people-entry \$\{pathname === '\/realtor' \? 'active' : ''\}`\}/);
  assert.match(appShell, /isRealtorWorkspace \|\| hasRealtorRelationships/);
  assert.match(appShell, /hasRealtorRelationships = accessibleSearches\?\.some\(\(search\) => search\.relationshipType === 'realtor'\)/);
  assert.match(appShell, /!isRealtorWorkspace && <nav className="hh-tabs"/);
});

test('no global realtor role, no directory, and requests remain distinct from membership at every layer', () => {
  assert.doesNotMatch(migration, /profiles[^\n]*role|alter table public\.users/i);
  assert.match(migration, /invitation_direction = 'realtor_to_buyer'/);
  assert.match(collaboration, /export async function createRealtorConnectionRequest/);
  assert.doesNotMatch(connectBuyer, /\.from\('search_members'\)|user directory/);
});

test('Realtor Home layout adapts responsively: 3 columns desktop, 2+1 tablet, stacked mobile, no forced overflow', () => {
  assert.match(css, /\.hh-realtor-home-cards \{[^}]*grid-template-columns: repeat\(3, minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*\.hh-realtor-home-cards \{ grid-template-columns: repeat\(2, minmax\(0,1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.hh-realtor-home-cards \{ grid-template-columns: 1fr; \}/);
});
