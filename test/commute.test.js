import test from 'node:test';
import assert from 'node:assert/strict';
import { addressFingerprint, coordinatesAreCurrent, evaluateCommute } from '../src/lib/commute.js';

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
