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
  const banned = /\bsubscription\b|\bsubscribe\b|\bsubscriber\b|premium (user|realtor|plan)|\bmembership tier\b|\bupgrade your\b|\bunlock powerful\b/i;
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

test('no legacy $6.99 pricing remains, and no pricing was newly scattered across the product', () => {
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, /\$6\.99/, `${file} still shows the old $6.99 figure`);
  }
  // $7.99 is the future price; it should not appear anywhere yet, since this
  // pass is copy/terminology only and checkout doesn't exist.
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, /\$7\.99/, `${file} introduces pricing ahead of checkout/paywall work`);
  }
});

test('FLH+ is introduced only where collaboration/full-search functionality is actually described', () => {
  assert.match(publicLanding, /With FLH\+, invite your co-buyer and Realtor/);
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

test('no entitlement, paywall, or fake-locked-state behavior was introduced alongside the copy pass', () => {
  for (const { file, content } of srcContents) {
    assert.doesNotMatch(content, /entitlement|has_flh_plus|flh_plus_search|isEntitled|stripe|checkout/i, `${file} appears to add entitlement/checkout logic, which this pass must not do`);
  }
  assert.doesNotMatch(peoplePage, /Waiting for FLH\+/i);
  assert.doesNotMatch(realtorHome, /Waiting for FLH\+/i);
});

test('no database entitlement/pricing migration was added in this pass', () => {
  const migrationFiles = readdirSync(path.join(rootDir, 'supabase', 'migrations'));
  for (const name of migrationFiles) {
    if (!/flh.?plus|entitlement|stripe|checkout|pricing/i.test(name)) continue;
    assert.fail(`Unexpected entitlement-looking migration added: ${name}`);
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
