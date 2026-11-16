// Home Facts → Match fulfillment (PR #187), against real Postgres: the Garage
// qualifier, Central Air and No HOA read identically by the participant's own
// Match (computeMatch) and by the sanitized Compare projection the other
// participant sees (resolve_cobuyer_compare_perspectives). Own answers win,
// Unknown stays out of the score, one Garage criterion, nothing is rewritten.
// Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';
import { computeMatch } from '../src/lib/matching.js';
import { homeFactAnswer } from '../src/lib/homeFactCriteria.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { addCriterion, setGaragePreference } from '../src/lib/searchProfile.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities, saveHomePersonalState,
  saveHomeSharedFields, saveHomePersonalAndShared,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const MIGRATION = 'supabase/migrations/2026-11-16-home-facts-match-fulfillment.sql';
const PREVIOUS = 'supabase/migrations/2026-11-02-home-facts-match-parity.sql';
const PREFLIGHT = readFileSync(new URL('../supabase/home-facts-match-fulfillment-preflight.sql', import.meta.url), 'utf8').replace(/;\s*$/, '');

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.fulfil@example.com', firstName: 'Ciara', lastName: 'M' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.fulfil@example.com', firstName: 'Andrew', lastName: 'M' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  await joinCoBuyer(db, ids.owner, ids.coBuyer, ids.search, 'cobuyer.fulfil@example.com');
});
after(() => db?.drop());

async function joinCoBuyer(database, owner, coBuyer, search, email) {
  const invitation = await createInvitation(database.clientFor(owner), search, owner, email, 'co_buyer');
  assert.equal((await acceptInvitation(database.clientFor(coBuyer), invitation.token)).success, true);
}

const one = (categoryKey, label, { searchType = 'purchase', tier = 'must', garagePreference = null } = {}) => {
  let priorities = addCriterion(normalizePriorities({ searchType }), { categoryKey, label, kind: 'check', ...(searchType === 'rental' ? { source: 'custom' } : {}) }, tier);
  if (garagePreference) priorities = setGaragePreference(priorities, garagePreference);
  return priorities;
};

async function addHomes(database, owner, search, grid, street) {
  const homeIds = {};
  for (const [name, facts] of Object.entries(grid)) {
    const inserted = await database.clientFor(owner).from('homes').insert({ user_id: owner, search_id: search, address: `${name} ${street}, Royal Oak, MI 48073`, ...facts }).select('id').single();
    assert.equal(inserted.error, null, name);
    homeIds[name] = inserted.data.id;
  }
  return homeIds;
}
async function removeHomes(database, owner, homeIds) {
  for (const id of Object.values(homeIds)) await database.clientFor(owner).from('homes').delete().eq('id', id);
}

// Both scorers for one participant: their own Match and the other participant's Compare view must agree.
async function bothScorers(database, { viewerId, subjectId, search, homeIds, label = '' }) {
  const priorities = normalizePriorities(await resolvePriorities(database.clientFor(subjectId), { id: search }, subjectId));
  const homes = await getHomesForUser(database.clientFor(subjectId), subjectId, search);
  const projected = await resolveCoBuyerComparePerspectives(database.clientFor(viewerId), { id: search }, Object.values(homeIds));
  const out = {};
  for (const [name, id] of Object.entries(homeIds)) {
    const own = computeMatch(homes.find((home) => home.id === id), priorities);
    const other = projected.get(id).match;
    assert.deepEqual([other.pct, other.selectedCount, other.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount], `${label} ${name}`);
    out[name] = own;
  }
  return out;
}
const toPct = (value) => (value === true ? 100 : value === 'no' ? 0 : null);
const camel = (facts) => ({ garageType: facts.garage_type, garageSpaces: facts.garage_spaces, cooling: facts.cooling, hasHoa: facts.has_hoa, hoaFeeMonthly: facts.hoa_fee_monthly });

async function setChecks(database, userId, search, homeIds, checksFor) {
  const homes = await getHomesForUser(database.clientFor(userId), userId, search);
  for (const [name, id] of Object.entries(homeIds)) {
    await saveHomePersonalState(database.clientFor(userId), { ...homes.find((entry) => entry.id === id), checks: checksFor(name) }, userId, search);
  }
}

