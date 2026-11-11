// Real Postgres: a buyer's own typed priority stored as `rating` ("Desirable
// Street", Location Must-Have — the founder's production shape) is answered
// Yes / No / Unknown through the existing personal save path, each buyer's
// answer stays their own, a Realtor cannot answer, and the SQL Compare scorer
// (resolve_cobuyer_compare_perspectives, unchanged) agrees with computeMatch
// at every step — it already reads ratings, then checks, for every item.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCustomCriterion } = await import('../src/lib/searchProfile.js');
const { answerableCriteriaKeys, criterionAnswerPatch } = await import('../src/lib/matchCriteria.js');
const { archiveHome } = await import('../src/lib/lifecycle.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities,
  saveHomePersonalAndShared, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const KEY = 'location:Desirable Street';

function basePriorities() {
  const priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities.preferredPropertyTypes = { values: [], tier: 'dontcare' };
  priorities.budget = { ...priorities.budget, value: '400000', tier: 'important' };
  return priorities;
}
// The pre-fix stored shape: kind 'rating', no source flag, Must-Have.
function legacyCustom() {
  const priorities = basePriorities();
  priorities.location = { ...priorities.location, customItems: [{ label: 'Desirable Street', kind: 'rating' }], tiers: { 'Desirable Street': 'must' } };
  return priorities;
}

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.street@example.com', firstName: 'Ciara' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.street@example.com', firstName: 'Andrew' });
  ids.realtor = db.createUser({ email: 'realtor.street@example.com', firstName: 'Rae' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  for (const [user, email, role] of [[ids.coBuyer, 'cobuyer.street@example.com', 'co_buyer'], [ids.realtor, 'realtor.street@example.com', 'realtor']]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, email, role);
    assert.equal((await acceptInvitation(db.clientFor(user), invitation.token)).success, true);
  }
});
after(() => db?.drop());

const stateOf = (homeId, user) => db.admin(`select checks, ratings from public.home_member_state where home_id = '${homeId}' and user_id = '${user}'`)[0] || null;

dbTest('existing custom rating priority: Yes / No / Unknown persist to the owner only, and both scorers agree', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  await savePriorities(owner, { id: ids.search }, ids.owner, legacyCustom());
  // The co-buyer has the same priority (their own document) with their own answer.
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, legacyCustom());
  const stored = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  assert.deepEqual(stored.location.customItems, [{ label: 'Desirable Street', kind: 'rating' }], 'stored kind, label and identity unchanged');
  assert.equal(stored.location.tiers['Desirable Street'], 'must');
  assert.ok(answerableCriteriaKeys(stored).has(KEY));

  const added = await saveHomePersonalAndShared(owner, { address: '1 Desirable St', price: '350000', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  const [coBuyerFirst] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId: added.id });
  await saveHomePersonalState(coBuyer, { ...coBuyerFirst, ...criterionAnswerPatch(coBuyerFirst, KEY, 'no', stored.searchType).personal }, ids.coBuyer, ids.search);

  const ownerView = async () => {
    const [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
    const own = computeMatch(home, stored);
    // The co-buyer's Compare shows the owner's Match through the SQL scorer.
    const projected = (await resolveCoBuyerComparePerspectives(coBuyer, { id: ids.search }, [added.id])).get(added.id).match;
    assert.deepEqual([projected.pct, projected.selectedCount, projected.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount], 'SQL and JS agree');
    return { home, own };
  };

  let { home, own } = await ownerView();
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 1], 'Unknown: only the budget counts');

  await saveHomePersonalState(owner, { ...home, ...criterionAnswerPatch(home, KEY, true, stored.searchType).personal }, ids.owner, ids.search);
  ({ home, own } = await ownerView());
  assert.deepEqual(stateOf(added.id, ids.owner).checks, { [KEY]: true });
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 2]);

  await saveHomePersonalState(owner, { ...home, ...criterionAnswerPatch(home, KEY, 'no', stored.searchType).personal }, ids.owner, ids.search);
  ({ home, own } = await ownerView());
  assert.deepEqual([own.pct, own.evaluatedCount], [33, 2], 'budget 1×2 + street 0×4 over 6');

  await saveHomePersonalState(owner, { ...home, ...criterionAnswerPatch(home, KEY, undefined, stored.searchType).personal }, ids.owner, ids.search);
  ({ home, own } = await ownerView());
  assert.deepEqual(stateOf(added.id, ids.owner).checks, {});
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 1], 'Unknown is unscored, never No');

  // The co-buyer's own No was never touched by any of the owner's answers.
  assert.deepEqual(stateOf(added.id, ids.coBuyer).checks, { [KEY]: 'no' });
  const [coBuyerHome] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId: added.id });
  assert.equal(computeMatch(coBuyerHome, stored).pct, 33);
});

