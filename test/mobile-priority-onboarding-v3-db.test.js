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
const { PETS_FEATURE, addOwnFeature, categoryView, featureLevel, garageImportance, garageType, setFeatureLevel, setGarageImportance, setGarageType, setLotSizeImportance, setLotSizeValue, switchPrioritySearchType } = await import('../src/lib/priorityCategories.js');
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
  await savePriorities(db.clientFor(a), { id: search }, a, { ...aStored, exterior: { ...aStored.exterior, heldGarage: { house: { tier: 'must', garagePreference: 'attached' } } } });
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

// House Garage and apartment Garage Parking across search-type switches
// (founder decision on #183): two co-buyers switch in opposite directions.
// The held preference is never scored, the active one is scored once, and
// computeMatch equals the SQL Compare scorer throughout.
dbTest('garage switching: held preferences are invisible to Match; JS = SQL for co-buyers in both directions', async () => {
  const a = db.createUser({ email: 'garage.a@example.com', firstName: 'House' });
  const b = db.createUser({ email: 'garage.b@example.com', firstName: 'Flat' });
  const search = db.admin(`select id from public.searches where user_id = '${a}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(a), search, a, 'garage.b@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(b), invitation.token)).success, true);
  const GARAGE = { categoryKey: 'exterior', label: 'Garage', custom: false };
  const start = (type) => { const p = chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false }); return { ...p, budget: { ...p.budget, value: '3000', tier: 'important' } }; };
  // A: a buyer (Garage Must, attached) moves to an apartment and explicitly picks Garage Parking Nice.
  let aDoc = setGarageType(setGarageImportance(start('home_buy'), 'must'), 'attached');
  aDoc = switchPrioritySearchType(aDoc, 'apartment_rent').priorities;
  aDoc = setFeatureLevel(aDoc, GARAGE, 'nice');
  // B: an apartment renter (Garage Parking Important) moves to Home to Buy.
  let bDoc = switchPrioritySearchType(setFeatureLevel(start('apartment_rent'), GARAGE, 'important'), 'home_buy').priorities;
  await savePriorities(db.clientFor(a), { id: search }, a, aDoc);
  await savePriorities(db.clientFor(b), { id: search }, b, bDoc);

  const homeIds = {};
  for (const [name, spaces] of [['noGarage', '0'], ['twoCar', '2'], ['unknown', '']]) {
    const inserted = await db.clientFor(a).from('homes').insert({ user_id: a, search_id: search, address: `${name} Garage Way, Royal Oak, MI 48073`, price: '2400', garage_spaces: spaces }).select('id').single();
    assert.equal(inserted.error, null, JSON.stringify(inserted.error));
    homeIds[name] = inserted.data.id;
  }
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
    return { priorities, out };
  };
  const garageItems = (match) => match.allSelected.filter((item) => item.key === 'exterior:Garage');

  let aSide = await both(a, b);
  assert.deepEqual(aSide.priorities.exterior.heldGarage, { house: { tier: 'must', garagePreference: 'attached' } }, 'held preference round-trips');
  for (const match of Object.values(aSide.out)) assert.deepEqual(garageItems(match).map((item) => item.tier), ['nice'], 'only the active Garage Parking counts, once');
  assert.deepEqual([aSide.out.noGarage.pct, aSide.out.twoCar.pct, aSide.out.unknown.evaluatedCount], [67, 100, 1], 'budget 2 + Nice 1 → 2/3; 3/3; garage Unknown');
  let bSide = await both(b, a);
  assert.deepEqual(bSide.priorities.exterior.heldGarage, { apartment: { tier: 'important' } });
  for (const match of Object.values(bSide.out)) assert.equal(garageItems(match).length, 0, 'the held Garage Parking never counts for the buyer');
  assert.equal(bSide.out.noGarage.pct, 100);

  // Both switch back: each restores their own earlier preference; still JS = SQL.
  const bRow = JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities);
  await savePriorities(db.clientFor(a), { id: search }, a, switchPrioritySearchType(aSide.priorities, 'home_buy').priorities);
  assert.equal(JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities), bRow, 'A’s switch never touches B');
  await savePriorities(db.clientFor(b), { id: search }, b, switchPrioritySearchType(bSide.priorities, 'apartment_rent').priorities);
  aSide = await both(a, b);
  assert.deepEqual([garageImportance(aSide.priorities), garageType(aSide.priorities), aSide.priorities.exterior.heldGarage], ['must', 'attached', { apartment: { tier: 'nice' } }]);
  for (const match of Object.values(aSide.out)) assert.deepEqual(garageItems(match).map((item) => item.tier), ['must']);
  assert.equal(aSide.out.noGarage.pct, 33, 'house Garage Must is answered No by 0 spaces: 2/6');
  bSide = await both(b, a);
  assert.deepEqual([featureLevel(bSide.priorities, GARAGE), bSide.priorities.exterior.heldGarage], ['important', undefined]);
  for (const match of Object.values(bSide.out)) assert.deepEqual(garageItems(match).map((item) => item.tier), ['important']);
});

// Stage 3 (rental onboarding UI). Home to Rent's Ideal lot size with its
// optional importance (D4) writes the existing lotSizeTarget.tier, and both
// scorers read it identically: unranked acreage is never scored; ranked
// acreage is a threshold, with an unknown lot size Unknown (never a miss).
// Changing Pet-Friendly on Review is a manual edit (ends FLH's ownership).
// Co-renters stay independent throughout.
dbTest('Home to Rent lot-size importance and Review edits: JS = SQL for co-renters; unranked acreage and unknown lots never count', async () => {
  const a = db.createUser({ email: 'renter.a.lot@example.com', firstName: 'Acre' });
  const b = db.createUser({ email: 'renter.b.lot@example.com', firstName: 'Other' });
  const search = db.admin(`select id from public.searches where user_id = '${a}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(a), search, a, 'renter.b.lot@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(b), invitation.token)).success, true);
  const T = '2026-11-14T12:00:00.000Z';
  const rent = () => {
    const p = chooseSearchType(normalizePriorities({}), 'home_rent', { presetPropertyType: false });
    return { ...p, budget: { ...p.budget, value: '3000', tier: 'important' }, lotSizeTarget: { ...p.lotSizeTarget, value: '0.5' } };
  };
  // A: 0.5 acres ranked Must Have; pets Yes, then Pet-Friendly changed by hand on Review.
  let aDoc = setLotSizeImportance(rent(), 'must');
  aDoc = setPetsMoving(aDoc, 'yes', T).priorities;
  aDoc = setFeatureLevel(aDoc, PETS_FEATURE, 'important');
  assert.deepEqual([aDoc.features.tiers['Pets Allowed'], petsAutoMarker(aDoc), petsMovingAnswer(aDoc)], ['important', null, 'yes'], 'Review edit is manual');
  // B: the same acreage, never ranked.
  const bDoc = rent();
  await savePriorities(db.clientFor(a), { id: search }, a, aDoc);
  await savePriorities(db.clientFor(b), { id: search }, b, bDoc);
  const bRow = JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities);

  const homeIds = {};
  for (const [name, lot] of [['big', '0.75 acres'], ['small', '0.25 acres'], ['unknown', '']]) {
    const inserted = await db.clientFor(a).from('homes').insert({ user_id: a, search_id: search, address: `${name} Acre Ln, Royal Oak, MI 48073`, price: '2400', lot_size: lot, pets_allowed: true }).select('id').single();
    assert.equal(inserted.error, null, inserted.error?.message);
    homeIds[name] = inserted.data.id;
  }
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
  const lot = (match) => match.allSelected.find((item) => item.key === 'lotSize');
  const aMatch = await both(a, b);
  assert.deepEqual([lot(aMatch.big).met, lot(aMatch.big).tier], [true, 'must']);
  assert.equal(lot(aMatch.small).met, false);
  assert.equal(lot(aMatch.unknown).evaluated, false, 'unknown lot size: Unknown, never a miss');
  assert.equal(aMatch.unknown.pct, 100);
  const bMatch = await both(b, a);
  for (const name of Object.keys(homeIds)) assert.equal(lot(bMatch[name]), undefined, `B’s unranked acreage is not scored (${name})`);
  assert.equal(JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities), bRow, 'B’s row is untouched by A’s edits');

  // Not important returns the tier to dontcare: the acreage stays, unscored, in both scorers.
  await savePriorities(db.clientFor(a), { id: search }, a, setLotSizeImportance(aDoc, 'none'));
  const aStored = normalizePriorities(await resolvePriorities(db.clientFor(a), { id: search }, a));
  assert.deepEqual(aStored.lotSizeTarget, { value: '0.5', tier: 'dontcare' });
  const aUnranked = await both(a, b);
  for (const name of Object.keys(homeIds)) assert.equal(lot(aUnranked[name]), undefined, name);

  // Enter → rank → clear → re-enter → rank again (Home to Rent): the cleared
  // and the re-entered-but-unranked targets count in neither scorer.
  const ranked = setLotSizeImportance(aDoc, 'nice');
  const cleared = setLotSizeValue(ranked, '');
  await savePriorities(db.clientFor(a), { id: search }, a, cleared);
  assert.deepEqual(normalizePriorities(await resolvePriorities(db.clientFor(a), { id: search }, a)).lotSizeTarget, { value: '', tier: 'dontcare' });
  const aCleared = await both(a, b);
  for (const name of Object.keys(homeIds)) assert.equal(lot(aCleared[name]), undefined, `cleared: ${name}`);
  const reentered = setLotSizeValue(cleared, '0.5');
  await savePriorities(db.clientFor(a), { id: search }, a, reentered);
  assert.deepEqual(normalizePriorities(await resolvePriorities(db.clientFor(a), { id: search }, a)).lotSizeTarget, { value: '0.5', tier: 'dontcare' }, 'the old importance is not reactivated');
  const aReentered = await both(a, b);
  for (const name of Object.keys(homeIds)) assert.equal(lot(aReentered[name]), undefined, `re-entered: ${name}`);
  await savePriorities(db.clientFor(a), { id: search }, a, setLotSizeImportance(reentered, 'important'));
  const aRankedAgain = await both(a, b);
  assert.deepEqual([lot(aRankedAgain.big).tier, lot(aRankedAgain.big).met, lot(aRankedAgain.small).met, lot(aRankedAgain.unknown).evaluated], ['important', true, false, false]);
  assert.equal(JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities), bRow, 'B’s row still untouched');
});
