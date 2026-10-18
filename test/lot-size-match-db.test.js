// Lot-size Match accuracy (2026-10-18-lot-size-units-match-parity.sql): both
// Match scorers read a home's lot size with its stored unit. RentCast stores a
// lot under an acre as '8850 sq ft'; it used to meet a 0.5 acre Must-Have as if
// it were 8,850 acres. computeMatch (src/lib/lotSize.js lotSizeAcres) and the
// co-buyer Compare projection now agree on 0.203 acres. Weights, partial
// credit, Unknown and every other criterion are unchanged. DB tests skip unless
// FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';
import { lotSizeAcres } from '../src/lib/lotSize.js';
import { computeMatch, mustHaveStatus } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { normalizeLotSizeInput } from '../src/lib/homeFacts.js';
import { formatLotSizeDisplay } from '../src/lib/homeDisplay.js';
import { normalizeRentCastFields } from '../src/lib/rentcast.js';
import { sortContenders } from '../src/lib/homesCollection.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

// A buyer whose budget is Important (2×) and lot size is at the given level.
function lotBuyer(value = '0.5', tier = 'must') {
  const priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '500000', tier: 'important' };
  priorities.lotSizeTarget = { value, tier };
  return priorities;
}
const lotOf = (match) => match.allSelected.find((item) => item.key === 'lotSize');

test('lotSizeAcres reads every stored shape with its unit', () => {
  close(lotSizeAcres('8850 sq ft'), 8850 / 43560);
  assert.equal(Number(lotSizeAcres('8850 sq ft').toFixed(3)), 0.203);
  assert.equal(lotSizeAcres('0.20 acres'), 0.2);
  assert.equal(lotSizeAcres('1 acre'), 1);
  assert.equal(lotSizeAcres('43560 sq ft'), 1);
  assert.equal(lotSizeAcres('43,560 sqft'), 1);
  close(lotSizeAcres('8,850 sq ft'), 8850 / 43560);
  close(lotSizeAcres('10,890 Square Feet'), 0.25);
  assert.equal(lotSizeAcres('1,234.5 acres'), 1234.5);
  assert.equal(lotSizeAcres('.75 ac'), 0.75);
  assert.equal(lotSizeAcres('0.25 ac.'), 0.25);
  assert.equal(lotSizeAcres('  3 ACRES '), 3);
  close(lotSizeAcres('2 ha'), 4.9421076294);
  close(lotSizeAcres('2023.4 sq m'), 2023.4 / 4046.8564224);
  // A bare number is acres, the field's labeled unit (unchanged).
  assert.equal(lotSizeAcres('0.25'), 0.25);
  // Unknown: blank, zero, fractions, decimal commas, malformed or unit-less words.
  for (const raw of ['', '   ', null, undefined, '0', '0 sq ft', '0.0 acres', '1/4 acre', '0,25 acres', '1.25.', 'irregular', 'Unknown', '-1 acre', '2 lots', '0.25 acres approx']) {
    assert.equal(lotSizeAcres(raw), null, JSON.stringify(raw));
  }
});

test('Home Facts normalization reads the same grammar Match does', () => {
  assert.equal(normalizeLotSizeInput('8850 sq ft'), '0.2 acres');
  assert.equal(normalizeLotSizeInput('43,560 sq ft'), '1 acre');
  assert.equal(normalizeLotSizeInput('0.5'), '0.5 acres');
  // A decimal comma is no longer read as thousands ('0,25' was stored as 25 acres).
  assert.equal(normalizeLotSizeInput('0,25 acres'), '0,25 acres');
  assert.equal(lotSizeAcres(normalizeLotSizeInput('0,25 acres')), null);
  for (const raw of ['8850 sq ft', '10,890 sq ft', '2 ha', '1 acre']) {
    close(lotSizeAcres(normalizeLotSizeInput(raw)), Number(lotSizeAcres(raw).toFixed(2)));
  }
});

