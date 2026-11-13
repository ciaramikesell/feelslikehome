// Add Home V3, phase 3: more from the RentCast responses FLH already receives
// (docs/add-home-v3-rentcast-context.md). County-record features (fireplace,
// pool, view, subdivision), listing type and listing history are read from the
// two existing requests, saved only in the existing snapshot, shown as dated,
// source-attributed context, and never become a Home Fact value or a Match
// answer. Shapes are documentation-derived (test/support/rentcastDocumentedShapes.js).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import {
  DOC_ADDRESS, documentedProperty, documentedPropertyWithFeatures, documentedSaleListing, documentedSaleListingWithHistory,
} from './support/rentcastDocumentedShapes.js';

register('./support/aliasHooks.mjs', import.meta.url);
const { normalizeRentCastFields, rentCastListingHistory, rentCastListingType } = await import('../src/lib/rentcast.js');
const { lookupRentCast } = await import('../src/lib/rentcastLookup.js');
const { countyRecordContext, listingSnapshotContext, listingSnapshotLines } = await import('../src/lib/listingContext.js');
const { recordListingAnswers } = await import('../src/lib/listingTextAnswers.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { emptyHome, normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ask = { requestedAddress: DOC_ADDRESS };
const facts = (result) => Object.fromEntries(result.listingFacts.map((item) => [item.key, item.value]));
const snapshotOf = (property, listing, importedAt = '2026-10-18T12:00:00.000Z') => {
  const lookup = normalizeRentCastFields(property, listing, ask);
  return listingImportSnapshot({ ...lookup, searchedAddress: DOC_ADDRESS }, importedAt);
};
const buyer = (...labels) => labels.reduce((next, [categoryKey, label]) => addCriterion(next, { categoryKey, label, kind: 'check' }, 'important'), applySearchChoice(normalizePriorities({}), 'home_buy'));

/* ------------------------------ county-record features ------------------------------ */

test('fireplace, pool, view and subdivision are read only when the record states them', () => {
  const got = facts(normalizeRentCastFields(documentedPropertyWithFeatures(), null, ask));
  assert.deepEqual([got.fireplace, got.pool, got.viewType, got.subdivision], ['Masonry', 'Concrete', 'City', 'EXAMPLE HILLS']);
  // A flag with no type is still "exists".
  const flagOnly = facts(normalizeRentCastFields(documentedPropertyWithFeatures({ features: { fireplaceType: undefined, poolType: '' } }), null, ask));
  assert.deepEqual([flagOnly.fireplace, flagOnly.pool], [true, true]);
});

test('a false, missing, null or odd county-record value is never reported (and never a No)', () => {
  for (const flags of [{ fireplace: false, pool: false }, { fireplace: null, pool: undefined }, { fireplace: 'true', pool: 1 }, { fireplace: 'yes', pool: 'Y' }]) {
    const result = normalizeRentCastFields(documentedPropertyWithFeatures({ features: flags }), null, ask);
    assert.equal(result.listingFacts.some((item) => item.key === 'fireplace' || item.key === 'pool'), false, JSON.stringify(flags));
    assert.equal(result.listingFacts.some((item) => item.value === false), false);
  }
  for (const viewType of ['None', 'no', 'N/A', '', '   ', true, 3]) {
    assert.equal('viewType' in facts(normalizeRentCastFields(documentedPropertyWithFeatures({ features: { viewType } }), null, ask)), false, String(viewType));
  }
  assert.equal('subdivision' in facts(normalizeRentCastFields(documentedProperty({ subdivision: '  ' }), null, ask)), false);
  // An apartment community's record is the building, not the option: no subdivision context.
  assert.equal('subdivision' in facts(normalizeRentCastFields(documentedPropertyWithFeatures(), null, { ...ask, apartmentCommunity: true })), false);
  // A record for a different address is dropped entirely (existing guard).
  const other = normalizeRentCastFields(documentedPropertyWithFeatures({ formattedAddress: '999 Other Rd, Elsewhere, MI 48001' }), null, ask);
  assert.equal(other.listingFacts.some((item) => ['fireplace', 'pool', 'subdivision'].includes(item.key)), false);
});

test('stories and foundation stay context: they never become layout or basement values', () => {
  const result = normalizeRentCastFields(documentedPropertyWithFeatures(), null, ask);
  for (const field of ['homeLayout', 'primaryBedroomLocation', 'basementCondition', 'basementStyle', 'homeCondition', 'laundryLocation']) assert.equal(field in result.fields, false, field);
  const record = countyRecordContext(snapshotOf(documentedPropertyWithFeatures(), null));
  assert.deepEqual([record.stories, record.foundation], [2, 'Basement']);
  for (const floorCount of [0, -1, 12, 2.5, '2', null]) {
    assert.equal(countyRecordContext(snapshotOf(documentedProperty({ features: { ...documentedProperty().features, floorCount } }), null)).stories, floorCount === '2' ? 2 : null, String(floorCount));
  }
});

/* ------------------------------ listing type and history ------------------------------ */

test('listing type: the documented values only; Standard is kept but not shown as a fact', () => {
  assert.equal(rentCastListingType('New Construction'), 'New Construction');
  assert.equal(rentCastListingType('new_construction'), 'New Construction');
  assert.equal(rentCastListingType(' Short Sale '), 'Short Sale');
  for (const value of ['Auction', 'REO', '', null, 3]) assert.equal(rentCastListingType(value), null, String(value));
  const newBuild = normalizeRentCastFields(null, documentedSaleListing({ listingType: 'New Construction' }), ask);
  assert.equal(newBuild.listing.listingType, 'New Construction');
  assert.equal(facts(newBuild).listingType, 'New Construction');
  const standard = normalizeRentCastFields(null, documentedSaleListing({ listingType: 'Standard' }), ask);
  assert.equal(standard.listing.listingType, 'Standard');
  assert.equal('listingType' in facts(standard), false);
  // Never written into Home Condition.
  assert.equal('homeCondition' in newBuild.fields, false);
});

test('listing history: real, ordered periods of this kind of listing; malformed entries dropped, never repaired', () => {
  const history = rentCastListingHistory({
    '2026-09-20': { event: 'Sale Listing', price: 289000, listedDate: '2026-09-20T00:00:00.000Z', removedDate: null, daysOnMarket: 29 },
    '2025-03-02': { event: 'Sale Listing', price: 299000, listedDate: '2025-03-02', removedDate: '2025-04-30', daysOnMarket: 59 },
    '2024-01-10': { event: 'Rental Listing', price: 2100, listedDate: '2024-01-10', removedDate: '2024-02-01', daysOnMarket: 22 },
    '2023-05-01': { event: 'Sale Listing', listedDate: '2023-05-01', removedDate: '2023-04-01', daysOnMarket: 5 },
    '2022-06-01': { event: 'Sale Listing', listedDate: 'not a date' },
    '2021-06-01': { event: 'Sale Listing', listedDate: '2021-06-01', removedDate: 'garbage' },
    dup: { event: 'Sale Listing', listedDate: '2025-03-02', removedDate: '2025-05-30', daysOnMarket: 89 },
    weird: { event: 'Sale Listing', listedDate: '2020-01-01', daysOnMarket: -3, price: -1 },
  }, 'sale');
  assert.deepEqual(history.map((item) => [item.listedDate, item.removedDate, item.daysOnMarket]), [
    ['2026-09-20', null, 29], ['2025-03-02', '2025-04-30', 59], ['2020-01-01', null, null],
  ]);
  assert.equal(history[2].price, null, 'a negative price is not a price');
  assert.deepEqual(rentCastListingHistory({ a: { event: 'Rental Listing', listedDate: '2024-01-10' } }, 'rental').map((item) => item.listedDate), ['2024-01-10']);
  for (const value of [null, [], 'x', 3]) assert.deepEqual(rentCastListingHistory(value, 'sale'), []);
});

test('the saved-home view: dated, source-attributed, no prices, no inferred price changes', () => {
  const context = listingSnapshotContext(snapshotOf(null, documentedSaleListingWithHistory({ listingType: 'New Construction' })));
  assert.deepEqual(listingSnapshotLines(context), [
    'When added (Oct 18, 2026): Active · listed Sep 20, 2026 · 29 days on market',
    'The listing called it New Construction',
    'Listed before: Mar 2, 2025 – Apr 30, 2025 (59 days)',
  ]);
  assert.doesNotMatch(listingSnapshotLines(context).join(' '), /\$|drop|reduc|cut|increase/i);
  // An inactive listing: removed date, no days on market, never "current".
  const inactive = listingSnapshotContext(snapshotOf(null, documentedSaleListing({ status: 'Inactive', removedDate: '2026-10-01T00:00:00.000Z' })));
  assert.deepEqual(listingSnapshotLines(inactive), ['When added (Oct 18, 2026): No longer listed · listed Sep 20, 2026 · removed Oct 1, 2026']);
  // A status nobody documented is not reported.
  assert.equal(listingSnapshotContext(snapshotOf(null, documentedSaleListing({ status: 'Pending', listedDate: null })))?.status ?? null, null);
  // Not a RentCast snapshot (pasted text) or no listing: nothing.
  assert.equal(listingSnapshotContext({ source: 'pasted_text', listing: { status: 'active' } }), null);
  assert.equal(listingSnapshotContext(snapshotOf(documentedProperty(), null)), null);
  assert.equal(listingSnapshotContext(null), null);
});

/* --------------------------------- Match: pointers only --------------------------------- */

test('county-record fireplace / pool: a Yes pointer for this buyer’s unanswered criterion only; never No, never written', () => {
  const snapshot = snapshotOf(documentedPropertyWithFeatures(), null);
  const owner = buyer(['features', 'Fireplace'], ['exterior', 'Pool']);
  const pointers = recordListingAnswers(snapshot, owner, {});
  assert.deepEqual(pointers.map((item) => [item.key, item.answer, item.sourceType, item.evidence]), [
    ['features:Fireplace', true, 'county_record', 'County records list a fireplace (Masonry).'],
    ['exterior:Pool', true, 'county_record', 'County records list a pool (Concrete).'],
  ]);
  assert.deepEqual(recordListingAnswers(snapshot, owner, { 'features:Fireplace': 'no' }).map((item) => item.key), ['exterior:Pool'], 'an answer the buyer gave wins');
  assert.deepEqual(recordListingAnswers(snapshot, buyer(['features', 'Fireplace']), {}).map((item) => item.key), ['features:Fireplace'], 'only selected criteria');
  assert.deepEqual(recordListingAnswers(snapshotOf(documentedPropertyWithFeatures({ features: { fireplace: false, pool: false } }), null), owner, {}), [], 'false is never a No');
  assert.deepEqual(recordListingAnswers({ source: 'pasted_text', listingFacts: [{ key: 'fireplace', value: true }] }, owner, {}), [], 'only a RentCast record counts');
  assert.deepEqual(recordListingAnswers(snapshot, null, {}), []);
  // Match is identical with and without the record: the pointer is never read as an answer.
  const home = { ...emptyHome(), checks: {} };
  assert.deepEqual(computeMatch({ ...home, listingImport: snapshot }, owner), computeMatch(home, owner));
  assert.equal(computeMatch({ ...home, listingImport: snapshot }, owner).allSelected.find((item) => item.key === 'features:Fireplace').evaluated, false, 'Unknown, not Yes');
});

/* --------------------------------- no extra request, no overwrite --------------------------------- */

test('still exactly two RentCast requests per lookup', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('/v1/properties') ? [documentedPropertyWithFeatures()] : [documentedSaleListingWithHistory()];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { body } = await lookupRentCast(DOC_ADDRESS, 'sale', 'test-key');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((url) => new URL(url).pathname).sort(), ['/v1/listings/sale', '/v1/properties']);
    assert.equal(body.listing.history.length, 2);
    assert.ok(body.listingFacts.some((item) => item.key === 'fireplace'));
  } finally { globalThis.fetch = realFetch; }
});

