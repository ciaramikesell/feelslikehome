// Add Home V3, phase 4: reliable, cost-conscious property lookups
// (docs/add-home-v3-lookup-efficiency.md). Strict property identity, the
// per-session lookup cache, address duplicates before any request, the
// busy cooldown and session cap, the best-effort per-user limit, and clearing
// one property's provider data before another property's arrives.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { documentedProperty, documentedSaleListing, documentedPropertyWithFeatures, documentedSaleListingWithHistory } from './support/rentcastDocumentedShapes.js';

register('./support/aliasHooks.mjs', import.meta.url);
const { propertyAddressKey, normalizeRentCastFields } = await import('../src/lib/rentcast.js');
const { SESSION_LOOKUP_LIMIT, BUSY_COOLDOWN_MS, appliedImportFields, findHomeByAddress, lookupCacheKey, revertAppliedFields } = await import('../src/lib/lookupSession.js');
const { createLookupLimiter, USER_LOOKUP_LIMIT, USER_LOOKUP_WINDOW_MS } = await import('../src/lib/lookupRateLimit.js');
const { lookupRentCast } = await import('../src/lib/rentcastLookup.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { emptyHome } = await import('../src/lib/constants.js');
const { getHomesForUser, saveHomePersonalAndShared } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/HomeModal.jsx');
const route = read('src/app/api/import-listing/route.js');

/* ------------------------------- property identity ------------------------------- */

test('strict property identity: formatting variants match; units, directions, streets and missing parts never collapse', () => {
  const key = propertyAddressKey('100 Main St, Springfield, MI 48000');
  assert.equal(propertyAddressKey('100 Main Street, Springfield, MI 48000-1234'), key);
  assert.equal(propertyAddressKey('100 MAIN ST., Springfield, MI 48000, USA'), key);
  for (const other of ['100 Main St Apt 4, Springfield, MI 48000', '100 N Main St, Springfield, MI 48000', '100 Main Ave, Springfield, MI 48000', '102 Main St, Springfield, MI 48000', '100 Main St, Springfield, MI 48001', '100 Main St, Springfield, MI']) {
    assert.notEqual(propertyAddressKey(other), key, other);
  }
  for (const vague of ['Main St', 'Springfield, MI', '', null, 'Oak Ridge Apartments']) assert.equal(propertyAddressKey(vague), null, String(vague));
});

test('the session cache key separates listing kinds and never merges two addresses', () => {
  assert.equal(lookupCacheKey('100 Main St, Springfield, MI 48000', 'sale'), lookupCacheKey('100 Main Street, Springfield, MI 48000', 'sale'));
  assert.notEqual(lookupCacheKey('100 Main St, Springfield, MI 48000', 'sale'), lookupCacheKey('100 Main St, Springfield, MI 48000', 'rental'));
  assert.notEqual(lookupCacheKey('100 Main St Apt 4, Springfield, MI 48000'), lookupCacheKey('100 Main St Apt 5, Springfield, MI 48000'));
  // An address FLH can't identify strictly keys on its exact text: no near-miss sharing.
  assert.notEqual(lookupCacheKey('100 Main St, Springfield'), lookupCacheKey('100 Main St, Springfeld'));
  assert.equal(lookupCacheKey('100 Main St, Springfield'), lookupCacheKey('  100 main st,  springfield '));
});

test('address duplicates: only the same property, only saved homes', () => {
  const homes = [{ id: 'h1', address: '100 Main St, Springfield, MI 48000' }, { id: 'h2', address: '7 Oak Ct Unit 2, Springfield, MI 48000' }, { address: '9 Pine Rd, Springfield, MI 48000' }];
  assert.equal(findHomeByAddress(homes, '100 Main Street, Springfield, MI 48000')?.id, 'h1');
  assert.equal(findHomeByAddress(homes, '7 Oak Ct Unit 2, Springfield, MI 48000')?.id, 'h2');
  assert.equal(findHomeByAddress(homes, '7 Oak Ct Unit 3, Springfield, MI 48000'), null, 'another unit is another home');
  assert.equal(findHomeByAddress(homes, '9 Pine Rd, Springfield, MI 48000'), null, 'an unsaved draft is not a duplicate');
  assert.equal(findHomeByAddress(homes, '100 Main St, Springfield, MI'), null, 'a missing ZIP is not enough to call it the same');
  assert.equal(findHomeByAddress(homes, ''), null);
  assert.equal(findHomeByAddress(null, '100 Main St, Springfield, MI 48000'), null);
});

/* --------------------------- one property's data at a time --------------------------- */

test('switching properties takes back only what the previous lookup wrote; buyer edits stay', () => {
  const lookupA = normalizeRentCastFields(documentedPropertyWithFeatures(), documentedSaleListingWithHistory(), { requestedAddress: '100 Example Ln, Testville, MI 48000' });
  const start = { ...emptyHome(), address: '100 Example Ln, Testville, MI 48000', notes: 'Call agent' };
  const withA = mergeImportFields(start, lookupA.fields);
  const applied = appliedImportFields(start, withA);
  assert.ok(Object.keys(applied).includes('price') && Object.keys(applied).includes('beds'));
  assert.equal('notes' in applied, false);
  // The buyer changes beds and types a lot size before switching.
  const edited = { ...withA, beds: '4', lotSize: '0.5 acres' };
  const { form: cleared, cleared: keys } = revertAppliedFields(edited, applied);
  assert.equal(cleared.price, emptyHome().price, 'provider price cleared');
  assert.equal(cleared.hoaFeeMonthly, null, 'a $0 provider HOA fee is cleared to Unknown, not kept as $0');
  assert.equal(cleared.beds, '4', 'the buyer’s edit is kept');
  assert.equal(cleared.notes, 'Call agent');
  assert.ok(keys.includes('price') && !keys.includes('beds'));
  // Property B (inactive: no price) then fills only what is empty: nothing of A survives.
  const lookupB = normalizeRentCastFields(documentedProperty({ formattedAddress: '200 Other Rd, Testville, MI 48000' }), documentedSaleListing({ formattedAddress: '200 Other Rd, Testville, MI 48000', status: 'Inactive' }), { requestedAddress: '200 Other Rd, Testville, MI 48000' });
  const withB = mergeImportFields({ ...cleared, address: '200 Other Rd, Testville, MI 48000' }, lookupB.fields);
  assert.equal(withB.price, emptyHome().price, 'A’s asking price does not carry over to inactive B');
  assert.equal(withB.daysOnMarket, emptyHome().daysOnMarket);
  // Without the revert (the old behaviour), A's price would have survived.
  assert.equal(mergeImportFields(withA, lookupB.fields).price, withA.price);
});

/* --------------------------------- usage safeguards --------------------------------- */

test('per-user limit: allows the limit, then refuses until the window passes; users are independent', () => {
  const limiter = createLookupLimiter({ limit: 3, windowMs: 1000 });
  assert.deepEqual([1, 2, 3].map((n) => limiter.take('u1', n).allowed), [true, true, true]);
  const refused = limiter.take('u1', 10);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterMs > 0 && refused.retryAfterMs <= 1000);
  assert.equal(limiter.take('u2', 10).allowed, true, 'another user is unaffected');
  assert.equal(limiter.take('u1', 1002).allowed, true, 'the window slides');
  assert.equal(limiter.take('', 5).allowed, false, 'no user, no lookup');
  // Memory stays bounded.
  const small = createLookupLimiter({ limit: 1, windowMs: 1000, maxUsers: 2 });
  ['a', 'b', 'c'].forEach((user) => small.take(user, 1));
  assert.equal(small.take('a', 2).allowed, true, 'the oldest user was evicted');
  assert.equal(USER_LOOKUP_LIMIT, 20);
  assert.equal(USER_LOOKUP_WINDOW_MS, 10 * 60 * 1000);
  assert.equal(SESSION_LOOKUP_LIMIT, 8);
  assert.equal(BUSY_COOLDOWN_MS, 60 * 1000);
});