test('the RentCast import shape scores as acres: 8,850 sq ft misses a 0.5 acre Must-Have', () => {
  const stored = normalizeRentCastFields({ lotSize: 8850 }, null).fields.lotSize;
  assert.equal(stored, '8850 sq ft');
  assert.equal(normalizeRentCastFields({ lotSize: 54450 }, null).fields.lotSize, '1.25 acres');
  const match = computeMatch({ price: '450000', lotSize: stored }, lotBuyer());
  assert.deepEqual([lotOf(match).evaluated, lotOf(match).met], [true, false]);
  close(lotOf(match).score, (8850 / 43560) / 0.5);
  assert.equal(lotOf(match).detail, '0.2 acres below target 0.5');
  assert.equal(mustHaveStatus(match).missed, 1);
  // budget 1×2 + lot 0.406×4 over 6
  assert.equal(match.pct, Math.round(((2 + (8850 / 43560 / 0.5) * 4) / 6) * 100));
  assert.equal(match.pct, 60);
});

test('minimum acreage: met at or above the target, partial credit below it; Unknown stays neutral', () => {
  const at = (lotSize, value = '1', tier = 'must') => computeMatch({ price: '450000', lotSize }, lotBuyer(value, tier));
  assert.equal(lotOf(at('43560 sq ft')).met, true, 'exactly 1 acre meets a 1 acre minimum');
  assert.equal(lotOf(at('43559 sq ft')).met, false);
  assert.equal(lotOf(at('1 acre')).met, true);
  assert.equal(lotOf(at('0.20 acres', '0.2')).met, true);
  assert.equal(lotOf(at('8850 sq ft', '0.2')).met, true, '0.203 acres meets 0.2');
  assert.equal(lotOf(at('8850 sq ft', '0.25')).met, false);
  assert.equal(lotOf(at('2 ha', '4')).met, true);
  for (const unknown of ['', '0', '1/4 acre', '0,25 acres', 'irregular']) {
    const match = at(unknown);
    assert.equal(lotOf(match).evaluated, false, JSON.stringify(unknown));
    assert.deepEqual([mustHaveStatus(match).missed, mustHaveStatus(match).unknown], [0, 1]);
    assert.equal(match.pct, 100, 'Unknown stays out of the percentage');
  }
  // Weights are unchanged: Must-Have 4×, Important 2×, Nice to Have 1×.
  const half = (tier) => at('0.5 acres', '1', tier).pct; // lot scores 0.5; budget 1 × 2
  assert.equal(half('must'), Math.round(((2 + 0.5 * 4) / 6) * 100));
  assert.equal(half('important'), Math.round(((2 + 0.5 * 2) / 4) * 100));
  assert.equal(half('nice'), Math.round(((2 + 0.5 * 1) / 3) * 100));
  assert.equal(at('8850 sq ft', '1', 'dontcare').allSelected.some((item) => item.key === 'lotSize'), false);
});

test('only the lot-size criterion changes; every other criterion scores exactly as before', () => {
  const priorities = lotBuyer('0.5', 'important');
  priorities.bedsMin = { value: '3', tier: 'must' };
  priorities.sqftTarget = { value: '2000', tier: 'nice' };
  const home = { price: '520000', beds: '3', sqft: '1,800', lotSize: '8850 sq ft' };
  const withLot = computeMatch(home, priorities).allSelected.filter((item) => item.key !== 'lotSize');
  const withoutLot = computeMatch({ ...home, lotSize: '' }, priorities).allSelected.filter((item) => item.key !== 'lotSize');
  assert.deepEqual(withLot, withoutLot);
});

test('Compare and My Homes show the same lot sizes as before, and Match ordering follows the corrected lot', () => {
  assert.equal(formatLotSizeDisplay('8850 sq ft'), '0.20 acres');
  assert.equal(formatLotSizeDisplay('0.20 acres'), '0.20 acres');
  assert.equal(formatLotSizeDisplay('1 acre'), '1.00 acres');
  assert.equal(formatLotSizeDisplay('43560 sq ft'), '1.00 acres');
  assert.equal(formatLotSizeDisplay('8,850 sq ft'), '0.20 acres');
  assert.equal(formatLotSizeDisplay(''), '');
  // My Homes / Compare "Match" ordering: the real 1.25 acre lot now ranks above the
  // 0.2 acre one that used to read as 8,850 acres.
  const priorities = lotBuyer('1', 'must');
  const homes = [{ id: 'small', price: '450000', lotSize: '8850 sq ft' }, { id: 'large', price: '450000', lotSize: '1.25 acres' }];
  assert.deepEqual(sortContenders(homes, 'matchDesc', (home) => computeMatch(home, priorities)).map((home) => home.id), ['large', 'small']);
});

