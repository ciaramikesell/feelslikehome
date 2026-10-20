// Filter My Homes against a real database: each participant filters by their
// OWN answers (home_member_state, through getHomesForUser), a co-buyer's Yes
// never fills in for the current buyer's Unknown, and filtering writes nothing.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { criterionAnswerPatch } = await import('../src/lib/matchCriteria.js');
const { applyHomeFilters, filterableCriteria } = await import('../src/lib/homeFilters.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolvePriorities, savePriorities, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const FENCED = 'exterior:Fenced yard';
const SUITE = 'features:First-floor guest suite';

function priorities() {
  let p = applySearchChoice(normalizePriorities({}), 'home_buy');
  p.sqftTarget = { value: '1800', tier: 'must' };
  p = addCriterion(p, { categoryKey: 'exterior', label: 'Fenced yard', kind: 'check' }, 'important');
  p = addCriterion(p, { categoryKey: 'features', label: 'First-floor guest suite', kind: 'check', source: 'custom' }, 'nice');
  return p;
}

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.filters@example.com', firstName: 'Ciara', lastName: 'M' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.filters@example.com', firstName: 'Sam', lastName: 'M' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.filters@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

const snapshot = () => db.admin(`select
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.homes t) as homes,
  (select md5(coalesce(string_agg(t::text, '|' order by t.home_id, t.user_id), '')) from public.home_member_state t) as states,
  (select md5(coalesce(string_agg(t::text, '|' order by t.user_id), '')) from public.search_member_priorities t) as priorities`)[0];

dbTest('co-buyer answers stay separate, and filtering never writes', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  await savePriorities(owner, { id: ids.search }, ids.owner, priorities());
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, priorities());
  const inserted = await owner.from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: '12 Filter Ln, Troy, MI 48084', sqft: '1450', lot_size: '8850 sq ft' }).select('id').single();
  assert.equal(inserted.error, null);
  const homeId = inserted.data.id;

  // The co-buyer says Yes to both; the owner has answered only the guest suite.
  const [coBuyerHome] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId });
  await saveHomePersonalState(coBuyer, { ...coBuyerHome, checks: { [FENCED]: true, [SUITE]: true } }, ids.coBuyer, ids.search);
  const [ownerHome] = await getHomesForUser(owner, ids.owner, ids.search, { homeId });
  await saveHomePersonalState(owner, { ...ownerHome, ...criterionAnswerPatch(ownerHome, SUITE, true, 'purchase').personal }, ids.owner, ids.search);

  const before = snapshot();
  const filters = { sqftMin: '1200', lotMinAcres: '0.2', criteria: [FENCED, SUITE] };
  const run = async (client, userId) => {
    const p = normalizePriorities(await resolvePriorities(client, { id: ids.search }, userId));
    const homes = await getHomesForUser(client, userId, ids.search);
    const matchBefore = homes.map((home) => computeMatch(home, p).pct);
    const result = applyHomeFilters(homes, filters, (home) => computeMatch(home, p), { criteria: filterableCriteria(p) });
    assert.deepEqual(homes.map((home) => computeMatch(home, p).pct), matchBefore, 'Match unchanged by filtering');
    return result.byId.get(homeId);
  };

  const ownerResult = await run(owner, ids.owner);
  assert.equal(ownerResult.status, 'possible', "the co-buyer's Yes does not confirm the owner's fence");
  assert.deepEqual(ownerResult.unknown, ['Fenced Yard not confirmed']);
  const coBuyerResult = await run(coBuyer, ids.coBuyer);
  assert.equal(coBuyerResult.status, 'confirmed');
  assert.deepEqual(snapshot(), before, 'filtering wrote nothing');

  // The owner's own No excludes the home for the owner only.
  const [ownerAgain] = await getHomesForUser(owner, ids.owner, ids.search, { homeId });
  await saveHomePersonalState(owner, { ...ownerAgain, ...criterionAnswerPatch(ownerAgain, FENCED, 'no', 'purchase').personal }, ids.owner, ids.search);
  const afterNo = snapshot();
  assert.equal((await run(owner, ids.owner)).status, 'excluded');
  assert.equal((await run(coBuyer, ids.coBuyer)).status, 'confirmed');

  // Filtering itself (both runs above) left every table exactly as it was.
  assert.deepEqual(snapshot(), afterNo);
  assert.notDeepEqual(before, afterNo, 'sanity: the owner’s explicit save did change state');
});