test('route: signed-in only; the limit is checked before any RentCast request; nothing personal in the response or logs', () => {
  assert.ok(route.indexOf('auth.getUser()') < route.indexOf('limiter.take(user.id)'));
  assert.ok(route.indexOf('limiter.take(user.id)') < route.indexOf('await lookupRentCast('));
  assert.match(route, /\{ error: 'You’ve looked up a lot of addresses in a short time\.', reason: 'user_limit' \},\s*\{ status: 429, headers: \{ 'Retry-After':/);
  assert.match(route, /console\.warn\('import-listing: per-user lookup limit reached'\);/);
  assert.doesNotMatch(route, /console\.\w+\([^)]*(?:user\.id|address|apiKey)/);
  assert.match(route, /process\.env\.IMPORT_LOOKUP_USER_LIMIT/);
});

test('Add Home: duplicates and the session cache come before any request; failures are never cached; busy waits', () => {
  const lookup = modal.match(/const lookupAddress = async \(rawAddress, opts = \{\}\) => \{[\s\S]*?\n {2}\};/)[0];
  const at = (needle) => lookup.indexOf(needle);
  assert.ok(at('findHomeByAddress(existingHomes, address)') > 0 && at('findHomeByAddress(existingHomes, address)') < at("fetch('/api/import-listing'"));
  assert.ok(at('lookupCache.current.get(cacheKey)') < at("fetch('/api/import-listing'"));
  assert.ok(at('Date.now() < cooldownUntil.current') < at("fetch('/api/import-listing'"));
  assert.ok(at('networkLookups.current >= SESSION_LOOKUP_LIMIT') < at("fetch('/api/import-listing'"));
  // Only a successful response is cached.
  assert.ok(at('lookupCache.current.set(cacheKey, data)') > at('if (!res.ok) {'));
  assert.match(lookup, /if \(res\.status === 429\) \{[\s\S]*?cooldownUntil\.current = Date\.now\(\)/);
  assert.match(lookup, /if \(!address \|\| importPhase === 'loading' \|\| lookupInFlight\.current \|\| address === lastLookupAddress\) return;/, 'repeated clicks and the same address make no request');
  assert.ok(at('lookupInFlight.current = true;') < at("fetch('/api/import-listing'"), 'set before the first await');
  assert.match(lookup, /\} finally \{\s*lookupInFlight\.current = false;\s*\}/);
  // One property's data at a time.
  // What to clear is captured before importApplied is reset: the updater runs at render, later.
  assert.match(lookup, /setForm\(\(f\) => \(\{ \.\.\.\(hadPrevious \? clearPreviousProperty\(f, previous, previousUsed\) : f\), address,/);
  assert.ok(at('const previous = { ...importApplied.current };') < at('importApplied.current = {};'));
  assert.match(lookup, /importApplied\.current = appliedImportFields\(f, merged\);/);
  assert.match(modal, /lookupAddress\(raw, \{ listingUrl: '' \}\);/, 'a plain address drops an earlier find’s link');
  // The manual path stays: every no-request safeguard ends on the address card.
  for (const reason of ['user_limit', 'session_limit', 'cooldown']) assert.match(modal, new RegExp(`${reason}: '[^']*Add (?:the address|this home by its address)`));
  // Save re-checks both URL and address duplicates.
  assert.match(modal, /const sameProperty = findHomeByAddress\(existingHomes, form\.address\);\s*if \(sameProperty\) \{ setDuplicateReason\('address'\); setDuplicateHome\(sameProperty\); return; \}\s*submit\(\{ quickSave: true \}\);/);
});

test('still exactly two RentCast requests per lookup', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => { calls += 1; return new Response(JSON.stringify(String(url).includes('/v1/properties') ? [documentedProperty()] : [documentedSaleListing()]), { status: 200 }); };
  try {
    await lookupRentCast('100 Example Ln, Testville, MI 48000', 'sale', 'k');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = realFetch; }
});

/* --------------------------------- real Postgres --------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.lookupeff@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
});
after(() => db?.drop());

dbTest('switching properties then saving: the row holds only the second property; the saved first home is untouched; it is found as a duplicate', async () => {
  const owner = db.clientFor(ids.owner);
  const A = '100 Example Ln, Testville, MI 48000';
  const B = '200 Other Rd, Testville, MI 48000';
  // A saved home already in the search.
  const savedA = await saveHomePersonalAndShared(owner, { ...emptyHome(), address: A, price: '289000', notes: 'kept' }, ids.owner, ids.search);
  const homes = await getHomesForUser(owner, ids.owner, ids.search);
  assert.equal(findHomeByAddress(homes, '100 Example Lane, Testville, MI 48000')?.id, savedA.id, 'a new lookup for A would open it, with no request');
  // A session that looked up C first, then switched to B (inactive).
  const lookupC = normalizeRentCastFields(documentedProperty({ formattedAddress: '300 Third St, Testville, MI 48000' }), documentedSaleListing({ formattedAddress: '300 Third St, Testville, MI 48000' }), { requestedAddress: '300 Third St, Testville, MI 48000' });
  const start = { ...emptyHome(), address: '300 Third St, Testville, MI 48000' };
  const withC = mergeImportFields(start, lookupC.fields);
  const reverted = revertAppliedFields(withC, appliedImportFields(start, withC)).form;
  const lookupB = normalizeRentCastFields(documentedProperty({ formattedAddress: B }), documentedSaleListing({ formattedAddress: B, status: 'Inactive' }), { requestedAddress: B });
  const form = mergeImportFields({ ...reverted, address: B }, lookupB.fields);
  const savedB = await saveHomePersonalAndShared(owner, { ...form, listingImport: listingImportSnapshot({ ...lookupB, searchedAddress: B }, 'x') }, ids.owner, ids.search);
  const row = db.admin(`select address, price, days_on_market, listing_import from public.homes where id = '${savedB.id}'`)[0];
  assert.deepEqual([row.address, row.price, row.days_on_market], [B, '', '']);
  assert.equal(row.listing_import.listing.status, 'inactive');
  assert.ok(!JSON.stringify(row.listing_import).includes('300 Third'), 'no trace of the other property');
  const rowA = db.admin(`select address, price, notes from public.homes where id = '${savedA.id}'`)[0];
  assert.deepEqual([rowA.address, rowA.price, rowA.notes], [A, '289000', 'kept'], 'the saved home was not modified');
});