/* ------------------------------ Real Postgres ------------------------------ */

const STORED_SHAPES = ['8850 sq ft', '8,850 sq ft', '0.20 acres', '1 acre', '1.25 acres', '43560 sq ft', '43,559 sq ft', '0.5', '2 ha', '0', '1/4 acre', '0,25 acres', '0.25 ac.', 'irregular', ''];

async function cobuyerSearch(database, tag) {
  const owner = database.createUser({ email: `owner.lot.${tag}@example.com`, firstName: 'Ciara', lastName: 'M' });
  const coBuyer = database.createUser({ email: `cobuyer.lot.${tag}@example.com`, firstName: 'Andrew', lastName: 'M' });
  const search = database.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
  const ownerClient = database.clientFor(owner);
  const coBuyerClient = database.clientFor(coBuyer);
  const invitation = await createInvitation(ownerClient, search, owner, `cobuyer.lot.${tag}@example.com`, 'co_buyer');
  assert.equal((await acceptInvitation(coBuyerClient, invitation.token)).success, true);
  return { owner, coBuyer, search, ownerClient, coBuyerClient };
}

async function addHome(client, owner, search, lotSize) {
  const inserted = await client.from('homes').insert({ user_id: owner, search_id: search, address: '1 Test Ln, Detroit, MI 48201', price: '450000', lot_size: lotSize }).select('id').single();
  assert.equal(inserted.error, null);
  return inserted.data.id;
}

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('buyer / co-buyer parity: every stored lot-size shape scores the same in the co-buyer’s own Match and in the owner’s Compare view', async () => {
  const { owner, coBuyer, search, ownerClient, coBuyerClient } = await cobuyerSearch(db, 'parity');
  for (const tier of ['must', 'important', 'nice']) {
    await savePriorities(coBuyerClient, { id: search }, coBuyer, lotBuyer('0.5', tier));
    const priorities = normalizePriorities(await resolvePriorities(coBuyerClient, { id: search }, coBuyer));
    const ids = new Map();
    for (const lotSize of STORED_SHAPES) ids.set(lotSize, await addHome(ownerClient, owner, search, lotSize));
    const projected = await resolveCoBuyerComparePerspectives(ownerClient, { id: search }, [...ids.values()]);
    const homes = await getHomesForUser(coBuyerClient, coBuyer, search);
    for (const [lotSize, id] of ids) {
      const own = computeMatch(homes.find((home) => home.id === id), priorities);
      const other = projected.get(id).match;
      assert.deepEqual([other.pct, other.selectedCount, other.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount], `${tier} ${JSON.stringify(lotSize)}`);
      assert.equal(lotOf(own).evaluated, lotSizeAcres(lotSize) !== null);
    }
    for (const id of ids.values()) await ownerClient.from('homes').delete().eq('id', id);
  }
});

const MIGRATION = 'supabase/migrations/2026-10-18-lot-size-units-match-parity.sql';
const PREFLIGHT = readFileSync(new URL('../supabase/lot-size-match-preflight.sql', import.meta.url), 'utf8').replace(/;\s*$/, '');