test('existing and buyer values are never overwritten: context adds no field', () => {
  const lookup = normalizeRentCastFields(documentedPropertyWithFeatures(), documentedSaleListingWithHistory({ listingType: 'New Construction' }), ask);
  const plain = normalizeRentCastFields(documentedProperty(), documentedSaleListing(), ask);
  assert.deepEqual(Object.keys(lookup.fields).sort(), Object.keys(plain.fields).sort(), 'the same fields as before phase 3');
  const typed = { ...emptyHome(), homeCondition: ['Needs Work'], homeLayout: ['Ranch / Single Story'], basementCondition: 'unfinished', price: '275000' };
  const merged = mergeImportFields(typed, lookup.fields);
  assert.deepEqual([merged.homeCondition, merged.homeLayout, merged.basementCondition, merged.price], [['Needs Work'], ['Ranch / Single Story'], 'unfinished', '275000']);
});

test('wiring: Home Facts shows dated context and hints only for Unknown fields; the found card shows a non-standard type', () => {
  const facts = read('src/components/HomeFacts.jsx');
  assert.match(facts, /hint=\{!layoutValues\(home\)\.length && record\.stories \?/);
  assert.match(facts, /hint=\{!\(home\.homeCondition \|\| \[\]\)\.length && listingType === 'New Construction' \? 'The listing called it New Construction' : null\}/);
  assert.match(facts, /\{!home\.basementStyle && !home\.basementCondition && record\.foundation && <p className="flh-hf2-note">County records: \{record\.foundation\} foundation\. Not proof of a basement’s style or condition\.<\/p>\}/);
  assert.match(facts, /Subdivision: \{record\.subdivision\} · county records/);
  assert.doesNotMatch(facts, /<details/, 'still no inline fold-out');
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /importResult\.listing\?\.status === 'active' && \['New Construction', 'Foreclosure', 'Short Sale'\]\.includes\(importResult\.listing\?\.listingType\)/);
  const criteria = read('src/components/MatchCriteria.jsx');
  assert.match(criteria, /Records can be out of date\. Choose Yes or No yourself\./);
});

