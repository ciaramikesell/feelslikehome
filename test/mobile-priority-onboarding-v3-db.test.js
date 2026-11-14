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
const { petsAutoMarker, petsMovingAnswer, setPetsMoving } = await import('../src/lib/rentalPets.js');

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

// Rental Foundations (docs/rental-foundations-onboarding-spec.md §7, Stage 2):
// two co-renters on one Home to Rent search. Pet-Friendly Must Have from the
// pets answer scores identically in computeMatch and the SQL Compare scorer
// with homes.pets_allowed null (Unknown) / true / false; the additive
// petsMoving / petsAuto keys round-trip and change neither score; each
// renter's document is their own.
dbTest('rental pets answer: JS = SQL for co-renters with pets_allowed null / true / false; additive keys are invisible to Match', async () => {
  const a = db.createUser({ email: 'renter.a.pets@example.com', firstName: 'Renter' });
  const b = db.createUser({ email: 'renter.b.pets@example.com', firstName: 'Other' });
  const search = db.admin(`select id from public.searches where user_id = '${a}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(a), search, a, 'renter.b.pets@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(b), invitation.token)).success, true);
  const rent = () => {
    const p = chooseSearchType(normalizePriorities({}), 'home_rent', { presetPropertyType: false });
    return { ...p, budget: { ...p.budget, value: '3000', tier: 'important' } };
  };
  const PETS = 'features:Pets Allowed';
  const T = '2026-11-14T12:00:00.000Z';
  // A: pets moving → Pet-Friendly Must Have (FLH-owned), plus the new custom Extra Bedroom.
  let aDoc = setPetsMoving(rent(), 'yes', T).priorities;
  aDoc = setFeatureLevel(aDoc, { categoryKey: 'features', label: 'Extra Bedroom', custom: true, group: 'rent_layout' }, 'nice');
  // B: their own Nice to Have, and "not sure" (which writes no requirement).
  let bDoc = setFeatureLevel(rent(), { categoryKey: 'features', label: 'Pets Allowed', custom: false }, 'nice');
  bDoc = setPetsMoving(bDoc, 'not_sure', T).priorities;
  await savePriorities(db.clientFor(a), { id: search }, a, aDoc);
  await savePriorities(db.clientFor(b), { id: search }, b, bDoc);

  const aStored = normalizePriorities(await resolvePriorities(db.clientFor(a), { id: search }, a));
  const bStored = normalizePriorities(await resolvePriorities(db.clientFor(b), { id: search }, b));
  assert.deepEqual(aStored, normalizePriorities(aDoc), 'the additive keys round-trip unchanged');
  assert.deepEqual([petsMovingAnswer(aStored), petsAutoMarker(aStored)], ['yes', { previousTier: null, setAt: T }]);
  assert.deepEqual([petsMovingAnswer(bStored), petsAutoMarker(bStored), bStored.features.tiers['Pets Allowed']], ['not_sure', null, 'nice']);

  const homeIds = {};
  for (const [name, petsAllowed] of [['unknown', null], ['allowed', true], ['notAllowed', false]]) {
    homeIds[name] = (await db.clientFor(a).from('homes').insert({ user_id: a, search_id: search, address: `${name} Pet Ln, Royal Oak, MI 48073`, price: '2400', pets_allowed: petsAllowed }).select('id').single()).data.id;
  }
  // Each renter's own Match (JS) equals what the other sees in Compare (SQL).
  const both = async (subject, viewer) => {
    const priorities = normalizePriorities(await resolvePriorities(db.clientFor(subject), { id: search }, subject));
    const homes = await getHomesForUser(db.clientFor(subject), subject, search);
    const projected = await resolveCoBuyerComparePerspectives(db.clientFor(viewer), { id: search }, Object.values(homeIds));
    const out = {};
    for (const [name, id] of Object.entries(homeIds)) {
      const own = computeMatch(homes.find((home) => home.id === id), priorities);
      const other = projected.get(id).match;
      assert.deepEqual([other.pct, other.selectedCount, other.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount], `JS = SQL on ${name}`);
      out[name] = own;
    }
    return out;
  };
  const pets = (match) => match.allSelected.find((item) => item.key === PETS);
  const aMatch = await both(a, b);
  assert.equal(pets(aMatch.unknown).evaluated, false, 'null pet policy: Unknown, never a miss');
  assert.deepEqual([aMatch.unknown.pct, aMatch.unknown.evaluatedCount], [100, 1]);
  assert.deepEqual([pets(aMatch.allowed).met, aMatch.allowed.pct], [true, 100]);
  assert.deepEqual([pets(aMatch.notAllowed).met, aMatch.notAllowed.pct], [false, 33], 'weights unchanged: 2 / (2 + 4)');
  const bMatch = await both(b, a);
  assert.deepEqual([bMatch.notAllowed.pct, pets(bMatch.notAllowed).tier], [67, 'nice'], 'B’s own Nice to Have: 2 / (2 + 1)');

  // Without the additive keys, both scores are identical.
  const bare = (doc) => { const { petsMoving, petsAuto, ...features } = doc.features; return { ...doc, features }; };
  await savePriorities(db.clientFor(a), { id: search }, a, bare(aStored));
  const aBare = await both(a, b);
  for (const name of Object.keys(homeIds)) assert.deepEqual([aBare[name].pct, aBare[name].evaluatedCount], [aMatch[name].pct, aMatch[name].evaluatedCount], name);
  // A held house Garage (set aside when switching into an apartment) is equally invisible to both scorers.
  await savePriorities(db.clientFor(a), { id: search }, a, { ...aStored, exterior: { ...aStored.exterior, heldGarage: { tier: 'must', from: 'home_buy' } } });
  const aHeld = await both(a, b);
  for (const name of Object.keys(homeIds)) assert.deepEqual([aHeld[name].pct, aHeld[name].selectedCount, aHeld[name].evaluatedCount], [aMatch[name].pct, aMatch[name].selectedCount, aMatch[name].evaluatedCount], name);
  await savePriorities(db.clientFor(a), { id: search }, a, aStored);

  // A answers No: FLH restores A's level. B's stored row is byte-identical.
  const bRow = JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities);
  await savePriorities(db.clientFor(a), { id: search }, a, setPetsMoving(aStored, 'no', T).priorities);
  const aAfter = normalizePriorities(await resolvePriorities(db.clientFor(a), { id: search }, a));
  assert.deepEqual([aAfter.features.tiers['Pets Allowed'], petsMovingAnswer(aAfter), petsAutoMarker(aAfter)], ['dontcare', 'no', null]);
  assert.equal(JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities), bRow);
  assert.equal(pets((await both(a, b)).notAllowed), undefined, 'No writes no anti-pet requirement');
  // The shared fact is never written by the pets answer.
  assert.deepEqual(db.admin(`select pets_allowed from public.homes where search_id = '${search}' order by address`).map((row) => row.pets_allowed), [true, false, null], 'allowed, notAllowed, unknown');
});
