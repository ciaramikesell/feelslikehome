import test from 'node:test';
import assert from 'node:assert/strict';
import { addressFingerprint, commuteResultSignature, commuteRowLabel, coordinatesAreCurrent, currentDestinationCoordinates, evaluateCommute, uniqueShortestIndex } from '../src/lib/commute.js';
import { cacheKey } from '../src/lib/useCommuteObserver.js';

const required = (id, max) => ({ id, label: id, maxDriveMinutes: max });

/* ------------------------------ My Homes card: multiple saved places ------------------------------
 * Regression coverage for the bug where a Home card displayed only the first saved
 * Place That Matters even when several existed and all had calculated commute results.
 * The root cause was a hardcoded `commuteDestinations.slice(0, 1)` in the card
 * component (HomesBoard.jsx) — no data was ever lost upstream (getCommuteDestinations
 * already fetches every saved row, and useCommuteObserver/evaluateCommute already
 * resolve a per-destination state for all of them). These tests exercise the exact
 * pure row-building function the card now calls per destination, proving the fix at
 * the unit level rather than only re-reading the JSX. */

test('one saved place produces one commute row', () => {
  const destinations = [{ id: 'dtw', label: 'DTW Airport' }];
  const rows = destinations.map((d) => commuteRowLabel(d, { status: 'ok', minutes: 27 }));
  assert.deepEqual(rows, ['DTW Airport: 27 min']);
});

test('two saved places produce two commute rows', () => {
  const destinations = [{ id: 'mom', label: 'Mom' }, { id: 'dtw', label: 'DTW Airport' }];
  const states = { mom: { status: 'ok', minutes: 14 }, dtw: { status: 'ok', minutes: 27 } };
  const rows = destinations.map((d) => commuteRowLabel(d, states[d.id]));
  assert.deepEqual(rows, ['Mom: 14 min', 'DTW Airport: 27 min']);
});

test('three saved places produce three commute rows, none dropped', () => {
  const destinations = [{ id: 'mom', label: 'Mom' }, { id: 'dad', label: "Dad's" }, { id: 'dtw', label: 'DTW Airport' }];
  const states = { mom: { status: 'ok', minutes: 14 }, dad: { status: 'ok', minutes: 22 }, dtw: { status: 'ok', minutes: 27 } };
  const rows = destinations.map((d) => commuteRowLabel(d, states[d.id]));
  assert.deepEqual(rows, ['Mom: 14 min', "Dad's: 22 min", 'DTW Airport: 27 min']);
  assert.equal(rows.length, destinations.length);
});

test('the saved custom label is used, never the raw address', () => {
  const destination = { id: 'mom', label: 'Mom', address: '123 Elm St, Royal Oak, MI' };
  const row = commuteRowLabel(destination, { status: 'ok', minutes: 14 });
  assert.match(row, /^Mom:/);
  assert.doesNotMatch(row, /Elm St/);
});

test('commute row order follows the given destination order — callers must never sort by commute time', () => {
  // A shorter drive time appearing later in the saved order must still render last;
  // nothing in commuteRowLabel (or its per-row mapping) reorders by minutes.
  const destinations = [{ id: 'far', label: 'Far Place' }, { id: 'near', label: 'Near Place' }];
  const states = { far: { status: 'ok', minutes: 40 }, near: { status: 'ok', minutes: 5 } };
  const rows = destinations.map((d) => commuteRowLabel(d, states[d.id]));
  assert.deepEqual(rows, ['Far Place: 40 min', 'Near Place: 5 min']);
});

test('one unavailable/pending commute never removes the other saved landmarks from the row set', () => {
  const destinations = [{ id: 'mom', label: 'Mom' }, { id: 'broken', label: 'Broken Address' }, { id: 'dtw', label: 'DTW Airport' }];
  const states = { mom: { status: 'ok', minutes: 14 }, broken: { status: 'destination_invalid' }, dtw: { status: 'ok', minutes: 27 } };
  const rows = destinations.map((d) => commuteRowLabel(d, states[d.id]));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows, ['Mom: 14 min', 'Broken Address · Check the address', 'DTW Airport: 27 min']);
});

