const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('src/app/for-realtors/page.js', 'utf8');
const landing = fs.readFileSync('src/components/RealtorLanding.jsx', 'utf8');
const publicLanding = fs.readFileSync('src/components/PublicLanding.jsx', 'utf8');
const auth = fs.readFileSync('src/components/auth/AuthForm.jsx', 'utf8');
const popover = fs.readFileSync('src/components/auth/LandingAuthPopover.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('For Realtors navigation leads to a public explanation before auth', () => {
  assert.match(publicLanding, /const realtorHref = '\/for-realtors'/);
  assert.match(page, /<RealtorLanding isAuthenticated=\{Boolean\(user\)\}/);
  assert.match(landing, /For real estate professionals/i);
  assert.match(landing, /Know what your buyers mean/);
  assert.match(landing, /Start helping a buyer/);
  assert.match(landing, /Already use FLH\? Sign in/);
});

test('CTA routing respects session while signup intent remains non-authorizing', () => {
  assert.match(landing, /isAuthenticated \? '\/people' : '\/auth\/sign-up\?intent=realtor'/);
  assert.match(landing, /\/auth\/sign-in\?redirect=\/people/);
  assert.match(auth, /account_entry_intent: 'realtor'/);
  assert.match(auth, /Access to every search is connected to that client relationship/);
  assert.doesNotMatch(auth, /Create an account with the email your client will invite/);
  assert.doesNotMatch(landing, /close rate|conversion|lead generation|pipeline/i);
});

test('desktop Realtor auth actions open the shared popover in their direct modes', () => {
  assert.match(landing, /<LandingAuthPopover mode=\{authMode\}[\s\S]*isRealtorEntry redirectTo="\/people"/);
  assert.ok((landing.match(/openAuth\('sign-in', event\)/g) || []).length >= 3);
  assert.ok((landing.match(/openAuth\('sign-up', event\)/g) || []).length >= 3);
  assert.match(landing, /openAuth\('sign-up', event\)[^>]*>Start helping a buyer/);
  assert.match(landing, /openAuth\('sign-up', event\)[^>]*>Create Realtor account/);
  assert.match(popover, /isRealtorEntry=\{isRealtorEntry\} redirectTo=\{redirectTo\}/);
});

test('Realtor panel switches in context and preserves Realtor copy, intent, and continuation', () => {
  assert.match(auth, /onModeChange\?\.\(nextMode\)/);
  assert.match(auth, /isRealtorEntry \? 'Create a Realtor account'/);
  assert.match(auth, /isRealtorEntry \? 'Sign in' : 'Back to sign in'/);
  assert.match(auth, /Help buyers organize what matters, understand their options, and make clearer decisions together/);
  assert.match(auth, /entryDestination = redirectTo === '\/' && isRealtorEntry \? '\/people' : redirectTo/);
  assert.match(auth, /router\.push\(entryDestination\)/);
  assert.doesNotMatch(auth, /users\.role|profiles\.role|role:\s*'realtor'/);
});

test('Realtor popover dismissal restores focus while mobile keeps Realtor-aware routes', () => {
  assert.match(popover, /event\.key === 'Escape'/);
  assert.match(popover, /contains\(event\.target\)/);
  assert.match(popover, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(landing, /className="rl-button rl-mobile-auth" href=\{startHref\}/);
  assert.match(landing, /className="rl-text-link rl-mobile-auth" href="\/auth\/sign-in\?redirect=\/people"/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.rl-desktop-auth\{display:none\}\.rl-root \.rl-mobile-auth\{display:inline-flex\}/);
});

test('page explains draft provenance, buyer ownership, and implemented contributions', () => {
  for (const phrase of ['Realtor-entered draft context', 'Match always belongs to the buyer', 'make changes', 'Suggest a listing', 'recommend tours', 'Buyers keep their own priorities and Match']) {
    assert.match(landing, new RegExp(phrase, 'i'));
  }
  assert.match(landing, /Illustrative workspace preview/);
  assert.equal((landing.match(/\[\w+, '[^']+', '[^']+'\]/g) || []).length, 8);
});

test('Realtor story uses the approved photo-led card composition and copy', () => {
  assert.match(landing, /Image src="\/images\/Warm Cottage\.png"/);
  assert.match(landing, /People I’m Helping/);
  assert.match(landing, /Stay connected to what matters/);
  assert.match(landing, /Built for better collaboration/);
  assert.match(landing, /Helping buyers make clearer home decisions/);
  assert.match(css, /\.rl-hero-visual\{[^}]*min-height:590px/);
  assert.match(css, /\.rl-steps>div\{[^}]*grid-template-columns:repeat\(4/);
  assert.match(css, /\.rl-value-list article\{[^}]*border:[^}]*border-radius/);
  assert.match(css, /\.rl-cta\{[^}]*background:#442f28/);
});

test('Realtor landing has accessible responsive navigation and full-width mobile CTAs', () => {
  assert.match(landing, /<a className="pl-skip" href="#main">/);
  assert.match(landing, /aria-labelledby="rl-steps-title"/);
  assert.match(landing, /<details className="rl-mobile-menu">/);
  assert.match(css, /\.rl-mobile-menu summary\{[^}]*min-width:44px;min-height:44px/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.rl-actions \.rl-button\{width:100%\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.rl-button/);
});