dbTest('a 1–5 rating stored from before scores the same in both scorers until a Yes replaces it', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  await savePriorities(owner, { id: ids.search }, ids.owner, legacyCustom());
  const stored = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  const added = await saveHomePersonalAndShared(owner, { address: '2 Rated Rd', price: '350000', status: 'Saved', checks: {}, ratings: { [KEY]: 2, 'tour:overall': 4 } }, ids.owner, ids.search);
  const both = async () => {
    const [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
    const own = computeMatch(home, stored);
    const projected = (await resolveCoBuyerComparePerspectives(coBuyer, { id: ids.search }, [added.id])).get(added.id).match;
    assert.deepEqual([projected.pct, projected.evaluatedCount], [own.pct, own.evaluatedCount]);
    return { home, own };
  };
  let { home, own } = await both();
  assert.deepEqual([own.pct, own.evaluatedCount], [60, 2], 'budget 1×2 + 2/5×4 over 6');
  await saveHomePersonalState(owner, { ...home, ...criterionAnswerPatch(home, KEY, true, stored.searchType).personal }, ids.owner, ids.search);
  ({ home, own } = await both());
  assert.deepEqual(stateOf(added.id, ids.owner), { checks: { [KEY]: true }, ratings: { 'tour:overall': 4 } });
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 2]);
});

dbTest('newly added custom priority is saved as check and answered the same way; archived homes keep the answer', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const fresh = addCustomCriterion(basePriorities(), 'location', 'Desirable Street');
  await savePriorities(owner, { id: ids.search }, ids.owner, fresh);
  const stored = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  assert.deepEqual(stored.location.customItems, [{ label: 'Desirable Street', kind: 'check', source: 'custom' }]);
  const added = await saveHomePersonalAndShared(owner, { address: '3 New Ln', price: '350000', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  let [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  await saveHomePersonalState(owner, { ...home, ...criterionAnswerPatch(home, KEY, 'no', stored.searchType).personal }, ids.owner, ids.search);
  [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  assert.equal(computeMatch(home, stored).pct, 50, 'budget 1×2 + street 0×2 (Important) over 4');
  // Archiving is personal lifecycle; it never touches the answer.
  await saveHomePersonalState(owner, archiveHome(home, 'Not for us'), ids.owner, ids.search);
  [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  assert.equal(home.status, 'Archived');
  assert.deepEqual(home.checks, { [KEY]: 'no' });
  const projected = (await resolveCoBuyerComparePerspectives(coBuyer, { id: ids.search }, [added.id])).get(added.id).match;
  assert.equal(projected.pct, computeMatch(home, stored).pct);
});

dbTest('a Realtor cannot answer a buyer\'s custom priority; nothing changes', async () => {
  const owner = db.clientFor(ids.owner);
  const added = await saveHomePersonalAndShared(owner, { address: '4 Agent Ave', price: '350000', status: 'Saved', checks: { [KEY]: true }, ratings: {} }, ids.owner, ids.search);
  const before = stateOf(added.id, ids.owner);
  await assert.rejects(
    saveHomePersonalState(db.clientFor(ids.realtor), { ...added, ...criterionAnswerPatch(added, KEY, 'no', 'purchase').personal }, ids.realtor, ids.search),
    (error) => error.code === '42501' && /row-level security/.test(error.message),
  );
  assert.deepEqual(stateOf(added.id, ids.owner), before);
  assert.equal(stateOf(added.id, ids.realtor), null);
});