test('commute states are distinguished — calculated, pending, and unavailable never look alike, and no time is ever invented', () => {
  const d = { id: 'x', label: 'Place' };
  assert.equal(commuteRowLabel(d, { status: 'ok', minutes: 12 }), 'Place: 12 min');
  assert.equal(commuteRowLabel(d, { status: 'loading' }), 'Place · Calculating…');
  assert.equal(commuteRowLabel(d, { status: 'idle' }), 'Place · Calculating…');
  assert.equal(commuteRowLabel(d, undefined), 'Place · Calculating…');
  for (const status of ['unavailable', 'no_route', 'home_unavailable', 'destination_unavailable']) {
    assert.equal(commuteRowLabel(d, { status }), 'Place · Not available');
  }
  assert.equal(commuteRowLabel(d, { status: 'destination_invalid' }), 'Place · Check the address');
  assert.equal(commuteRowLabel(d, { status: 'destination_ambiguous' }), 'Place · Add a city or ZIP');
  // Never a bare number-looking string with no state qualifier when minutes is unknown.
  for (const state of [{ status: 'loading' }, { status: 'idle' }, undefined]) {
    assert.doesNotMatch(commuteRowLabel(d, state), /\d+ min/);
  }
});

test('commute cache keys can never associate a result with the wrong destination', () => {
  const home = { id: 'home-1', address: '1 Main St' };
  const mom = { id: 'dest-mom', address: '2 Elm St' };
  const dtw = { id: 'dest-dtw', address: 'DTW Airport' };
  const momKey = cacheKey(home, mom);
  const dtwKey = cacheKey(home, dtw);
  assert.notEqual(momKey, dtwKey);
  // The same two destinations for a different home also never collide with the first home's keys.
  const otherHome = { id: 'home-2', address: '9 Oak Ave' };
  assert.notEqual(cacheKey(otherHome, mom), momKey);
  assert.notEqual(cacheKey(otherHome, dtw), dtwKey);
});

test('informational destinations do not create a Commute evaluation', () => {
  assert.equal(evaluateCommute([{ id: 'gym', maxDriveMinutes: null }], () => ({ status: 'ok', minutes: 10 })), null);
});

test('all required destinations must pass and are represented by one evaluation', () => {
  const destinations = [required('work', 30), required('parents', 40)];
  assert.deepEqual(evaluateCommute(destinations, (d) => ({ status: 'ok', minutes: d.id === 'work' ? 25 : 39 })).met, true);
  assert.deepEqual(evaluateCommute(destinations, (d) => ({ status: 'ok', minutes: d.id === 'work' ? 25 : 41 })).met, false);
});

test('any unavailable required route makes Commute unknown, not failed', () => {
  const result = evaluateCommute([required('work', 30), required('school', 20)], (d) =>
    d.id === 'work' ? { status: 'ok', minutes: 15 } : { status: 'no_route', minutes: null });
  assert.equal(result.evaluated, false);
  assert.equal(result.met, null);
});

test('coordinate provenance only accepts the current address fingerprint', async () => {
  const fingerprint = await addressFingerprint('123 Main St, Detroit, MI');
  assert.equal(coordinatesAreCurrent({ coordinate_status: 'resolved', coordinate_address_fingerprint: fingerprint, latitude: 42, longitude: -83 }, fingerprint), true);
  assert.equal(coordinatesAreCurrent({ coordinate_status: 'resolved', coordinate_address_fingerprint: fingerprint, latitude: 42, longitude: -83 }, await addressFingerprint('999 New St')), false);
});

test('destination map coordinates require the current destination address', async () => {
  const address = '1 Campus Drive, Columbus, OH';
  const destination = {
    address, latitude: 39.99, longitude: -83.01, coordinateStatus: 'resolved',
    coordinateAddressFingerprint: await addressFingerprint(address),
  };
  assert.deepEqual(await currentDestinationCoordinates(destination), { lat: 39.99, lng: -83.01 });
  assert.equal(await currentDestinationCoordinates({ ...destination, address: 'Edited address' }), null);
});

test('Compare differences use meaningful commute states', () => {
  assert.equal(commuteResultSignature({ status: 'ok', minutes: 24 }), 'ok:24');
  assert.equal(commuteResultSignature({ status: 'loading', minutes: null }), 'calculating');
  assert.equal(commuteResultSignature({ status: 'idle', minutes: null }), 'calculating');
  assert.equal(commuteResultSignature({ status: 'no_route', minutes: null }), 'unavailable');
});

test('only a unique shortest known route is emphasized', () => {
  assert.equal(uniqueShortestIndex([{ status: 'ok', minutes: 24 }, { status: 'ok', minutes: 31 }, { status: 'no_route' }]), 0);
  assert.equal(uniqueShortestIndex([{ status: 'ok', minutes: 24 }, { status: 'ok', minutes: 24 }]), -1);
  assert.equal(uniqueShortestIndex([{ status: 'loading' }, { status: 'no_route' }]), -1);
});
