import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const page = read('src/app/(app)/account/page.js');
const layout = read('src/app/(app)/layout.js');
const appShell = read('src/components/AppShell.jsx');
const accountSettings = read('src/components/account/AccountSettings.jsx');
const searchAccess = read('src/components/account/SearchAccess.jsx');
const connections = read('src/components/account/Connections.jsx');
const collaboration = read('src/lib/supabase/collaboration.js');
const data = read('src/lib/supabase/data.js');
const authForm = read('src/components/auth/AuthForm.jsx');
const rootPage = read('src/app/page.js');
const migration = read('supabase/migrations/2026-09-20-account-settings-foundation.sql');
const css = read('src/app/globals.css');

test('/account requires authentication like every other (app) page', () => {
  assert.match(page, /const user = await requireUser\(supabase\)/);
  assert.match(page, /withAuthRecovery/);
});

test('/account is exempt from the onboarding gate so it never depends on a buyer search existing', () => {
  assert.match(layout, /const isAccountSettings = requestedPath\.startsWith\('\/account'\)/);
  assert.match(layout, /if \(!isAccountSettings && !profile\?\.onboarding_complete\) redirect/);
});

test('a buyer account with a real search renders FLH+ and Connections', () => {
  assert.match(page, /const hasBuyerSearch = Boolean\(profile\?\.onboarding_complete && ownedSearch\)/);
  assert.match(page, /search=\{hasBuyerSearch \? ownedSearch : null\}/);
  assert.match(accountSettings, /\{search && \(/);
  assert.match(accountSettings, /<SearchAccess /);
  assert.match(accountSettings, /<Connections /);
});

test('a Realtor-only account (never completed buyer onboarding) renders Account Settings without bootstrapping a buyer search', () => {
  // hasBuyerSearch is false whenever onboarding was never completed, which is
  // exactly a Realtor-only account's permanent state — their owned `searches`
  // row exists (every account gets one) but was never onboarded.
  assert.doesNotMatch(page, /if \(!hasBuyerSearch\)/);
  assert.doesNotMatch(page, /notFound\(\)|throw new Error.*search/i);
  assert.match(accountSettings, /search \? search\.id : null|search && \(/);
  assert.doesNotMatch(accountSettings, /Your search access — Free — 0 of/i);
});

test('dual-role: Account Settings always manages the person\'s own OWNED search, never a search they merely joined as Realtor/co-buyer elsewhere', () => {
  assert.match(page, /getSearch\(supabase, user\.id\)/);
  assert.doesNotMatch(page, /await resolveActiveSearch\(/);
  assert.match(page, /own OWNED search/);
});

test('profile name editing reuses the canonical profiles.first_name/last_name update path', () => {
  assert.match(accountSettings, /import \{ updateProfileName \} from '@\/lib\/supabase\/data'/);
  assert.match(accountSettings, /await updateProfileName\(supabase, userId, firstName, lastName\)/);
  assert.match(data, /export async function updateProfileName/);
});

test('email change goes through Supabase Auth directly, never a parallel profile-email column', () => {
  assert.match(accountSettings, /supabase\.auth\.updateUser\(\{ email: email\.trim\(\) \}\)/);
  assert.doesNotMatch(accountSettings, /\.from\('profiles'\)\.update\(\{[^}]*email/);
});

test('a legacy account with no name yet can still open and use Profile without being blocked', () => {
  assert.match(page, /firstName=\{profile\?\.first_name \|\| ''\}/);
  assert.match(page, /lastName=\{profile\?\.last_name \|\| ''\}/);
  assert.doesNotMatch(accountSettings, /redirect\(|next\/navigation/);
});

test('password change reuses Supabase Auth updateUser, the same mechanism as the existing reset-password page — no parallel password system', () => {
  assert.match(accountSettings, /createClient\(\)\.auth\.updateUser\(\{ password \}\)/);
  assert.match(accountSettings, /password\.length < 6/);
  assert.doesNotMatch(accountSettings, /\.from\('profiles'\)\.update\(\{[^}]*password/i);
});

test('Free search FLH+ presentation shows real, actual eligible home counts (excluding staged Realtor suggestions), never a fake/hardcoded count', () => {
  assert.match(collaboration, /export async function getEligibleHomeCount\(supabase, searchId\)/);
  assert.match(collaboration, /eq\('suggestion_staged', false\)/);
  assert.match(searchAccess, /Current access/);
  assert.match(searchAccess, /{homeCount} of {homeLimit} homes/);
});

test('FLH+ unlocked-state presentation exists and is driven by a component prop, testable without inventing a fake purchase row', () => {
  assert.match(searchAccess, /hasFlhPlus \?/);
  assert.match(searchAccess, /Unlocked for this search/);
  assert.match(searchAccess, /Co-buyer collaboration/);
  assert.match(searchAccess, /Realtor collaboration/);
});

test('no persisted FLH+ purchase/entitlement flag was created — the boundary is explicit and commented, not pretended', () => {
  assert.doesNotMatch(migration, /add column|create table|alter table public\.searches/i);
  assert.match(searchAccess, /persisted "this search purchased FLH\+" flag/);
  assert.match(searchAccess, /disabled title="Purchasing isn't available yet"/);
  assert.match(searchAccess, /button type="button" className="hh-btn" disabled/);
});

test('Free search: Co-Buyer card is gated behind FLH+ and offers no real invite action', () => {
  assert.match(connections, /GatedRelationship/);
  assert.match(connections, /FLH\+ required/);
  assert.match(connections, /!hasFlhPlus \?/);
  const gatedBlock = connections.match(/function GatedRelationship[\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(gatedBlock, /createInvitation|removeMember/);
});

test('Free search: Realtor card is gated behind FLH+, never implies FLH supplies or matches a Realtor', () => {
  assert.match(connections, /Bring the Realtor you're already working with/);
  assert.doesNotMatch(connections, /find a realtor|recommend.{0,20}realtor|realtor marketplace|matching/i);
});

test('gated controls never create a real invitation or membership — they only link to the FLH+ section', () => {
  assert.match(connections, /href="#unlock-flh-plus"/);
  assert.doesNotMatch(connections.match(/function GatedRelationship[\s\S]*?\n}/)?.[0] || '', /supabase|rpc\(/);
});

test('connected co-buyer rendering shows the real resolved participant, not a placeholder name', () => {
  assert.match(connections, /coBuyer \?/);
  assert.match(connections, /ConnectedRelationship icon={Users}[^]*person={coBuyer}/);
});

test('connected Realtor rendering shows the real resolved participant, not a placeholder name', () => {
  assert.match(connections, /realtor \?/);
  assert.match(connections, /ConnectedRelationship icon={HomeIcon}[^]*person={realtor}/);
});

test('relationship resolution is owner-only and search-scoped, enforced in the database function itself', () => {
  const fn = migration.match(/create or replace function public\.resolve_search_relationships[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(fn, /is_search_owner\(p_search_id, auth\.uid\(\)\)/);
  assert.match(fn, /raise exception 'Search access denied'/);
  assert.match(fn, /where sm\.search_id = p_search_id/);
  assert.match(migration, /grant execute on function public\.resolve_search_relationships\(uuid\) to authenticated;/);
  assert.match(migration, /revoke execute on function public\.resolve_search_relationships\(uuid\) from anon, service_role;/);
});

test('account_entry_intent remains non-authorizing and untouched by this pass', () => {
  assert.match(authForm, /account_entry_intent: 'realtor'/);
  assert.doesNotMatch(authForm, /users\.role|profiles\.role|role:\s*'realtor'/);
  assert.match(rootPage, /account_entry_intent === 'realtor'\) redirect\('\/realtor'\)/);
  assert.doesNotMatch(page, /account_entry_intent/);
});

test('account deletion requires an explicit confirmation step and never executes on the first button press', () => {
  assert.match(accountSettings, /function DeleteAccountSection/);
  assert.match(accountSettings, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(accountSettings, /const \[confirmed, setConfirmed\] = useState\(false\)/);
  assert.match(accountSettings, /disabled=\{!confirmed\}/);
  // The button that opens the Sheet only ever calls setOpen — no Supabase
  // call of any kind, deletion or otherwise, happens on the first click.
  assert.match(accountSettings, /onClick=\{\(\) => setOpen\(true\)\}>Delete my account/);
});

test('no destructive cascade is wired up — deletion is an honest placeholder, not a working delete', () => {
  assert.doesNotMatch(accountSettings, /\.auth\.admin\.deleteUser|DELETE FROM|\.delete\(\).*profiles|\.delete\(\).*auth\.users/i);
  assert.match(accountSettings, /Account deletion isn&apos;t available yet/);
  assert.match(accountSettings, /Nothing has been deleted/);
});

test('the account nav entry shows the authenticated user\'s real stored name, never a hardcoded example name', () => {
  assert.doesNotMatch(appShell, />Ciara</);
  assert.match(appShell, /const label = firstName \|\| emailDerivedNameGuess\(userEmail\) \|\| 'Account'/);
  assert.match(appShell, /function emailDerivedNameGuess\(email\)/);
});

test('Account Settings nav entry replaces the old standalone Sign out button without duplicating it', () => {
  assert.match(appShell, /<AccountMenu firstName={firstName} lastName={lastName} userEmail={userEmail} pathname={pathname} signOut={signOut} \/>/);
  assert.doesNotMatch(appShell, /<LogOut size=\{14\} \/> Sign out\s*<\/button>\s*<\/div>\s*<\/header>/);
  assert.match(appShell, /<Link href="\/account"[^>]*>.*Account Settings<\/Link>/);
});

test('responsive: the account menu integrates into the existing mobile utilities row rather than floating off-screen', () => {
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.hh-account-menu \{ margin-left: auto; \}/);
  assert.match(css, /\.hh-account-name \{ display: none; \}/);
});

test('responsive: the account page itself stacks cleanly on mobile with no forced horizontal layout', () => {
  assert.match(css, /@media \(max-width: 700px\) \{\s*\n\s*\.hh-account-page/);
  assert.match(css, /\.hh-account-access-row \{ flex-direction: column;/);
  assert.match(css, /\.hh-account-unlock-card \{ flex-direction: column; \}/);
});
