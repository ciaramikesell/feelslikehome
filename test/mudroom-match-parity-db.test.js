// Mudroom Match parity (2026-10-15-cobuyer-compare-mudroom-parity.sql): a
// co-buyer's Mudroom priority counts identically in their own Match
// (computeMatch) and in the sanitized Compare projection the other participant
// sees. Unknown stays Unknown on both sides; only the co-buyer's own Yes / No
// evaluates it. Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';
import { computeMatch, hasNoMustHaveMisses, mustHaveStatus } from '../src/lib/matching.js';
import { normalizePriorities, RETIRED_PURCHASE_BUILT_IN_KEYS } from '../src/lib/constants.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);

// A buyer who chose Mudroom as a Must-Have (stored exactly as selection stores it).
function mudroomBuyer() {
  const priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '500000', tier: 'important' };
  priorities.features = { ...priorities.features, customItems: [{ label: 'Mudroom', kind: 'check' }], tiers: { Mudroom: 'must' }, order: ['Mudroom'] };
  return priorities;
}

let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.mudroom@example.com', firstName: 'Ciara', lastName: 'M' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.mudroom@example.com', firstName: 'Andrew', lastName: 'M' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
});
after(() => db?.drop());

const MIGRATION = 'supabase/migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql';
const PREFLIGHT = readFileSync(new URL('../supabase/mudroom-parity-preflight.sql', import.meta.url), 'utf8').replace(/;\s*$/, '');

test('Mudroom is no longer a retired purchase built-in in JS; Must-Have and Unknown rules are unchanged', () => {
  assert.ok(!RETIRED_PURCHASE_BUILT_IN_KEYS.includes('features:Mudroom'));
  const status = (checks) => {
    const match = computeMatch({ price: '450000', checks }, mudroomBuyer());
    return { match, must: mustHaveStatus(match), mudroom: match.allSelected.find((item) => item.key === 'features:Mudroom') };
  };
  // Unknown: selected, not evaluated, never a miss — even as a Must-Have.
  let result = status({});
  assert.deepEqual(result.match.allSelected.map((item) => [item.key, item.evaluated]), [['budget', true], ['features:Mudroom', false]]);
  assert.equal(result.match.missing.length, 0);
  assert.deepEqual([result.must.total, result.must.met, result.must.missed, result.must.unknown], [1, 0, 0, 1]);
  assert.equal(hasNoMustHaveMisses(result.match), true);
  assert.equal(result.match.pct, 100, 'Unknown stays out of the percentage');
  // A historical boolean false is still Unknown (only the explicit 'no' is a miss).
  assert.equal(status({ 'features:Mudroom': false }).mudroom.evaluated, false);
  // No: a confirmed Must-Have miss at Must-Have weight.
  result = status({ 'features:Mudroom': 'no' });
  assert.deepEqual([result.must.met, result.must.missed], [0, 1]);
  assert.equal(hasNoMustHaveMisses(result.match), false);
  assert.equal(result.match.pct, 33, 'budget 1×2 + Mudroom 0×4 over 6');
  // Yes: met.
  result = status({ 'features:Mudroom': true });
  assert.deepEqual([result.must.met, result.must.missed], [1, 0]);
  assert.equal(result.match.pct, 100);
});

test('existing saved Mudroom selections count in either stored shape; rentals are unaffected', () => {
  // Promoted into customItems (how selection stores it), or a bare tier from older data.
  const promoted = mudroomBuyer();
  const bareTier = normalizePriorities({ searchType: 'purchase', features: { tiers: { Mudroom: 'important' } } });
  for (const priorities of [promoted, bareTier]) {
    const stored = JSON.stringify(priorities);
    const mudroom = computeMatch({ checks: { 'features:Mudroom': true } }, priorities).allSelected.find((item) => item.key === 'features:Mudroom');
    assert.deepEqual([mudroom.evaluated, mudroom.met], [true, true]);
    assert.equal(JSON.stringify(priorities), stored, 'reading never rewrites the stored preference');
  }
  const deselected = normalizePriorities({ searchType: 'purchase', features: { tiers: { Mudroom: 'dontcare' }, customItems: [{ label: 'Mudroom', kind: 'check' }] } });
  assert.equal(computeMatch({ checks: { 'features:Mudroom': true } }, deselected), null, 'a deselected Mudroom stays off');
  const rental = normalizePriorities({ searchType: 'rental', features: { tiers: { Mudroom: 'nice' }, customItems: [{ label: 'Mudroom', kind: 'check' }] } });
  assert.ok(computeMatch({ checks: {} }, rental).allSelected.some((item) => item.key === 'features:Mudroom'), 'rentals already counted it');
});