/* ------------------------------- Exhaustive grids ------------------------------- */

const GARAGE_GRID = {};
[null, 'none', 'attached', 'detached'].forEach((type, i) => ['', '0', '2', '3+', 'Attached', '1.2.3', 'none', 'No garage, 2 carport'].forEach((spaces, j) => {
  GARAGE_GRID[`g${i}${j}`] = { garage_type: type, garage_spaces: spaces };
}));
const COOLING_GRID = Object.fromEntries([null, '', ' ', 'Central Air', 'central air', 'Central', 'Central A/C', 'Central Air, Ceiling Fan(s)', 'Forced Air, Central', 'Central-Air',
  'None', ' none ', 'No', 'No Cooling', 'No A/C', 'No AC', 'No air conditioning', 'No central air', 'Window Units', 'Ductless Mini-Split', 'Heat Pump', 'Yes',
  'Central Evaporative', 'Not central air', 'No central air; window units', 'Centralized fans', 'Central Air?', 'Possibly central air', 'Maybe central', 'Central air (unverified)']
  .map((cooling, i) => [`c${i}`, { cooling }]));
const HOA_GRID = {};
[null, true, false].forEach((status, i) => [null, 0, 0.5, 450].forEach((fee, j) => { HOA_GRID[`h${i}${j}`] = { has_hoa: status, hoa_fee_monthly: fee }; }));

dbTest('Garage: every type × spaces × qualifier reads identically in both scorers, and matches the JS table', async () => {
  const homeIds = await addHomes(db, ids.owner, ids.search, GARAGE_GRID, 'Garage Grid Ct');
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({}));
  for (const garagePreference of ['any', 'attached', 'detached', 'carport']) {
    await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, one('exterior', 'Garage', { garagePreference: garagePreference === 'carport' ? null : garagePreference }));
    if (garagePreference === 'carport') db.exec(`update public.search_member_priorities set priorities = jsonb_set(priorities, '{exterior,garagePreference}', '"carport"') where user_id = '${ids.coBuyer}'`);
    const result = await bothScorers(db, { viewerId: ids.owner, subjectId: ids.coBuyer, search: ids.search, homeIds, label: `Garage ${garagePreference}` });
    for (const [name, match] of Object.entries(result)) {
      assert.equal(match.selectedCount, 1, 'one Garage criterion');
      const expected = homeFactAnswer(camel(GARAGE_GRID[name]), 'exterior:Garage', { garagePreference: garagePreference === 'carport' ? 'any' : garagePreference });
      assert.equal(match.pct, toPct(expected), `${garagePreference} on ${JSON.stringify(GARAGE_GRID[name])}`);
    }
  }
  // Spot checks of the required table (PR #187 brief).
  const spot = async (preference) => {
    await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, one('exterior', 'Garage', { garagePreference: preference }));
    return bothScorers(db, { viewerId: ids.owner, subjectId: ids.coBuyer, search: ids.search, homeIds, label: preference });
  };
  const anyGarage = await spot('any');
  assert.deepEqual([anyGarage.g20.pct, anyGarage.g30.pct, anyGarage.g10.pct, anyGarage.g00.pct, anyGarage.g02.pct], [100, 100, 0, null, 100], 'attached ✓ detached ✓ none ✗ unknown ? spaces-only ✓');
  const attached = await spot('attached');
  assert.deepEqual([attached.g20.pct, attached.g30.pct, attached.g10.pct, attached.g00.pct, attached.g02.pct], [100, 0, 0, null, null], 'attached ✓ detached-only ✗ none ✗ unknown ? spaces-only ?');
  const detached = await spot('detached');
  assert.deepEqual([detached.g30.pct, detached.g20.pct, detached.g10.pct, detached.g00.pct, detached.g02.pct], [100, 0, 0, null, null], 'detached ✓ attached-only ✗ none ✗ unknown ? spaces-only ?');
  // Contradictions answer nothing, in either direction.
  assert.deepEqual([anyGarage.g12.pct, attached.g21.pct, detached.g31.pct], [null, null, null]);
  await removeHomes(db, ids.owner, homeIds);
});

