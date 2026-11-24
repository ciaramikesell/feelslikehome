const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const landing = fs.readFileSync('src/components/PublicLanding.jsx', 'utf8');
const previews = fs.readFileSync('src/components/PublicHomeFeatures.jsx', 'utf8');
const root = fs.readFileSync('src/app/page.js', 'utf8');
const signup = fs.readFileSync('src/app/auth/sign-up/page.js', 'utf8');
const authForm = fs.readFileSync('src/components/auth/AuthForm.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('signed-out visitors receive the public landing while signed-in routing remains intact', () => {
  assert.match(root, /if \(!user\) return <><NativeWelcome \/><div className=\"flh-web-entry\"><PublicLanding \/><\/div><\/>;/);
  assert.match(root, /redirect\(realtor \? REALTOR_WORKSPACE_PATH : '\/onboarding'\)/);
  assert.match(root, /redirect\('\/homes'\)/);
});

test('public navigation exposes only truthful account and explanation entries', () => {
  for (const label of ['How it works', 'For Realtors', 'Sign in', 'Get started']) assert.match(landing, new RegExp(label));
  assert.match(landing, /href="#how-it-works"/);
  assert.match(landing, /const realtorHref = '\/for-realtors'/);
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

test('landing uses the approved cottage and four local preview illustrations', () => {
  assert.match(landing, /\/images\/Warm Cottage\.png/);
  assert.match(previews, /<PublicFeatureArtwork id=\{id\} alt=\{alt\} \/>/);
  for (const panel of ['priorities', 'listings', 'compare', 'collaborate']) {
    assert.ok(fs.existsSync(`public/images/homepage-previews/${panel}.webp`));
    assert.match(previews, new RegExp(`id: '${panel}'`));
  }
  assert.match(previews, /do not imply affiliation or direct integration/);
  assert.match(previews, /Illustrative mockups/);
  assert.ok(fs.existsSync('public/images/Warm Cottage.png'));
});

test('Realtor entry preserves intent without introducing an account role', () => {
  assert.match(authForm, /account_entry_intent: 'realtor'/);
  assert.match(authForm, /relationship-scoped/);
  assert.doesNotMatch(authForm, /users\.role|profiles\.role|role:\s*'realtor'/);
});

test('landing includes responsive and reduced-motion-aware visual foundations', () => {
  assert.match(css, /--brick-deep:/);
  assert.match(css, /--positive:/);
  assert.match(css, /--negative:/);
  assert.match(css, /--unknown:/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.pl-hero/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the web hero keeps the requested desktop copy and signup-first CTA', () => {
  assert.match(landing, /You’ve saved a lot of options\.<\/span>.*Now find the one that/);
  assert.doesNotMatch(landing + previews, /Import the homes you’ve already saved/);
  assert.doesNotMatch(landing, /pl-lede/);
  assert.match(landing, /href="\/auth\/sign-up">Create a free account/);
  assert.doesNotMatch(landing, /\/guest|Real estate, reimagined|>See how it works</);
});

test('How It Works is one large tabbed story with four concepts and a short page', () => {
  for (const title of ['Rank what matters', 'Save homes from anywhere', 'See your personal Match', 'Decide together']) assert.ok(previews.includes(title));
  assert.match(previews, /unknown isn’t no/);
  assert.match(previews, /Everyone keeps their own priorities and their own Match/);
  assert.doesNotMatch(landing + previews, /combined|household Match|dream home|perfect match|AI-powered|we find|finds listings/i);
  assert.match(landing, /<PublicHomeFeatures \/>/);
  assert.match(previews, /id="how-it-works"[^>]*tabIndex=\{-1\}/);
  assert.match(previews, /role="tablist"/);
  assert.match(previews, /role="tab"/);
  assert.match(previews, /role="tabpanel"/);
  assert.match(previews, /aria-selected=\{active === index\}/);
  assert.match(previews, /tabIndex=\{active === index \? 0 : -1\}/);
  assert.match(previews, /hidden=\{active !== index\}/);
  assert.doesNotMatch(previews, /setInterval|setTimeout|autoplay/i);
  assert.match(previews, /<noscript><style>/);
  // Page stays short: hero, one showcase, one closing invitation, footer.
  assert.equal((landing.match(/<section /g) || []).length, 2);
  assert.match(landing, /className="pl-closing"/);
  assert.match(landing, /Your shortlist deserves/);
  assert.doesNotMatch(landing + previews, /youtube|<iframe/);
});

test('hero note shows unknown facts as unknown, never as mismatches', () => {
  assert.match(landing, /label: 'Garage', state: 'Not listed yet', met: false/);
  assert.match(landing, /Unknown isn’t no\./);
  assert.match(css, /\.pl-hero-note li\.is-unknown small \{[^}]*background: #f1ebe4/);
});
