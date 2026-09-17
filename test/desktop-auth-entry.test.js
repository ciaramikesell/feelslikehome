import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const landing = read('src/components/PublicLanding.jsx');
const popover = read('src/components/auth/LandingAuthPopover.jsx');
const authForm = read('src/components/auth/AuthForm.jsx');
const css = read('src/app/globals.css');
const shell = read('src/components/AppShell.jsx');
const signInPage = read('src/app/auth/sign-in/page.js');
const signUpPage = read('src/app/auth/sign-up/page.js');

test('desktop landing actions open the shared auth presentation in the intended mode', () => {
  assert.match(landing, /openAuth\('sign-in', event\)/);
  assert.ok((landing.match(/openAuth\('sign-up', event\)/g) || []).length >= 2);
  assert.match(landing, /<LandingAuthPopover mode=\{authMode\}/);
  assert.match(popover, /<AuthForm initialMode=\{mode\} inline onModeChange=\{onModeChange\}/);
  assert.match(authForm, /switchMode\(signIn \? 'sign-up' : 'sign-in'\)/);
});

test('mobile web keeps dedicated auth links and suppresses inline auth', () => {
  assert.match(landing, /aria-label="Mobile public navigation"[\s\S]*href="\/auth\/sign-in"[\s\S]*href="\/auth\/sign-up"/);
  assert.match(landing, /className="pl-button pl-mobile-auth" href="\/auth\/sign-up"/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.pl-auth-popover\{display:none\}[\s\S]*\.pl-desktop-auth\{display:none\}[\s\S]*\.pl-mobile-auth\{display:inline-flex\}/);
});

test('direct auth routes remain wrappers around the same auth implementation', () => {
  assert.match(signInPage, /<AuthForm redirectTo=\{redirectTo\}/);
  assert.match(signUpPage, /<AuthForm initialMode="sign-up" redirectTo=\{redirectTo\} isRealtorEntry=\{isRealtorEntry\}/);
  assert.match(signInPage, /sanitizeRedirectPath/);
  assert.match(signUpPage, /sanitizeRedirectPath/);
});

test('popover has dialog semantics, escape/outside dismissal, focus restoration, and labelled fields', () => {
  assert.match(popover, /role="dialog" aria-modal="false"/);
  assert.match(popover, /event\.key === 'Escape'/);
  assert.match(popover, /contains\(event\.target\)/);
  assert.match(popover, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(authForm, /htmlFor=\{`\$\{inline \? 'popover-' : ''\}\$\{mode\}-email`\}/);
  assert.match(authForm, /aria-live="polite"/);
  assert.match(authForm, /autoComplete=\{signIn \? 'current-password' : 'new-password'\}/);
});

test('explicit shell sign out returns to the public root while auth-error recovery stays separate', () => {
  assert.match(shell, /await supabase\.auth\.signOut\(\);\s*router\.push\('\/'\);\s*router\.refresh\(\);/);
  assert.doesNotMatch(shell.match(/const signOut = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '', /auth\/sign-in/);
});

test('shared auth preserves safe continuations and non-authorizing Realtor entry metadata', () => {
  assert.match(authForm, /router\.push\(redirectTo\)/);
  assert.match(authForm, /entryDestination = redirectTo === '\/' && isRealtorEntry \? '\/people' : redirectTo/);
  assert.match(authForm, /account_entry_intent: 'realtor'/);
  assert.doesNotMatch(authForm, /users\.role|profiles\.role|role:\s*'realtor'/);
});
