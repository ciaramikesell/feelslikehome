const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('src/app/for-realtors/page.js', 'utf8');
const landing = fs.readFileSync('src/components/RealtorLanding.jsx', 'utf8');
const publicLanding = fs.readFileSync('src/components/PublicLanding.jsx', 'utf8');
const auth = fs.readFileSync('src/components/auth/AuthForm.jsx', 'utf8');
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

test('page explains draft provenance, buyer ownership, and implemented contributions', () => {
  for (const phrase of ['Realtor-entered draft context', 'Match always belongs to the buyer', 'make changes', 'Suggest a listing', 'recommend tours', 'Buyers keep their own priorities and Match']) {
    assert.match(landing, new RegExp(phrase, 'i'));
  }
  assert.match(landing, /Illustrative workspace preview/);
  assert.equal((landing.match(/\[\w+, '[^']+', '[^']+'\]/g) || []).length, 4);
});

test('Realtor landing has accessible responsive navigation and full-width mobile CTAs', () => {
  assert.match(landing, /<a className="pl-skip" href="#main">/);
  assert.match(landing, /aria-labelledby="rl-steps-title"/);
  assert.match(landing, /<details className="rl-mobile-menu">/);
  assert.match(css, /\.rl-mobile-menu summary\{[^}]*min-width:44px;min-height:44px/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.rl-actions \.rl-button\{width:100%\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.rl-button/);
});
