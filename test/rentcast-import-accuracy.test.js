// RentCast import accuracy (PR #161). Fixtures are DOCUMENTATION-DERIVED shapes
// (test/support/rentcastDocumentedShapes.js), not live RentCast responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeRentCastFields, rentCastAddressMatch, rentCastCoordinates, rentCastListingStatus } from '../src/lib/rentcast.js';
import { lookupRentCast } from '../src/lib/rentcastLookup.js';
import { listingImportSnapshot, importedCoordinatePatch } from '../src/lib/importSnapshot.js';
import { mergeImportFields } from '../src/lib/importDomain.js';
import { currentHomeCoordinates } from '../src/lib/commute.js';
import { computeMatch } from '../src/lib/matching.js';
import { importedDetailCount } from '../src/lib/homeFacts.js';
import { DOC_ADDRESS, documentedProperty, documentedSaleListing, documentedRentalListing } from './support/rentcastDocumentedShapes.js';

const ASKED = '100 Example Lane, Testville, MI';
const factOf = (result, key) => result.listingFacts.find((item) => item.key === key)?.value;

/* --------------------------- complete and partial --------------------------- */

test('complete property record + active listing: documented fields map, nothing else is guessed', () => {
  const result = normalizeRentCastFields(documentedProperty(), documentedSaleListing(), { requestedAddress: ASKED });
  assert.deepEqual(result.fields, {
    address: DOC_ADDRESS, price: '289000', beds: '3', baths: '2', sqft: '1650', lotSize: '8712 sq ft', yearBuilt: '1978',
    propertyType: 'house', garageSpaces: '2', heating: 'Forced Air', cooling: 'Central', exterior: 'Vinyl Siding', roof: 'Asphalt',
    garageType: 'attached', listingId: '20260000001', daysOnMarket: '29', latitude: 42.5001, longitude: -83.1002,
    hoaFeeMonthly: 0, propertyTaxAnnual: 4125, propertyTaxYear: 2024,
  });
  for (const key of ['basementNotes', 'basementCondition', 'basementStyle', 'laundryLocation', 'estMonthly']) assert.equal(result.fields[key], undefined, key);
  assert.equal(factOf(result, 'status'), 'Active');
  assert.equal(factOf(result, 'listedDate'), '2026-09-20');
  assert.equal(factOf(result, 'lastSeenDate'), '2026-10-18');
  assert.equal(factOf(result, 'removedDate'), undefined);
  assert.equal(factOf(result, 'mlsName'), 'ExampleMLS');
  assert.equal(factOf(result, 'architecture'), 'Colonial');
  assert.equal(factOf(result, 'lastKnownPrice'), undefined, 'an active price is the asking price, not a "last known" one');
  assert.deepEqual(result.descriptionFeatures, [], 'no documented description field');
  assert.deepEqual(result.addressCheck, { property: 'match', listing: 'match' });
  assert.equal(result.listing.status, 'active');
});

test('property record only: structural facts, no price, no listing status or days on market', () => {
  const result = normalizeRentCastFields(documentedProperty(), null, { requestedAddress: ASKED });
  assert.equal(result.fields.price, undefined);
  assert.equal(result.fields.daysOnMarket, undefined);
  assert.equal(result.fields.beds, '3');
  assert.equal(result.listing, null);
  assert.equal(result.listingFacts.some((item) => item.group === 'listing'), false);
});

test('listing only: price from the active listing; HOA from the listing\'s documented hoa.fee', () => {
  const result = normalizeRentCastFields(null, documentedSaleListing({ hoa: { fee: 85 } }), { requestedAddress: ASKED });
  assert.equal(result.fields.price, '289000');
  assert.equal(result.fields.hoaFeeMonthly, 85);
  assert.equal(result.fields.heating, undefined);
  assert.equal(result.fields.propertyTaxAnnual, undefined);
});

/* ------------------------------ listing freshness ----------------------------- */

