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

test('mobile public navigation keeps every primary destination discoverable', () => {
  assert.match(landing, /<details className="pl-mobile-menu">/);
  assert.match(landing, /<summary aria-label="Open navigation">/);
  assert.match(landing, /aria-label="Mobile public navigation"/);
  assert.match(css, /\.pl-mobile-menu summary\{[^}]*min-width:44px;min-height:44px/);
  assert.match(css, /\.pl-header>nav\{display:none\}/);
  assert.match(css, /\.pl-mobile-menu\{display:block/);
});

test('landing uses dedicated artwork and describes representative product data truthfully', () => {
  assert.match(landing, /\/images\/Warm Cottage\.png/);
  assert.match(landing, /\/images\/FLH Example\.png/);
  assert.doesNotMatch(landing, /landing-hero-home\.svg|landing-product-demo\.svg/);
  assert.ok(fs.existsSync('public/images/Warm Cottage.png'));
  assert.ok(fs.existsSync('public/images/FLH Example.png'));
  assert.match(landing, /Representative product illustration — not live listing data/);
  assert.match(landing, /Unknown information stays Unknown/i);
  assert.doesNotMatch(landing, /role="tablist"/);
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
