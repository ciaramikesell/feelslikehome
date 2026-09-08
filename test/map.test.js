const test = require('node:test');
const assert = require('node:assert/strict');

async function commute() { return import('../src/lib/commute.js'); }
async function resolvedHome(overrides = {}) {
  const { addressFingerprint } = await commute();
  const address = overrides.address || '123 Main St, Columbus, OH';
  return {
    address, latitude: 39.96, longitude: -82.99,
    coordinateStatus: 'resolved',
    coordinateAddressFingerprint: await addressFingerprint(address),
    coordinateSource: 'google', ...overrides,
  };
}

test('accepts current trusted coordinates regardless of resolver source', async () => {
  const { currentHomeCoordinates } = await commute();
  assert.deepEqual(await currentHomeCoordinates(await resolvedHome()), { lat: 39.96, lng: -82.99 });
  assert.deepEqual(await currentHomeCoordinates(await resolvedHome({ coordinateSource: 'rentcast' })), { lat: 39.96, lng: -82.99 });
});

test('rejects stale, unresolved, nonnumeric, and out-of-range coordinates', async () => {
  const { currentHomeCoordinates } = await commute();
  assert.equal(await currentHomeCoordinates(await resolvedHome({ address: 'A new address', coordinateAddressFingerprint: 'old' })), null);
  assert.equal(await currentHomeCoordinates(await resolvedHome({ coordinateStatus: 'ambiguous' })), null);
  assert.equal(await currentHomeCoordinates(await resolvedHome({ latitude: 'not-a-number' })), null);
  assert.equal(await currentHomeCoordinates(await resolvedHome({ latitude: 91 })), null);
});