test('inactive listing: its last price is never the asking price, and is labelled as last known', () => {
  const inactive = documentedSaleListing({ status: 'Inactive', removedDate: '2026-08-01T00:00:00.000Z', bedrooms: 4 });
  const result = normalizeRentCastFields(documentedProperty(), inactive, { requestedAddress: ASKED });
  assert.equal(result.fields.price, undefined);
  assert.equal(result.fields.daysOnMarket, undefined);
  assert.equal(result.fields.beds, '3', 'the property record outranks an inactive listing for size');
  assert.equal(factOf(result, 'status'), 'Inactive (no longer listed)');
  assert.equal(factOf(result, 'lastKnownPrice'), '$289,000 (not a current asking price)');
  assert.equal(factOf(result, 'removedDate'), '2026-08-01');
  assert.equal(result.listing.lastKnownPrice, 289000);
  // With no property record, the inactive listing's own attributes still fill size.
  assert.equal(normalizeRentCastFields(null, inactive, { requestedAddress: ASKED }).fields.beds, '4');
});

test('missing or unrecognized status is "Not reported", never treated as active', () => {
  for (const status of [undefined, null, '', 'Pending', 42]) {
    const result = normalizeRentCastFields(null, documentedSaleListing({ status }), { requestedAddress: ASKED });
    assert.equal(result.fields.price, undefined, String(status));
    assert.equal(factOf(result, 'status'), 'Not reported');
    assert.match(factOf(result, 'lastKnownPrice'), /not a current asking price/);
  }
  assert.equal(rentCastListingStatus({ status: ' active ' }), 'active');
  assert.equal(rentCastListingStatus({ status: 'INACTIVE' }), 'inactive');
});

test('rental: an active long-term rental listing gives the monthly rent; an inactive one does not', () => {
  assert.equal(normalizeRentCastFields(null, documentedRentalListing(), { requestedAddress: ASKED }).fields.price, '2150');
  assert.equal(normalizeRentCastFields(null, documentedRentalListing({ status: 'Inactive' }), { requestedAddress: ASKED }).fields.price, undefined);
});

test('apartment community: the listing (one arbitrary unit) supplies no option facts and no listing status', () => {
  const result = normalizeRentCastFields(documentedProperty({ propertyType: 'Apartment' }), documentedRentalListing(), { apartmentCommunity: true, requestedAddress: ASKED });
  for (const key of ['price', 'beds', 'baths', 'sqft', 'daysOnMarket', 'listingId', 'heating', 'garageSpaces']) assert.equal(result.fields[key], undefined, key);
  assert.equal(result.fields.propertyType, 'apartment');
  assert.equal(result.listing, null);
});

/* ----------------------------- heating and cooling ---------------------------- */

test('heating/cooling: the documented *Type text is the value; a presence flag is never a type', () => {
  const flagsOnly = normalizeRentCastFields(documentedProperty({ features: { heating: true, cooling: true } }), null, { requestedAddress: ASKED });
  assert.equal(flagsOnly.fields.heating, undefined);
  assert.equal(flagsOnly.fields.cooling, undefined);
  assert.equal(factOf(flagsOnly, 'heating'), true, 'shown as "Yes" in the found panel');
  const absent = normalizeRentCastFields(documentedProperty({ features: { heating: false, cooling: false } }), null, { requestedAddress: ASKED });
  assert.equal(factOf(absent, 'heating'), undefined, 'false is not documented as "has none", so it stays Unknown');
  assert.equal(factOf(absent, 'cooling'), undefined);
  const odd = normalizeRentCastFields(documentedProperty({ features: { heatingType: 'Yes', coolingType: '  ' } }), null, { requestedAddress: ASKED });
  assert.equal(odd.fields.heating, undefined);
  assert.equal(odd.fields.cooling, undefined);
  // Nothing about central air, fuel or equipment age is inferred from the type text.
  const gas = normalizeRentCastFields(documentedProperty({ features: { heatingType: 'Gas' } }), null, { requestedAddress: ASKED });
  assert.equal(gas.fields.cooling, undefined);
  assert.equal(gas.fields.checks, undefined);
});

/* --------------------------------- HOA and taxes ------------------------------- */