dbTest('Central Air (purchase and rental labels) and No HOA (status × fee): every value reads identically in both scorers', async () => {
  const homeIds = await addHomes(db, ids.owner, ids.search, { ...COOLING_GRID, ...HOA_GRID }, 'Fact Grid Ct');
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({}));
  for (const [categoryKey, label, searchType, key] of [
    ['features', 'Central air', 'purchase', 'features:Central air'],
    ['features', 'Central Air', 'rental', 'features:Central Air'],
    ['location', 'No HOA', 'purchase', 'location:No HOA'],
  ]) {
    await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, one(categoryKey, label, { searchType }));
    const result = await bothScorers(db, { viewerId: ids.owner, subjectId: ids.coBuyer, search: ids.search, homeIds, label });
    for (const [name, match] of Object.entries(result)) {
      const facts = { ...COOLING_GRID, ...HOA_GRID }[name];
      assert.equal(match.pct, toPct(homeFactAnswer(camel(facts), key)), `${label} on ${JSON.stringify(facts)}`);
    }
    if (key === 'location:No HOA') {
      // $0 alone is never No HOA; a confirmed HOA contradicts even at $0; status No with a fee disagrees.
      assert.deepEqual([result.h01.pct, result.h11.pct, result.h21.pct, result.h23.pct, result.h03.pct, result.h00.pct], [null, 0, 100, null, 0, null]);
    } else {
      const byText = Object.fromEntries(Object.entries(result).map(([name, match]) => [COOLING_GRID[name]?.cooling, match.pct]));
      assert.deepEqual([byText['Central Air'], byText.None, byText['Window Units'], byText['Heat Pump'], byText[''], byText['Possibly central air']], [100, 0, null, null, null, null]);
    }
  }
  await removeHomes(db, ids.owner, homeIds);
});

/* ------------------------- Precedence, independence, weights ------------------------- */

dbTest('owner and co-buyer with different qualifiers and answers on the same homes: each scored independently, own answers win, nothing written', async () => {
  const grid = { attached: { garage_type: 'attached', garage_spaces: '2', cooling: 'Central Air' }, detached: { garage_type: 'detached', garage_spaces: '1', cooling: 'None' }, unknown: {} };
  const homeIds = await addHomes(db, ids.owner, ids.search, grid, 'Both Way');
  const buyer = (garagePreference) => {
    let priorities = one('exterior', 'Garage', { garagePreference, tier: 'must' });
    priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Central air', kind: 'check' }, 'important');
    return { ...priorities, budget: { value: '500000', tier: 'nice' } };
  };
  await savePriorities(db.clientFor(ids.owner), { id: ids.search }, ids.owner, buyer('attached'));
  await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, buyer('detached'));
  await setChecks(db, ids.owner, ids.search, homeIds, () => ({}));
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({}));
  const asOwner = () => bothScorers(db, { viewerId: ids.coBuyer, subjectId: ids.owner, search: ids.search, homeIds, label: 'owner' });
  const asCoBuyer = () => bothScorers(db, { viewerId: ids.owner, subjectId: ids.coBuyer, search: ids.search, homeIds, label: 'co-buyer' });
  const garage = (match) => match.allSelected.find((item) => item.key === 'exterior:Garage');
  const air = (match) => match.allSelected.find((item) => item.key === 'features:Central air');

  let owner = await asOwner(); let coBuyer = await asCoBuyer();
  assert.deepEqual([garage(owner.attached).met, garage(owner.detached).met, garage(owner.unknown).evaluated], [true, false, false]);
  assert.deepEqual([garage(coBuyer.attached).met, garage(coBuyer.detached).met, garage(coBuyer.unknown).evaluated], [false, true, false]);
  assert.deepEqual([air(owner.attached).met, air(owner.detached).met, air(owner.unknown).evaluated], [true, false, false]);
  // Garage must (4) + Central Air important (2); budget has no price, so it's Unknown.
  assert.deepEqual([owner.attached.pct, owner.detached.pct, coBuyer.attached.pct, coBuyer.detached.pct], [100, 0, 33, 67]);
  assert.equal(owner.unknown.pct, null, 'Unknown never counts');

  // The co-buyer overrides: Garage Yes on the attached home, Central Air Yes despite "None".
  await setChecks(db, ids.coBuyer, ids.search, homeIds, (name) => (name === 'attached' ? { 'exterior:Garage': true } : name === 'detached' ? { 'features:Central air': true } : {}));
  owner = await asOwner(); coBuyer = await asCoBuyer();
  assert.deepEqual([garage(coBuyer.attached).met, garage(coBuyer.attached).source], [true, undefined]);
  assert.deepEqual([air(coBuyer.detached).met, air(coBuyer.detached).source], [true, undefined]);
  assert.deepEqual([coBuyer.attached.pct, coBuyer.detached.pct], [100, 100]);
  assert.deepEqual([owner.attached.pct, owner.detached.pct], [100, 0], 'the owner is untouched by the co-buyer\'s answers');

  // A shared fact change moves everyone without an override, at once.
  await db.clientFor(ids.coBuyer).from('homes').update({ garage_type: 'attached' }).eq('id', homeIds.detached);
  owner = await asOwner(); coBuyer = await asCoBuyer();
  assert.equal(garage(owner.detached).met, true);
  assert.equal(garage(coBuyer.detached).met, false);

  const stored = db.admin(`select user_id, checks from public.home_member_state where home_id in (${Object.values(homeIds).map((id) => `'${id}'`).join(',')}) order by user_id`);
  assert.ok(stored.filter((row) => row.user_id === ids.owner).every((row) => Object.keys(row.checks).length === 0), 'no derived answer was written');
  await removeHomes(db, ids.owner, homeIds);
});

