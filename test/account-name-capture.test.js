import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql');
const authForm = read('src/components/auth/AuthForm.jsx');
const signUpPage = read('src/app/auth/sign-up/page.js');
const invite = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
const realtorHome = read('src/app/(app)/realtor/page.js');
const appShell = read('src/components/AppShell.jsx');
const data = read('src/lib/supabase/data.js');
const collaboration = read('src/lib/supabase/collaboration.js');

test('profiles gains nullable, permissively-validated first/last name columns', () => {
  assert.match(migration, /alter table public\.profiles\s*\n\s*add column if not exists first_name text,\s*\n\s*add column if not exists last_name text;/);
  // No fabricated-name regex/format constraints — only a generous length cap,
  // so apostrophes, hyphens, spaces, and accented/Unicode names all pass.
  assert.match(migration, /first_name is null or char_length\(first_name\) <= 100/);
  assert.match(migration, /last_name is null or char_length\(last_name\) <= 100/);
  assert.doesNotMatch(migration, /first_name.*~.*\[a-z/i);
});

test('signup metadata seeds profiles.first_name/last_name through the existing new-user trigger, trimmed and null-if-blank', () => {
  const trigger = migration.match(/create or replace function public\.handle_new_user\(\)[\s\S]*?end;\n\$\$;/)?.[0] || '';
  assert.match(trigger, /insert into public\.profiles \(id, onboarding_complete, first_name, last_name\)/);
  assert.match(trigger, /nullif\(trim\(new\.raw_user_meta_data->>'first_name'\), ''\)/);
  assert.match(trigger, /nullif\(trim\(new\.raw_user_meta_data->>'last_name'\), ''\)/);
  // The owned search this trigger has always seeded stays untouched.
  assert.match(trigger, /insert into public\.searches \(user_id, priorities\)/);
});

test('resolve_display_name is the single canonical name resolver, never inventing a name beyond the pre-existing email fallback', () => {
  const fn = migration.match(/create or replace function public\.resolve_display_name[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(fn, /concat_ws\(' ', p\.first_name, p\.last_name\)/);
  assert.match(fn, /raw_user_meta_data->>'full_name'/);
  assert.match(fn, /initcap\(replace\(split_part\(u\.email, '@', 1\), '\.', ' '\)\)/);
  assert.match(fn, /p_fallback/);
  assert.match(migration, /grant execute on function public\.resolve_display_name\(uuid, text\) to authenticated;/);
  // Every prior ad hoc "full_name meta -> email initcap -> literal fallback"
  // copy now funnels through the one helper instead of re-deriving it.
  for (const name of ['get_realtor_client_roster', 'save_realtor_note', 'suggest_home_tour', 'create_realtor_suggestion', 'invite_prospective_client', 'resolve_collaborator_search_context']) {
    const body = migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\nend;?\\s*\\$\\$;`, 'i'))?.[0]
      || migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0] || '';
    assert.match(body, /resolve_display_name/, `${name} should call resolve_display_name`);
  }
});

test('signup requires first and last name with accessible labels and autocomplete, without lengthening sign-in', () => {
  assert.match(authForm, /!firstName\.trim\(\) \|\| !lastName\.trim\(\)/);
  assert.match(authForm, /Please enter your first and last name/);
  assert.match(authForm, /autoComplete="given-name"/);
  assert.match(authForm, /autoComplete="family-name"/);
  assert.match(authForm, /\{!signIn && <div className="afh-name-row">/);
});

test('first_name/last_name reach the canonical profile via signup metadata, not a second unsynchronized field', () => {
  assert.match(authForm, /first_name: firstName\.trim\(\), last_name: lastName\.trim\(\)/);
  assert.doesNotMatch(authForm, /full_name:/);
});

test('desktop, mobile/full-page, and invitation-driven signup all reuse the one AuthForm — no parallel name form', () => {
  assert.match(signUpPage, /<AuthForm initialMode="sign-up"/);
  assert.match(read('src/components/auth/LandingAuthPopover.jsx'), /<AuthForm initialMode=\{mode\} inline/);
  // The invite acceptance flow signs a new buyer up through the same
  // /auth/sign-in?redirect=... continuation, not a bespoke form.
  assert.match(read('src/app/invite/[token]/page.js'), /\/auth\/sign-in\?redirect=/);
});

test('unicode, apostrophes, and hyphens in names are never rejected client-side', () => {
  assert.doesNotMatch(authForm, /firstName\.match|firstName\.test|\/\^\[a-zA-Z/);
  assert.doesNotMatch(authForm, /lastName\.match|lastName\.test/);
});

test('existing nameless accounts stay usable — no forced redirect, no email-derived fabrication', () => {
  assert.doesNotMatch(appShell, /firstName \? firstName : .*split.*@|email\.split\('@'\)/);
  assert.match(appShell, /!firstName && <NameCompletionPrompt/);
  assert.doesNotMatch(appShell, /redirect\('\/onboarding'\)|router\.push\('\/onboarding'\)/);
  assert.match(appShell, /NAME_PROMPT_DISMISS_KEY/);
  assert.match(appShell, /localStorage\.setItem\(NAME_PROMPT_DISMISS_KEY, '1'\)/);
});

test('the lightweight name-completion path writes only first_name/last_name under existing RLS, trimmed and null-if-blank', () => {
  assert.match(data, /export async function updateProfileName\(supabase, userId, firstName, lastName\)/);
  assert.match(data, /firstName\.trim\(\) \|\| null/);
  assert.match(data, /lastName\.trim\(\) \|\| null/);
  assert.match(data, /from\('profiles'\)\.update\(/);
});

test('Realtor Home greets by real first name only, with a graceful non-personalized fallback — never derived from email', () => {
  assert.match(realtorHome, /const firstName = profile\?\.first_name \|\| null;/);
  assert.match(realtorHome, /Welcome to Feels Like Home\{firstName \? `, \$\{firstName\}` : ''\}\./);
  assert.doesNotMatch(realtorHome, /email\.split|initcap|split_part/);
});

test('invitation acceptance preserves and reads the invited name path without weakening email-bound acceptance', () => {
  assert.match(invite, /wrong_account/);
  assert.match(collaboration, /export async function previewInvitation/);
});
