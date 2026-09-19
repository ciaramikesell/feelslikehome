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
const schema = read('supabase/schema.sql');
const nameSchemaCacheFix = read('supabase/migrations/2026-09-21-profiles-name-schema-cache-fix.sql');
const nameCaptureMigration = read('supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql');

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

test('email is shown read-only from Supabase Auth (not the profiles table) and is never written by the profile form', () => {
  assert.match(accountSettings, /value=\{initialEmail \|\| ''\} readOnly disabled/);
  assert.doesNotMatch(accountSettings, /auth\.updateUser\(\{ email/);
  assert.doesNotMatch(accountSettings, /\.from\('profiles'\)\.update\(\{[^}]*email/);
});

test('saving the profile name never also depends on an email-change call — the two are decoupled', () => {
  const form = accountSettings.match(/function ProfileForm[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(form, /await updateProfileName\(supabase, userId, firstName, lastName\);/);
  assert.doesNotMatch(form, /auth\.updateUser/);
  // The real error is logged (not just swallowed into the generic banner),
  // so a production failure is diagnosable from server/browser logs.
  assert.match(form, /console\.error\('Account Settings: could not save profile name', nameError\)/);
});

test('saving the profile name refreshes the route so the header/account menu (sourced from the (app) layout\'s server-side profile fetch) picks up the new name immediately, not just after the next navigation', () => {
  assert.match(accountSettings, /import \{ useRouter \} from 'next\/navigation'/);
  const form = accountSettings.match(/function ProfileForm[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(form, /const router = useRouter\(\);/);
  const saveFn = form.match(/const save = async[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(saveFn, /setStatus\('saved'\);\s*\n\s*\/\/[\s\S]*?\n\s*router\.refresh\(\);/);
});

test('a legacy account with no name yet can still open and use Profile without being blocked', () => {
  assert.match(page, /firstName=\{profile\?\.first_name \|\| ''\}/);
  assert.match(page, /lastName=\{profile\?\.last_name \|\| ''\}/);
  // useRouter (for router.refresh() after a save) is fine — it's next/navigation
  // that never performs a redirect/navigation away from the page.
  assert.doesNotMatch(accountSettings, /redirect\(/);
  assert.doesNotMatch(accountSettings, /router\.push\(|router\.replace\(/);
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

test('purchasing remains an honest, non-working placeholder — a Free search never fakes a purchase button that does anything', () => {
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

/* ------------------------------ loading-failure repair pass ------------------------------ */

test('root cause: getSearchParticipantIds no longer assumes a truthy search — the exact crash a null owned search would cause', () => {
  const fn = collaboration.match(/export async function getSearchParticipantIds\(supabase, search\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /if \(!search\) return \[\];/);
  // Must guard before ever touching search.id/search.user_id.
  const guardIndex = fn.indexOf('if (!search)');
  const firstDotId = fn.indexOf('search.id');
  assert.ok(guardIndex > -1 && firstDotId > -1 && guardIndex < firstDotId);
});

test('root cause: (app)/layout.js never dereferences .id on a possibly-null search', () => {
  assert.doesNotMatch(layout, /activeSearchId=\{search\.id\}/);
  assert.match(layout, /activeSearchId=\{search\?\.id \?\? null\}/);
});

test('root cause: /account/page.js isolates the optional FLH+/Connections fetch so a failure there cannot take down Profile/Password/Delete Account', () => {
  assert.match(page, /try \{/);
  assert.match(page, /getEligibleHomeCount\(supabase, ownedSearch\.id\)/);
  assert.match(page, /resolveSearchRelationships\(supabase, ownedSearch\.id\)/);
  assert.match(page, /catch \(error\) \{/);
  assert.match(page, /searchDataError = true/);
  // The failure path must never fabricate a fake Free/no-relationships state
  // as if it were real — searchDataError is passed through, not swallowed.
  assert.match(page, /searchDataError=\{searchDataError\}/);
});

test('homeCount and relationships are fetched in independent try/catch blocks — a homeCount failure alone never blocks real relationship data', () => {
  const homeCountBlock = page.match(/try \{\s*homeCount = await getEligibleHomeCount\(supabase, ownedSearch\.id\);\s*\} catch \(error\) \{[\s\S]*?\}/)?.[0] || '';
  assert.ok(homeCountBlock, 'expected an isolated try/catch around getEligibleHomeCount');
  assert.doesNotMatch(homeCountBlock, /searchDataError = true/);

  const relationshipsBlock = page.match(/try \{\s*relationships = await resolveSearchRelationships\(supabase, ownedSearch\.id\);\s*\} catch \(error\) \{[\s\S]*?searchDataError = true;\s*\}/)?.[0] || '';
  assert.ok(relationshipsBlock, 'expected an isolated try/catch around resolveSearchRelationships that sets searchDataError');
});

test('resolveSearchRelationships falls back to a plain search_members read when the RPC is unavailable, without fabricating a name', () => {
  const fn = collaboration.match(/export async function resolveSearchRelationships[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /supabase\.rpc\('resolve_search_relationships', \{ p_search_id: searchId \}\)/);
  assert.match(fn, /if \(!rpcResult\.error\) return rpcResult\.data \|\| \[\];/);
  assert.match(fn, /supabase\.from\('search_members'\)\.select\('user_id, role'\)\.eq\('search_id', searchId\)/);
  assert.match(fn, /display_name: row\.role === 'realtor' \? 'Your Realtor' : 'Your co-buyer'/);
});

test('when the FLH+/Connections fetch fails, AccountSettings renders an honest error notice instead of a fabricated Free/0-relationships state', () => {
  assert.match(accountSettings, /searchDataError = false/);
  assert.match(accountSettings, /searchDataError \? \(/);
  assert.match(accountSettings, /Couldn&apos;t load your FLH\+ access and connections/);
  // The error branch must not also render SearchAccess/Connections with the
  // (necessarily fake, in this failure case) homeCount=0/relationships=[]
  // defaults.
  const errorBranch = accountSettings.match(/searchDataError \? \([\s\S]*?\) : \(/)?.[0] || '';
  assert.doesNotMatch(errorBranch, /<SearchAccess|<Connections/);
  // Profile/Password/Delete Account are siblings of the {search && (...)}
  // block, not nested inside it, so they render regardless of this failure.
  assert.match(accountSettings, /<ProfileForm /);
  assert.match(accountSettings, /<DeleteAccountSection \/>/);
});

test('FLH+ Access section never uses subscription/premium/monthly language, and matches the canonical benefit list', () => {
  assert.doesNotMatch(searchAccess, /\bsubscription\b|\bpremium\b|\bmonthly plan\b/i);
  assert.match(searchAccess, /Individual Match perspectives/);
  assert.match(searchAccess, /Realtor suggestions and professional context/);
  assert.match(searchAccess, /Shared home-search experience/);
  assert.match(searchAccess, /One purchase\. One search\. Everyone you invite\./);
  assert.match(searchAccess, /Your co-buyer and Realtor don&apos;t purchase separately for this FLH\+ search\./);
  assert.doesNotMatch(searchAccess, /\bchat\b|\btour bookings\b/i);
});

test('Account Settings header describes FLH+ access, not a subscription', () => {
  assert.match(accountSettings, /Manage your profile, FLH\+ access, and connections\./);
  assert.doesNotMatch(accountSettings, /\bsubscription\b/i);
});

test('the outdated "co-buyer upgrade automatically grants full access" claim is never present — FLH+ belongs to the search, not a person', () => {
  assert.doesNotMatch(searchAccess, /automatically gains? full access/i);
  assert.doesNotMatch(connections, /automatically gains? full access/i);
});

test('the Realtor relationship description never overclaims — no buyer-side Match, no tour booking, no control over buyer decisions', () => {
  assert.doesNotMatch(connections, /favorited matches?/i);
  assert.doesNotMatch(connections, /\bbook(s|ing)? tours?\b/i);
  assert.match(connections, /while your decisions stay yours/);
});

test('no global/account-level entitlement flag is ever used — entitlement stays search-scoped via resolve_search_entitlement', () => {
  assert.doesNotMatch(page, /is_plus|isPlus|global.{0,10}entitlement|profile.{0,10}entitlement|profiles\.is_plus|users\.is_plus/i);
  assert.doesNotMatch(searchAccess, /is_plus|isPlus/i);
  assert.match(page, /resolveSearchEntitlement\(supabase, ownedSearch\.id\)/);
});

/* ------------------------------ data-repair pass: profile writes + connections resilience ------------------------------ */

test('profiles RLS lets a user read and update only their own row, scoped by auth.uid() on both using and with check', () => {
  assert.match(schema, /create policy "profiles_select_own" on public\.profiles\s*\n\s*for select using \(auth\.uid\(\) = id\);/);
  assert.match(schema, /create policy "profiles_update_own" on public\.profiles\s*\n\s*for update using \(auth\.uid\(\) = id\) with check \(auth\.uid\(\) = id\);/);
});

test('updateProfileName writes only first_name/last_name, scoped to the given userId — no other column, no cross-user write path', () => {
  const fn = data.match(/export async function updateProfileName[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /\.from\('profiles'\)\.update\(\{/);
  assert.match(fn, /first_name: firstName\.trim\(\) \|\| null/);
  assert.match(fn, /last_name: lastName\.trim\(\) \|\| null/);
  assert.match(fn, /\.eq\('id', userId\)/);
  assert.equal((fn.match(/\.eq\('id',/g) || []).length, 1, 'expected exactly one .eq(\'id\', ...) filter, scoped to userId');
});

test('Realtor onboarding (AppShell NameCompletionPrompt) and Account Settings (ProfileForm) both call the one canonical updateProfileName write — no second/duplicate name-write implementation exists', () => {
  const nameWriters = [...data.matchAll(/export async function updateProfileName/g)];
  assert.equal(nameWriters.length, 1, 'updateProfileName must be defined exactly once');
  assert.match(appShell, /import \{ updateProfileName \} from '@\/lib\/supabase\/data'/);
  assert.match(appShell, /await updateProfileName\(createClient\(\), userId, firstName, lastName\)/);
  assert.match(accountSettings, /import \{ updateProfileName \} from '@\/lib\/supabase\/data'/);
  assert.match(accountSettings, /await updateProfileName\(supabase, userId, firstName, lastName\)/);
  assert.doesNotMatch(appShell, /\.from\('profiles'\)\.update\(/);
  assert.doesNotMatch(accountSettings, /\.from\('profiles'\)\.update\(/);
});

test('a missing/undeployed resolve_search_relationships RPC does not crash Account Settings — real search_members rows still load via the fallback', () => {
  const fn = collaboration.match(/export async function resolveSearchRelationships[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /if \(fallback\.error\) throw fallback\.error;/);
  // Only a genuine fallback failure (e.g. RLS truly denying access) still
  // surfaces as searchDataError — an RPC-not-found is recovered from, not
  // treated as a hard failure.
  assert.doesNotMatch(fn, /throw rpcResult\.error/);
});

/* ------------------------------ data repair pass 2: PostgREST schema-cache fix ------------------------------ */

test('production root cause: profiles.first_name/last_name are re-asserted idempotently and PostgREST is told to reload its schema cache', () => {
  assert.match(nameSchemaCacheFix, /alter table public\.profiles\s*\n\s*add column if not exists first_name text,\s*\n\s*add column if not exists last_name text;/);
  assert.match(nameSchemaCacheFix, /notify pgrst, 'reload schema';/);
});

test('the schema-cache fix reasserts the same first/last name length constraints as the original migration — no drift between the two', () => {
  for (const src of [nameCaptureMigration, nameSchemaCacheFix]) {
    assert.match(src, /check \(first_name is null or char_length\(first_name\) <= 100\)/);
    assert.match(src, /check \(last_name is null or char_length\(last_name\) <= 100\)/);
  }
});

test('the schema-cache fix never touches RLS policies, grants, or any other table — it only repairs profiles.first_name/last_name', () => {
  assert.doesNotMatch(nameSchemaCacheFix, /create policy|drop policy|alter policy/i);
  assert.doesNotMatch(nameSchemaCacheFix, /^\s*grant |^\s*revoke /im);
  assert.doesNotMatch(nameSchemaCacheFix, /create table|drop table/i);
});

test('no second/duplicate name-storage location was introduced to work around the schema-cache error — profiles.first_name/last_name remain the only canonical columns', () => {
  assert.doesNotMatch(nameSchemaCacheFix, /create table/i);
  assert.doesNotMatch(data, /full_name|display_name.{0,20}column/i);
  const fn = data.match(/export async function updateProfileName[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /\.from\('profiles'\)\.update\(\{/);
});