dbTest('production path: preflight reports the impact on pre-migration data; the migration corrects Compare and rewrites nothing', async () => {
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const { owner, coBuyer, search, ownerClient, coBuyerClient } = await cobuyerSearch(legacy, 'legacy');
    await savePriorities(coBuyerClient, { id: search }, coBuyer, lotBuyer('0.5', 'must'));
    const ids = {};
    for (const lotSize of ['8850 sq ft', '1.25 acres', '0.20 acres', '']) ids[lotSize] = await addHome(ownerClient, owner, search, lotSize);
    const priorities = normalizePriorities(await resolvePriorities(coBuyerClient, { id: search }, coBuyer));
    const projected = async () => resolveCoBuyerComparePerspectives(ownerClient, { id: search }, Object.values(ids));
    const snapshot = () => legacy.admin(`select
      (select json_agg(p order by p.user_id) from public.search_member_priorities p) as priorities,
      (select json_agg(s order by s.id) from public.searches s) as searches,
      (select json_agg(h order by h.id) from public.homes h) as homes,
      (select json_agg(m order by m.home_id, m.user_id) from public.home_member_state m) as states`)[0];

    // Before: Compare scores the 8,850 sq ft lot as 8,850 acres (Must-Have met).
    let compare = await projected();
    assert.equal(compare.get(ids['8850 sq ft']).match.pct, 100);
    assert.equal(compare.get(ids['0.20 acres']).match.pct, 60);

    const before = snapshot();
    const report = legacy.admin(PREFLIGHT);
    assert.deepEqual(report.filter((row) => row.check === 'required' && row.ok !== true), []);
    const info = (prefix) => report.find((row) => row.item.startsWith(prefix))?.detail;
    assert.match(info('current body is the 2026-10-15'), /^expected: 2026-10-15-cobuyer-compare-mudroom-parity\.sql/);
    assert.equal(info('saved homes by lot-size shape'), 'acres: 2, blank: 1, sq ft: 1');
    assert.equal(info('sq ft values under 1 acre'), '1');
    assert.equal(info('homes whose lot-size reading changes'), '1');
    assert.equal(info('homes whose lot size makes co-buyer Compare error'), '0');
    assert.equal(info('participant preference documents with a lot-size target'), 'must: 1');
    assert.equal(info('home × participant lot-size evaluations that change'), '1');
    assert.equal(info('distinct homes / searches affected'), '1 homes, 1 searches');
    assert.equal(info('changes by stored shape'), 'sq ft: 1');
    assert.equal(info('state transitions'), 'must: met -> missed ×1');
    assert.equal(info('Must-Have status changes'), '1 / 0');
    assert.equal(info('lot-size criterion score change'), '-0.594 / -0.594');
    assert.equal(info('bare numbers'), '0 / 0');
    assert.deepEqual(snapshot(), before, 'the preflight writes nothing');

    assert.equal(legacy.applyFile(MIGRATION).error, null);
    assert.deepEqual(snapshot(), before, 'the migration rewrites no preferences, homes or answers');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 'the migration is re-runnable');
    const afterReport = legacy.admin(PREFLIGHT);
    assert.deepEqual(afterReport.filter((row) => row.check === 'required' && row.ok !== true), []);
    assert.match(afterReport.find((row) => row.item.startsWith('current body is the 2026-10-15')).detail, /^ALREADY APPLIED/);

    // After: Compare agrees with the co-buyer's own Match for every home.
    compare = await projected();
    const homes = await getHomesForUser(coBuyerClient, coBuyer, search);
    for (const id of Object.values(ids)) {
      const own = computeMatch(homes.find((home) => home.id === id), priorities);
      assert.deepEqual([compare.get(id).match.pct, compare.get(id).match.evaluatedCount], [own.pct, own.evaluatedCount]);
    }
    assert.equal(compare.get(ids['8850 sq ft']).match.pct, 60, 'budget 1×2 + lot 0.406×4 over 6');
  } finally {
    legacy.drop();
  }
});

dbTest('a lot size the old Compare scorer could not cast no longer errors the whole projection', async () => {
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const { owner, coBuyer, search, ownerClient, coBuyerClient } = await cobuyerSearch(legacy, 'cast');
    await savePriorities(coBuyerClient, { id: search }, coBuyer, lotBuyer('0.5', 'important'));
    const good = await addHome(ownerClient, owner, search, '1 acre');
    const odd = await addHome(ownerClient, owner, search, '0.25 ac.');
    await assert.rejects(resolveCoBuyerComparePerspectives(ownerClient, { id: search }, [good, odd]));
    assert.equal(legacy.admin(PREFLIGHT).find((row) => row.item.startsWith('homes whose lot size makes co-buyer Compare error')).detail, '1');
    assert.equal(legacy.applyFile(MIGRATION).error, null);
    const compare = await resolveCoBuyerComparePerspectives(ownerClient, { id: search }, [good, odd]);
    assert.equal(compare.get(good).match.pct, 100);
    assert.equal(compare.get(odd).match.pct, Math.round(((2 + 0.5 * 2) / 4) * 100), '0.25 acres of 0.5 at Important');
  } finally {
    legacy.drop();
  }
});
