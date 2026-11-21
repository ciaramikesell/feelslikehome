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
  assert.match(previews, /alt=\{alt\}/);
  for (const panel of ['priorities', 'listings', 'compare', 'collaborate']) {
    assert.ok(fs.existsSync(`public/images/homepage-previews/${panel}.webp`));
  }
  assert.match(css, /\.pl-editorial-feature > img \{[^}]*aspect-ratio: 4 \/ 3/);
  assert.match(previews, /do not imply affiliation or direct integration/);
  assert.ok(fs.existsSync('public/images/Warm Cottage.png'));
  assert.match(previews, /Illustrative mockups/);
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

test('editorial sliding showcase keeps four concepts and original native fallback', () => {
  for (const title of ['Set Your Preferences', 'Import Homes from Anywhere', 'Compare What Matters', 'Search & Decide Together']) assert.ok(previews.includes(title));
  for (const copy of ['Decide what matters most to you.', 'Bring your saved listings together.', 'See how each home fits your priorities.', 'Make decisions with your co-buyer and Realtor.']) assert.ok(previews.includes(copy));
  assert.match(landing, /<PublicHomeFeatures \/>/);
  assert.match(previews, /id="how-it-works"[^>]*tabIndex=\{-1\}/);
  assert.match(previews, /<h2 className="pl-eyebrow" id="how-title">How it works<\/h2>/);
  assert.match(previews, /<article[^>]*aria-labelledby=/);
  assert.match(previews, /width=\{1448\} height=\{1086\} loading="lazy"/);
  assert.doesNotMatch(previews, /aria-pressed|onPointerEnter/);
  assert.match(previews, /setWebShowcase\(!isNativeApp\(\) && !root.hasAttribute\(NATIVE_SHELL_ATTRIBUTE\)\)/);
  assert.match(previews, /<PublicFeatureArtwork id=\{id\} alt=\{alt\}/);
  assert.match(previews, /className="pl-native-feature-fallback"/);
  assert.match(css, /grid-template-areas: 'copy art'/);
  assert.match(css, /grid-template-areas: 'art' 'copy'/);
  assert.doesNotMatch(landing + previews, /Choosing a home doesn’t happen alone|pl-collaboration|youtube|<iframe/);
  assert.match(landing, /className="pl-section-divider" aria-hidden="true"/);
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /max-width: 1199px[^}]+repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /min-height: clamp\(640px, 80svh, 920px\)/);
});
