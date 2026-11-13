// Add Home V3, phase 4: reliable, cost-conscious property lookups
// (docs/add-home-v3-lookup-efficiency.md). Strict property identity, the
// per-session lookup cache, address duplicates before any request, the
// busy cooldown and session cap, the best-effort per-user limit, and property
// isolation: a Find for a different property starts a fresh draft (asking first
// when the draft holds the buyer's own content), so nothing of one property's
// is ever saved on another; the same property keeps the draft.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { documentedProperty, documentedSaleListing, documentedPropertyWithFeatures, documentedSaleListingWithHistory } from './support/rentcastDocumentedShapes.js';

register('./support/aliasHooks.mjs', import.meta.url);
const { propertyAddressKey, normalizeRentCastFields } = await import('../src/lib/rentcast.js');
const { SESSION_LOOKUP_LIMIT, BUSY_COOLDOWN_MS, appliedImportFields, draftBuyerContent, draftContentPhrase, findHomeByAddress, findSwitchPlan, freshDraft, lookupCacheKey, sameProperty } = await import('../src/lib/lookupSession.js');
const { suggestListingAnswers, applyListingAnswer, resuggestListingAnswers } = await import('../src/lib/listingTextAnswers.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { createLookupLimiter, USER_LOOKUP_LIMIT, USER_LOOKUP_WINDOW_MS } = await import('../src/lib/lookupRateLimit.js');
const { lookupRentCast } = await import('../src/lib/rentcastLookup.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { emptyHome } = await import('../src/lib/constants.js');
const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared } = await import('../src/lib/supabase/collaboration.js');

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

const A = '100 Example Ln, Testville, MI 48000';
const B = '200 Other Rd, Testville, MI 48000';
const FIRE = 'features:Fireplace';
const fireBuyer = () => addCriterion(applySearchChoice(normalizePriorities({}), 'home_buy'), { categoryKey: 'features', label: 'Fireplace', kind: 'check' }, 'must');
const lookupOf = (address, status = 'Active') => normalizeRentCastFields(documentedPropertyWithFeatures({ formattedAddress: address }), documentedSaleListingWithHistory({ formattedAddress: address, status }), { requestedAddress: address });
// A's unsaved draft as Add Home holds it: A's lookup, then everything a buyer can
// add before switching: notes / pros / cons, a corrected detail, a Match answer
// confirmed from pasted text, a rating, a shared fact added from that text, and
// the snapshot (A's listing evidence, pasted sentences).
function draftForA() {
  const lookup = lookupOf(A);
  const start = { ...emptyHome(), address: A };
  const withA = mergeImportFields(start, lookup.fields);
  const applied = appliedImportFields(start, withA);
  const [answer] = suggestListingAnswers('Gas fireplace in the den.', fireBuyer(), {}).filter((item) => item.key === FIRE);
  const usedFacts = { 'fact-basement': { id: 'fact-basement', field: 'basementStyle', value: 'walkout' } };
  const form = { ...withA, notes: 'Loved the yard', pros: 'Quiet street', cons: 'Small kitchen', beds: '4', basementStyle: 'walkout',
    checks: applyListingAnswer({}, answer, 'home_buy'), ratings: { 'tour:overall': 4 }, id: 'partial-save-of-A' };
  return { lookup, form, applied, usedFacts, pasteText: 'Gas fireplace in the den. Finished basement.' };
}

test('same property or a different one: strict identity decides, an unreadable link is never "the same"', () => {
  assert.equal(sameProperty(A, '100 Example Lane, Testville, MI 48000-1234'), true);
  assert.equal(sameProperty('100 Example Ln Apt 2, Testville, MI 48000', '100 Example Ln Apt 3, Testville, MI 48000'), false, 'another unit');
  assert.equal(sameProperty(A, B), false);
  assert.equal(sameProperty(A, ''), false);
  assert.equal(sameProperty('Oak Ridge Apartments', 'oak ridge apartments'), true, 'unidentifiable addresses compare as text');
  assert.equal(findSwitchPlan('', B, ['notes']), 'keep', 'no property yet: the first find keeps what was typed for it');
  assert.equal(findSwitchPlan(A, '100 Example Lane, Testville, MI 48000', ['notes', 'answers']), 'keep', 'same property: everything stays');
  assert.equal(findSwitchPlan(A, B, []), 'fresh');
  assert.equal(findSwitchPlan(A, B, ['photo']), 'confirm');
  assert.equal(findSwitchPlan(A, null, []), 'fresh', 'a link FLH can’t read an address from is another property');
  assert.equal(findSwitchPlan(A, null, ['notes']), 'confirm');
});

test('the buyer’s own content is recognised by kind; what a lookup or added fact wrote is not the buyer’s', () => {
  const { form, applied, usedFacts, pasteText } = draftForA();
  assert.deepEqual(draftBuyerContent({ form, applied, usedFacts, photoStaged: true, pasteText }), ['notes', 'photo', 'answers', 'listing', 'details']);
  assert.equal(draftContentPhrase(['notes', 'photo', 'answers', 'listing', 'details']), 'notes, photo, Match answers, pasted listing details and details you edited');
  // Only provider data: nothing to ask about.
  const lookup = lookupOf(A);
  const start = { ...emptyHome(), address: A };
  const onlyLookup = mergeImportFields(start, lookup.fields);
  assert.deepEqual(draftBuyerContent({ form: onlyLookup, applied: appliedImportFields(start, onlyLookup) }), []);
  assert.deepEqual(draftBuyerContent({ form: { ...onlyLookup, beds: '9' }, applied: appliedImportFields(start, onlyLookup) }), ['details'], 'a corrected detail');
  assert.deepEqual(draftBuyerContent({ form: { ...onlyLookup, basementStyle: 'walkout' }, applied: appliedImportFields(start, onlyLookup), usedFacts: { f: { field: 'basementStyle' } } }), ['listing'], 'an added fact counts as listing material');
  assert.equal(draftContentPhrase(['photo']), 'photo');
});

test('A (answers, notes, photo, facts, evidence) → B: the fresh draft and B’s save hold none of A', () => {
  const a = draftForA();
  const plan = findSwitchPlan(a.form.address, B, draftBuyerContent({ ...a, photoStaged: true }));
  assert.equal(plan, 'confirm', 'the buyer is asked first');
  const fresh = freshDraft(a.form);
  assert.deepEqual(fresh, emptyHome(), 'a fresh draft is an empty home');
  assert.equal(fresh.id, null, 'never A’s partial-save id: saving B can’t overwrite A’s row');
  const lookupB = lookupOf(B, 'Inactive');
  const formB = mergeImportFields({ ...fresh, address: B }, lookupB.fields);
  const snapshotB = listingImportSnapshot({ ...lookupB, searchedAddress: B }, 'x');
  const saved = JSON.stringify({ ...formB, listingImport: snapshotB });
  for (const trace of ['Loved the yard', 'Quiet street', 'Small kitchen', 'Gas fireplace', FIRE, 'tour:overall', '100 Example', 'partial-save-of-A']) assert.ok(!saved.includes(trace), trace);
  assert.equal(formB.price, emptyHome().price, 'inactive B has no asking price, and A’s is gone');
  assert.equal(formB.basementStyle, emptyHome().basementStyle, 'A’s added fact is gone');
  // An apartment search keeps only its property type.
  assert.equal(freshDraft({ propertyType: 'apartment', notes: 'x' }, { apartment: true }).propertyType, 'apartment');
  assert.equal(freshDraft({ propertyType: 'condo' }).propertyType, null);
});

test('same-property re-paste keeps the answers the buyer accepted; a different property never inherits them', () => {
  const buyer = fireBuyer();
  const [suggestion] = suggestListingAnswers('Gas fireplace in the den.', buyer, {}).filter((item) => item.key === FIRE);
  let checks = applyListingAnswer({}, suggestion, 'home_buy');
  let confirmed = { [FIRE]: true };
  for (const text of ['Bright kitchen.', 'No fireplace.']) {
    const rerun = resuggestListingAnswers(text, buyer, checks, confirmed, [suggestion]);
    assert.deepEqual(rerun.checks, { [FIRE]: true }, `re-paste: ${text}`);
    ({ checks, confirmed } = rerun);
  }
  // Same property found again under another spelling or link: the draft is kept as is.
  assert.equal(findSwitchPlan(A, '100 EXAMPLE LANE, Testville, MI 48000', ['answers']), 'keep');
  // A different property: never kept, at most asked about.
  assert.notEqual(findSwitchPlan(A, B, ['answers']), 'keep');
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
  // The limit is described as what it is: per instance, best-effort, never an account-wide quota.
  const doc = read('docs/add-home-v3-lookup-efficiency.md');
  assert.match(doc, /\*\*The per-user limit is best-effort\. It is not an account-wide quota and\s+guarantees no ceiling\.\*\*/);
  assert.doesNotMatch(doc, /no single account or bug can drain/i);
  assert.match(read('src/lib/lookupRateLimit.js'), /NOT an account-wide limit/);
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
  // A lookup never decides property isolation itself (handleFind does, before it).
  assert.match(lookup, /setForm\(\(f\) => \(\{ \.\.\.f, address, \.\.\.\(opts\.listingUrl !== undefined/);
  assert.match(lookup, /importApplied\.current = \{ \.\.\.importApplied\.current, \.\.\.appliedImportFields\(f, merged\) \};/);
  assert.match(modal, /lookupAddress\(raw, \{ listingUrl: '' \}\);/, 'a plain address drops an earlier find’s link');
  // The manual path stays: every no-request safeguard ends on the address card.
  for (const reason of ['user_limit', 'session_limit', 'cooldown']) assert.match(modal, new RegExp(`${reason}: '[^']*Add (?:the address|this home by its address)`));
  // Save re-checks both URL and address duplicates.
  assert.match(modal, /const sameProperty = findHomeByAddress\(existingHomes, form\.address\);\s*if \(sameProperty\) \{ setDuplicateReason\('address'\); setDuplicateHome\(sameProperty\); return; \}\s*submit\(\{ quickSave: true \}\);/);
});

test('Add Home: every Find decides isolation first; a different property is a fresh draft of every state path', () => {
  const find = modal.match(/const handleFind = \(input = findInput, \{ confirmed = false \} = \{\}\) => \{[\s\S]*?\n {2}\};/)[0];
  const at = (needle) => find.indexOf(needle);
  assert.match(find, /if \(!raw \|\| importPhase === 'loading' \|\| lookupInFlight\.current\) return;/, 'never mid-lookup');
  // Duplicates first (nothing in the draft changes), then the plan, then any lookup or link handling.
  assert.ok(at('findHomeByListingUrl(existingHomes, raw)') < at('findSwitchPlan('));
  assert.ok(at('findHomeByAddress(existingHomes, target)') < at('findSwitchPlan('));
  assert.ok(at("if (plan === 'confirm' && !confirmed)") < at('startFresh(form.address.trim())'));
  assert.ok(at('startFresh(form.address.trim())') < at('if (looksLikeUrl) {'), 'an unreadable link is handled on the fresh draft too');
  assert.ok(at('startFresh(form.address.trim())') < at('lookupAddress(raw'));
  assert.match(find, /draftBuyerContent\(\{ form, applied: importApplied\.current, usedFacts, photoStaged: !!photoFile, pasteText \}\)/);
  const fresh = modal.match(/const startFresh = \(fromAddress\) => \{[\s\S]*?\n {2}\};/)[0];
  for (const reset of ['setPhotoFile(null)', 'setPhotoPreviewUrl(null)', "setPasteText('')", 'setAnswerSuggestions([])', 'setAnswerDecisions({})', 'setConfirmedAnswers({})',
    'setFactSuggestions([])', 'setFactDecisions({})', 'setUsedFacts({})', 'setAcceptedSuggestionIds([])', "setReviewedText('')", 'setImportResult(null)',
    'setProviderResult(null)', "setLastLookupAddress('')", 'importApplied.current = {}', 'setForm((f) => freshDraft(f, { apartment: vocabulary.apartment }))']) {
    assert.ok(fresh.includes(reset), reset);
  }
  // The session's cache, request count and cooldown are not the property's: they stay.
  for (const kept of ['lookupCache', 'networkLookups', 'cooldownUntil']) assert.ok(!fresh.includes(kept), kept);
  // The question: Start fresh replays the same find, confirmed; Keep changes nothing.
  assert.match(modal, /const confirmSwitch = \(\) => \{ const input = pendingSwitch\?\.input; setPendingSwitch\(null\); if \(input\) handleFind\(input, \{ confirmed: true \}\); \};/);
  assert.match(modal, /const keepCurrentProperty = \(\) => \{ setPendingSwitch\(null\); setFindInput\(form\.listingUrl \|\| form\.address\); \};/);
  assert.match(modal, /onClick=\{\(\) => handleFind\(\)\}/, 'the button never passes its click event as the input');
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
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.lookupeff@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.lookupeff@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.lookupeff@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

const row = (id) => db.admin(`select id, address, price, notes, pros, cons, photo_url, basement_style, listing_url, listing_import from public.homes where id = '${id}'`)[0];
const states = (id) => db.admin(`select user_id, checks, ratings from public.home_member_state where home_id = '${id}'`);
const homeAt = (address) => db.admin(`select id from public.homes where search_id = '${ids.search}' and address = '${address}'`);
// What Add Home saves for a draft: the form plus the snapshot of its import (as submit() does).
const saveDraft = (user, form, lookup) => saveHomePersonalAndShared(db.clientFor(user), { ...form, ...(lookup ? { listingImport: listingImportSnapshot({ ...lookup, searchedAddress: form.address }, 'x') } : {}) }, user, ids.search);

dbTest('A with answers, notes, photo, facts and pasted evidence → B → Save: B’s row and both buyers’ state hold none of A; A’s partial row is untouched', async () => {
  const a = draftForA();
  // A was partly saved earlier (its shared row exists: the partial-save id in the draft).
  const partialA = await saveDraft(ids.owner, { ...a.form, id: null, photoUrl: 'https://example.test/a.jpg' }, a.lookup);
  a.form.id = partialA.id;
  const before = row(partialA.id);
  // Switch: the buyer is asked (confirm), starts fresh, B is found and saved.
  assert.equal(findSwitchPlan(a.form.address, B, draftBuyerContent({ ...a, photoStaged: true })), 'confirm');
  const lookupB = lookupOf(B, 'Inactive');
  const formB = mergeImportFields({ ...freshDraft(a.form), address: B }, lookupB.fields);
  const savedB = await saveDraft(ids.owner, formB, lookupB);
  assert.notEqual(savedB.id, partialA.id, 'a new row, never an upsert over A');
  const b = row(savedB.id);
  assert.deepEqual([b.address, b.price, b.notes, b.pros, b.cons, b.photo_url, b.basement_style], [B, '', '', '', '', '', null]);
  assert.ok(!JSON.stringify(b.listing_import).includes('100 Example') && !JSON.stringify(b.listing_import).includes('Gas fireplace'), 'no A evidence in B’s snapshot');
  assert.ok(states(savedB.id).every((state) => !Object.keys(state.checks || {}).length && !Object.keys(state.ratings || {}).length), 'no answers or ratings for anyone on B');
  assert.deepEqual(row(partialA.id), before, 'A’s row is unchanged');
});

dbTest('switching back to A in the same session contaminates neither property', async () => {
  const A2 = '300 Third St, Testville, MI 48000';
  const B2 = '400 Fourth Ave, Testville, MI 48000';
  const lookupA = lookupOf(A2);
  const lookupB = lookupOf(B2, 'Inactive');
  // A found, notes typed; → B (asked, fresh) with its own note; → back to A (asked, fresh), served by the session cache.
  const formA1 = { ...mergeImportFields({ ...emptyHome(), address: A2 }, lookupA.fields), notes: 'A note' };
  assert.equal(findSwitchPlan(A2, B2, ['notes']), 'confirm');
  const formB = { ...mergeImportFields({ ...freshDraft(formA1), address: B2 }, lookupB.fields), notes: 'B note' };
  assert.equal(findSwitchPlan(B2, A2, ['notes']), 'confirm');
  const formA2 = mergeImportFields({ ...freshDraft(formB), address: A2 }, lookupA.fields);
  const savedA = await saveDraft(ids.owner, formA2, lookupA);
  const a = row(savedA.id);
  assert.equal(a.notes, '', 'neither A’s abandoned note nor B’s');
  assert.equal(a.price, formA1.price, 'A’s own details, from A’s lookup');
  assert.ok(!JSON.stringify(a.listing_import).includes('400 Fourth'));
  assert.equal(homeAt(B2).length, 0, 'B was never saved');
  // Saving B later in a new session: only B.
  const savedB = await saveDraft(ids.owner, mergeImportFields({ ...emptyHome(), address: B2 }, lookupB.fields), lookupB);
  assert.deepEqual([row(savedB.id).price, row(savedB.id).notes], ['', '']);
  assert.ok(!JSON.stringify(row(savedB.id).listing_import).includes('300 Third'));
});

dbTest('A → B whose lookup fails → manual Save: only B’s address, no snapshot, nothing of A', async () => {
  const A3 = '500 Fifth Ct, Testville, MI 48000';
  const B3 = '600 Sixth Way, Testville, MI 48000';
  const formA = mergeImportFields({ ...emptyHome(), address: A3 }, lookupOf(A3).fields);
  assert.equal(findSwitchPlan(A3, B3, []), 'fresh', 'only provider data: no question, straight to a fresh draft');
  // The lookup for B fails: the address card holds the fresh draft with B's address.
  const saved = await saveDraft(ids.owner, { ...freshDraft(formA), address: B3 }, null);
  const b = row(saved.id);
  assert.deepEqual([b.address, b.price, b.notes, b.listing_import], [B3, '', '', null]);
  assert.equal(homeAt(A3).length, 0);
});

dbTest('owner and co-buyer stay independent: each switches and saves their own draft; answers stay per buyer', async () => {
  const OA = '700 Owner Ln, Testville, MI 48000';
  const CB = '800 Cobuyer Rd, Testville, MI 48000';
  // The owner saves OA with their answer and a note.
  const ownerA = await saveDraft(ids.owner, { ...mergeImportFields({ ...emptyHome(), address: OA }, lookupOf(OA).fields), notes: 'Owner note', checks: { [FIRE]: true } }, lookupOf(OA));
  // The co-buyer, in their own Add Home, looks up OA (already saved: the duplicate rule opens it, no request)…
  const homes = await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search);
  assert.equal(findHomeByAddress(homes, '700 Owner Lane, Testville, MI 48000')?.id, ownerA.id);
  // …then a draft for X with their own answer, switches to CB (asked, fresh), and saves CB.
  const X = '900 Ninth St, Testville, MI 48000';
  const draftX = { ...mergeImportFields({ ...emptyHome(), address: X }, lookupOf(X).fields), checks: { [FIRE]: 'no' }, notes: 'Co-buyer note on X' };
  assert.equal(findSwitchPlan(X, CB, draftBuyerContent({ form: draftX })), 'confirm');
  const savedCB = await saveDraft(ids.coBuyer, mergeImportFields({ ...freshDraft(draftX), address: CB }, lookupOf(CB, 'Inactive').fields), lookupOf(CB, 'Inactive'));
  assert.equal(row(savedCB.id).notes, '');
  assert.ok(states(savedCB.id).every((state) => !Object.keys(state.checks || {}).length), 'the co-buyer’s answer for X is not on CB, for anyone');
  // The owner's home and answers are exactly as they were; the co-buyer has none on it.
  assert.equal(row(ownerA.id).notes, 'Owner note');
  const onA = states(ownerA.id);
  assert.deepEqual(onA.find((state) => state.user_id === ids.owner).checks, { [FIRE]: true });
  assert.ok(onA.filter((state) => state.user_id !== ids.owner).every((state) => !Object.keys(state.checks || {}).length));
});
