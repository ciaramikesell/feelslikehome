// Existing users accepting invitations, and moving between every search they
// own or belong to, without losing or mixing anything. Real Postgres + RLS,
// replaying the exact decisions of src/app/(app)/layout.js,
// src/app/onboarding/page.js, the onboarding finish paths, and SearchSwitcher.
// Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md); the source
// contract at the bottom always runs.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getAccessibleSearches, getHomesForUser, needsSharedSearchSetup,
  resolveActiveSearch, resolveCoBuyerComparePerspectives, resolveOnboardingSearch, resolvePriorities,
  saveHomePersonalState, saveRealtorNote, savePriorities, setActiveSearch,
} = await import('../src/lib/supabase/collaboration.js');
const { completeOnboarding, getProfile } = await import('../src/lib/supabase/data.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const rlsDenied = (error) => /row-level security/.test(error?.message || '');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

/* ------------------------------ app decision replays ------------------------------ */

// (app)/layout.js for buyer routes.
async function route(userId) {
  const client = db.clientFor(userId);
  const profile = await getProfile(client, userId);
  if (!profile?.onboarding_complete) return { to: '/onboarding' };
  const { search, isOwner } = await resolveActiveSearch(client, userId);
  if (await needsSharedSearchSetup(client, userId, search, isOwner)) return { to: '/onboarding' };
  return { to: '/homes', searchId: search.id };
}

// onboarding/page.js: which experience, for which search.
async function openOnboarding(userId) {
  const client = db.clientFor(userId);
  const profile = await getProfile(client, userId);
  const { search, role } = await resolveOnboardingSearch(client, userId);
  const sharedSetup = Boolean(profile?.onboarding_complete);
  if (sharedSetup && !(await needsSharedSearchSetup(client, userId, search, role === 'owner'))) return { redirect: '/homes' };
  return { mode: sharedSetup ? 'shared_search_setup' : 'account', search, role };
}

// Onboarding.jsx finish(): shared setup saves only the caller's own preference
// document on that search; account onboarding also records completion.
async function finish(userId, page, priorities) {
  const client = db.clientFor(userId);
  await savePriorities(client, page.search, userId, priorities);
  if (page.mode === 'account') await completeOnboarding(client, userId, { version: 1, state: { completedAt: new Date().toISOString() } });
}

// SearchSwitcher.choose(): only the active-search pointer changes.
const switchTo = (userId, searchId) => setActiveSearch(db.clientFor(userId), userId, searchId);

/* ------------------------------------ fixtures ------------------------------------ */

const prefs = (beds, garage) => {
  const p = normalizePriorities({ searchType: 'purchase', onboardingSearchType: 'home_buy' });
  p.bedsMin = { value: String(beds), tier: 'must' };
  p.exterior = { ...p.exterior, customItems: [{ label: 'Garage', kind: 'check' }], tiers: { Garage: garage }, order: ['Garage'] };
  return p;
};
const searchOf = (userId) => db.admin(`select id from public.searches where user_id = '${userId}'`)[0].id;

// Account A: a real, established solo user — onboarding done, preferences,
// homes, and personal ratings on their own search.
async function establishedAccount(name) {
  const id = db.createUser({ email: `${name.toLowerCase()}@example.com`, firstName: name });
  const search = searchOf(id);
  const client = db.clientFor(id);
  await savePriorities(client, { id: search }, id, prefs(3, 'nice'));
  db.exec(`update public.profiles set onboarding_complete = true where id = '${id}'`);
  const home = await client.from('homes').insert({ user_id: id, search_id: search, address: `1 ${name} St, Detroit, MI`, price: '300000', beds: '3', garage_spaces: '1' }).select('id').single();
  await saveHomePersonalState(client, { id: home.data.id, status: 'Want to Tour', isFavorite: true, reaction: null, rejectionReason: '', ratings: {}, checks: { 'location:Reputable Schools': true } }, id, search);
  return { id, search, homeId: home.data.id };
}

// Everything that belongs to one account's own search, for before/after equality.
const ownSearchSnapshot = (userId, searchId) => ({
  search: db.admin(`select id, user_id, priorities, created_at from public.searches where id = '${searchId}'`),
  priorities: db.admin(`select search_id, user_id, priorities from public.search_member_priorities where search_id = '${searchId}' order by user_id`),
  homes: db.admin(`select id, address, price, beds, garage_spaces, notes from public.homes where search_id = '${searchId}' order by id`),
  personal: db.admin(`select home_id, user_id, status, is_favorite, ratings, checks from public.home_member_state where home_id in (select id from public.homes where search_id = '${searchId}') order by home_id, user_id`),
  members: db.admin(`select user_id, role from public.search_members where search_id = '${searchId}' order by user_id`),
});
const accountOnboarding = (userId) => db.admin(`select onboarding_complete, onboarding_version, onboarding_state from public.profiles where id = '${userId}'`)[0];

async function invite(owner, ownerSearch, email, relationship = 'co_buyer') {
  const invitation = await createInvitation(db.clientFor(owner), ownerSearch, owner, email, relationship);
  return invitation.token;
}
async function acceptAndActivate(userId, token) {
  const result = await acceptInvitation(db.clientFor(userId), token);
  assert.equal(result.success, true, result.reason);
  await switchTo(userId, result.search_id); // AcceptInvitationClient
  return result.search_id;
}

/* ------------------------------------ scenarios ------------------------------------ */

dbTest('1. a brand-new co-buyer does account onboarding once, inside the shared search', async () => {
  const bea = await establishedAccount('Bea');
  const newbie = db.createUser({ email: 'newbie@example.com', firstName: 'Nia' });
  await acceptAndActivate(newbie, await invite(bea.id, bea.search, 'newbie@example.com'));
  assert.deepEqual(await route(newbie), { to: '/onboarding' });
  const page = await openOnboarding(newbie);
  assert.equal(page.mode, 'account');
  assert.equal(page.search.id, bea.search);
  await finish(newbie, page, prefs(4, 'must'));
  assert.equal(accountOnboarding(newbie).onboarding_complete, true);
  assert.deepEqual(await route(newbie), { to: '/homes', searchId: bea.search });
});

dbTest('2. an established account gets targeted shared-search setup — never account onboarding — and keeps everything', async () => {
  const bea = await establishedAccount('Bree');
  const ana = await establishedAccount('Ana');
  const anaBefore = ownSearchSnapshot(ana.id, ana.search);
  const onboardingBefore = accountOnboarding(ana.id);

  const shared = await acceptAndActivate(ana.id, await invite(bea.id, bea.search, 'ana@example.com'));
  assert.deepEqual(db.admin(`select role from public.search_members where search_id = '${shared}' and user_id = '${ana.id}'`), [{ role: 'co_buyer' }]);
  assert.deepEqual(await route(ana.id), { to: '/onboarding' }, 'her own preferences are needed for this search');
  const page = await openOnboarding(ana.id);
  assert.equal(page.mode, 'shared_search_setup', 'not first-time account onboarding');
  assert.equal(page.search.id, bea.search);
  assert.equal(normalizePriorities(await resolvePriorities(db.clientFor(ana.id), page.search, ana.id)).bedsMin.value, '', 'starts from her own empty document — nothing copied from her other search');

  await finish(ana.id, page, prefs(5, 'must'));
  assert.deepEqual(accountOnboarding(ana.id), onboardingBefore, 'account-level onboarding state untouched');
  assert.deepEqual(await route(ana.id), { to: '/homes', searchId: bea.search });
  assert.deepEqual(ownSearchSnapshot(ana.id, ana.search), anaBefore, 'her own search, homes, ratings, and preferences are unchanged');
  assert.equal(db.admin(`select count(*)::int as n from public.searches where user_id = '${ana.id}'`)[0].n, 1, 'no search created or merged');
});

dbTest('3. an account that already has its own preferences on the invited search goes straight to Homes', async () => {
  const bea = await establishedAccount('Bria');
  const ana = await establishedAccount('Amy');
  // Amy was a co-buyer here before (removed, her document remained), and is invited back.
  await acceptAndActivate(ana.id, await invite(bea.id, bea.search, 'amy@example.com'));
  await savePriorities(db.clientFor(ana.id), { id: bea.search }, ana.id, prefs(4, 'important'));
  db.exec(`delete from public.search_members where search_id = '${bea.search}' and user_id = '${ana.id}'`);
  await switchTo(ana.id, ana.search);

  await acceptAndActivate(ana.id, await invite(bea.id, bea.search, 'amy@example.com'));
  assert.deepEqual(await route(ana.id), { to: '/homes', searchId: bea.search });
  assert.deepEqual(await openOnboarding(ana.id), { redirect: '/homes' });
  assert.equal(normalizePriorities(await resolvePriorities(db.clientFor(ana.id), { id: bea.search }, ana.id)).bedsMin.value, '4');
});

dbTest('4–5. switching between her own search and the shared one shows each search\'s own homes and preferences, mutating nothing', async () => {
  const bea = await establishedAccount('Bonnie');
  const ana = await establishedAccount('Abby');
  await acceptAndActivate(ana.id, await invite(bea.id, bea.search, 'abby@example.com'));
  await finish(ana.id, await openOnboarding(ana.id), prefs(5, 'must'));

  const searches = await getAccessibleSearches(db.clientFor(ana.id), ana.id);
  assert.deepEqual(searches.map(({ label, relationshipType, isOwner }) => ({ label, relationshipType, isOwner })), [
    { label: 'Your search', relationshipType: 'owner', isOwner: true },
    { label: 'Bonnie’s search', relationshipType: 'co_buyer', isOwner: false },
  ]);

  const before = { mine: ownSearchSnapshot(ana.id, ana.search), shared: ownSearchSnapshot(bea.id, bea.search) };
  for (const [target, expectedHome, expectedBeds] of [[ana.search, ana.homeId, '3'], [bea.search, bea.homeId, '5'], [ana.search, ana.homeId, '3'], [bea.search, bea.homeId, '5']]) {
    await switchTo(ana.id, target);
    assert.deepEqual(await route(ana.id), { to: '/homes', searchId: target });
    const homes = await getHomesForUser(db.clientFor(ana.id), ana.id, target);
    assert.deepEqual(homes.map((home) => home.id), [expectedHome]);
    assert.equal(normalizePriorities(await resolvePriorities(db.clientFor(ana.id), { id: target }, ana.id)).bedsMin.value, expectedBeds);
  }
  // Her personal state on her own home survived every switch.
  const [ownHome] = await getHomesForUser(db.clientFor(ana.id), ana.id, ana.search);
  assert.equal(ownHome.status, 'Want to Tour');
  assert.equal(ownHome.isFavorite, true);
  assert.equal(ownHome.checks['location:Reputable Schools'], true);
  assert.deepEqual({ mine: ownSearchSnapshot(ana.id, ana.search), shared: ownSearchSnapshot(bea.id, bea.search) }, before, 'switching changed no membership, preference, or home');
});

dbTest('6. signing out and back in restores the same authorized active search', async () => {
  const bea = await establishedAccount('Bella');
  const ana = await establishedAccount('Alma');
  await acceptAndActivate(ana.id, await invite(bea.id, bea.search, 'alma@example.com'));
  await finish(ana.id, await openOnboarding(ana.id), prefs(4, 'must'));
  // A new session is a new client; only server-side state carries over.
  for (let session = 0; session < 3; session += 1) {
    assert.deepEqual(await route(ana.id), { to: '/homes', searchId: bea.search });
  }
  await switchTo(ana.id, ana.search);
  assert.deepEqual(await route(ana.id), { to: '/homes', searchId: ana.search });
});

dbTest('7. a stale or unauthorized active search falls back safely to her own search', async () => {
  const bea = await establishedAccount('Bette');
  const stranger = await establishedAccount('Sam');
  const ana = await establishedAccount('Ada');
  await acceptAndActivate(ana.id, await invite(bea.id, bea.search, 'ada@example.com'));
  await finish(ana.id, await openOnboarding(ana.id), prefs(4, 'must'));

  // Removed from the shared search while it was active.
  db.exec(`delete from public.search_members where search_id = '${bea.search}' and user_id = '${ana.id}'`);
  assert.deepEqual(await route(ana.id), { to: '/homes', searchId: ana.search });
  assert.deepEqual((await getAccessibleSearches(db.clientFor(ana.id), ana.id)).map((s) => s.id), [ana.search]);

  // Pointed at a search she was never part of.
  await switchTo(ana.id, stranger.search);
  assert.deepEqual(await route(ana.id), { to: '/homes', searchId: ana.search });
  assert.deepEqual(await getHomesForUser(db.clientFor(ana.id), ana.id, stranger.search), [], 'RLS hides another search\'s homes');
});

dbTest('8. owner and co-buyer Match stay independent and agree across the Compare projection', async () => {
  const bea = await establishedAccount('Blair');
  const ana = await establishedAccount('Ava');
  await acceptAndActivate(ana.id, await invite(bea.id, bea.search, 'ava@example.com'));
  await finish(ana.id, await openOnboarding(ana.id), prefs(4, 'must'));

  const [forOwner] = await getHomesForUser(db.clientFor(bea.id), bea.id, bea.search);
  const [forCoBuyer] = await getHomesForUser(db.clientFor(ana.id), ana.id, bea.search);
  const ownerMatch = computeMatch(forOwner, normalizePriorities(await resolvePriorities(db.clientFor(bea.id), { id: bea.search }, bea.id)));
  const coBuyerMatch = computeMatch(forCoBuyer, normalizePriorities(await resolvePriorities(db.clientFor(ana.id), { id: bea.search }, ana.id)));
  // Blair: 3 beds of min 3 (must, met), garage nice (met) = 100. Ava: 3 of 4 beds (must, 0.75) + garage must met = 88.
  assert.equal(ownerMatch.pct, 100);
  assert.equal(coBuyerMatch.pct, 88);
  const projected = await resolveCoBuyerComparePerspectives(db.clientFor(bea.id), { id: bea.search }, [bea.homeId]);
  assert.equal(projected.get(bea.homeId).match.pct, coBuyerMatch.pct);
  await assert.rejects(savePriorities(db.clientFor(bea.id), { id: bea.search }, ana.id, prefs(9, 'must')), rlsDenied);
});

dbTest('9. Realtor relationships keep their permissions and never enter buyer setup', async () => {
  const bea = await establishedAccount('Brooke');
  const rita = await establishedAccount('Rita');
  await acceptAndActivate(rita.id, await invite(bea.id, bea.search, 'rita@example.com', 'realtor'));

  const searches = await getAccessibleSearches(db.clientFor(rita.id), rita.id);
  assert.deepEqual(searches.find((s) => s.id === bea.search), { id: bea.search, label: 'Brooke’s search', ownerName: 'Brooke', isOwner: false, relationshipType: 'realtor' });
  assert.deepEqual(await route(rita.id), { to: '/homes', searchId: bea.search }, 'a Realtor is never routed into buyer preference setup');
  assert.notEqual((await resolveOnboardingSearch(db.clientFor(rita.id), rita.id)).search.id, bea.search);
  await assert.rejects(savePriorities(db.clientFor(rita.id), { id: bea.search }, rita.id, prefs(2, 'must')), rlsDenied);
  const reaction = await db.clientFor(rita.id).from('home_member_state').upsert({ home_id: bea.homeId, user_id: rita.id, status: 'Saved' }, { onConflict: 'home_id,user_id' });
  assert.ok(rlsDenied(reaction.error), 'a Realtor cannot record buyer state');
  await saveRealtorNote(db.clientFor(rita.id), bea.search, bea.homeId, 'Furnace replaced 2022.');
  assert.deepEqual(db.admin(`select content from public.realtor_notes where home_id = '${bea.homeId}'`), [{ content: 'Furnace replaced 2022.' }]);
});

/* --------------------------- wiring contract (always runs) --------------------------- */

test('shared-search setup never touches account onboarding, and switching remounts per search', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const page = read('src/app/onboarding/page.js');
  const shell = read('src/components/AppShell.jsx');
  const switcher = read('src/components/SearchSwitcher.jsx');
  // Shared setup returns before the account-completion path, and its progress is never stored.
  assert.match(onboarding, /if \(sharedSetup\) \{ await finishSharedSetup\(\); return; \}/);
  assert.match(onboarding, /const finishSharedSetup = async \(\) => \{\n\s+await flush\(\);\n\s+await persistPriorities\(priorities\);\n\s+leave\(pendingRedirect \|\| '\/homes'\);\n\s+\};/);
  assert.match(onboarding, /if \(sharedSetup\) return Promise\.resolve\(false\);/);
  assert.match(page, /mode="shared_search_setup"/);
  // Every page remounts when the active search changes.
  assert.match(shell, /<Fragment key=\{activeSearchId \|\| workspace\}>\{children\}<\/Fragment>/);
  // The switcher only moves the active-search pointer, then opens that search's Homes.
  assert.match(switcher, /await setActiveSearch\(createClient\(\), userId, searchId\);/);
  assert.doesNotMatch(switcher, /savePriorities|search_members|insert\(|delete\(/);
  assert.match(switcher, /aria-label=\{`Current search: \$\{active\.label\}\. Switch search`\}/);
});
