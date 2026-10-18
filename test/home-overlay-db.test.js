// The home overlay (docs/home-overlay-phase-2.md) against real Postgres:
// Laundry Location's migration and its release scripts, partial autosave of
// shared facts, co-buyer / Realtor / outsider permissions, the app working on a
// database that hasn't applied the migration yet, and the autosave queue's
// ordering and failure handling. Plus the pure helpers it relies on.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState, saveHomeSharedFields,
  sharedColumnFor, sharedFieldChanges,
} = await import('../src/lib/supabase/collaboration.js');
const { createAutosaveQueue } = await import('../src/lib/autosaveQueue.js');
const { canonicalLaundryLocation, normalizeRentCastFields } = await import('../src/lib/rentcast.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { basementPatch, garagePatch, garageSpacesSelectValue, layoutPatch, layoutValues, LAUNDRY_LOCATION_CHOICES } = await import('../src/lib/homeFacts.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const MIGRATION = 'supabase/migrations/2026-10-18-laundry-location.sql';
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const quiet = { warn() {} };
// The harness (like supabase-js) rejects with plain { message } objects.
const rejectsWith = (promise, pattern) => assert.rejects(promise, (error) => { assert.match(error?.message || String(error), pattern); return true; });

/* ------------------------------- pure helpers ------------------------------- */

test('Laundry Location imports only an explicit, single location', () => {
  assert.equal(canonicalLaundryLocation('Basement'), 'basement');
  assert.equal(canonicalLaundryLocation('In Basement'), 'basement');
  assert.equal(canonicalLaundryLocation('First Floor Laundry Room'), 'first_floor');
  assert.equal(canonicalLaundryLocation('Main Level'), 'first_floor');
  assert.equal(canonicalLaundryLocation('Second Floor'), 'second_floor');
  assert.equal(canonicalLaundryLocation(['Laundry Room', 'Second Floor']), 'second_floor');
  // Several locations, hookups, yes/no, "in unit", "upper level": never guessed.
  for (const value of ['Basement, Main Level', 'Hookups - Basement', 'Washer/Dryer Hookups', 'Yes', true, 'In Unit', 'Upper Level', 'Upstairs', '', null, undefined]) {
    assert.equal(canonicalLaundryLocation(value), null, String(value));
  }
  // A basement existing says nothing about the laundry.
  const { fields } = normalizeRentCastFields({ features: { basement: 'Finished' } }, null);
  assert.equal(fields.laundryLocation, undefined);
  assert.equal(normalizeRentCastFields({ features: { laundry: 'Basement' } }, null).fields.laundryLocation, 'basement');
  // Apartment communities never import it; import only fills an empty field.
  assert.equal(normalizeRentCastFields({ features: { laundry: 'Basement' } }, null, { apartmentCommunity: true }).fields.laundryLocation, undefined);
  assert.equal(mergeImportFields({ laundryLocation: 'second_floor' }, { laundryLocation: 'basement' }).laundryLocation, 'second_floor');
  assert.deepEqual(LAUNDRY_LOCATION_CHOICES.map(([key]) => key), ['basement', 'first_floor', 'second_floor']);
});

test('layout, garage and basement edits write only what changed and keep None distinct from Unknown', () => {
  const home = { homeLayout: ['Two Story'], primaryBedroomLocation: 'Upstairs' };
  assert.deepEqual(layoutValues(home), ['Two Story']);
  assert.deepEqual(layoutPatch(home, ['Two Story']), {});
  assert.deepEqual(layoutPatch(home, ['Two Story', 'Ranch / Single Story']), { homeLayout: ['Two Story', 'Ranch / Single Story'] });
  assert.deepEqual(layoutPatch({ homeLayout: [], primaryBedroomLocation: 'Main Floor' }, []), { primaryBedroomLocation: '' });
  // Turning First-Floor Primary off never clears another stored location.
  assert.deepEqual(layoutPatch(home, []), { homeLayout: [] });
  assert.deepEqual(garagePatch({}, 'garageType', 'none'), { garageType: 'none', garageSpaces: '0' });
  assert.deepEqual(garagePatch({ garageType: 'none', garageSpaces: '0' }, 'garageType', 'attached'), { garageType: 'attached', garageSpaces: '' });
  assert.deepEqual(garagePatch({ garageType: 'none', garageSpaces: '0' }, 'garageType', null), { garageType: null });
  assert.deepEqual(garagePatch({ garageType: 'none' }, 'garageSpaces', '2'), { garageSpaces: '2', garageType: null });
  assert.deepEqual(basementPatch({}, 'basementStyle', 'none'), { basementStyle: 'none', basementCondition: 'none' });
  assert.deepEqual(basementPatch({ basementStyle: 'none', basementCondition: 'none' }, 'basementCondition', 'finished'), { basementCondition: 'finished', basementStyle: null });
  assert.equal(garageSpacesSelectValue('4'), '3+');
  assert.equal(garageSpacesSelectValue(''), '');
  assert.equal(garageSpacesSelectValue('tandem'), 'tandem');
});

test('Laundry Location is not a Match input and scoring is unchanged', () => {
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'First-floor laundry', kind: 'check' }, 'must');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Second-Floor Laundry', kind: 'check' }, 'important');
  const home = { price: '300000', beds: '3', checks: { 'features:First-floor laundry': true } };
  for (const laundryLocation of [undefined, null, 'basement', 'first_floor', 'second_floor']) {
    assert.deepEqual(computeMatch({ ...home, laundryLocation }, priorities), computeMatch(home, priorities));
  }
  assert.doesNotMatch(read('src/lib/matching.js') + read('src/lib/matchCriteria.js'), /laundryLocation|laundry_location/);
  assert.match(read('src/lib/matching.js'), /must: \{ label: 'Must have', weight: 4|weight/);
  assert.match(read('src/lib/constants.js'), /must: \{ label: 'Must have', weight: 4, [^}]*\},\s*important: \{ label: 'Important', weight: 2, [^}]*\},\s*nice: \{ label: 'Nice to have', weight: 1,/);
});

