import test from 'node:test';
import assert from 'node:assert/strict';
import { addressFingerprint, commuteResultSignature, coordinatesAreCurrent, currentDestinationCoordinates, evaluateCommute, uniqueShortestIndex } from '../src/lib/commute.js';

const required = (id, max) => ({ id, label: id, maxDriveMinutes: max });

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
