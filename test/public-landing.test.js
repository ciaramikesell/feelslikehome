const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const landing = fs.readFileSync('src/components/PublicLanding.jsx', 'utf8');
const root = fs.readFileSync('src/app/page.js', 'utf8');
const signup = fs.readFileSync('src/app/auth/sign-up/page.js', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('signed-out visitors receive the public landing while signed-in routing remains intact', () => {
  assert.match(root, /if \(!user\) return <PublicLanding \/>/);
  assert.match(root, /if \(!profile\?\.onboarding_complete\) redirect\('\/onboarding'\)/);
  assert.match(root, /redirect\('\/homes'\)/);
});

test('public navigation exposes only truthful account and explanation entries', () => {
  for (const label of ['How it works', 'For Realtors', 'Sign in', 'Get started']) assert.match(landing, new RegExp(label));
  assert.match(landing, /href="#how-it-works"/);
  assert.match(landing, /\/auth\/sign-up\?intent=realtor/);
  assert.doesNotMatch(landing, />Buy</);
  assert.doesNotMatch(landing, />Sell</);
  assert.doesNotMatch(landing, /Verified Listings|Walk Score|school ratings|safety score/i);
});

test('demo distinguishes matched, mismatch, and unknown sample information', () => {
  for (const address of ['123 Main Street', '789 Prairie Lane', '545 Cannon Drive']) assert.match(landing, new RegExp(address));
  assert.match(landing, /kind === 'miss' \? 'does not match' : 'Unknown'/);
  assert.match(landing, /Illustrative sample data — not a live listing/);
  assert.match(landing, /role="tablist"/);
  assert.match(landing, /aria-selected=/);
});

test('Realtor entry preserves intent without introducing an account role', () => {
  assert.match(signup, /account_entry_intent: 'realtor'/);
  assert.match(signup, /relationship-scoped/);
  assert.doesNotMatch(signup, /users\.role|profiles\.role|role:\s*'realtor'/);
});

test('landing includes responsive and reduced-motion-aware visual foundations', () => {
  assert.match(css, /--brick-deep:/);
  assert.match(css, /--positive:/);
  assert.match(css, /--negative:/);
  assert.match(css, /--unknown:/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.pl-hero/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