test('shared fields map to their columns; only changed shared fields form a patch', () => {
  assert.equal(sharedColumnFor('schoolDistrict'), 'school_district_name');
  assert.equal(sharedColumnFor('laundryLocation'), 'laundry_location');
  assert.equal(sharedColumnFor('estMonthly'), 'est_monthly');
  assert.equal(sharedColumnFor('primaryBedroomLocation'), 'primary_bedroom_location');
  assert.deepEqual(sharedFieldChanges({ notes: 'a', status: 'Toured', price: '1' }, { notes: '', status: 'Saved', price: '1' }), { notes: 'a' });
});

test('the autosave queue serializes writes, always sends the newest value, and keeps failures until retried', async () => {
  let latest = { price: '1' };
  const writes = [];
  let fail = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const states = [];
  const queue = createAutosaveQueue({
    getLatest: () => latest,
    writeShared: async (patch) => { writes.push(patch); if (writes.length === 1) await gate; if (fail > 0) { fail -= 1; throw new Error('offline'); } },
    writePersonal: async () => { writes.push('personal'); },
    onChange: (state) => states.push(state.state),
    log: quiet,
  });
  queue.markShared(['price']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // While the first write is in flight, three more edits arrive.
  latest = { price: '2' }; queue.markShared(['price']);
  latest = { price: '3', beds: '4' }; queue.markShared(['price', 'beds']);
  queue.markPersonal();
  release();
  assert.equal(await queue.settle(), true);
  // The first write, then ONE coalesced write with the newest values.
  assert.deepEqual(writes, [{ price: '1' }, { price: '3', beds: '4' }, 'personal']);
  assert.equal(queue.status().state, 'saved');

  fail = 1;
  latest = { ...latest, sqft: '1800' };
  queue.markShared(['sqft']);
  assert.equal(await queue.settle(), false);
  assert.deepEqual(queue.status().failed, ['sqft']);
  assert.equal(queue.status().state, 'error');
  assert.equal(queue.hasUnsaved(), true);
  queue.retry();
  assert.equal(await queue.settle(), true);
  assert.deepEqual(writes.at(-1), { sqft: '1800' });
  assert.equal(queue.hasUnsaved(), false);
  assert.ok(states.includes('saving') && states.includes('error'));
});

/* ------------------------------ real Postgres ------------------------------ */

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  for (const key of ['owner', 'coBuyer', 'realtor', 'outsider']) ids[key] = db.createUser({ email: `${key}.overlay@example.com` });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  for (const [key, role] of [['coBuyer', 'co_buyer'], ['realtor', 'realtor']]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, `${key}.overlay@example.com`, role);
    assert.equal((await acceptInvitation(db.clientFor(ids[key]), invitation.token)).success, true);
  }
});
after(() => db?.drop());

const row = (id) => db.admin(`select * from public.homes where id = '${id}'`)[0];
const stateOf = (id, user) => db.admin(`select checks, status, ratings from public.home_member_state where home_id = '${id}' and user_id = '${user}'`)[0];

