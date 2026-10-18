// Release check for the home overlay (PR #155): Unknown stays Unknown.
//
//   - An Unknown fact (blank) is not a None: a blank garage is not evaluated;
//     None ('0' spaces / garage type 'none') is a real "no garage".
//   - An Unknown criterion (no answer) is not a No: it is left out of the
//     percentage, never scored 0; only an explicit 'no' is a miss.
//   - Weights are unchanged (4 / 2 / 1), Laundry Location never affects Match,
//     and the SQL scorer the other buyer sees (resolve_cobuyer_compare_perspectives)
//     agrees with computeMatch at every step — writing through the overlay's
//     own autosave paths (saveHomeSharedFields / saveHomePersonalState).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities, TIER_META } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { criterionAnswer, criterionAnswerPatch } = await import('../src/lib/matchCriteria.js');
const { garagePatch } = await import('../src/lib/homeFacts.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities,
  saveHomePersonalState, saveHomeSharedFields,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);

// Garage (Must, 4×, scored from Home Facts), Finished basement (Important, 2×,
// the buyer's own answer), Fireplace (Nice, 1×, the buyer's own answer), and a
// budget (Important, 2×) so there is always one evaluated fact.
function buyer() {
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities.preferredPropertyTypes = { values: [], tier: 'dontcare' };
  priorities.budget = { ...priorities.budget, value: '400000', tier: 'important' };
  priorities = addCriterion(priorities, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Finished basement', kind: 'check' }, 'important');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Fireplace', kind: 'check' }, 'nice');
  return priorities;
}
const row = (match, key) => match.allSelected.find((item) => item.key === key);

test('weights are unchanged: Must-Have 4, Important 2, Nice to Have 1', () => {
  assert.deepEqual([TIER_META.must.weight, TIER_META.important.weight, TIER_META.nice.weight], [4, 2, 1]);
});

test('an Unknown fact is not None, and an Unknown answer is not No — exact percentages', () => {
  const priorities = buyer();
  const base = { price: '350000', garageSpaces: '', garageType: null, checks: {} };

  // Everything Unknown but the budget: only the budget is scored → 100%.
  let match = computeMatch(base, priorities);
  assert.equal(row(match, 'exterior:Garage').evaluated, false, 'blank garage is Unknown');
  assert.equal(row(match, 'features:Finished basement').evaluated, false, 'no answer is Unknown');
  assert.equal(match.evaluatedCount, 1);
  assert.equal(match.pct, 100, 'Unknown is left out, never counted as 0');

  // Garage type None (the overlay's patch also sets spaces to '0'): a real "no garage".
  const none = { ...base, ...garagePatch(base, 'garageType', 'none') };
  assert.deepEqual(garagePatch(base, 'garageType', 'none'), { garageType: 'none', garageSpaces: '0' });
  match = computeMatch(none, priorities);
  assert.deepEqual([row(match, 'exterior:Garage').evaluated, row(match, 'exterior:Garage').met], [true, false]);
  assert.equal(match.pct, 33, 'budget 1×2 + garage 0×4 over 6');

  // Back to Unknown: the garage leaves the score again.
  const unknownAgain = { ...none, ...garagePatch(none, 'garageType', null), garageSpaces: '' };
  assert.equal(row(computeMatch(unknownAgain, priorities), 'exterior:Garage').evaluated, false);
  assert.equal(computeMatch(unknownAgain, priorities).pct, 100);

  // A personal No is a miss; Unknown (the control's third option) removes it.
  let checks = criterionAnswerPatch(base, 'features:Finished basement', 'no', priorities.searchType).personal.checks;
  match = computeMatch({ ...base, checks }, priorities);
  assert.equal(criterionAnswer({ checks }, 'features:Finished basement', priorities.searchType), 'no');
  assert.equal(match.pct, 50, 'budget 1×2 + basement 0×2 over 4');
  checks = criterionAnswerPatch({ checks }, 'features:Finished basement', undefined, priorities.searchType).personal.checks;
  assert.equal(criterionAnswer({ checks }, 'features:Finished basement', priorities.searchType), undefined);
  assert.equal(computeMatch({ ...base, checks }, priorities).pct, 100);

  // A historical boolean false is still Unknown, exactly as before.
  assert.equal(row(computeMatch({ ...base, checks: { 'features:Fireplace': false } }, priorities), 'features:Fireplace').evaluated, false);

  // Facts that are not Match inputs never move the score, known or not.
  for (const extra of [{ laundryLocation: 'basement' }, { laundryLocation: null }, { basementStyle: 'none', basementCondition: 'none' }, { heating: 'Forced Air' }, { schoolDistrict: 'Anchor Bay' }]) {
    assert.deepEqual(computeMatch({ ...none, ...extra }, priorities), computeMatch(none, priorities), JSON.stringify(extra));
  }
});

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.unknown@example.com', firstName: 'Ciara', lastName: 'M' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.unknown@example.com', firstName: 'Andrew', lastName: 'M' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.unknown@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('JS and SQL scorers agree through every overlay edit: Unknown → None → Unknown, No → Unknown, laundry', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, buyer());
  const inserted = await owner.from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: '1 Unknown Way, Chesterfield, MI 48051', price: '350000' }).select('id').single();
  assert.equal(inserted.error, null);
  const homeId = inserted.data.id;
  const priorities = normalizePriorities(await resolvePriorities(coBuyer, { id: ids.search }, ids.coBuyer));

  const both = async () => {
    const [home] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId });
    const own = computeMatch(home, priorities);
    const projected = (await resolveCoBuyerComparePerspectives(owner, { id: ids.search }, [homeId])).get(homeId).match;
    assert.equal(projected.pct, own.pct, 'SQL and JS percentages agree');
    assert.equal(projected.selectedCount, own.selectedCount);
    assert.equal(projected.evaluatedCount, own.evaluatedCount, 'SQL and JS leave out the same Unknowns');
    return { home, own };
  };

  let { home, own } = await both();
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 1], 'all Unknown but the budget');

  // The co-buyer picks garage type None in the overlay (shared fact autosave).
  await saveHomeSharedFields(coBuyer, homeId, garagePatch(home, 'garageType', 'none'));
  ({ home, own } = await both());
  assert.deepEqual([home.garageType, home.garageSpaces], ['none', '0']);
  assert.deepEqual([own.pct, own.evaluatedCount], [33, 2], 'None is a real no garage');

  // …then back to Unknown for both garage facts.
  await saveHomeSharedFields(coBuyer, homeId, { garageType: null, garageSpaces: '' });
  ({ home, own } = await both());
  assert.deepEqual([home.garageType, home.garageSpaces], [null, '']);
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 1], 'Unknown leaves the score');

  // Their own No, then Unknown (personal autosave).
  await saveHomePersonalState(coBuyer, { ...home, ...criterionAnswerPatch(home, 'features:Finished basement', 'no', priorities.searchType).personal }, ids.coBuyer, ids.search);
  ({ home, own } = await both());
  assert.deepEqual([own.pct, own.evaluatedCount], [50, 2]);
  await saveHomePersonalState(coBuyer, { ...home, ...criterionAnswerPatch(home, 'features:Finished basement', undefined, priorities.searchType).personal }, ids.coBuyer, ids.search);
  ({ home, own } = await both());
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 1]);

  // Laundry Location, known or Unknown, never moves either scorer.
  await saveHomeSharedFields(coBuyer, homeId, { laundryLocation: 'second_floor' });
  ({ own } = await both());
  assert.deepEqual([own.pct, own.evaluatedCount], [100, 1]);
});
