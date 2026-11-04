// RentCast import (PR #161) against real Postgres: a saved import keeps its
// trusted map point and snapshot through save and reload, and the existing
// address-change trigger still clears that point. Opt-in like the other DB
// tests (docs/database-tests.md). Fixtures are documentation-derived shapes.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { documentedProperty, documentedSaleListing } from './support/rentcastDocumentedShapes.js';

register('./support/aliasHooks.mjs', import.meta.url);
const { getHomesForUser, saveHomePersonalAndShared, saveHomeSharedFields } = await import('../src/lib/supabase/collaboration.js');
const { normalizeRentCastFields } = await import('../src/lib/rentcast.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { listingImportSnapshot, importedCoordinatePatch } = await import('../src/lib/importSnapshot.js');
const { currentHomeCoordinates } = await import('../src/lib/commute.js');
const { emptyHome } = await import('../src/lib/constants.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const ASKED = '100 Example Lane, Testville, MI';

let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.rentcast@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
});
after(() => db?.drop());

async function importAndSave(listing) {
  const result = normalizeRentCastFields(documentedProperty(), listing, { requestedAddress: ASKED });
  const importResult = { ...result, sources: { property: 'ok', listing: 'ok' }, searchedAddress: ASKED };
  const form = mergeImportFields({ ...emptyHome(), address: ASKED, status: 'Saved', checks: {}, ratings: {} }, result.fields);
  const coordinates = await importedCoordinatePatch(form, importResult);
  const owner = db.clientFor(ids.owner);
  const saved = await saveHomePersonalAndShared(owner, { ...form, ...coordinates, listingImport: listingImportSnapshot(importResult) }, ids.owner, ids.search);
  return { owner, id: saved.id };
}
const reload = async (owner, id) => (await getHomesForUser(owner, ids.owner, ids.search)).find((home) => home.id === id);

dbTest('an imported home saves and reloads with its values, $0/mo HOA, trusted point and snapshot', async () => {
  const { owner, id } = await importAndSave(documentedSaleListing());
  const home = await reload(owner, id);
  assert.equal(home.price, '289000');
  assert.equal(Number(home.hoaFeeMonthly), 0);
  assert.notEqual(home.hoaFeeMonthly, null, 'a confirmed $0 is not Unknown');
  assert.equal(Number(home.propertyTaxAnnual), 4125);
  assert.equal(Number(home.propertyTaxYear), 2024);
  assert.equal(home.heating, 'Forced Air');
  assert.equal(home.garageType, 'attached');
  assert.equal(home.coordinateStatus, 'resolved');
  assert.equal(home.coordinateSource, 'rentcast');
  assert.deepEqual(await currentHomeCoordinates(home), { lat: 42.5001, lng: -83.1002 });
  assert.equal(home.listingImport.source, 'rentcast');
  assert.equal(home.listingImport.listing.status, 'active');
});

dbTest('changing the address clears the imported point (existing trigger); nothing re-attaches it', async () => {
  const { owner, id } = await importAndSave(documentedSaleListing());
  await saveHomeSharedFields(owner, id, { address: '200 Other St, Testville, MI' });
  const home = await reload(owner, id);
  assert.equal(home.coordinateStatus, 'unresolved');
  assert.equal(home.coordinateSource, null);
  assert.equal(await currentHomeCoordinates(home), null, 'the map and commute no longer use the old point');
});

dbTest('an inactive listing saves no asking price or days on market; the snapshot keeps the last known price', async () => {
  const { owner, id } = await importAndSave(documentedSaleListing({ status: 'Inactive', removedDate: '2026-08-01T00:00:00.000Z' }));
  const home = await reload(owner, id);
  assert.equal(home.price, '');
  assert.equal(home.daysOnMarket, '');
  assert.equal(home.listingImport.listing.status, 'inactive');
  assert.equal(home.listingImport.listing.lastKnownPrice, 289000);
});