test('HOA: documented monthly fee; $0 is a confirmed $0/mo, missing stays Unknown, nothing says "No HOA"', () => {
  const zero = normalizeRentCastFields(documentedProperty(), null, { requestedAddress: ASKED });
  assert.equal(zero.fields.hoaFeeMonthly, 0);
  assert.equal(zero.listingFacts.some((item) => item.key === 'hoa'), false);
  assert.equal(normalizeRentCastFields(documentedProperty({ hoa: undefined }), null, { requestedAddress: ASKED }).fields.hoaFeeMonthly, undefined);
  assert.equal(normalizeRentCastFields(documentedProperty({ hoa: { fee: null } }), null, { requestedAddress: ASKED }).fields.hoaFeeMonthly, undefined);
  assert.equal(normalizeRentCastFields(documentedProperty({ hoa: { fee: -5 } }), null, { requestedAddress: ASKED }).fields.hoaFeeMonthly, undefined);
  assert.equal(normalizeRentCastFields(documentedProperty({ hoa: { fee: 'abc' } }), null, { requestedAddress: ASKED }).fields.hoaFeeMonthly, undefined);
  assert.equal(normalizeRentCastFields(documentedProperty({ hoa: { fee: 210 } }), documentedSaleListing({ hoa: { fee: 0 } }), { requestedAddress: ASKED }).fields.hoaFeeMonthly, 210, 'property record first');
  const modal = readFileSync(new URL('../src/components/HomeModal.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(modal, /No HOA/);
});

test('property taxes: the most recent plausible annual amount with its own year, never a monthly figure', () => {
  const taxes = { a: { year: 2022, total: 3000 }, b: { year: '2024', total: '4125.5' }, c: { year: 3024, total: 9999 }, d: { year: 2025, total: -1 }, e: { year: 2023.5, total: 1 }, f: null };
  const { fields } = normalizeRentCastFields(documentedProperty({ propertyTaxes: taxes }), null, { requestedAddress: ASKED });
  assert.equal(fields.propertyTaxAnnual, 4125.5);
  assert.equal(fields.propertyTaxYear, 2024);
  assert.equal(fields.estMonthly, undefined);
  assert.equal(normalizeRentCastFields(documentedProperty({ propertyTaxes: 'n/a' }), null, { requestedAddress: ASKED }).fields.propertyTaxAnnual, undefined);
});

/* ------------------------------ lot size and malformed ------------------------- */

test('lot size: documented square feet, written with its unit; zero, negative and text stay Unknown', () => {
  const lot = (lotSize) => normalizeRentCastFields(documentedProperty({ lotSize }), null, { requestedAddress: ASKED }).fields.lotSize;
  assert.equal(lot(8712), '8712 sq ft');
  assert.equal(lot(43560), '1.00 acres');
  assert.equal(lot(108900), '2.50 acres');
  assert.equal(lot('9000'), '9000 sq ft');
  for (const value of [0, -10, 'big', null, undefined]) assert.equal(lot(value), undefined, String(value));
});

test('malformed and contradictory values never become facts', () => {
  const result = normalizeRentCastFields(documentedProperty({
    bedrooms: 'three', features: { garageSpaces: -1, garageType: 'Attached and Detached', heatingType: 12 },
  }), null, { requestedAddress: ASKED });
  assert.equal(result.fields.beds, undefined);
  assert.equal(result.fields.garageSpaces, undefined);
  assert.equal(result.fields.garageType, undefined);
  assert.equal(result.fields.heating, undefined);
  assert.doesNotThrow(() => normalizeRentCastFields({ features: 'oops', hoa: 'x', propertyTaxes: [] }, { status: {} }, { requestedAddress: ASKED }));
});

/* ---------------------------------- coordinates ------------------------------- */

test('coordinates: valid, agreeing points only, and only from a result that matched the address', () => {
  assert.deepEqual(rentCastCoordinates({ latitude: 42.5, longitude: -83.1 }, { latitude: 42.5005, longitude: -83.1005 }), { latitude: 42.5, longitude: -83.1 });
  assert.equal(rentCastCoordinates({ latitude: 42.5, longitude: -83.1 }, { latitude: 42.6, longitude: -83.1 }), null, '~11 km apart: conflicting');
  assert.equal(rentCastCoordinates({ latitude: 0, longitude: 0 }, null), null);
  assert.equal(rentCastCoordinates({ latitude: 95, longitude: -83 }, null), null);
  assert.deepEqual(rentCastCoordinates({ latitude: 'x', longitude: 1 }, { latitude: 42.5, longitude: -83.1 }), { latitude: 42.5, longitude: -83.1 });
  const unconfirmed = normalizeRentCastFields(documentedProperty({ formattedAddress: undefined }), null, { requestedAddress: ASKED });
  assert.equal(unconfirmed.fields.latitude, undefined, 'unconfirmed address: let the geocoder decide');
  assert.equal(unconfirmed.fields.beds, '3', 'but the record is still used');
});

test('saving: an imported point becomes the resolved location only for the same address, untouched', async () => {
  const result = normalizeRentCastFields(documentedProperty(), documentedSaleListing(), { requestedAddress: ASKED });
  const importResult = { ...result, searchedAddress: ASKED };
  const form = mergeImportFields({ address: ASKED, latitude: null, longitude: null, coordinateStatus: 'unresolved' }, result.fields);
  const patch = await importedCoordinatePatch(form, importResult);
  assert.equal(patch.coordinateStatus, 'resolved');
  assert.equal(patch.coordinateSource, 'rentcast');
  const saved = { ...form, ...patch };
  assert.deepEqual(await currentHomeCoordinates(saved), { lat: 42.5001, lng: -83.1002 }, 'map and commute accept it');
  assert.equal(await currentHomeCoordinates({ ...saved, address: '102 Example Ln, Testville, MI' }), null, 'an address edit invalidates it');
  assert.deepEqual(await importedCoordinatePatch({ ...form, address: '102 Example Ln, Testville, MI' }, importResult), {});
  assert.deepEqual(await importedCoordinatePatch({ ...form, latitude: 40 }, importResult), {});
  assert.deepEqual(await importedCoordinatePatch(form, { ...importResult, source: 'raw-text' }), {});
  assert.deepEqual(await importedCoordinatePatch({ ...form, coordinateStatus: 'resolved' }, importResult), {});
  assert.deepEqual(await importedCoordinatePatch(form, { ...importResult, fields: { ...importResult.fields, latitude: 0, longitude: 0 } }), {});
  // Without Web Crypto, saving still works and falls back to geocoding.
  const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
  Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
  try { assert.deepEqual(await importedCoordinatePatch(form, importResult), {}); }
  finally { if (subtle) Object.defineProperty(globalThis.crypto, 'subtle', subtle); else delete globalThis.crypto.subtle; }
});

/* -------------------------------- address matching ----------------------------- */

test('address matching: only a definite difference is a mismatch', () => {
  assert.equal(rentCastAddressMatch('100 Example Lane, Testville, MI', DOC_ADDRESS), 'match');
  assert.equal(rentCastAddressMatch('100 N Main Street', '100 Main St N, Town, MI 48000'), 'match');
  assert.equal(rentCastAddressMatch('101 Example Ln, Testville, MI', DOC_ADDRESS), 'mismatch');
  assert.equal(rentCastAddressMatch('100 Sample Ln, Testville, MI', DOC_ADDRESS), 'mismatch');
  assert.equal(rentCastAddressMatch('100 Example Ln, Testville, MI 48001', DOC_ADDRESS), 'mismatch');
  assert.equal(rentCastAddressMatch('100 Example Ln, Testville, OH', DOC_ADDRESS), 'mismatch');
  assert.equal(rentCastAddressMatch('100 Example Ln Apt 4, Testville, MI', '100 Example Ln, Apt 5, Testville, MI 48000'), 'mismatch');
  assert.equal(rentCastAddressMatch('100 Example Ln #4, Testville, MI', '100 Example Ln, Apt 4, Testville, MI 48000'), 'match');
  assert.equal(rentCastAddressMatch('100 Example Ln, Testville, MI', '100 Example Ln, Apt 5, Testville, MI 48000'), 'match', 'a unit on one side only is not a conflict');
  assert.equal(rentCastAddressMatch('Example Ln, Testville', DOC_ADDRESS), 'unknown');
  assert.equal(rentCastAddressMatch('100 Example Ln', undefined), 'unknown');
});

test('a result for a different house is dropped, never merged', () => {
  const result = normalizeRentCastFields(documentedProperty({ formattedAddress: '102 Example Ln, Testville, MI 48000' }), documentedSaleListing(), { requestedAddress: ASKED });
  assert.equal(result.addressCheck.property, 'mismatch');
  assert.equal(result.fields.propertyTaxAnnual, undefined);
  assert.equal(result.fields.heating, undefined);
  assert.equal(result.fields.price, '289000', 'the matching listing is kept');
});

/* ------------------------------ user values and Match -------------------------- */

test('imported values only fill empty fields; buyer corrections and $0 vs Unknown survive', () => {
  const { fields } = normalizeRentCastFields(documentedProperty({ hoa: { fee: 0 } }), documentedSaleListing(), { requestedAddress: ASKED });
  const buyer = { address: ASKED, price: '279000', heating: 'Boiler', hoaFeeMonthly: 150, propertyTaxAnnual: null, laundryLocation: 'second_floor', checks: { 'features:Central air': 'no' } };
  const merged = mergeImportFields(buyer, fields);
  assert.equal(merged.price, '279000');
  assert.equal(merged.heating, 'Boiler');
  assert.equal(merged.hoaFeeMonthly, 150);
  assert.equal(merged.propertyTaxAnnual, 4125);
  assert.equal(merged.laundryLocation, 'second_floor');
  assert.deepEqual(merged.checks, buyer.checks);
  assert.equal(mergeImportFields({ hoaFeeMonthly: 0 }, { hoaFeeMonthly: 95 }).hoaFeeMonthly, 0, 'a confirmed $0 is a value');
});

test('Match scoring and personal answers are unchanged by an import snapshot', () => {
  const priorities = { beds: { value: 3, tier: 'must' }, baths: { value: 2, tier: 'important' } };
  const { fields } = normalizeRentCastFields(documentedProperty(), documentedSaleListing(), { requestedAddress: ASKED });
  const home = { ...mergeImportFields({ address: ASKED, checks: { 'features:Fireplace': true }, ratings: { feel: 4 } }, fields) };
  const withSnapshot = { ...home, listingImport: listingImportSnapshot({ ...normalizeRentCastFields(documentedProperty(), null, { requestedAddress: ASKED }) }) };
  assert.deepEqual(computeMatch(withSnapshot, priorities), computeMatch(home, priorities));
  assert.deepEqual(withSnapshot.checks, { 'features:Fireplace': true });
  assert.deepEqual(withSnapshot.ratings, { feel: 4 });
});

/* ---------------------------------- snapshot ---------------------------------- */

test('the listing_import snapshot records source, freshness and per-source status (no migration)', () => {
  const result = normalizeRentCastFields(documentedProperty(), documentedSaleListing({ status: 'Inactive' }), { requestedAddress: ASKED });
  const snapshot = listingImportSnapshot({ ...result, sources: { property: 'ok', listing: 'ok' }, searchedAddress: ASKED }, '2026-10-19T12:00:00.000Z');
  assert.equal(snapshot.source, 'rentcast');
  assert.equal(snapshot.importedAt, '2026-10-19T12:00:00.000Z');
  assert.equal(snapshot.listing.status, 'inactive');
  assert.equal(snapshot.listing.lastKnownPrice, 289000);
  assert.deepEqual(snapshot.sources, { property: 'ok', listing: 'ok' });
  assert.equal(snapshot.fields.price, undefined);
  assert.deepEqual(Object.keys(snapshot).sort(), ['descriptionFeatures', 'fields', 'importedAt', 'listing', 'listingFacts', 'source', 'sources']);
  const pasted = listingImportSnapshot({ fields: { beds: '3' }, source: 'raw-text' }, 'x');
  assert.equal(pasted.source, 'pasted_text');
  assert.equal(pasted.listing, undefined);
  // Round-trips through jsonb unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

/* ------------------------------ lookup, errors, partial ------------------------- */

async function withFetch(handler, run) {
  const original = global.fetch;
  const originalError = console.error;
  const calls = [];
  const logs = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return handler(url, options); };
  console.error = (...args) => logs.push(args);
  try { return { ...(await run()), calls, logs }; } finally { global.fetch = original; console.error = originalError; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = ({ property, listing }) => (url) => (url.includes('/v1/properties') ? property() : listing());
const KEY = 'test-key-not-real';

test('lookup: exactly two requests, to the documented endpoints, with the key only in a header', async () => {
  const { status, body, calls } = await withFetch(answer({ property: () => json([documentedProperty()]), listing: () => json([documentedSaleListing()]) }),
    () => lookupRentCast(ASKED, 'sale', KEY));
  assert.equal(status, 200);
  assert.equal(body.found, true);
  assert.deepEqual(body.sources, { property: 'ok', listing: 'ok' });
  assert.equal(body.partial, undefined);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname).sort(), ['/v1/listings/sale', '/v1/properties']);
  assert.ok(calls.every(({ url, options }) => !url.includes(KEY) && options.headers['X-Api-Key'] === KEY));
  const rental = await withFetch(answer({ property: () => json([]), listing: () => json([documentedRentalListing()]) }), () => lookupRentCast(ASKED, 'rental', KEY));
  assert.ok(rental.calls.some(({ url }) => new URL(url).pathname === '/v1/listings/rental/long-term'));
  assert.equal(rental.body.fields.price, '2150');
});

test('lookup: listing fails, property found — keep the property facts and say listing details are missing', async () => {
  const { status, body, logs } = await withFetch(answer({ property: () => json([documentedProperty()]), listing: () => json({ message: 'boom' }, 503) }),
    () => lookupRentCast(ASKED, 'sale', KEY));
  assert.equal(status, 200);
  assert.equal(body.partial, 'listing_unavailable');
  assert.equal(body.fields.price, undefined);
  assert.equal(body.fields.heating, 'Forced Air');
  assert.deepEqual(body.sources, { property: 'ok', listing: 'error' });
  assert.ok(logs.length > 0);
  const text = JSON.stringify(body);
  for (const leak of ['503', 'diagnostics', 'httpStatus', KEY, 'boom']) assert.ok(!text.includes(leak), leak);
});

test('lookup: property fails, listing found — keep the listing, say property records are missing', async () => {
  const { body } = await withFetch(answer({ property: () => { throw new TypeError('network'); }, listing: () => json([documentedSaleListing()]) }),
    () => lookupRentCast(ASKED, 'sale', KEY));
  assert.equal(body.partial, 'property_unavailable');
  assert.equal(body.fields.price, '289000');
});

test('lookup: failures are told apart — rate limit, timeout, refused address, outage — never "not found"', async () => {
  const run = (property, listing) => withFetch(answer({ property, listing }), () => lookupRentCast(ASKED, 'sale', KEY));
  const limited = await run(() => json({}, 429), () => json({}, 429));
  assert.deepEqual([limited.status, limited.body.reason], [429, 'rate_limited']);
  const abort = () => { throw new DOMException('Aborted', 'AbortError'); };
  const slow = await run(abort, abort);
  assert.deepEqual([slow.status, slow.body.reason], [504, 'timeout']);
  const refused = await run(() => json({}, 400), () => json({}, 400));
  assert.deepEqual([refused.status, refused.body.reason], [422, 'invalid_address']);
  const down = await run(() => json({}, 500), () => json({}, 401));
  assert.deepEqual([down.status, down.body.reason], [502, 'unavailable']);
  // One failed and the other found nothing: unknown, so still a failure.
  const halfEmpty = await run(() => json({}, 503), () => json([], 200));
  assert.equal(halfEmpty.status, 502);
  assert.equal(halfEmpty.body.found, undefined);
  for (const result of [limited, slow, refused, down, halfEmpty]) assert.doesNotMatch(JSON.stringify(result.body), /RentCast|api\.rentcast|\b50[0-9]\b|diagnostics/);
});

test('lookup: genuinely nothing found, or only another address, says so calmly', async () => {
  const none = await withFetch(answer({ property: () => json([], 200), listing: () => new Response('', { status: 404 }) }), () => lookupRentCast(ASKED, 'sale', KEY));
  assert.equal(none.status, 200);
  assert.equal(none.body.found, false);
  assert.match(none.body.message, /No property data was found/);
  const other = await withFetch(answer({ property: () => json([documentedProperty({ formattedAddress: '9 Other Rd, Testville, MI 48000' })]), listing: () => json([]) }),
    () => lookupRentCast(ASKED, 'sale', KEY));
  assert.equal(other.body.found, false);
  assert.equal(other.body.sources.property, 'mismatch');
  assert.match(other.body.message, /exact address/);
});

/* ---------------------------------- Add Home ---------------------------------- */

test('Add Home shows reason-specific, non-technical failure notes and the partial note', () => {
  const modal = readFileSync(new URL('../src/components/HomeModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /LOOKUP_FAILURE_NOTES\[data\.reason\]/);
  assert.match(modal, /PARTIAL_NOTES\[importResult\.partial\]/);
  assert.match(modal, /importedCoordinatePatch\(form, importResult\)/);
  assert.match(modal, /'No current asking price'/);
  const notes = modal.slice(modal.indexOf('const LOOKUP_FAILURE_NOTES'), modal.indexOf('function ImportFoundCard'));
  assert.doesNotMatch(notes, /RentCast|429|502|504|rate limit|API/i);
});

test('listing bookkeeping is shown but not counted as a home detail', () => {
  const active = normalizeRentCastFields(null, documentedSaleListing(), { requestedAddress: ASKED });
  const inactive = normalizeRentCastFields(null, documentedSaleListing({ status: 'Inactive', removedDate: '2026-08-01T00:00:00.000Z' }), { requestedAddress: ASKED });
  // The inactive import loses price and days on market and gains only bookkeeping.
  assert.equal(importedDetailCount(inactive), importedDetailCount(active) - 2);
});

/* --------------------------- final review (PR #161) --------------------------- */

test('address variants of the same home match: St/Street, directions, units, ZIP+4, punctuation', () => {
  const R = '100 N Main St, Apt 4, Springfield, MI 48000';
  for (const variant of [
    '100 North Main Street Apt 4, Springfield, MI',
    '100 N. Main St. #4, Springfield, MI 48000-1234',
    '100 N Main St Apt #4, Springfield, MI',
    '100 N Main St, Apt. 4, Springfield, MI',
    '100 N Main St Unit 4, Springfield, MI 48000',
    '100 Main St N, Apt 4, Springfield, MI',
    '100 N Main St, Apt 4, Springfield, MI, USA',
    '100 N Main St Springfield MI 48000',
  ]) assert.equal(rentCastAddressMatch(variant, R), 'match', variant);
  assert.equal(rentCastAddressMatch('100 Saint Clair Ave, Detroit, MI', '100 St Clair Ave, Detroit, MI 48214'), 'match');
  assert.equal(rentCastAddressMatch('100 First St, Detroit, MI', '100 1st St, Detroit, MI 48214'), 'match');
  assert.equal(rentCastAddressMatch('100 Main St, Grosse Pointe Woods, MI 48236', '100 Main St, Grosse Pointe, MI 48236'), 'match', 'same ZIP: postal city names vary');
});

test('a different property never matches: direction, suffix, city, unit, number, ZIP, state', () => {
  const R = '100 N Main St, Apt 4, Springfield, MI 48000';
  for (const other of [
    '100 S Main St, Apt 4, Springfield, MI',
    '100 N Main Ave, Apt 4, Springfield, MI',
    '100 N Main St, Apt 4, Lansing, MI',
    '100 N Main St Lansing MI',
    '100 N Main St, Apt 5, Springfield, MI',
    '102 N Main St, Apt 4, Springfield, MI',
    '100 N Maine St, Apt 4, Springfield, MI',
    '100 N Main St, Apt 4, Springfield, MI 48001',
    '100 N Main St, Apt 4, Springfield, OH',
  ]) assert.equal(rentCastAddressMatch(other, R), 'mismatch', other);
});

test('garage type: only an unambiguous Attached / Detached garage; carports and parking are not garages', () => {
  const type = (garageType) => normalizeRentCastFields(documentedProperty({ features: { garageType } }), null, { requestedAddress: ASKED }).fields.garageType;
  assert.equal(type('Attached'), 'attached');
  assert.equal(type('Detached Garage'), 'detached');
  assert.equal(type('Attached/Carport'), 'attached', 'an attached garage plus a carport');
  for (const value of ['Garage', 'Carport', 'Parking Structure', 'Attached/Detached', 'Detached Carport', 'Attached Carport', 'Attached and Detached', '']) {
    assert.equal(type(value), undefined, value);
  }
});

test('heating / cooling with several types separated by slashes are kept as written', () => {
  const { fields } = normalizeRentCastFields(documentedProperty({ features: { heatingType: 'Forced Air/Heat Pump', coolingType: 'Central/Window' } }), null, { requestedAddress: ASKED });
  assert.equal(fields.heating, 'Forced Air/Heat Pump');
  assert.equal(fields.cooling, 'Central/Window');
});

test('propertyTaxes keyed by YYYY: the latest year wins regardless of key order', () => {
  const { fields } = normalizeRentCastFields(documentedProperty({ propertyTaxes: { 2024: { year: 2024, total: 4125 }, 2022: { year: 2022, total: 3700 }, 2023: { year: 2023, total: 3900 } } }), null, { requestedAddress: ASKED });
  assert.deepEqual([fields.propertyTaxAnnual, fields.propertyTaxYear], [4125, 2024]);
});

test('Inactive is "no longer listed", never "Sold"', () => {
  const result = normalizeRentCastFields(documentedProperty(), documentedSaleListing({ status: 'Inactive' }), { requestedAddress: ASKED });
  const text = JSON.stringify(result.listingFacts);
  assert.match(text, /Inactive \(no longer listed\)/);
  assert.doesNotMatch(text, /sold/i);
  for (const file of ['src/lib/rentcast.js', 'src/lib/rentcastLookup.js', 'src/components/HomeModal.jsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /['"`][^'"`\n]*\bsold\b[^'"`\n]*['"`]/i, file);
  }
});

test('owner, agent, office, sale history and assessments never reach the client response or the snapshot', async () => {
  const property = documentedProperty({
    owner: { names: ['Pat Example'], mailingAddress: { formattedAddress: '9 Private Rd' } }, ownerOccupied: true,
    lastSaleDate: '2019-05-01T00:00:00.000Z', lastSalePrice: 201000, history: { '2019-05-01': { price: 201000 } },
    taxAssessments: { 2024: { year: 2024, value: 150000 } }, legalDescription: 'LOT 12 EXAMPLE SUB', assessorID: '12-34-567',
  });
  const listing = documentedSaleListing({
    listingAgent: { name: 'Agent Example', phone: '5550100', email: 'agent@example.test' },
    listingOffice: { name: 'Office Example', phone: '5550101' }, history: { '2026-09-20': { price: 289000 } },
  });
  const { body } = await withFetch(answer({ property: () => json([property]), listing: () => json([listing]) }), () => lookupRentCast(ASKED, 'sale', KEY));
  const snapshot = listingImportSnapshot({ ...body, searchedAddress: ASKED });
  for (const text of [JSON.stringify(body), JSON.stringify(snapshot)]) {
    for (const secret of ['Pat Example', '9 Private Rd', '201000', 'Agent Example', 'agent@example.test', '5550100', 'Office Example', 'LOT 12', '12-34-567', '150000', 'owner', 'listingAgent', 'listingOffice']) {
      assert.ok(!text.includes(secret), secret);
    }
  }
});