dbTest('Laundry Location saves, reloads, rejects anything but its tokens, and stays separate from In-Unit Laundry', async () => {
  const owner = db.clientFor(ids.owner);
  const added = await saveHomePersonalAndShared(owner, { address: '1 Laundry Ln', status: 'Saved', checks: {}, ratings: {}, laundryLocation: 'basement' }, ids.owner, ids.search);
  assert.equal(row(added.id).laundry_location, 'basement');
  assert.equal(row(added.id).in_unit_laundry, null);
  let [view] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  assert.equal(view.laundryLocation, 'basement');
  await saveHomeSharedFields(owner, added.id, { laundryLocation: 'second_floor' });
  [view] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  assert.equal(view.laundryLocation, 'second_floor');
  await saveHomeSharedFields(owner, added.id, { laundryLocation: null });
  assert.equal(row(added.id).laundry_location, null, 'Unknown is stored as null');
  await rejectsWith(saveHomeSharedFields(owner, added.id, { laundryLocation: 'garage' }), /homes_laundry_location_check|violates check/);
  assert.equal(row(added.id).laundry_location, null);
  // A brand-new home without the fact leaves it Unknown.
  const plain = await saveHomePersonalAndShared(owner, { address: '2 Plain St', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  assert.equal(row(plain.id).laundry_location, null);
});

dbTest('partial autosave writes only its columns: a co-buyer\'s concurrent edit and everyone\'s personal answers survive', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const added = await saveHomePersonalAndShared(owner, { address: '3 Shared Way', price: '300000', status: 'Saved', checks: { 'features:Fireplace': true }, ratings: {} }, ids.owner, ids.search);
  await saveHomePersonalState(coBuyer, { ...added, status: 'Want to Tour', checks: { 'features:Fireplace': 'no' }, ratings: {} }, ids.coBuyer, ids.search);
  const [ownerCopy] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  const [coCopy] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId: added.id });
  // Both have the overlay open; each edits a different fact from a stale copy.
  await saveHomeSharedFields(coBuyer, coCopy.id, { yearBuilt: '1992' });
  await saveHomeSharedFields(owner, ownerCopy.id, { heating: 'Forced Air', laundryLocation: 'first_floor' });
  const after = row(added.id);
  assert.equal(after.year_built, '1992', 'the owner\'s autosave overwrote the co-buyer\'s fact');
  assert.equal(after.heating, 'Forced Air');
  assert.equal(after.laundry_location, 'first_floor');
  assert.equal(after.price, '300000');
  assert.equal(after.user_id, ids.owner, 'the adder never changes');
  assert.deepEqual(stateOf(added.id, ids.owner).checks, { 'features:Fireplace': true });
  assert.deepEqual(stateOf(added.id, ids.coBuyer).checks, { 'features:Fireplace': 'no' });
  assert.equal(stateOf(added.id, ids.coBuyer).status, 'Want to Tour');
  // Autosave refuses personal or unknown fields outright.
  await assert.rejects(saveHomeSharedFields(owner, added.id, { checks: {} }), /Not shared home fields: checks/);
  await assert.rejects(saveHomeSharedFields(owner, added.id, { user_id: ids.coBuyer }), /Not shared home fields/);
});

dbTest('Realtors and outsiders cannot autosave a buyer\'s facts; nothing changes', async () => {
  const owner = db.clientFor(ids.owner);
  const added = await saveHomePersonalAndShared(owner, { address: '4 Private Pl', status: 'Saved', checks: {}, ratings: {}, laundryLocation: 'basement' }, ids.owner, ids.search);
  const before = row(added.id);
  for (const user of [ids.realtor, ids.outsider]) {
    await rejectsWith(saveHomeSharedFields(db.clientFor(user), added.id, { laundryLocation: 'second_floor', yearBuilt: '2001' }), /row-level security|permission denied|expected one row/i);
    await rejectsWith(saveHomePersonalState(db.clientFor(user), { ...added, checks: { 'features:Fireplace': true } }, user, ids.search), /row-level security|permission denied|violates/i);
  }
  assert.deepEqual(row(added.id), before);
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${added.id}' and user_id in ('${ids.realtor}', '${ids.outsider}')`)[0].n, 0);
  // The outsider cannot even read it through the overlay's single-home read.
  assert.deepEqual(await getHomesForUser(db.clientFor(ids.outsider), ids.outsider, ids.search, { homeId: added.id }), []);
});

