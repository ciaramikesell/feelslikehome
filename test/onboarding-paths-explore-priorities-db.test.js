// Real Postgres (docs/database-tests.md) for Milestone 2
// (docs/onboarding-paths-explore-priorities.md):
//   • quick start stores no answers nobody gave and completes onboarding once;
//   • Explore writes only the participant's own search_member_priorities row
//     through savePriorities, never profiles.onboarding_*;
//   • co-buyers stay independent; each search keeps its own resume point;
//   • the non-scoring `explore` key changes neither computeMatch nor the SQL
//     Compare scorer.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { prioritiesForExplicitSave } = await import('../src/lib/searchIntent.js');
const { featureLevel, setFeatureLevel, setGarageImportance, switchPrioritySearchType } = await import('../src/lib/priorityCategories.js');
const { EXPLORE_KEY, exploreProgress, recordExploreVisit } = await import('../src/lib/explorePriorities.js');
const { beginOnboarding, completeOnboardingState, setOnboardingSearchType, setOnboardingSetupPath, advanceOnboarding } = await import('../src/lib/onboardingFlow.js');
const { completeOnboarding, saveOnboardingProgress } = await import('../src/lib/supabase/data.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveActiveSearch, resolveCoBuyerComparePerspectives, resolvePriorities,
  savePriorities, saveHomePersonalAndShared, setActiveSearch,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const T0 = '2026-11-20T12:00:00.000Z';
const ITEM_CATEGORIES = ['location', 'features', 'exterior', 'homeFeel'];
const dontcares = (p) => ITEM_CATEGORIES.flatMap((key) => Object.entries(p[key]?.tiers || {}).filter(([, tier]) => tier === 'dontcare').map(([label]) => `${key}:${label}`));
const fresh = (type) => prioritiesForExplicitSave(switchPrioritySearchType(normalizePriorities({}), type).priorities);
const KITCHEN_ISLAND = { categoryKey: 'features', label: 'Kitchen Island', custom: false };

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.m2@example.com', firstName: 'Ciara' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.m2@example.com', firstName: 'Andrew' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  ids.coBuyerOwn = db.admin(`select id from public.searches where user_id = '${ids.coBuyer}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.m2@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

const profile = (id) => db.admin(`select onboarding_complete, onboarding_version, onboarding_state from public.profiles where id = '${id}'`)[0];
const searchCount = (id) => db.admin(`select count(*)::int as n from public.searches where user_id = '${id}'`)[0].n;
const memberRows = (searchId) => db.admin(`select user_id, priorities from public.search_member_priorities where search_id = '${searchId}' order by user_id`);

dbTest('quick start: one search, onboarding complete, and a stored document with no dontcare and no features', async () => {
  for (const type of ['home_buy', 'home_rent', 'apartment_rent']) {
    const user = db.createUser({ email: `quick.${type}@example.com`, firstName: 'Quick' });
    const client = db.clientFor(user);
    const search = db.admin(`select id from public.searches where user_id = '${user}'`)[0].id;
    // The flow: kind of search → "I'll figure it out as I go" → skip Basics → finish.
    let state = beginOnboarding({ context: { searchId: search, role: 'owner' }, targetVersion: 4, now: T0 }).state;
    state = advanceOnboarding(4, setOnboardingSearchType(state, type, T0), 'search_type', T0).state;
    state = advanceOnboarding(4, setOnboardingSetupPath(state, 'as_i_go', T0), 'setup_path', T0).state;
    const last = advanceOnboarding(4, state, 'basics', T0);
    assert.equal(last.done, true, `${type}: Basics is the last screen`);
    await savePriorities(client, { id: search }, user, fresh(type));
    await completeOnboarding(client, user, { version: 4, state: completeOnboardingState(4, last.state, T0) });

    const stored = normalizePriorities(await resolvePriorities(client, { id: search }, user));
    assert.deepEqual(dontcares(stored), [], `${type}: no Not important written`);
    for (const key of ITEM_CATEGORIES) assert.deepEqual(stored[key].customItems, [], `${type} ${key}`);
    assert.equal(computeMatch({ price: '300000' }, stored), null, `${type}: no Match % from nothing`);
    const row = profile(user);
    assert.equal(row.onboarding_complete, true);
    assert.equal(row.onboarding_version, 4);
    assert.equal(row.onboarding_state.answers.setupPath, 'as_i_go');
    assert.equal(searchCount(user), 1, `${type}: still exactly one owned search`);
    assert.equal(memberRows(search).length, 1);
  }
});

dbTest('Explore later: prefilled from onboarding, edits only the caller’s own row, never touches onboarding state', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  // Personalized during onboarding (owner) and shared-search setup (co-buyer).
  let ownerDoc = setFeatureLevel(fresh('home_buy'), KITCHEN_ISLAND, 'must');
  await savePriorities(owner, { id: ids.search }, ids.owner, ownerDoc);
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, setFeatureLevel(fresh('home_buy'), KITCHEN_ISLAND, 'nice'));
  await completeOnboarding(owner, ids.owner, { version: 4, state: completeOnboardingState(4, { answers: { searchType: 'home_buy', setupPath: 'personalize' } }, T0) });
  const profileBefore = profile(ids.owner);
  const coBuyerBefore = memberRows(ids.search).find((row) => row.user_id === ids.coBuyer).priorities;

  // Re-entry reads the same document (prefilled), jumps to Kitchen, edits one priority, exits.
  ownerDoc = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  assert.equal(featureLevel(ownerDoc, KITCHEN_ISLAND), 'must', 'onboarding answer is prefilled');
  ownerDoc = recordExploreVisit(ownerDoc, 'cat_kitchen', T0);
  await savePriorities(owner, { id: ids.search }, ids.owner, ownerDoc);
  ownerDoc = setFeatureLevel(ownerDoc, KITCHEN_ISLAND, 'important');
  await savePriorities(owner, { id: ids.search }, ids.owner, ownerDoc);

  const reread = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  assert.equal(featureLevel(reread, KITCHEN_ISLAND), 'important', 'the edit persisted');
  assert.equal(exploreProgress(reread).lastStep, 'cat_kitchen', 'and so did the resume point');
  assert.deepEqual(profile(ids.owner), profileBefore, 'onboarding_complete / _version / _state untouched');
  const coBuyerAfter = memberRows(ids.search).find((row) => row.user_id === ids.coBuyer).priorities;
  assert.deepEqual(coBuyerAfter, coBuyerBefore, 'the co-buyer’s row is untouched');
  assert.equal(featureLevel(coBuyerAfter, KITCHEN_ISLAND), 'nice');
  assert.equal(memberRows(ids.search).length, 2, 'no extra rows');
  assert.equal(searchCount(ids.owner), 1, 'no new search');

  // The co-buyer can't write the owner's row (RLS), whatever the client sends.
  await assert.rejects(savePriorities(coBuyer, { id: ids.search }, ids.owner, setFeatureLevel(fresh('home_buy'), KITCHEN_ISLAND, 'must')));
  assert.equal(featureLevel(normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner)), KITCHEN_ISLAND), 'important');
});

dbTest('switching searches loads that search’s priorities and its own resume point', async () => {
  const coBuyer = db.clientFor(ids.coBuyer);
  // The co-buyer's OWN search has its own document and resume point.
  await savePriorities(coBuyer, { id: ids.coBuyerOwn }, ids.coBuyer, recordExploreVisit(fresh('home_buy'), 'cat_bath', T0));
  const shared = normalizePriorities(await resolvePriorities(coBuyer, { id: ids.search }, ids.coBuyer));
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, recordExploreVisit(shared, 'cat_garage', T0));

  await setActiveSearch(coBuyer, ids.coBuyer, ids.coBuyerOwn);
  let { search } = await resolveActiveSearch(coBuyer, ids.coBuyer);
  assert.equal(search.id, ids.coBuyerOwn);
  assert.equal(exploreProgress(await resolvePriorities(coBuyer, search, ids.coBuyer)).lastStep, 'cat_bath');

  await setActiveSearch(coBuyer, ids.coBuyer, ids.search);
  ({ search } = await resolveActiveSearch(coBuyer, ids.coBuyer));
  assert.equal(search.id, ids.search);
  const sharedDoc = normalizePriorities(await resolvePriorities(coBuyer, search, ids.coBuyer));
  assert.equal(exploreProgress(sharedDoc).lastStep, 'cat_garage');
  assert.equal(featureLevel(sharedDoc, KITCHEN_ISLAND), 'nice', 'their own answers on the shared search');
});

dbTest('JS / SQL Match parity holds, and the explore key changes neither scorer', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  let base = fresh('home_buy');
  base.budget = { ...base.budget, value: '400000' };
  base = setGarageImportance(setFeatureLevel(base, KITCHEN_ISLAND, 'must'), 'important');
  const added = await saveHomePersonalAndShared(owner, { address: '7 Explore Way, Troy, MI 48084', price: '380000', garageSpaces: '0', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);

  const score = async (doc) => {
    await savePriorities(owner, { id: ids.search }, ids.owner, doc);
    const stored = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
    const [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
    const js = computeMatch(home, stored);
    // The co-buyer's Compare view of the owner: the SQL scorer over the stored document.
    const sql = (await resolveCoBuyerComparePerspectives(coBuyer, { id: ids.search }, [added.id])).get(added.id).match;
    return { js: [js.pct, js.selectedCount, js.evaluatedCount], sql: [sql.pct, sql.selectedCount, sql.evaluatedCount], stored };
  };
  const plain = await score(base);
  const explored = await score({ ...base, [EXPLORE_KEY]: { lastStep: 'cat_kitchen', visited: ['cat_kitchen', 'cat_garage', 'cat_bath'], updatedAt: T0 } });
  assert.deepEqual(plain.js, plain.sql, 'JS = SQL');
  assert.deepEqual(explored.js, explored.sql, 'JS = SQL with explore metadata');
  assert.deepEqual(explored.js, plain.js, 'explore metadata changes nothing in JS');
  assert.deepEqual(explored.sql, plain.sql, 'explore metadata changes nothing in SQL');
  assert.deepEqual(explored.stored[EXPLORE_KEY].visited, ['cat_kitchen', 'cat_garage', 'cat_bath'], 'stored as written');
  // Budget met (2) + garage known no (Important 2 → 0); the Kitchen Island Must Have is Unknown, unscored.
  assert.deepEqual(plain.js, [50, 3, 2]);
});

dbTest('onboarding progress writes never touch priorities, and Explore never writes profiles (both directions)', async () => {
  const user = db.createUser({ email: 'both.ways@example.com', firstName: 'Both' });
  const client = db.clientFor(user);
  const search = db.admin(`select id from public.searches where user_id = '${user}'`)[0].id;
  const doc = setFeatureLevel(fresh('home_buy'), KITCHEN_ISLAND, 'must');
  await savePriorities(client, { id: search }, user, doc);
  const state = setOnboardingSetupPath(beginOnboarding({ context: { searchId: search, role: 'owner' }, targetVersion: 4, now: T0 }).state, 'personalize', T0);
  assert.equal(await saveOnboardingProgress(client, user, { version: 4, state }), true);
  assert.deepEqual(normalizePriorities(await resolvePriorities(client, { id: search }, user)), normalizePriorities(doc));
  const before = profile(user);
  await savePriorities(client, { id: search }, user, recordExploreVisit(doc, 'cat_kitchen', T0));
  assert.deepEqual(profile(user), before);
});
