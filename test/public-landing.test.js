const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const landing = fs.readFileSync('src/components/PublicLanding.jsx', 'utf8');
const root = fs.readFileSync('src/app/page.js', 'utf8');
const signup = fs.readFileSync('src/app/auth/sign-up/page.js', 'utf8');
const authForm = fs.readFileSync('src/components/auth/AuthForm.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('signed-out visitors receive the public landing while signed-in routing remains intact', () => {
  assert.match(root, /if \(!user\) return <PublicLanding \/>/);
  assert.match(root, /if \(!profile\?\.onboarding_complete\) redirect\('\/onboarding'\)/);
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

test('landing is limited to the four-step workflow, product proof, and consolidated collaboration', () => {
  for (const title of ['Set Your Preferences', 'Bring Homes From Anywhere', 'Compare What Matters', 'Search Together']) {
    assert.match(landing, new RegExp(`'${title}'`));
  }
  assert.doesNotMatch(landing, /\['0[1-4]',|pl-step-number/);
  assert.equal((landing.match(/\[(ListChecks|HousePlus|Heart|Users),/g) || []).length, 4);
  assert.doesNotMatch(landing, /pl-together|pl-philosophy|pl-final/);
  assert.doesNotMatch(landing, /Same home\.|Ready to understand your shortlist|THE FEELS LIKE HOME PHILOSOPHY/);
});

test('product proof is static, concise, and owns the philosophy statement exactly once', () => {
  const philosophy = 'The right home isn’t the one that checks the most boxes. It’s the one that checks the boxes that matter to you.';
  assert.equal(landing.split(philosophy).length - 1, 1);
  assert.match(landing, /<figure className="pl-demo-art"><Image/);
  assert.doesNotMatch(landing, /<button[^>]*className="pl-demo|<Link[^>]*className="pl-demo/);
  for (const benefit of ['Personalized Match Scores', 'Side-by-side comparison', 'Commute times from places that matter most', 'Built for buyers, co-buyers, and Realtors']) assert.match(landing, new RegExp(benefit));
});

test('hero makes the find-elsewhere/bring-here product model explicit, without losing the existing headline or workflow copy', () => {
  assert.match(landing, /Find homes wherever you already search\. Bring the ones you.re considering here\./);
  assert.match(landing, /Feels Like Home isn.t a listing search engine\. It.s where you compare the homes you.ve already found and figure out which one fits you best\./);
  assert.match(landing, /className="pl-model-explainer"/);
  // The approved headline, hero image, and downstream sections (How it
  // works -> product proof -> FLH+ bridge -> collaboration -> footer) are
  // untouched by this comprehension-only addition.
  assert.match(landing, /Now find the one that<\/span><em>Feels Like Home\.<\/em>/);
  assert.match(landing, /id="how-it-works"/);
  assert.match(landing, /id="demo-title"/);
  assert.match(landing, /id="flh-bridge-title"/);
  assert.match(landing, /id="collaboration-title"/);
  assert.match(landing, /<footer className="pl-footer">/);
});

test('collaboration keeps co-buyer and Realtor participation distinct', () => {
  assert.match(landing, /Searching with a co-buyer/);
  assert.match(landing, /Working with a Realtor/);
  assert.match(landing, /Ciara <b>92% Match/);
  assert.match(landing, /Andrew <b>84% Match/);
  assert.match(landing, /Unknown information stays Unknown/);
  assert.match(landing, /Learn more for agents/);
  assert.doesNotMatch(landing, /combined|blended household Match|compatibility score/i);
});
