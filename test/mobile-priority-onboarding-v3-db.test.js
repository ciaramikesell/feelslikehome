// Real Postgres: priorities written by Mobile Priority Onboarding V3 (flow 4)
// persist through the existing save path, stay each buyer's own (no blended
// household score), survive a read-back unchanged (desktop and mobile read the
// same document), and score identically in computeMatch and the SQL Compare
// scorer — with the buyer's own features Unknown (unscored) until answered.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { chooseSearchType } = await import('../src/lib/onboardingBasics.js');
const { criterionAnswerPatch } = await import('../src/lib/matchCriteria.js');
const { priorityLevels } = await import('../src/lib/searchProfile.js');
const { addOwnFeature, categoryView, featureLevel, setFeatureLevel, setGarageImportance, setGarageType } = await import('../src/lib/priorityCategories.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities,
  saveHomePersonalAndShared, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');
const { saveOnboardingProgress } = await import('../src/lib/supabase/data.js');
const { beginOnboarding, skipOnboardingStep } = await import('../src/lib/onboardingFlow.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const SEATING = 'features:Countertop Seating';

function ownerPriorities() {
  let p = chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });
  p.budget = { ...p.budget, value: '400000' };
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'must');
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Countertop Seating', custom: true, group: 'kitchen' }, 'important');
  const own = addOwnFeature(p, 'kitchen', 'Pot filler');
  p = setFeatureLevel(own.priorities, own.feature, 'nice');
  p = setGarageType(setGarageImportance(p, 'important'), 'attached');
  return p;
}
function coBuyerPriorities() {
  let p = chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });
  p.budget = { ...p.budget, value: '400000' };
  p = setFeatureLevel(p, { categoryKey: 'features', label: 'Countertop Seating', custom: true, group: 'kitchen' }, 'nice');
  return setGarageImportance(p, 'not_important');
}

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.v3@example.com', firstName: 'Ciara' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.v3@example.com', firstName: 'Andrew' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.v3@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('flow 4 priorities round-trip unchanged, stay independent per buyer, and both scorers agree', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  await savePriorities(owner, { id: ids.search }, ids.owner, ownerPriorities());
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, coBuyerPriorities());

  const ownerStored = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  const coBuyerStored = normalizePriorities(await resolvePriorities(coBuyer, { id: ids.search }, ids.coBuyer));
  assert.deepEqual(ownerStored, normalizePriorities(ownerPriorities()), 'the document reads back exactly (one schema for every surface)');
  assert.deepEqual(ownerStored.features.customItems.find((item) => item.label === 'Pot filler'), { label: 'Pot filler', kind: 'check', source: 'custom', group: 'kitchen' });
  assert.deepEqual(categoryView(ownerStored, 'kitchen').cards.filter((card) => card.level).map((card) => [card.text, card.level]).sort(),
    [['Countertop Seating', 'important'], ['Kitchen Island', 'must'], ['Pot filler', 'nice']]);
  // Independent: the co-buyer's levels are their own; nothing was merged.
  assert.equal(featureLevel(coBuyerStored, { categoryKey: 'features', label: 'Countertop Seating' }), 'nice');
  assert.equal(featureLevel(coBuyerStored, { categoryKey: 'features', label: 'Kitchen Island' }), null);
  assert.equal(priorityLevels(coBuyerStored).flatMap((level) => level.items).some((item) => item.label === 'Garage'), false);

  const added = await saveHomePersonalAndShared(owner, { address: '1 Island Way', price: '350000', garageSpaces: '0', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  const check = async () => {
    const [ownerHome] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
    const [coBuyerHome] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId: added.id });
    const ownerMatch = computeMatch(ownerHome, ownerStored);
    const coBuyerMatch = computeMatch(coBuyerHome, coBuyerStored);
    const projected = (await resolveCoBuyerComparePerspectives(coBuyer, { id: ids.search }, [added.id])).get(added.id).match;
    assert.deepEqual([projected.pct, projected.selectedCount, projected.evaluatedCount], [ownerMatch.pct, ownerMatch.selectedCount, ownerMatch.evaluatedCount], 'SQL and JS agree');
    return { ownerHome, coBuyerHome, ownerMatch, coBuyerMatch };
  };

  let { ownerHome, ownerMatch, coBuyerMatch } = await check();
  // Owner: budget yes (2), garage known no (Important, 2 → 0); everything else Unknown, unscored.
  assert.deepEqual([ownerMatch.pct, ownerMatch.evaluatedCount], [50, 2]);
  // Co-buyer said a garage isn't important: the same home is not marked down for it.
  assert.deepEqual([coBuyerMatch.pct, coBuyerMatch.evaluatedCount], [100, 1]);

  await saveHomePersonalState(owner, { ...ownerHome, ...criterionAnswerPatch(ownerHome, SEATING, true, ownerStored.searchType).personal }, ids.owner, ids.search);
  ({ ownerMatch, coBuyerMatch } = await check());
  assert.deepEqual([ownerMatch.pct, ownerMatch.evaluatedCount], [67, 3], 'budget 2 + garage 0 + seating 2 over 6');
  assert.deepEqual([coBuyerMatch.pct, coBuyerMatch.evaluatedCount], [100, 1], 'the owner’s answer is not the co-buyer’s');
});

dbTest('skip and resume progress persists on the profile without touching priorities', async () => {
  const owner = db.clientFor(ids.owner);
  const before = await resolvePriorities(owner, { id: ids.search }, ids.owner);
  const begun = beginOnboarding({ context: { searchId: ids.search, role: 'owner' }, targetVersion: 4 });
  const skipped = skipOnboardingStep(4, { ...begun.state, step: 'cat_kitchen' }, 'cat_kitchen').state;
  assert.equal(await saveOnboardingProgress(owner, ids.owner, { version: 4, state: skipped }), true);
  const [row] = db.admin(`select onboarding_version, onboarding_state from public.profiles where id = '${ids.owner}'`);
  assert.equal(row.onboarding_version, 4);
  assert.deepEqual(row.onboarding_state.skipped, ['cat_kitchen']);
  const resumed = beginOnboarding({ storedVersion: row.onboarding_version, storedState: row.onboarding_state, context: { searchId: ids.search, role: 'owner' }, targetVersion: 4 });
  assert.equal(resumed.state.step, 'cat_living');
  assert.deepEqual(await resolvePriorities(owner, { id: ids.search }, ids.owner), before);
});