dbTest('the co-buyer’s Mudroom counts the same in their own Match and in the owner’s Compare view', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const invitation = await createInvitation(owner, ids.search, ids.owner, 'cobuyer.mudroom@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(coBuyer, invitation.token)).success, true);
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, mudroomBuyer());

  const inserted = await owner.from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: '9 Mudroom Ln, Grosse Pointe, MI 48236', price: '450000' }).select('id').single();
  assert.equal(inserted.error, null);
  const homeId = inserted.data.id;
  const priorities = normalizePriorities(await resolvePriorities(coBuyer, { id: ids.search }, ids.coBuyer));

  const both = async () => {
    const [home] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search);
    const own = computeMatch(home, priorities);
    const projected = (await resolveCoBuyerComparePerspectives(owner, { id: ids.search }, [homeId])).get(homeId).match;
    // The same selected and evaluated criteria on both sides, not just the same score.
    assert.equal(projected.selectedCount, own.selectedCount);
    assert.equal(projected.evaluatedCount, own.evaluatedCount);
    return { own, projected, mudroom: own.allSelected.find((item) => item.key === 'features:Mudroom') };
  };

  // Unknown: neither side evaluates it; both count only the budget.
  let result = await both();
  assert.equal(result.mudroom.evaluated, false);
  assert.equal(result.own.evaluatedCount, 1);
  assert.equal(result.projected.pct, result.own.pct);
  assert.equal(result.own.pct, 100);

  // The co-buyer's own No is a confirmed miss on both sides.
  let [home] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search);
  await saveHomePersonalState(coBuyer, { ...home, checks: { 'features:Mudroom': 'no' } }, ids.coBuyer, ids.search);
  result = await both();
  assert.deepEqual([result.mudroom.evaluated, result.mudroom.met], [true, false]);
  assert.equal(result.own.pct, 33, 'budget 1×2 + Mudroom 0×4 over weight 6');
  assert.equal(result.projected.pct, result.own.pct);

  // And Yes is met on both sides.
  [home] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search);
  await saveHomePersonalState(coBuyer, { ...home, checks: { 'features:Mudroom': true } }, ids.coBuyer, ids.search);
  result = await both();
  assert.equal(result.mudroom.met, true);
  assert.equal(result.own.pct, 100);
  assert.equal(result.projected.pct, result.own.pct);
});

dbTest('production path: preflight on pre-migration data, then the migration — saved Mudroom choices start counting and nothing is rewritten', async () => {
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const owner = legacy.createUser({ email: 'owner.legacy.mudroom@example.com', firstName: 'Ciara', lastName: 'M' });
    const coBuyer = legacy.createUser({ email: 'cobuyer.legacy.mudroom@example.com', firstName: 'Andrew', lastName: 'M' });
    const search = legacy.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
    const ownerClient = legacy.clientFor(owner);
    const coBuyerClient = legacy.clientFor(coBuyer);
    const invitation = await createInvitation(ownerClient, search, owner, 'cobuyer.legacy.mudroom@example.com', 'co_buyer');
    assert.equal((await acceptInvitation(coBuyerClient, invitation.token)).success, true);
    // The co-buyer chose Mudroom before it was retired, stored as a bare tier.
    const saved = { searchType: 'purchase', budget: { value: '500000', tier: 'important' }, features: { tiers: { Mudroom: 'must' } } };
    await savePriorities(coBuyerClient, { id: search }, coBuyer, saved);
    const inserted = await ownerClient.from('homes').insert({ user_id: owner, search_id: search, address: '12 Legacy Ct, Grosse Pointe, MI 48236', price: '450000' }).select('id').single();
    const homeId = inserted.data.id;
    const [home] = await getHomesForUser(coBuyerClient, coBuyer, search);
    await saveHomePersonalState(coBuyerClient, { ...home, checks: { 'features:Mudroom': 'no' } }, coBuyer, search);

    const snapshot = () => legacy.admin(`select
      (select json_agg(p order by p.user_id) from public.search_member_priorities p) as priorities,
      (select json_agg(s order by s.id) from public.searches s) as searches,
      (select json_agg(h order by h.id) from public.homes h) as homes,
      (select json_agg(m order by m.home_id, m.user_id) from public.home_member_state m) as states`)[0];
    const projected = async () => (await resolveCoBuyerComparePerspectives(ownerClient, { id: search }, [homeId])).get(homeId).match;
    const own = computeMatch((await getHomesForUser(coBuyerClient, coBuyer, search))[0], normalizePriorities(await resolvePriorities(coBuyerClient, { id: search }, coBuyer)));

    // Before: the Compare scorer skips Mudroom, so it disagrees with the co-buyer's own Match.
    const beforeCompare = await projected();
    assert.deepEqual([beforeCompare.selectedCount, beforeCompare.pct], [1, 100]);
    assert.deepEqual([own.selectedCount, own.pct], [2, 33]);

    const before = snapshot();
    const report = legacy.admin(PREFLIGHT);
    assert.deepEqual(report.filter((row) => row.check === 'required' && row.ok !== true), []);
    const info = (prefix) => report.find((row) => row.item.startsWith(prefix))?.detail;
    assert.match(info('current body is a known repository version'), /^expected: 2026-10-07-cobuyer-compare-garage-parity\.sql/);
    assert.equal(info('purchase preference documents with Mudroom selected'), '1');
    assert.equal(info('of those, by level'), 'must: 1');
    assert.equal(info('personal Mudroom answers on homes'), 'yes: 0, no: 1');
    assert.deepEqual(snapshot(), before, 'the preflight writes nothing');

    const applied = legacy.applyFile(MIGRATION);
    assert.equal(applied.error, null);
    assert.deepEqual(snapshot(), before, 'the migration rewrites no preferences, homes or answers');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 'the migration is re-runnable');
    const after = legacy.admin(PREFLIGHT);
    assert.deepEqual(after.filter((row) => row.check === 'required' && row.ok !== true), []);
    assert.match(after.find((row) => row.item.startsWith('current body is a known')).detail, /^ALREADY APPLIED/);

    // After: the saved Must-Have counts on both sides, identically.
    const afterCompare = await projected();
    assert.deepEqual([afterCompare.pct, afterCompare.selectedCount, afterCompare.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount]);
  } finally {
    legacy.drop();
  }
});