dbTest('no duplicate weighting: both stored Central Air labels and an old Garage document count once, on both scorers', async () => {
  const homeIds = await addHomes(db, ids.owner, ids.search, { home: { garage_type: 'detached', garage_spaces: '2', cooling: 'Central' } }, 'Once Ln');
  // Written as stored data: both purchase spellings selected, and a Garage with an attached qualifier.
  const document = { searchType: 'purchase', features: { tiers: { 'Central Air': 'must', 'Central air': 'nice' } }, exterior: { tiers: { Garage: 'important' }, customItems: [{ label: 'Garage', kind: 'check' }], garagePreference: 'attached' } };
  db.exec(`update public.search_member_priorities set priorities = '${JSON.stringify(document)}'::jsonb where search_id = '${ids.search}' and user_id = '${ids.coBuyer}'`);
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({}));
  const result = await bothScorers(db, { viewerId: ids.owner, subjectId: ids.coBuyer, search: ids.search, homeIds, label: 'once' });
  assert.equal(result.home.selectedCount, 2, 'Central Air once, Garage once');
  // Central air (nice, 1) Yes; Garage (important, 2) No: detached for an attached qualifier.
  assert.equal(result.home.pct, 33);
  await removeHomes(db, ids.owner, homeIds);
});

/* --------------------------------- Data layer --------------------------------- */

dbTest('HOA status saves through the shared-field autosave and the full-row save; Unknown stays null; a co-buyer can correct it', async () => {
  const homeIds = await addHomes(db, ids.owner, ids.search, { hoa: { hoa_fee_monthly: 0 } }, 'Status St');
  let [home] = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).filter((entry) => entry.id === homeIds.hoa);
  assert.equal(home.hasHoa, null, 'Unknown, and known to this database');
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), homeIds.hoa, { hasHoa: false });
  assert.equal(db.admin(`select has_hoa from public.homes where id = '${homeIds.hoa}'`)[0].has_hoa, false);
  [home] = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).filter((entry) => entry.id === homeIds.hoa);
  assert.equal(home.hasHoa, false);
  // A full-row save that didn't touch it keeps it.
  await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...home, pros: 'Quiet street' }, ids.owner, ids.search);
  assert.equal(db.admin(`select has_hoa from public.homes where id = '${homeIds.hoa}'`)[0].has_hoa, false);
  await saveHomeSharedFields(db.clientFor(ids.owner), homeIds.hoa, { hasHoa: null });
  assert.equal(db.admin(`select has_hoa from public.homes where id = '${homeIds.hoa}'`)[0].has_hoa, null);
  await removeHomes(db, ids.owner, homeIds);
});

