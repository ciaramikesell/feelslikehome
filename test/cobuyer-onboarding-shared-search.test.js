// Phase 0 regression: an invited co-buyer onboards into the SHARED search.
//
// Runs the real data-layer functions (collaboration.js) against a real Postgres
// built from the repository's SQL, as each participant, under RLS. Skips unless
// FLH_TEST_PGHOST is set (see docs/database-tests.md); the source-level
// contract at the bottom always runs.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { computeMatch } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';

register('./support/aliasHooks.mjs', import.meta.url);
const collaboration = await import('../src/lib/supabase/collaboration.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveActiveSearch, resolveCoBuyerComparePerspectives,
  resolveOnboardingSearch, resolvePriorities, savePriorities, setActiveSearch,
} = collaboration;

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
// The data layer throws Supabase error objects (not Error instances).
const rlsDenied = (error) => /row-level security/.test(error?.message || '');

function andrewsOwnPriorities() {
  const priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '500000', tier: 'important' };
  priorities.bedsMin = { value: '3', tier: 'must' };
  priorities.bathsMin = { value: '3', tier: 'nice' };
  priorities.exterior = { ...priorities.exterior, customItems: [{ label: 'Garage', kind: 'check' }], tiers: { Garage: 'must' }, order: ['Garage'] };
  // Listing data can't answer this one — it must stay Unknown, never a miss.
  priorities.location = { ...priorities.location, customItems: [{ label: 'Reputable Schools', kind: 'check' }], tiers: { 'Reputable Schools': 'important' }, order: ['Reputable Schools'] };
  return priorities;
}

let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.ciara = db.createUser({ email: 'ciara@example.com', firstName: 'Ciara', lastName: 'M' });
  ids.andrew = db.createUser({ email: 'andrew@example.com', firstName: 'Andrew', lastName: 'M' });
  ids.rita = db.createUser({ email: 'rita.realtor@example.com', firstName: 'Rita', lastName: 'R' });
  const owned = Object.fromEntries(db.admin('select user_id, id from public.searches').map((row) => [row.user_id, row.id]));
  ids.ciaraSearch = owned[ids.ciara];
  ids.andrewOwnedSearch = owned[ids.andrew];
  ids.ritaOwnedSearch = owned[ids.rita];
});
after(() => db?.drop());

dbTest('owner invites a co-buyer, who accepts into the shared search', async () => {
  const ciara = db.clientFor(ids.ciara);
  const andrew = db.clientFor(ids.andrew);

  const { search: ciaraSearch, isOwner } = await resolveActiveSearch(ciara, ids.ciara);
  assert.equal(ciaraSearch.id, ids.ciaraSearch);
  assert.equal(isOwner, true);

  const invitation = await createInvitation(ciara, ciaraSearch.id, ids.ciara, 'Andrew@Example.com', 'co_buyer');
  const accepted = await acceptInvitation(andrew, invitation.token);
  assert.equal(accepted.success, true);
  assert.equal(accepted.search_id, ids.ciaraSearch);
  // Exactly what AcceptInvitationClient does next.
  await setActiveSearch(andrew, ids.andrew, accepted.search_id);

  assert.deepEqual(db.admin(`select role from public.search_members where search_id = '${ids.ciaraSearch}' and user_id = '${ids.andrew}'`), [{ role: 'co_buyer' }]);
});

dbTest('the co-buyer\'s onboarding resolves the shared search, not their own empty one', async () => {
  const andrew = db.clientFor(ids.andrew);
  const { search, role } = await resolveOnboardingSearch(andrew, ids.andrew);
  assert.equal(search.id, ids.ciaraSearch, 'onboarding must target the shared search Andrew accepted into');
  assert.notEqual(search.id, ids.andrewOwnedSearch, 'the pre-fix bug: onboarding wrote to Andrew\'s auto-created owned search');
  assert.equal(role, 'co_buyer');
});

dbTest('the co-buyer\'s independent preferences are saved to, and belong to, the shared search', async () => {
  const andrew = db.clientFor(ids.andrew);
  const { search } = await resolveOnboardingSearch(andrew, ids.andrew);
  await savePriorities(andrew, search, ids.andrew, andrewsOwnPriorities());

  const rows = db.admin(`select search_id, user_id, priorities from public.search_member_priorities where user_id = '${ids.andrew}'`);
  assert.equal(rows.length, 1, 'one participant document, nothing on the dormant owned search');
  assert.equal(rows[0].search_id, ids.ciaraSearch);
  assert.equal(rows[0].priorities.bedsMin.tier, 'must');

  const readBack = normalizePriorities(await resolvePriorities(andrew, search, ids.andrew));
  assert.equal(readBack.exterior.tiers.Garage, 'must');

  // Andrew's list is his, not a household list: Ciara's own document is untouched.
  const ciaraDoc = normalizePriorities(await resolvePriorities(db.clientFor(ids.ciara), { id: ids.ciaraSearch }, ids.ciara));
  assert.equal(ciaraDoc.exterior.tiers.Garage, undefined);
});

