import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relPath) => readFileSync(path.join(rootDir, relPath), 'utf8');

const publicLanding = read('src/components/PublicLanding.jsx');
const realtorLanding = read('src/components/RealtorLanding.jsx');
const realtorHome = read('src/app/(app)/realtor/page.js');
const peoplePage = read('src/app/(app)/people/page.js');
const inviteCoBuyer = read('src/components/InviteCoBuyer.jsx');
const mySearchPanel = read('src/components/MySearchPanel.jsx');
const authForm = read('src/components/auth/AuthForm.jsx');
const rootPage = read('src/app/page.js');
const layout = read('src/app/(app)/layout.js');

// Walk every user-facing source file this pass could plausibly have touched,
// to catch a stray "FLH Plus"/"Feels Like Home Plus"/lowercase variant or a
// reintroduced legacy price/subscription word anywhere, not just the files
// this PR happened to edit.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const srcFiles = walk(path.join(rootDir, 'src'));
const srcContents = srcFiles.map((file) => ({ file: path.relative(rootDir, file), content: readFileSync(file, 'utf8') }));

test('FLH+ is spelled exactly one way everywhere it appears in product copy', () => {
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, /FLH Plus|Feels Like Home Plus/i, `${file} uses a banned FLH+ variant`);
    // Catches "flh+"/"Flh+" while allowing the canonical "FLH+".
    const lowerVariant = content.match(/\bflh\+/g)?.filter((m) => m !== 'FLH+');
    assert.ok(!lowerVariant?.length, `${file} has a mis-cased FLH+`);
  }
});

test('no SaaS/subscription monetization language was introduced as consumer-facing copy', () => {
  // "not a subscription" is the one legitimate, explicitly-requested use —
  // the public FLH+ page states the negative to rule out recurring billing.
  // `data: { subscription: ... }` is destructuring Supabase's own
  // onAuthStateChange() return shape (an unsubscribe handle), not
  // consumer-facing copy — also excepted.
  // Any other/affirmative use of "subscription" is still banned.
  const banned = /(?<!not a )(?<!data: \{ )\bsubscription\b|\bsubscribe\b|\bsubscriber\b|premium (user|realtor|plan)|\bmembership tier\b|\bupgrade your\b|\bunlock powerful\b/i;
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, banned, `${file} introduces banned monetization language`);
  }
});

test('copy never establishes a global "user has FLH+" mental model — FLH+ belongs to the search', () => {
  const banned = /FLH\+ member|FLH\+ user|Plus member|you (are|have) (an? )?FLH\+|Realtor subscription|premium Realtor|FLH\+ Realtor/i;
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, banned, `${file} implies a global FLH+ user/role instead of a per-search entitlement`);
  }
});

test('no legacy $6.99 pricing remains, and $7.99 stays confined to the approved FLH+ pricing surfaces', () => {
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, /\$6\.99/, `${file} still shows the old $6.99 figure`);
  }
  // $7.99 is a legitimate static display value in exactly these places: the
  // Account Settings FLH+ card, the shared Free/FLH+ pricing cards (used by
  // both the homepage bridge section and the dedicated /flh-plus page), and
  // the homepage bridge's own headline. None of these are a working
  // purchase flow — see test/account-settings.test.js and
  // test/public-homepage-flh-plus.test.js for the "no real checkout" guards.
  const allowed = new Set([
    'src/components/account/SearchAccess.jsx',
    'src/components/FlhPlusCards.jsx',
    'src/components/FlhPlusLanding.jsx',
    'src/components/PublicLanding.jsx',
  ]);
  for (const { file, content } of srcContents) {
    if (allowed.has(file)) continue;
    assert.doesNotMatch(content, /\$7\.99/, `${file} introduces pricing ahead of checkout/paywall work`);
  }
});

test('FLH+ is introduced only where collaboration/full-search functionality is actually described', () => {
  // Superseded by the public-homepage FLH+ pass's own copy — see
  // test/public-homepage-flh-plus.test.js for the current exact wording.
  assert.match(publicLanding, /FLH\+/);
  assert.match(publicLanding, /Thoughtful collaboration · FLH\+/);
  assert.match(realtorLanding, /their FLH\+ search/);
  assert.match(realtorHome, /their FLH\+ search/);
  assert.match(inviteCoBuyer, /FLH\+/);
  assert.match(mySearchPanel, /FLH\+ unlocks for this search/);
  // Ordinary product nouns stay ordinary — not renamed or FLH+-prefixed.
  assert.doesNotMatch(peoplePage, /FLH\+/);
  assert.match(peoplePage, /People I.m Helping/);
});

test('Realtor accounts/workspace are described as free, never as something a Realtor purchases', () => {
  assert.match(realtorLanding, /Realtor accounts are free/);
  assert.doesNotMatch(realtorLanding, /Realtor.{0,40}\b(purchase|buy|pay for)\b/i);
  assert.doesNotMatch(realtorHome, /\b(purchase|buy|pay for)\b.{0,40}FLH\+/i);
});

test('no real payment/checkout integration exists anywhere in the product', () => {
  // "entitlement" itself is now a legitimate word in code comments (the
  // account-settings pass explicitly documents the seam it deliberately
  // leaves unimplemented — see test/account-settings.test.js) — what must
  // never appear is an actual payment provider integration.
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, /stripe|checkout\.session|payment_intent/i, `${file} appears to add real payment/checkout logic, which no pass so far may do`);
  }
  assert.doesNotMatch(peoplePage, /Waiting for FLH\+/i);
  assert.doesNotMatch(realtorHome, /Waiting for FLH\+/i);
});

test('no database payment/checkout migration was added', () => {
  const migrationFiles = readdirSync(path.join(rootDir, 'supabase', 'migrations'));
  for (const name of migrationFiles) {
    if (!/stripe|checkout|payment/i.test(name)) continue;
    assert.fail(`Unexpected payment-looking migration added: ${name}`);
  }
});

test('Realtor signup remains free workspace creation, non-authorizing, and unchanged by the copy pass', () => {
  assert.match(authForm, /account_entry_intent: 'realtor'/);
  assert.doesNotMatch(authForm, /users\.role|profiles\.role|role:\s*'realtor'/);
  assert.match(authForm, /isRealtorEntry \? 'Create your Realtor account' : 'Start your home search'/);
  assert.doesNotMatch(authForm, /FLH\+/);
});

test('post-signup routing and Realtor Home continuation are unchanged by this pass', () => {
  assert.match(rootPage, /account_entry_intent === 'realtor'\) redirect\('\/realtor'\)/);
  assert.match(layout, /isRealtorWorkspace = requestedPath\.startsWith\('\/people'\) \|\| requestedPath\.startsWith\('\/realtor'\)/);
});