dbTest('the autosave queue against real Postgres: rapid edits land as the last value, a failure is retried, the owner\'s answers are untouched', async () => {
  const coBuyer = db.clientFor(ids.coBuyer);
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), { address: '5 Rapid Rd', status: 'Saved', checks: { 'features:Pool': true }, ratings: {} }, ids.owner, ids.search);
  let [latest] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId: added.id });
  let offline = false;
  const queue = createAutosaveQueue({
    getLatest: () => latest,
    writeShared: (patch) => { if (offline) { offline = false; return Promise.reject(new Error('offline')); } return saveHomeSharedFields(coBuyer, added.id, patch); },
    writePersonal: (snapshot) => saveHomePersonalState(coBuyer, snapshot, ids.coBuyer, ids.search),
    log: quiet,
  });
  for (const estMonthly of ['2', '25', '257', '2574']) { latest = { ...latest, estMonthly }; queue.markShared(['estMonthly']); }
  for (const propertyType of ['house', 'condo', 'multifamily']) { latest = { ...latest, propertyType }; queue.markShared(['propertyType']); }
  latest = { ...latest, checks: { 'features:Pool': 'no' } };
  queue.markPersonal();
  assert.equal(await queue.settle(), true);
  assert.equal(row(added.id).est_monthly, '2574');
  assert.equal(row(added.id).property_type, 'multifamily');
  assert.deepEqual(stateOf(added.id, ids.coBuyer).checks, { 'features:Pool': 'no' });
  assert.deepEqual(stateOf(added.id, ids.owner).checks, { 'features:Pool': true });

  offline = true;
  latest = { ...latest, highSchool: 'Anchor Bay High' };
  queue.markShared(['highSchool']);
  assert.equal(await queue.settle(), false);
  assert.equal(row(added.id).high_school, null);
  queue.retry();
  assert.equal(await queue.settle(), true);
  assert.equal(row(added.id).high_school, 'Anchor Bay High');
});

dbTest('no SQL function reads laundry_location (the SQL scorer is unchanged)', () => {
  const readers = db.admin(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ilike '%laundry_location%'`);
  assert.deepEqual(readers, []);
});

dbTest('before the migration is applied the app still reads and writes homes (Laundry Location just hides); preflight, migration (twice) and verification', async () => {
  const PREFLIGHT = read('supabase/laundry-location-preflight.sql').replace(/;\s*$/, '');
  const VERIFY = read('supabase/laundry-location-verification.sql').replace(/;\s*$/, '');
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const owner = legacy.createUser({ email: 'owner.legacy.laundry@example.com' });
    const client = legacy.clientFor(owner);
    const search = legacy.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
    // Today's importer may hand a new home a laundry location: the save still succeeds.
    const added = await saveHomePersonalAndShared(client, { address: '6 Early St', status: 'Saved', checks: {}, ratings: {}, inUnitLaundry: true, laundryLocation: 'basement' }, owner, search);
    assert.ok(added.id);
    const [view] = await getHomesForUser(client, owner, search);
    assert.equal(view.laundryLocation, undefined, 'unknown to this database: the overlay hides the field');
    assert.equal(view.inUnitLaundry, true);
    // Editing the whole home (the full editor) works without the column, and so does autosave.
    await saveHomePersonalAndShared(client, { ...view, price: '250000' }, owner, search);
    await saveHomeSharedFields(client, added.id, { yearBuilt: '1990' });
    const snapshot = () => legacy.admin('select json_agg(h order by h.id) as homes from (select * from public.homes) h')[0];
    const before = snapshot();
    assert.equal(before.homes[0].year_built, '1990');
    assert.equal(before.homes[0].price, '250000');

    const report = legacy.admin(PREFLIGHT);
    assert.deepEqual(report.filter((entry) => entry.check === 'required' && entry.ok !== true), []);
    assert.equal(report.find((entry) => entry.item.startsWith('homes (all stay Unknown')).detail, '1');
    assert.deepEqual(snapshot(), before, 'the preflight writes nothing');

    assert.equal(legacy.applyFile(MIGRATION).error, null);
    const afterApply = snapshot();
    assert.equal(afterApply.homes[0].laundry_location, null);
    assert.deepEqual({ ...afterApply.homes[0], laundry_location: undefined }, { ...before.homes[0], laundry_location: undefined }, 'the migration rewrites no home');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 're-runnable');
    const verification = legacy.admin(VERIFY);
    assert.deepEqual(verification.filter((entry) => entry.ok !== true), []);
    assert.equal(verification.find((entry) => entry.section === 7).detail, '0');
    const [migrated] = await getHomesForUser(client, owner, search);
    assert.equal(migrated.laundryLocation, null, 'after the migration the field shows as Unknown');
  } finally {
    legacy.drop();
  }
});
