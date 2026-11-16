// Real Postgres: priorities written with the refined Home to Buy catalog
// (PR #186) — Main Floor Laundry, Privacy Fence, the three garage choices and a
// legacy choice no longer offered — round-trip unchanged, stay each co-buyer's
// own, and score identically in computeMatch (JS) and the SQL Compare scorer.
// No scorer or SQL change: these are existing identities.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { chooseSearchType } = await import('../src/lib/onboardingBasics.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { criterionAnswerPatch } = await import('../src/lib/matchCriteria.js');
const { setFeatureLevel } = await import('../src/lib/priorityCategories.js');
const { BOARD_GARAGE_CHOICES, placeOnBoard } = await import('../src/lib/priorityBoard.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const buy = () => {
  const p = chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });
  return { ...p, budget: { ...p.budget, value: '500000' } };
};
const garage = (variant) => BOARD_GARAGE_CHOICES.find((choice) => choice.variant === variant);

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.186@example.com', firstName: 'Ciara' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.186@example.com', firstName: 'Andrew' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.186@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('refined Home to Buy choices: round-trip, independent co-buyers, JS = SQL; Unknown never No', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  // Owner on the desktop board.
  let mine = buy();
  mine = placeOnBoard(mine, { id: 'features:First-floor laundry', categoryKey: 'features', label: 'First-floor laundry', custom: false, group: 'layout' }, 'must');
  mine = placeOnBoard(mine, { id: 'exterior:Privacy Fencing', categoryKey: 'exterior', label: 'Privacy Fencing', custom: false, group: 'exterior' }, 'important');
  mine = placeOnBoard(mine, { id: 'exterior:Fenced yard', categoryKey: 'exterior', label: 'Fenced yard', custom: false, group: 'exterior' }, 'nice');
  mine = placeOnBoard(mine, garage('attached'), 'important');
  mine = addCriterion(mine, { categoryKey: 'location', label: 'Walkable schools', kind: 'check' }, 'nice'); // chosen before PR #186
  // Co-buyer on a phone: their own, different choices.
  let theirs = setFeatureLevel(buy(), { categoryKey: 'exterior', label: 'Fenced yard' }, 'must');
  theirs = placeOnBoard(theirs, garage('detached'), 'nice');

  await savePriorities(owner, { id: ids.search }, ids.owner, mine);
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, theirs);
  const mineStored = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  const theirsStored = normalizePriorities(await resolvePriorities(coBuyer, { id: ids.search }, ids.coBuyer));
  assert.deepEqual(mineStored, normalizePriorities(mine));
  assert.deepEqual(theirsStored, normalizePriorities(theirs));
  assert.deepEqual([mineStored.exterior.garagePreference, theirsStored.exterior.garagePreference], ['attached', 'detached'], 'each buyer’s own qualifier');

  const homeIds = {};
  const rows = {
    allYes: { garage_spaces: '2', laundry_location: 'first_floor' },
    noGarage: { garage_spaces: '0', laundry_location: 'second_floor' },
    unknown: { garage_spaces: '' },
  };
  for (const [name, facts] of Object.entries(rows)) {
    const { data, error } = await owner.from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: `${name} 186 Ln, Royal Oak, MI 48073`, price: '450000', ...facts }).select('id').single();
    assert.equal(error, null, error?.message);
    homeIds[name] = data.id;
  }
  const both = async (subject, viewer) => {
    const priorities = normalizePriorities(await resolvePriorities(db.clientFor(subject), { id: ids.search }, subject));
    const homes = await getHomesForUser(db.clientFor(subject), subject, ids.search);
    const projected = await resolveCoBuyerComparePerspectives(db.clientFor(viewer), { id: ids.search }, Object.values(homeIds));
    const out = {};
    for (const [name, id] of Object.entries(homeIds)) {
      const own = computeMatch(homes.find((home) => home.id === id), priorities);
      const seen = projected.get(id).match;
      assert.deepEqual([seen.pct, seen.selectedCount, seen.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount], `JS = SQL on ${name}`);
      out[name] = own;
    }
    return out;
  };
  const item = (match, key) => match.allSelected.find((entry) => entry.key === key);
  let mineMatch = await both(ids.owner, ids.coBuyer);
  assert.equal(item(mineMatch.allYes, 'features:First-floor laundry').met, true, 'Main Floor Laundry answered by Home Facts laundry location');
  assert.equal(item(mineMatch.noGarage, 'exterior:Garage').met, false);
  assert.equal(item(mineMatch.unknown, 'exterior:Garage').evaluated, false, 'unknown garage is never a miss');
  assert.equal(item(mineMatch.unknown, 'features:First-floor laundry').evaluated, false);
  assert.equal(item(mineMatch.allYes, 'exterior:Privacy Fencing').evaluated, false, 'Privacy Fence unanswered');
  assert.equal(item(mineMatch.allYes, 'location:Walkable schools').evaluated, false, 'a legacy choice still counts, Unknown until answered');

  // The owner answers Fenced yard Yes on one home: Privacy Fence stays Unknown (never inferred).
  const [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: homeIds.allYes });
  await saveHomePersonalState(owner, { ...home, ...criterionAnswerPatch(home, 'exterior:Fenced yard', true, mineStored.searchType).personal }, ids.owner, ids.search);
  mineMatch = await both(ids.owner, ids.coBuyer);
  assert.equal(item(mineMatch.allYes, 'exterior:Fenced yard').met, true);
  assert.equal(item(mineMatch.allYes, 'exterior:Privacy Fencing').evaluated, false);
  const theirsMatch = await both(ids.coBuyer, ids.owner);
  assert.equal(item(theirsMatch.allYes, 'exterior:Fenced yard').evaluated, false, 'the owner’s answer is not the co-buyer’s');
});
