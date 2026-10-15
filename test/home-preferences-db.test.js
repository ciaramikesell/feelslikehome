// Home preferences against a real Postgres (docs/database-tests.md): what a
// buyer chooses on The Basics persists in their OWN preferences, ranks as
// Important, re-ranks from My Search, never leaks into a co-buyer's document,
// and the multi-value layout / condition facts recorded in Edit Home are shared,
// editable by either buyer, and scored identically by both Match scorers.
// Skips unless FLH_TEST_PGHOST is set.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { computeMatch } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { homePreferenceRows, toggleHomePreference } from '../src/lib/homePreferences.js';
import { moveCriterion } from '../src/lib/searchProfile.js';
import { switchSearchType } from '../src/lib/whatMattersCatalog.js';
import { moveGroup, priorityLevelsWithGroups } from '../src/lib/whatMattersGroups.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, saveHomePersonalAndShared,
  saveHomePersonalState, savePriorities,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const choose = (priorities, ...picks) => picks.reduce((next, [rowKey, text]) => {
  const option = homePreferenceRows(next).find((row) => row.key === rowKey).options.find((entry) => entry.text === text);
  return toggleHomePreference(next, option);
}, priorities);
const ranked = (priorities) => Object.fromEntries(priorityLevelsWithGroups(priorities).map((level) => [level.tier, level.items.map((item) => (item.qualifier ? `${item.displayLabel} (${item.qualifier})` : item.displayLabel))]));

let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.prefs@example.com', firstName: 'Ciara', lastName: 'M' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.prefs@example.com', firstName: 'Andrew', lastName: 'M' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
});
after(() => db?.drop());

dbTest('each buyer’s Home preferences persist in their own preferences, rank Important, and re-rank from My Search', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const invitation = await createInvitation(owner, ids.search, ids.owner, 'cobuyer.prefs@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(coBuyer, invitation.token)).success, true);

  const ownerPrefs = choose(switchSearchType(normalizePriorities({}), 'home_buy').priorities,
    ['homeType', 'Single Family'], ['layout', 'Two-Story'], ['layout', 'First-Floor Primary'], ['condition', 'Move-in Ready'], ['condition', 'Renovation Potential'],
    ['garage', 'Attached'], ['basement', 'Finished'], ['basement', 'Walkout'], ['yard', 'Fenced'], ['yard', 'Privacy Fence']);
  const coBuyerPrefs = choose(switchSearchType(normalizePriorities({}), 'home_buy').priorities, ['yard', 'Unfenced'], ['homeType', 'Condominium']);
  await savePriorities(owner, { id: ids.search }, ids.owner, ownerPrefs);
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, coBuyerPrefs);

  const ownerReloaded = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  assert.deepEqual(ranked(ownerReloaded), {
    must: [],
    important: ['First-Floor Primary', 'Finished Basement', 'Walkout Basement', 'Garage (Attached)', 'Fenced Yard', 'Privacy Fence',
      'Home type (Single Family)', 'Layout (Two-Story)', 'Condition (Move-in Ready or Renovation Potential)'],
    nice: [],
  });
  // The co-buyer's own choices only — nothing of the owner's is copied in either direction.
  const coBuyerReloaded = normalizePriorities(await resolvePriorities(coBuyer, { id: ids.search }, ids.coBuyer));
  assert.deepEqual(ranked(coBuyerReloaded), { must: [], important: ['Unfenced Yard', 'Home type (Condominium)'], nice: [] });
  assert.equal(ownerReloaded.exterior.tiers['Unfenced Yard'], undefined);
  assert.equal(coBuyerReloaded.exterior.tiers['Fenced yard'], undefined);

  // My Search Rank Priorities: move a criterion and a group, save, reload.
  let reranked = moveCriterion(ownerReloaded, 'exterior', 'Garage', 'must');
  reranked = moveGroup(reranked, 'homeCondition', 'nice');
  await savePriorities(owner, { id: ids.search }, ids.owner, reranked);
  const afterRerank = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  assert.deepEqual(ranked(afterRerank).must, ['Garage (Attached)']);
  assert.deepEqual(ranked(afterRerank).nice, ['Condition (Move-in Ready or Renovation Potential)']);
  assert.equal(afterRerank.exterior.garagePreference, 'attached');
});

dbTest('shared layout / condition facts hold several values, either buyer can edit them, and both scorers agree', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const inserted = await owner.from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: '4 Lakeview Ave, Grosse Pointe, MI 48236', price: '450000', garage_spaces: '2' }).select('id').single();
  assert.equal(inserted.error, null);
  const homeId = inserted.data.id;

  // The co-buyer records shared facts on a home the owner added (Edit Home).
  let [home] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search);
  await saveHomePersonalAndShared(coBuyer, { ...home, homeLayout: ['Two Story', 'Split Level'], homeCondition: ['Move-In Ready', 'Renovation Potential'], propertyType: 'house' }, ids.coBuyer, ids.search);
  [home] = await getHomesForUser(owner, ids.owner, ids.search);
  assert.deepEqual(home.homeLayout, ['Two Story', 'Split Level']);
  assert.deepEqual(home.homeCondition, ['Move-In Ready', 'Renovation Potential']);

  // Clearing back to Unknown is an empty list, not a "No".
  await saveHomePersonalAndShared(owner, { ...home, homeCondition: [] }, ids.owner, ids.search);
  [home] = await getHomesForUser(owner, ids.owner, ids.search);
  assert.deepEqual(home.homeCondition, []);
  await saveHomePersonalAndShared(owner, { ...home, homeCondition: ['Renovation Potential'] }, ids.owner, ids.search);

  // The owner answers a personal Yes / No; it stays the owner's own.
  [home] = await getHomesForUser(owner, ids.owner, ids.search);
  await saveHomePersonalState(owner, { ...home, checks: { 'features:Finished basement': true, 'features:Walkout basement': 'no' } }, ids.owner, ids.search);
  const [coBuyerView] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search);
  assert.deepEqual(coBuyerView.checks || {}, {}, 'personal answers never become the co-buyer’s');

  // The owner's own Match and the co-buyer's view of it in Compare agree.
  const [ownerHome] = await getHomesForUser(owner, ids.owner, ids.search);
  const ownerPrefs = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  const own = computeMatch(ownerHome, ownerPrefs);
  const status = Object.fromEntries(own.allSelected.map((item) => [item.key, item.evaluated ? item.met : 'unknown']));
  assert.deepEqual(status, {
    preferredPropertyTypes: true,
    homeLayout: true,
    homeCondition: true,
    'features:First-Floor Primary': 'unknown',
    'features:Finished basement': true,
    'features:Walkout basement': false,
    'exterior:Garage': true,
    'exterior:Fenced yard': 'unknown',
    'exterior:Privacy Fencing': 'unknown',
  });
  const projected = (await resolveCoBuyerComparePerspectives(coBuyer, { id: ids.search }, [homeId])).get(homeId).match;
  assert.deepEqual([projected.pct, projected.selectedCount, projected.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount]);
});
