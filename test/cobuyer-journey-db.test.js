// The complete co-buyer journey, checkpoint by checkpoint, on real Postgres:
// invitation sent → accepted → membership → active search → onboarding
// loaded → preferences saved → back in the shared search.
//
// `routeAppRequest` and `openOnboardingPage` replay the exact decisions made
// by src/app/(app)/layout.js and src/app/onboarding/page.js (same functions,
// same order), so these tests assert real routing outcomes, not just data.
// Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { advanceOnboarding, beginOnboarding } from '../src/lib/onboardingFlow.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, needsSharedSearchSetup, resolveActiveSearch,
  resolveCoBuyerComparePerspectives, resolveOnboardingSearch, resolvePriorities, savePriorities, setActiveSearch,
} = await import('../src/lib/supabase/collaboration.js');
const { completeOnboarding, getProfile, saveOnboardingProgress } = await import('../src/lib/supabase/data.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const rlsDenied = (error) => /row-level security/.test(error?.message || '');

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

/* ------------------------- app decision replays ------------------------- */

// src/app/(app)/layout.js, buyer routes.
async function routeAppRequest(userId) {
  const client = db.clientFor(userId);
  const profile = await getProfile(client, userId);
  if (!profile?.onboarding_complete) return { to: '/onboarding' };
  const { search, isOwner } = await resolveActiveSearch(client, userId);
  if (await needsSharedSearchSetup(client, userId, search, isOwner)) return { to: '/onboarding' };
  return { to: '/homes', searchId: search.id, isOwner };
}

// src/app/onboarding/page.js.
async function openOnboardingPage(userId) {
  const client = db.clientFor(userId);
  const profile = await getProfile(client, userId);
  const { search, role } = await resolveOnboardingSearch(client, userId);
  if (profile?.onboarding_complete && !(await needsSharedSearchSetup(client, userId, search, role === 'owner'))) return { redirect: '/homes' };
  const progress = beginOnboarding({ storedVersion: profile.onboarding_version, storedState: profile.onboarding_state, context: { searchId: search.id, role } });
  const priorities = normalizePriorities(await resolvePriorities(client, search, userId));
  return { search, role, progress, priorities };
}

// Onboarding.jsx finish(): save own priorities to the page's search, then the gate.
async function finishOnboarding(userId, page, priorities) {
  const client = db.clientFor(userId);
  await savePriorities(client, page.search, userId, priorities);
  await completeOnboarding(client, userId, { version: page.progress.version, state: page.progress.state });
}

function newHousehold(tag) {
  const owner = db.createUser({ email: `owner.${tag}@example.com` });
  const coBuyer = db.createUser({ email: `cobuyer.${tag}@example.com` });
  const searchOf = (userId) => db.admin(`select id from public.searches where user_id = '${userId}'`)[0].id;
  return { owner, coBuyer, ownerSearch: searchOf(owner), coBuyerOwnSearch: searchOf(coBuyer), email: `cobuyer.${tag}@example.com` };
}

// AcceptInvitationClient.accept(): RPC, then point the session at the shared search.
async function inviteAndAccept(h) {
  const invitation = await createInvitation(db.clientFor(h.owner), h.ownerSearch, h.owner, h.email, 'co_buyer');
  const result = await acceptInvitation(db.clientFor(h.coBuyer), invitation.token);
  assert.equal(result.success, true, `acceptance failed: ${result.reason}`);
  await setActiveSearch(db.clientFor(h.coBuyer), h.coBuyer, result.search_id);
  return result;
}

const docsOf = (userId) => db.admin(`select search_id, priorities from public.search_member_priorities where user_id = '${userId}' order by search_id`);
const prefs = (beds, garageTier = 'must') => {
  const p = normalizePriorities({ searchType: 'purchase', onboardingSearchType: 'home_buy' });
  p.bedsMin = { value: String(beds), tier: 'must' };
  p.exterior = { ...p.exterior, customItems: [{ label: 'Garage', kind: 'check' }], tiers: { Garage: garageTier }, order: ['Garage'] };
  return p;
};

/* ---------------------------- Scenario A ---------------------------- */

dbTest('A: a brand-new co-buyer accepts, onboards into the shared search, and stays there', async () => {
  const h = newHousehold('a');
  const accepted = await inviteAndAccept(h);
  // 1. membership
  assert.deepEqual(db.admin(`select role from public.search_members where search_id = '${h.ownerSearch}' and user_id = '${h.coBuyer}'`), [{ role: 'co_buyer' }]);
  assert.equal(accepted.search_id, h.ownerSearch);
  // 2. active search
  assert.equal((await resolveActiveSearch(db.clientFor(h.coBuyer), h.coBuyer)).search.id, h.ownerSearch);
  // 3. onboarding loads for the shared search
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/onboarding' });
  const page = await openOnboardingPage(h.coBuyer);
  assert.equal(page.search.id, h.ownerSearch);
  assert.equal(page.role, 'co_buyer');
  // 4. preferences saved to the shared search only
  await finishOnboarding(h.coBuyer, page, prefs(4));
  assert.deepEqual(docsOf(h.coBuyer).map((row) => row.search_id), [h.ownerSearch]);
  // 5. back in the shared search afterwards
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/homes', searchId: h.ownerSearch, isOwner: false });
  assert.deepEqual(await openOnboardingPage(h.coBuyer), { redirect: '/homes' }, 'no way back into onboarding once set up');
});

/* ---------------------------- Scenario B ---------------------------- */

dbTest('B: an existing account is asked for its own preferences on the shared search; its own search is untouched', async () => {
  const h = newHousehold('b');
  // Andrew already used FLH alone: finished onboarding, preferences on his own search.
  await savePriorities(db.clientFor(h.coBuyer), { id: h.coBuyerOwnSearch }, h.coBuyer, prefs(5, 'nice'));
  db.exec(`update public.profiles set onboarding_complete = true where id = '${h.coBuyer}'`);
  const ownBefore = docsOf(h.coBuyer);
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/homes', searchId: h.coBuyerOwnSearch, isOwner: true });

  await inviteAndAccept(h);
  assert.equal((await resolveActiveSearch(db.clientFor(h.coBuyer), h.coBuyer)).search.id, h.ownerSearch, 'the accepted search is active, not his own');
  // The bug: previously this went straight to /homes with an empty preference list.
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/onboarding' });
  const page = await openOnboardingPage(h.coBuyer);
  assert.equal(page.search.id, h.ownerSearch);
  assert.equal(page.progress.state.step, 'basics');
  assert.equal(page.priorities.bedsMin.value, '', 'his other search\'s preferences are never silently copied in');

  await finishOnboarding(h.coBuyer, page, prefs(3));
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/homes', searchId: h.ownerSearch, isOwner: false });
  const after = docsOf(h.coBuyer);
  assert.equal(after.length, 2, 'one document per search, nothing merged or duplicated');
  assert.deepEqual(after.find((row) => row.search_id === h.coBuyerOwnSearch), ownBefore[0], 'own-search preferences byte-for-byte intact');
  assert.equal(after.find((row) => row.search_id === h.ownerSearch).priorities.bedsMin.value, '3');
  assert.equal(db.admin(`select count(*)::int as n from public.searches where user_id = '${h.coBuyer}'`)[0].n, 1, 'no duplicate search created');
});

dbTest('B: switching back to his own search never asks for setup; switching to the shared one again does not either once set up', async () => {
  const h = newHousehold('b2');
  db.exec(`update public.profiles set onboarding_complete = true where id = '${h.coBuyer}'`);
  await inviteAndAccept(h);
  await setActiveSearch(db.clientFor(h.coBuyer), h.coBuyer, h.coBuyerOwnSearch);
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/homes', searchId: h.coBuyerOwnSearch, isOwner: true });
  await setActiveSearch(db.clientFor(h.coBuyer), h.coBuyer, h.ownerSearch);
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/onboarding' });
  await finishOnboarding(h.coBuyer, await openOnboardingPage(h.coBuyer), prefs(3));
  await setActiveSearch(db.clientFor(h.coBuyer), h.coBuyer, h.coBuyerOwnSearch);
  await setActiveSearch(db.clientFor(h.coBuyer), h.coBuyer, h.ownerSearch);
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/homes', searchId: h.ownerSearch, isOwner: false });
});

/* ---------------------------- Scenario C ---------------------------- */

dbTest('C: an interrupted onboarding resumes in the shared search, and the shared search persists across sessions', async () => {
  const h = newHousehold('c');
  await inviteAndAccept(h);
  const first = await openOnboardingPage(h.coBuyer);
  await savePriorities(db.clientFor(h.coBuyer), first.search, h.coBuyer, prefs(4));
  const moved = advanceOnboarding(first.progress.version, first.progress.state, 'basics').state;
  assert.equal(await saveOnboardingProgress(db.clientFor(h.coBuyer), h.coBuyer, { version: first.progress.version, state: moved }), true);

  // App closed / refreshed / signed out and back in: only server state remains.
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/onboarding' });
  const resumed = await openOnboardingPage(h.coBuyer);
  assert.equal(resumed.search.id, h.ownerSearch);
  assert.equal(resumed.progress.resumed, true);
  assert.equal(resumed.progress.state.step, 'what_matters');
  assert.equal(resumed.priorities.bedsMin.value, '4', 'answers survived the interruption');

  await finishOnboarding(h.coBuyer, resumed, resumed.priorities);
  for (let session = 0; session < 3; session += 1) {
    assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/homes', searchId: h.ownerSearch, isOwner: false });
  }
});

dbTest('C: if the owner removes the co-buyer, they fall back to their own search rather than a broken one', async () => {
  const h = newHousehold('c2');
  await inviteAndAccept(h);
  await finishOnboarding(h.coBuyer, await openOnboardingPage(h.coBuyer), prefs(3));
  db.exec(`delete from public.search_members where search_id = '${h.ownerSearch}' and user_id = '${h.coBuyer}'`);
  assert.deepEqual(await routeAppRequest(h.coBuyer), { to: '/homes', searchId: h.coBuyerOwnSearch, isOwner: true });
});

/* ---------------------------- Scenario D ---------------------------- */

dbTest('D: own preferences only, Realtors are never buyers, and Match reflects the co-buyer\'s own list', async () => {
  const h = newHousehold('d');
  await inviteAndAccept(h);
  await finishOnboarding(h.coBuyer, await openOnboardingPage(h.coBuyer), prefs(4));
  // Owner's own, different list.
  await savePriorities(db.clientFor(h.owner), { id: h.ownerSearch }, h.owner, prefs(6, 'nice'));

  // The co-buyer can edit their own document…
  await savePriorities(db.clientFor(h.coBuyer), { id: h.ownerSearch }, h.coBuyer, prefs(3));
  assert.equal(docsOf(h.coBuyer)[0].priorities.bedsMin.value, '3');
  // …the owner cannot create, update, or overwrite it.
  await assert.rejects(savePriorities(db.clientFor(h.owner), { id: h.ownerSearch }, h.coBuyer, prefs(9)), rlsDenied);
  const update = await db.clientFor(h.owner).from('search_member_priorities').update({ priorities: {} })
    .eq('search_id', h.ownerSearch).eq('user_id', h.coBuyer).select('id');
  assert.deepEqual(update.data, []);
  assert.equal(docsOf(h.coBuyer)[0].priorities.bedsMin.value, '3');

  // A Realtor on the same search is never routed into buyer setup and never onboards into it.
  const realtor = db.createUser({ email: 'realtor.d@example.com' });
  const invitation = await createInvitation(db.clientFor(h.owner), h.ownerSearch, h.owner, 'realtor.d@example.com', 'realtor');
  assert.equal((await acceptInvitation(db.clientFor(realtor), invitation.token)).success, true);
  await setActiveSearch(db.clientFor(realtor), realtor, h.ownerSearch);
  db.exec(`update public.profiles set onboarding_complete = true where id = '${realtor}'`);
  assert.equal(await needsSharedSearchSetup(db.clientFor(realtor), realtor, { id: h.ownerSearch }, false), false);
  assert.notEqual((await resolveOnboardingSearch(db.clientFor(realtor), realtor)).search.id, h.ownerSearch);
  await assert.rejects(savePriorities(db.clientFor(realtor), { id: h.ownerSearch }, realtor, prefs(2)), rlsDenied);

  // Match on a shared home: each buyer against their own list, same number from both sides.
  const home = await db.clientFor(h.owner).from('homes').insert({ user_id: h.owner, search_id: h.ownerSearch, address: '9 Lake Shore Rd, Grosse Pointe Shores, MI 48236', beds: '4', garage_spaces: '0' }).select('id').single();
  const [homeForCoBuyer] = await getHomesForUser(db.clientFor(h.coBuyer), h.coBuyer, h.ownerSearch);
  const coBuyerMatch = computeMatch(homeForCoBuyer, normalizePriorities(await resolvePriorities(db.clientFor(h.coBuyer), { id: h.ownerSearch }, h.coBuyer)));
  // beds 4 ≥ 3 (must, met) + no garage (must, missed) → 50%.
  assert.equal(coBuyerMatch.pct, 50);
  const [homeForOwner] = await getHomesForUser(db.clientFor(h.owner), h.owner, h.ownerSearch);
  const ownerMatch = computeMatch(homeForOwner, normalizePriorities(await resolvePriorities(db.clientFor(h.owner), { id: h.ownerSearch }, h.owner)));
  assert.notEqual(ownerMatch.pct, coBuyerMatch.pct, 'two people, two lists, two Matches');
  const projected = await resolveCoBuyerComparePerspectives(db.clientFor(h.owner), { id: h.ownerSearch }, [home.data.id]);
  assert.equal(projected.get(home.data.id).match.pct, coBuyerMatch.pct);
});

/* ------------------------- wiring (always runs) ------------------------- */

test('layout gate and onboarding page share one shared-search setup predicate', () => {
  const layout = readFileSync(new URL('../src/app/(app)/layout.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/app/onboarding/page.js', import.meta.url), 'utf8');
  const onboarding = readFileSync(new URL('../src/components/onboarding/Onboarding.jsx', import.meta.url), 'utf8');
  assert.match(layout, /if \(!isAccountRoute && await needsSharedSearchSetup\(supabase, user\.id, search, isOwner\)\) redirect\(withRedirectParam\('\/onboarding', requestedPath\)\);/);
  assert.match(page, /const sharedSetup = Boolean\(profile\?\.onboarding_complete\);\n\s+if \(sharedSetup && !\(await needsSharedSearchSetup\(supabase, user\.id, search, role === 'owner'\)\)\) redirect\('\/homes'\);/);
  // Finishing always leaves a participant document, so the gate cannot loop.
  assert.match(onboarding, /await persistPriorities\(priorities\);\n\s+await completeOnboarding\(/);
});