dbTest('the owner cannot create, overwrite, or edit the co-buyer\'s preferences', async () => {
  const ciara = db.clientFor(ids.ciara);
  const before = db.admin(`select priorities from public.search_member_priorities where user_id = '${ids.andrew}'`)[0].priorities;

  await assert.rejects(
    savePriorities(ciara, { id: ids.ciaraSearch }, ids.andrew, normalizePriorities({ budget: { value: '1', tier: 'must' } })),
    rlsDenied,
  );
  const update = await ciara.from('search_member_priorities').update({ priorities: { hijacked: true } })
    .eq('search_id', ids.ciaraSearch).eq('user_id', ids.andrew).select('id');
  assert.deepEqual(update.data, [], 'RLS hides the row from an UPDATE by anyone but its participant');

  const afterRows = db.admin(`select priorities from public.search_member_priorities where user_id = '${ids.andrew}'`);
  assert.deepEqual(afterRows[0].priorities, before);
});

dbTest('the owner cannot record a reaction on the co-buyer\'s behalf', async () => {
  const ciara = db.clientFor(ids.ciara);
  const inserted = await ciara.from('homes').insert({ user_id: ids.ciara, search_id: ids.ciaraSearch, address: '1 Lakeshore Rd, Grosse Pointe, MI 48236', price: '450000', beds: '4', baths: '2', garage_spaces: '2' }).select('id').single();
  assert.equal(inserted.error, null);
  ids.home = inserted.data.id;

  const impersonation = await ciara.from('home_member_state').upsert({ home_id: ids.home, user_id: ids.andrew, reaction: 'love' }, { onConflict: 'home_id,user_id' });
  assert.match(impersonation.error?.message || '', /row-level security/);
  assert.deepEqual(db.admin(`select id from public.home_member_state where user_id = '${ids.andrew}'`), []);
});

dbTest('the co-buyer\'s Match appears for homes in the shared search, identically from both sides', async () => {
  const andrew = db.clientFor(ids.andrew);
  const homes = await getHomesForUser(andrew, ids.andrew, ids.ciaraSearch);
  assert.deepEqual(homes.map((home) => home.id), [ids.home]);

  const priorities = normalizePriorities(await resolvePriorities(andrew, { id: ids.ciaraSearch }, ids.andrew));
  const match = computeMatch(homes[0], priorities);
  // budget 1×2 + beds 1×4 + garage 1×4 + baths (2/3)×1 over weight 11; the
  // unanswerable schools criterion is Unknown and outside the denominator.
  assert.equal(match.pct, 97);
  const schools = match.allSelected.find((criterion) => criterion.key === 'location:Reputable Schools');
  assert.equal(schools.evaluated, false, 'unknown is not no');
  assert.equal(match.allSelected.find((criterion) => criterion.key === 'exterior:Garage').met, true);

  // Ciara (the importer) sees Andrew's Match through the sanitized projection —
  // evaluating listing data against his declared criteria, never answering for him.
  const perspectives = await resolveCoBuyerComparePerspectives(db.clientFor(ids.ciara), { id: ids.ciaraSearch }, [ids.home]);
  assert.equal(perspectives.get(ids.home).match.pct, match.pct);
});

dbTest('a Realtor membership never becomes the Realtor\'s onboarding search', async () => {
  const ciara = db.clientFor(ids.ciara);
  const rita = db.clientFor(ids.rita);
  const invitation = await createInvitation(ciara, ids.ciaraSearch, ids.ciara, 'rita.realtor@example.com', 'realtor');
  assert.equal((await acceptInvitation(rita, invitation.token)).success, true);
  await setActiveSearch(rita, ids.rita, ids.ciaraSearch);

  const { search, role } = await resolveOnboardingSearch(rita, ids.rita);
  assert.equal(search.id, ids.ritaOwnedSearch);
  assert.equal(role, 'owner');
  // And the policy agrees: a Realtor cannot write participant priorities on the client's search.
  await assert.rejects(savePriorities(rita, { id: ids.ciaraSearch }, ids.rita, normalizePriorities({})), rlsDenied);
});

test('onboarding resolves its search through the collaboration resolver, never the owned search', () => {
  const page = readFileSync(new URL('../src/app/onboarding/page.js', import.meta.url), 'utf8');
  const data = readFileSync(new URL('../src/lib/supabase/data.js', import.meta.url), 'utf8');
  assert.match(page, /resolveOnboardingSearch\(supabase, user\.id\)/);
  assert.doesNotMatch(page, /getSearch\(/);
  assert.doesNotMatch(data, /export async function getSearch\(/);
});
