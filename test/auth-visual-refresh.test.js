import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

const authShell = read('src/components/auth/AuthShell.jsx');
const signIn = read('src/app/auth/sign-in/page.js');
const signUp = read('src/app/auth/sign-up/page.js');
const authForm = read('src/components/auth/AuthForm.jsx');
const forgotPassword = read('src/app/auth/forgot-password/page.js');
const resetPassword = read('src/app/auth/reset-password/page.js');
const invitation = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
const globalsCss = read('src/app/globals.css');

/* ------------------------------ AuthShell: editorial copy is prop-driven ------------------------------ */

test('AuthShell no longer hardcodes a fixed benefits list — the left panel is prop-driven per page', () => {
  assert.doesNotMatch(authShell, /BENEFITS/);
  assert.doesNotMatch(authShell, /SlidersHorizontal|LayoutGrid|Target/);
  assert.doesNotMatch(authShell, /afh-benefit/);
  assert.match(authShell, /export default function AuthShell\(\{ children, headline = DEFAULT_HEADLINE, description = DEFAULT_DESCRIPTION \}\)/);
});

test('the "Find your best match" marketing line is gone from the auth surfaces — no auth file references best-match language', () => {
  for (const [name, src] of [
    ['AuthShell.jsx', authShell],
    ['sign-in/page.js', signIn],
    ['sign-up/page.js', signUp],
    ['forgot-password/page.js', forgotPassword],
    ['reset-password/page.js', resetPassword],
  ]) {
    assert.doesNotMatch(src, /best match/i, `${name} should not contain "best match" language`);
  }
});

test('AuthShell defaults to a welcome-back framing so Forgot/Reset Password inherit sensible copy without their own props', () => {
  assert.match(authShell, /Welcome back\.<br \/>Your homes are right where you left them\./);
  assert.match(authShell, /Pick up your search, revisit your Match scores, and keep narrowing in on the place that feels like home\./);
  // Forgot/Reset Password never pass headline/description — they rely on the default.
  assert.doesNotMatch(forgotPassword, /<AuthShell headline/);
  assert.doesNotMatch(resetPassword, /<AuthShell headline/);
});

test('Sign Up supplies its own distinct editorial copy rather than reusing Sign In\'s "welcome back" framing', () => {
  assert.match(signUp, /Start with the homes<br \/>you&apos;re already considering\./);
  assert.match(signUp, /Bring your contenders together and compare them against what actually matters to you\./);
  assert.match(signUp, /<AuthShell headline=\{SIGN_UP_HEADLINE\} description=\{SIGN_UP_DESCRIPTION\}>/g);
  assert.match(signUp, /<AuthForm initialMode="sign-up"/);
});

test('Sign In relies on AuthShell\'s own default rather than duplicating the copy locally', () => {
  assert.match(signIn, /<AuthShell>/);
  assert.doesNotMatch(signIn, /<AuthShell headline/);
});

/* ------------------------------ AuthShell: brand lockup ------------------------------ */

