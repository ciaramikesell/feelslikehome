import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCommute, sortCommuteDestinations } from '../src/lib/commute/match.mjs';
import { addressFingerprint, hasCurrentCoordinates } from '../src/lib/commute/address.mjs';
import { computeGoogleRouteMatrix, geocodeWithGoogle } from '../src/lib/commute/google.mjs';

const destination = (id, maximumMinutes = null) => ({ id, label: id, maximumMinutes });
const ok = (minutes) => ({ status: 'ok', minutes });

test('single threshold passes', () => {
  assert.deepEqual(evaluateCommute([destination('Work', 30)], { Work: ok(24) }), {
    evaluated: true, met: true, score: 1, detail: 'All commute limits met',
  });
});

test('single threshold fails with approved detail', () => {
  assert.deepEqual(evaluateCommute([destination('Work', 30)], { Work: ok(38) }), {
    evaluated: true, met: false, score: 0, detail: 'Work is 38 min · 30 min maximum',
  });
});

test('multiple thresholds all pass as one result', () => {
  assert.equal(evaluateCommute([destination('Work', 30), destination('Parents', 25)], { Work: ok(20), Parents: ok(25) }).score, 1);
});

test('one failed threshold determines the result without averaging', () => {
  const result = evaluateCommute([destination('Work', 30), destination('Parents', 25)], { Work: ok(5), Parents: ok(26) });
  assert.equal(result.score, 0);
  assert.equal(result.detail, 'Parents is 26 min · 25 min maximum');
});

test('required unavailable is unknown when no known requirement fails', () => {
  assert.deepEqual(evaluateCommute([destination('Work', 30)], { Work: { status: 'unavailable', minutes: null } }), {
    evaluated: false, met: null, score: null, detail: 'Commute not available yet',
  });
});

test('informational-only destinations are excluded', () => {
  assert.equal(evaluateCommute([destination('Downtown')], { Downtown: ok(10) }), null);
});

test('informational destinations do not affect required destinations', () => {
  const result = evaluateCommute([destination('Work', 30), destination('Downtown')], { Work: ok(29), Downtown: { status: 'unavailable' } });
  assert.equal(result.met, true);
});

test('one or many destinations still produce one criterion evaluation', () => {
  const one = evaluateCommute([destination('A', 30)], { A: ok(20) });
  const many = evaluateCommute([destination('A', 30), destination('B', 40), destination('C')], { A: ok(20), B: ok(35), C: ok(1) });
  assert.equal(one.score, 1);
  assert.equal(many.score, 1);
  assert.equal(Array.isArray(many), false);
});

test('thresholded destinations sort before informational destinations', () => {
  assert.deepEqual(sortCommuteDestinations([destination('Info'), destination('Required', 20)]).map((item) => item.id), ['Required', 'Info']);
});

test('coordinates are current only for the same normalized address', () => {
  const address = '123 Main St, Detroit, MI';
  const record = { address, latitude: 42.3, longitude: -83.1, coordinate_address_fingerprint: addressFingerprint(address) };
  assert.equal(hasCurrentCoordinates(record), true);
  assert.equal(hasCurrentCoordinates({ ...record, address: '456 Main St, Detroit, MI' }), false);
});

test('Google geocoding maps exact, invalid, and ambiguous responses', async () => {
  const response = (payload) => async () => ({ ok: true, json: async () => payload });
  const exact = await geocodeWithGoogle('123 Main', { apiKey: 'test', fetchImpl: response({ status: 'OK', results: [{ formatted_address: '123 Main St', geometry: { location: { lat: 1, lng: 2 } } }] }) });
  assert.equal(exact.status, 'resolved');
  assert.equal((await geocodeWithGoogle('bad', { apiKey: 'test', fetchImpl: response({ status: 'ZERO_RESULTS', results: [] }) })).status, 'invalid');
  assert.equal((await geocodeWithGoogle('Main', { apiKey: 'test', fetchImpl: response({ status: 'OK', results: [{ partial_match: true, geometry: { location: { lat: 1, lng: 2 } } }] }) })).status, 'ambiguous');
});

test('Google route matrix parses fractional protobuf durations and no-route rows', async () => {
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.travelMode, 'DRIVE');
    assert.equal(body.routingPreference, 'TRAFFIC_UNAWARE');
    return { ok: true, json: async () => [
      { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '1439.6s' },
      { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
    ] };
  };
  const result = await computeGoogleRouteMatrix([{ latitude: 1, longitude: 2 }], [{ latitude: 3, longitude: 4 }, { latitude: 5, longitude: 6 }], { apiKey: 'test', fetchImpl });
  assert.deepEqual(result.rows.map((row) => [row.resultStatus, row.minutes]), [['ok', 24], ['no_route', null]]);
});

test('provider configuration failure is structured as unavailable', async () => {
  assert.equal((await geocodeWithGoogle('123 Main', { apiKey: '' })).status, 'unavailable');
  assert.equal((await computeGoogleRouteMatrix([], [], { apiKey: '' })).status, 'unavailable');
});