/* --------------------------------- real Postgres --------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.rentcastctx@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.rentcastctx@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.rentcastctx@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('saved and reloaded: both buyers see the same dated context; pointers stay per buyer; nothing is answered', async () => {
  const lookup = normalizeRentCastFields(documentedPropertyWithFeatures(), documentedSaleListingWithHistory({ listingType: 'New Construction' }), ask);
  const form = mergeImportFields({ ...emptyHome(), address: DOC_ADDRESS }, lookup.fields);
  const listingImport = listingImportSnapshot({ ...lookup, searchedAddress: DOC_ADDRESS }, '2026-10-18T12:00:00.000Z');
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...form, listingImport }, ids.owner, ids.search);
  const load = async (user) => (await getHomesForUser(db.clientFor(user), user, ids.search)).find((item) => item.id === saved.id);
  const asOwner = await load(ids.owner);
  const asCoBuyer = await load(ids.coBuyer);
  assert.deepEqual(listingSnapshotLines(listingSnapshotContext(asCoBuyer.listingImport)), listingSnapshotLines(listingSnapshotContext(asOwner.listingImport)));
  assert.deepEqual(countyRecordContext(asCoBuyer.listingImport), countyRecordContext(asOwner.listingImport));
  assert.deepEqual(asOwner.homeCondition, [], 'New Construction is context, not a Home Condition value');
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${saved.id}' and checks <> '{}'::jsonb`)[0].n, 0);
  const ownerBuyer = buyer(['features', 'Fireplace'], ['exterior', 'Pool']);
  const coBuyerBuyer = buyer(['exterior', 'Pool']);
  assert.deepEqual(recordListingAnswers(asCoBuyer.listingImport, coBuyerBuyer, asCoBuyer.checks).map((item) => item.key), ['exterior:Pool']);
  // The owner answers Fireplace No themselves: only their pointer goes; the co-buyer's are untouched.
  await saveHomePersonalState(db.clientFor(ids.owner), { ...asOwner, checks: { 'features:Fireplace': 'no' } }, ids.owner, ids.search);
  const ownerAfter = await load(ids.owner);
  assert.deepEqual(recordListingAnswers(ownerAfter.listingImport, ownerBuyer, ownerAfter.checks).map((item) => item.key), ['exterior:Pool']);
  const coAfter = await load(ids.coBuyer);
  assert.deepEqual(coAfter.checks || {}, {});
});