test('the web (non-native) brand lockup is a clickable link home, matching the public landing\'s own pl-brand pattern', () => {
  const nonNativeBranch = authShell.split('if (native)')[1] || '';
  assert.match(authShell, /<Link href="\/" className="afh-brand" aria-label="Feels Like Home home"/);
  // Native branch keeps its plain (non-link) brand lockup — nothing to navigate to inside the app shell.
  assert.match(authShell, /function NativeAuthHeader\(\) \{[\s\S]*?<div className="afh-brand"/);
});

/* ------------------------------ AuthShell: native branch untouched ------------------------------ */

test('regression guard: native Capacitor auth presentation keeps its exact hydration-gated pattern and tagline', () => {
  assert.match(authShell, /^'use client';/);
  assert.match(authShell, /import \{ isNativeApp \} from '@\/lib\/platform'/);
  assert.match(authShell, /useEffect\(\(\) => \{ if \(isNativeApp\(\)\) setNative\(true\); \}, \[\]\);/);
  assert.match(authShell, /You found the homes\. We&apos;ll help you choose\./);
  const nativeBranch = authShell.match(/if \(native\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(nativeBranch, 'expected an if (native) branch');
  assert.doesNotMatch(nativeBranch, /BENEFITS/);
  assert.match(nativeBranch, /afh-native-root/);
  assert.match(authShell, /afh-grid/);
});

/* ------------------------------ CSS: pinned desktop composition ------------------------------ */

test('regression guard: the pinned desktop split-screen grid and panel dimensions are unchanged', () => {
  assert.match(globalsCss, /\.afh-grid \{ display: grid; grid-template-columns: minmax\(0,55fr\) minmax\(380px,45fr\); min-height: 100vh; max-width: 1440px; margin: 0 auto; \}/);
  assert.match(globalsCss, /\.afh-panel \{ width: 100%; max-width: 380px;/);
  const collapse = globalsCss.match(/@media \(max-width: 880px\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(collapse, /\.afh-grid \{ grid-template-columns: 1fr; \}/);
});

test('the old fixed 3-item benefits CSS is gone; .afh-description carries the new single supporting line', () => {
  assert.doesNotMatch(globalsCss, /\.afh-benefits/);
  assert.doesNotMatch(globalsCss, /\.afh-benefit-icon/);
  assert.match(globalsCss, /\.afh-description \{ max-width: 420px; margin: 14px 0 0; color: var\(--ink-soft\); font-size: 14\.5px; line-height: 1\.6; \}/);
});

test('mobile keeps a brief editorial welcome line visible instead of hiding it outright, since it is now a single short sentence', () => {
  const mobileBlock = globalsCss.match(/@media \(max-width: 640px\) \{\s*\n\s*\.afh-left[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(mobileBlock);
  assert.doesNotMatch(mobileBlock, /\.afh-description,?\s*\.afh-benefits \{ display: none; \}/);
  assert.match(mobileBlock, /\.afh-description \{ font-size: 13px; margin-top: 10px; \}/);
  assert.match(mobileBlock, /\.afh-input, \.afh-btn \{ min-height: 44px; \}/);
});

/* ------------------------------ Input styling: no pale-blue, no autofill fighting ------------------------------ */

test('auth inputs use the app\'s paper/line/brick tokens, never a default blue focus ring, and never override -webkit-autofill', () => {
  const inputBlock = globalsCss.match(/\.afh-input \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(inputBlock);
  assert.match(inputBlock, /background: var\(--paper-raised\)/);
  assert.match(inputBlock, /border: 1px solid var\(--line\)/);
  assert.doesNotMatch(globalsCss, /-webkit-autofill/);
  assert.match(globalsCss, /\.afh-input:focus \{ border-color: var\(--brick\); box-shadow: 0 0 0 3px var\(--focus-ring\); \}/);
});

/* ------------------------------ Critical auth contract: unchanged ------------------------------ */

test('regression guard: sanitizeRedirectPath return-path recovery is unchanged on sign-in and sign-up', () => {
  assert.match(signIn, /import \{ sanitizeRedirectPath \} from '@\/lib\/safeRedirect'/);
  assert.match(signIn, /const redirectTo = sanitizeRedirectPath\(searchParams\.get\('redirect'\)\) \|\| '\/';/);
  assert.match(signUp, /import \{ sanitizeRedirectPath \} from '@\/lib\/safeRedirect'/);
  assert.match(signUp, /const redirectTo = sanitizeRedirectPath\(searchParams\.get\('redirect'\)\) \|\| '\/';/);
  assert.match(authForm, /supabase\.auth\.signInWithPassword\(\{ email: email\.trim\(\), password \}\)/);
});

test('regression guard: Realtor-aware signup intent is preserved as entry context, not a role, unaffected by the visual refresh', () => {
  assert.match(signUp, /const isRealtorEntry = searchParams\.get\('intent'\) === 'realtor';/);
  assert.match(authForm, /account_entry_intent: 'realtor'/);
  assert.doesNotMatch(authForm, /users\.role|profiles\.role|role:\s*'realtor'/);
});

test('regression guard: password reset/recovery mechanics (length + confirm-match validation, updateUser call) are untouched', () => {
  assert.match(forgotPassword, /supabase\.auth\.resetPasswordForEmail\(email\.trim\(\), \{/);
  assert.match(resetPassword, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(resetPassword, /password\.length < 6/);
  assert.match(resetPassword, /password !== confirm/);
});

test('regression guard: invitation-driven auth continuation (redirect through sign-in back to the invite) is untouched', () => {
  assert.match(invitation, /router\.push\(`\/auth\/sign-in\?redirect=\$\{encodeURIComponent\(`\/invite\/\$\{token\}`\)\}`\)/);
});