/* ---------------------------------- Production path ---------------------------------- */

dbTest('production path: preflight on pre-migration data, the migration (twice), nothing rewritten, then rollback and forward again', async () => {
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const owner = legacy.createUser({ email: 'owner.legacy.fulfil@example.com', firstName: 'Ciara', lastName: 'M' });
    const coBuyer = legacy.createUser({ email: 'cobuyer.legacy.fulfil@example.com', firstName: 'Andrew', lastName: 'M' });
    const search = legacy.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
    await joinCoBuyer(legacy, owner, coBuyer, search, 'cobuyer.legacy.fulfil@example.com');
    let priorities = one('exterior', 'Garage', { garagePreference: 'attached', tier: 'must' });
    priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Central air', kind: 'check' }, 'important');
    priorities = addCriterion(priorities, { categoryKey: 'location', label: 'No HOA', kind: 'check' }, 'nice');
    await savePriorities(legacy.clientFor(coBuyer), { id: search }, coBuyer, priorities);
    const homeIds = await addHomes(legacy, owner, search, {
      attachedCentral: { garage_type: 'attached', garage_spaces: '2', cooling: 'Central Air', hoa_fee_monthly: 0 },
      detachedNone: { garage_type: 'detached', garage_spaces: '2', cooling: 'None' },
      spacesOnly: { garage_spaces: '2', cooling: 'Window Units' },
      contradiction: { garage_type: 'none', garage_spaces: '2' },
      typeOnly: { garage_type: 'attached' },
      unknown: {},
    }, 'Legacy Ln');
    // An own Garage Yes on the detached home (kept: an override).
    await setChecks(legacy, coBuyer, search, homeIds, (name) => (name === 'detachedNone' ? { 'exterior:Garage': true } : {}));

    // Pre-migration: the app cannot read has_hoa yet and still reads the home (optional column).
    const homesBefore = await getHomesForUser(legacy.clientFor(coBuyer), coBuyer, search);
    assert.ok(homesBefore.length === 6 && homesBefore.every((home) => home.hasHoa === undefined));
    assert.equal(homesBefore[0].laundryLocation, null, 'the other optional column is still read');
    // A full-row save on that database still works and keeps the other optional column.
    const saved = await saveHomePersonalAndShared(legacy.clientFor(owner), { ...homesBefore.find((home) => home.id === homeIds.unknown), laundryLocation: 'first_floor' }, owner, search);
    assert.deepEqual([saved.laundryLocation, saved.hasHoa], ['first_floor', undefined]);

    // Before the migration: the app reads these homes with the 2026-11-02 rules the
    // database's scorer still has, so the two Match views agree on every home.
    assert.ok(homesBefore.every((home) => home.matchFactRules === 'pre-2026-11-16'));
    const pre = await bothScorers(legacy, { viewerId: owner, subjectId: coBuyer, search, homeIds, label: 'before migration' });
    assert.equal(pre.spacesOnly.allSelected.find((item) => item.key === 'exterior:Garage').met, true, 'old rule: spaces alone answer Garage');
    assert.equal(pre.attachedCentral.allSelected.find((item) => item.key === 'features:Central air').evaluated, false, 'old rule: Cooling is not read');

    const snapshot = () => legacy.admin(`select
      (select json_agg(p order by p.user_id) from public.search_member_priorities p) as priorities,
      (select json_agg(h order by h.id) from public.homes h) as homes,
      (select json_agg(m order by m.home_id, m.user_id) from public.home_member_state m) as states`)[0];
    const before = snapshot();
    const report = legacy.admin(PREFLIGHT);
    assert.deepEqual(report.filter((row) => row.check === 'required' && row.ok !== true), []);
    const info = (prefix) => report.find((row) => row.item.startsWith(prefix))?.detail;
    assert.match(info('current body is the 2026-11-02'), /^expected: 2026-11-02-home-facts-match-parity\.sql/);
    assert.match(info('homes.has_hoa already exists'), /^no/);
    assert.equal(info('Garage selections by qualifier'), '0 / 1 / 0');
    // spacesOnly: Yes -> Unknown; contradiction: Yes -> Unknown; typeOnly: Unknown -> Yes. detachedNone has an own answer.
    assert.equal(info('Garage evaluations that change'), 'attached: 1, 0, 0, 0, 2, 0');
    assert.equal(info('Garage: Must-Haves that become a confirmed miss'), '0');
    assert.equal(info('Garage: own Yes / No kept as an override'), '1');
    assert.equal(info('saved homes whose garage type and spaces contradict'), '1');
    assert.equal(info('Central Air evaluations newly answered'), 'important: 1 / 1');
    assert.equal(info('saved homes by Cooling reading'), '1 / 1 / 4');
    assert.equal(info('home × participant pairs with a changed evaluation'), '5 (1 searches)');
    assert.deepEqual(snapshot(), before, 'the preflight writes nothing');

    assert.equal(legacy.applyFile(MIGRATION).error, null);
    const afterMigration = snapshot();
    assert.deepEqual(afterMigration.priorities, before.priorities);
    assert.deepEqual(afterMigration.states, before.states);
    assert.deepEqual(afterMigration.homes.map(({ has_hoa: hasHoa, ...rest }) => { assert.equal(hasHoa, null); return rest; }), before.homes, 'only the new, null column');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 'the migration is re-runnable');
    assert.match(legacy.admin(PREFLIGHT).find((row) => row.item.startsWith('current body is the 2026-11-02')).detail, /^ALREADY APPLIED/);
    const security = legacy.admin(`select p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p where p.proname = 'resolve_cobuyer_compare_perspectives'`)[0];
    assert.deepEqual([security.prosecdef, security.proconfig, security.auth, security.anon], [true, ['search_path=""'], true, false]);
    // The new column has exactly the privileges of the existing Home Facts column beside it, for every role.
    const privileges = (column) => legacy.admin(`select r.rolname, p.privilege, has_column_privilege(r.rolname, 'public.homes', '${column}', p.privilege) as granted
      from (values ('anon'), ('authenticated'), ('service_role')) r(rolname) cross join (values ('select'), ('insert'), ('update')) p(privilege) order by 1, 2`);
    assert.deepEqual(privileges('has_hoa'), privileges('laundry_location'));
    assert.ok(privileges('has_hoa').filter((row) => row.rolname === 'authenticated').every((row) => row.granted));

    const result = await bothScorers(legacy, { viewerId: owner, subjectId: coBuyer, search, homeIds, label: 'after' });
    assert.ok((await getHomesForUser(legacy.clientFor(coBuyer), coBuyer, search)).every((home) => home.matchFactRules === undefined && home.hasHoa === null), 'the new rules, at once');
    const garage = (name) => result[name].allSelected.find((item) => item.key === 'exterior:Garage');
    assert.deepEqual([garage('attachedCentral').met, garage('detachedNone').met, garage('spacesOnly').evaluated, garage('contradiction').evaluated, garage('typeOnly').met],
      [true, true, false, false, true], 'the own Yes on the detached home wins');

    // Rollback: the previous scorer body; the column stays (unused), nothing rewritten.
    assert.equal(legacy.applyFile(PREVIOUS).error, null);
    assert.deepEqual(snapshot(), afterMigration);
    assert.match(legacy.admin(PREFLIGHT).find((row) => row.item.startsWith('current body is the 2026-11-02')).detail, /^expected/);
    const rolledBack = await resolveCoBuyerComparePerspectives(legacy.clientFor(owner), { id: search }, [homeIds.spacesOnly]);
    assert.equal(rolledBack.get(homeIds.spacesOnly).match.evaluatedCount, 1, 'the previous rule: spaces alone answer Garage');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 'and forward again');
  } finally {
    legacy.drop();
  }
});
