// Buyer-side Realtor management (My Search → Your People), executed against a
// real Postgres built from the repository SQL. Covers who may see, invite,
// revoke and remove; connection requests approved into the search a buyer
// actually uses (not "the search they own"); and that removal relies on the
// 2026-10-12 protections (withdrawn suggestions, accepted homes kept).
// Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, approveRealtorConnection, createInvitation, createRealtorConnectionRequest, createRealtorInvitation,
  createRealtorSuggestion, getHomesForUser, getRealtorRelationships, getSearchPeople, listRealtorInvitations,
  previewInvitation, promoteSuggestion, removeRealtor, revokeInvitation, saveHomePersonalAndShared, savePriorities,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const fails = (re) => (error) => re.test(error?.message || String(error));
const denied = (error) => /access denied|42501|permission denied|row-level security/i.test(error?.message || String(error));

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

let seq = 0;
const newUser = (name) => {
  seq += 1;
  const email = `${name}.${seq}@example.com`;
  return { id: db.createUser({ email, firstName: name[0].toUpperCase() + name.slice(1) }), email };
};
const as = (user) => db.clientFor(user.id);
const ownedSearch = (user) => db.admin(`select id from public.searches where user_id = '${user.id}'`)[0].id;
const searchCount = () => db.admin('select count(*)::int as n from public.searches')[0].n;
const roleIn = (search, user) => db.admin(`select role from public.search_members where search_id = '${search}' and user_id = '${user.id}'`)[0]?.role || null;
const invStatus = (id) => db.admin(`select status from public.search_invitations where id = '${id}'`)[0].status;

// An owner with a home and priorities, a co-buyer who joined, plus a Realtor
// and an outsider who are not (yet) connected.
async function household() {
  const p = { owner: newUser('olive'), coBuyer: newUser('casey'), realtor: newUser('riley'), outsider: newUser('oscar') };
  p.search = ownedSearch(p.owner);
  db.exec(`update public.profiles set onboarding_complete = true where id in ('${p.owner.id}', '${p.coBuyer.id}')`);
  await savePriorities(as(p.owner), { id: p.search }, p.owner.id, { searchType: 'purchase', budget: { value: '650000', tier: 'must' } });
  await saveHomePersonalAndShared(as(p.owner), { address: `1 Olive St ${seq}`, status: 'Saved', checks: {}, ratings: { overall: 4 }, reaction: 'love' }, p.owner.id, p.search);
  const invite = await createInvitation(as(p.owner), p.search, p.owner.id, p.coBuyer.email, 'co_buyer');
  assert.equal((await acceptInvitation(as(p.coBuyer), invite.token)).success, true);
  db.exec(`update public.profiles set active_search_id = '${p.search}' where id = '${p.coBuyer.id}'`);
  await savePriorities(as(p.coBuyer), { id: p.search }, p.coBuyer.id, { searchType: 'purchase', bedsMin: { value: '3', tier: 'must' } });
  return p;
}
async function connectRealtor(p, by = p.owner) {
  const inv = await createRealtorInvitation(as(by), p.search, p.realtor.email);
  const result = await acceptInvitation(as(p.realtor), inv.token);
  assert.equal(result.success, true, result.reason);
  assert.equal(result.search_id, p.search);
  return inv;
}

/* --------------------------------- people --------------------------------- */

dbTest('both buyers see the people in their search with roles and names; Realtors and outsiders cannot', async () => {
  const p = await household();
  await connectRealtor(p);
  for (const viewer of [p.owner, p.coBuyer]) {
    const people = await getSearchPeople(as(viewer), p.search);
    assert.deepEqual(people.map((row) => [row.role, row.displayName, row.isYou]), [
      ['owner', 'Olive', viewer === p.owner], ['co_buyer', 'Casey', viewer === p.coBuyer], ['realtor', 'Riley', false],
    ]);
    // Names and roles only: nothing about anyone's priorities or ratings.
    assert.deepEqual(Object.keys(people[0]).sort(), ['displayName', 'isYou', 'joinedAt', 'role', 'userId']);
  }
  for (const viewer of [p.realtor, p.outsider]) await assert.rejects(getSearchPeople(as(viewer), p.search), denied);
});

/* -------------------------------- inviting -------------------------------- */

dbTest('the owner and the co-buyer can each invite a Realtor to the shared search; Realtors and outsiders cannot', async () => {
  const p = await household();
  const before = searchCount();
  const byCoBuyer = await createRealtorInvitation(as(p.coBuyer), p.search, p.realtor.email);
  assert.equal(byCoBuyer.reused, false);
  // Re-inviting the same email returns the pending invitation, not a second one.
  const again = await createRealtorInvitation(as(p.owner), p.search, ` ${p.realtor.email.toUpperCase()} `);
  assert.deepEqual([again.id, again.reused], [byCoBuyer.id, true]);
  const row = db.admin(`select search_id, relationship_type, invitation_direction, invited_by from public.search_invitations where id = '${byCoBuyer.id}'`)[0];
  assert.deepEqual(row, { search_id: p.search, relationship_type: 'realtor', invitation_direction: 'buyer_to_realtor', invited_by: p.coBuyer.id });

  // The Realtor accepts and joins the shared search itself; no search is created.
  const result = await acceptInvitation(as(p.realtor), byCoBuyer.token);
  assert.deepEqual([result.success, result.search_id], [true, p.search]);
  assert.equal(roleIn(p.search, p.realtor), 'realtor');
  assert.equal(searchCount(), before);
  assert.deepEqual((await getRealtorRelationships(as(p.realtor), p.realtor.id)).map((r) => r.id), [p.search]);

  // A connected Realtor cannot invite anyone; an outsider cannot invite themselves or anyone else.
  await assert.rejects(createRealtorInvitation(as(p.realtor), p.search, 'friend@example.com'), denied);
  await assert.rejects(createRealtorInvitation(as(p.outsider), p.search, p.outsider.email), denied);
  for (const user of [p.realtor, p.outsider]) {
    const direct = await as(user).from('search_invitations').insert({ search_id: p.search, invited_by: user.id, invited_email: 'x@example.com', relationship_type: 'co_buyer' }).select('id');
    assert.ok(direct.error, 'direct invitation writes stay owner-only');
  }
});

dbTest('invitation input is validated: bad email, yourself, an existing buyer, an already-connected Realtor', async () => {
  const p = await household();
  await assert.rejects(createRealtorInvitation(as(p.owner), p.search, 'not-an-email'), fails(/invalid_email/));
  await assert.rejects(createRealtorInvitation(as(p.owner), p.search, p.owner.email), fails(/self_invite/));
  await assert.rejects(createRealtorInvitation(as(p.owner), p.search, p.coBuyer.email), fails(/already_a_buyer/));
  await connectRealtor(p);
  await assert.rejects(createRealtorInvitation(as(p.coBuyer), p.search, p.realtor.email), fails(/already_connected/));
});

/* --------------------------- pending invitations --------------------------- */

dbTest('pending invitations: both buyers see them, copy while valid, revoke, and send a replacement; revoked links are dead', async () => {
  const p = await household();
  const inv = await createRealtorInvitation(as(p.owner), p.search, p.realtor.email);
  for (const viewer of [p.owner, p.coBuyer]) {
    const [row] = await listRealtorInvitations(as(viewer), p.search);
    assert.deepEqual([row.id, row.status, row.token, row.email, row.direction], [inv.id, 'pending', inv.token, p.realtor.email, 'buyer_to_realtor']);
  }
  for (const viewer of [p.realtor, p.outsider]) await assert.rejects(listRealtorInvitations(as(viewer), p.search), denied);
  await assert.rejects(revokeInvitation(as(p.outsider), inv.id), denied);
  await assert.rejects(revokeInvitation(as(p.realtor), inv.id), denied, 'the invitee cannot revoke a buyer invitation');

  assert.equal(await revokeInvitation(as(p.coBuyer), inv.id), 'revoked');
  assert.equal(await revokeInvitation(as(p.owner), inv.id), 'already_revoked', 'repeat revoke is harmless');
  const [revoked] = await listRealtorInvitations(as(p.owner), p.search);
  assert.deepEqual([revoked.status, revoked.token], ['revoked', null], 'no link to copy once revoked');
  assert.equal((await previewInvitation(as(p.realtor), inv.token)).reason, 'revoked');
  const used = await acceptInvitation(as(p.realtor), inv.token);
  assert.deepEqual([used.success, used.reason], [false, 'revoked']);
  assert.equal(roleIn(p.search, p.realtor), null);

  // Replacement invitation after revocation, and after expiry.
  const replacement = await createRealtorInvitation(as(p.owner), p.search, p.realtor.email);
  assert.notEqual(replacement.id, inv.id);
  db.exec(`update public.search_invitations set expires_at = now() - interval '1 hour' where id = '${replacement.id}'`);
  const expired = (await listRealtorInvitations(as(p.owner), p.search)).find((row) => row.id === replacement.id);
  assert.deepEqual([expired.status, expired.token], ['expired', null]);
  assert.equal((await acceptInvitation(as(p.realtor), replacement.token)).reason, 'expired');
  const third = await createRealtorInvitation(as(p.coBuyer), p.search, p.realtor.email);
  assert.equal(third.reused, false);
  assert.equal((await acceptInvitation(as(p.realtor), third.token)).success, true);
  // Accepted invitations drop out of the list (the Realtor now shows as connected).
  assert.ok(!(await listRealtorInvitations(as(p.owner), p.search)).some((row) => row.id === third.id));
  assert.equal(await revokeInvitation(as(p.owner), third.id), 'already_accepted');
  assert.equal(roleIn(p.search, p.realtor), 'realtor', 'revoking an accepted invitation does not remove anyone');
});

dbTest('a buyer cannot see or manage another search\'s invitations or Realtor', async () => {
  const p = await household();
  const q = await household();
  await connectRealtor(q);
  const inv = await createRealtorInvitation(as(q.owner), q.search, `someone.${seq}@example.com`);
  await assert.rejects(listRealtorInvitations(as(p.owner), q.search), denied);
  await assert.rejects(revokeInvitation(as(p.owner), inv.id), denied);
  await assert.rejects(removeRealtor(as(p.owner), q.search, q.realtor.id), denied);
  await assert.rejects(getSearchPeople(as(p.coBuyer), q.search), denied);
  await assert.rejects(createRealtorInvitation(as(p.owner), q.search, `x.${seq}@example.com`), denied);
  assert.equal(invStatus(inv.id), 'pending');
  assert.equal(roleIn(q.search, q.realtor), 'realtor');
});

/* ------------------------------ connection requests ------------------------------ */

dbTest('a co-buyer approves a Realtor\'s connection request into the shared search they use, not the empty search they own', async () => {
  const p = await household();
  const casyOwn = ownedSearch(p.coBuyer);
  const before = { searches: searchCount(), ownerHomes: db.admin(`select count(*)::int as n from public.homes where search_id = '${p.search}'`)[0].n };
  const request = await createRealtorConnectionRequest(as(p.realtor), p.coBuyer.email);
  // The co-buyer sees it in Your People for the shared search, with a link to review.
  const [listed] = await listRealtorInvitations(as(p.coBuyer), p.search);
  assert.deepEqual([listed.direction, listed.status, listed.token, listed.inviterName], ['realtor_to_buyer', 'pending', request.token, 'Riley']);

  const result = await approveRealtorConnection(as(p.coBuyer), request.token, p.search);
  assert.deepEqual([result.success, result.search_id], [true, p.search]);
  assert.equal(roleIn(p.search, p.realtor), 'realtor', 'connected to the shared search');
  assert.equal(roleIn(casyOwn, p.realtor), null, 'not to the co-buyer\'s own search');
  assert.equal(searchCount(), before.searches, 'no search created');
  assert.equal(db.admin(`select active_search_id from public.profiles where id = '${p.coBuyer.id}'`)[0].active_search_id, p.search, 'active search not switched');
  assert.equal(db.admin(`select count(*)::int as n from public.homes where search_id = '${p.search}'`)[0].n, before.ownerHomes);
  assert.deepEqual((await getRealtorRelationships(as(p.realtor), p.realtor.id)).map((r) => r.id), [p.search]);
  // Approving again is idempotent.
  const again = await approveRealtorConnection(as(p.coBuyer), request.token, p.search);
  assert.deepEqual([again.success, again.reason], [true, 'already_member']);
});

dbTest('approval is refused for a search the buyer is not a buyer of, a forged search id, or the wrong account', async () => {
  const p = await household();
  const q = await household();
  const request = await createRealtorConnectionRequest(as(p.realtor), p.owner.email);
  // Someone else's search (forged id), a search where the caller is only a Realtor, a made-up id.
  const realtorOnly = await household();
  await connectRealtor({ ...realtorOnly, realtor: p.owner });
  for (const target of [q.search, realtorOnly.search, '00000000-0000-0000-0000-000000000000']) {
    const result = await approveRealtorConnection(as(p.owner), request.token, target);
    assert.deepEqual([result.success, result.reason], [false, 'search_not_authorized'], target);
  }
  // The token belongs to the owner's email: nobody else can use it, even for their own search.
  const stolen = await approveRealtorConnection(as(q.owner), request.token, q.search);
  assert.deepEqual([stolen.success, stolen.reason], [false, 'wrong_account']);
  // A buyer→Realtor invitation token cannot be "approved" into another search either.
  const buyerInvite = await createRealtorInvitation(as(q.owner), q.search, p.owner.email);
  const misuse = await approveRealtorConnection(as(p.owner), buyerInvite.token, p.search);
  assert.deepEqual([misuse.success, misuse.reason], [false, 'not_a_connection_request']);
  assert.equal(roleIn(q.search, p.realtor), null);
  assert.equal(roleIn(realtorOnly.search, p.realtor), null);
  assert.equal(invStatus(db.admin(`select id from public.search_invitations where token = '${request.token}'`)[0].id), 'pending');
  // A declined request can no longer be approved.
  const requestId = db.admin(`select id from public.search_invitations where token = '${request.token}'`)[0].id;
  assert.equal(await revokeInvitation(as(p.owner), requestId), 'revoked');
  const late = await approveRealtorConnection(as(p.owner), request.token, p.search);
  assert.deepEqual([late.success, late.reason], [false, 'revoked']);
});

/* --------------------------------- removal --------------------------------- */

dbTest('either buyer removes the Realtor: access ends at once, pending suggestions are withdrawn for good, accepted homes stay', async () => {
  for (const remover of ['owner', 'coBuyer']) {
    const p = await household();
    await connectRealtor(p);
    const accepted = await createRealtorSuggestion(as(p.realtor), p.search, { address: `20 Accepted Ave ${seq}` });
    await promoteSuggestion(as(p.coBuyer), accepted.suggestion_id);
    const pending = await createRealtorSuggestion(as(p.realtor), p.search, { address: `21 Pending Ave ${seq}` });
    const homesBefore = db.admin(`select id, notes from public.homes where search_id = '${p.search}' and not suggestion_staged order by id`);

    // A Realtor cannot remove buyers or change ownership; an outsider cannot remove anyone.
    await assert.rejects(removeRealtor(as(p.realtor), p.search, p.coBuyer.id), denied);
    await assert.rejects(removeRealtor(as(p.outsider), p.search, p.realtor.id), denied);
    const takeover = await as(p.realtor).from('searches').update({ user_id: p.realtor.id }).eq('id', p.search).select('id');
    assert.ok(takeover.error || (takeover.data || []).length === 0);
    // This function never removes a buyer.
    await assert.rejects(removeRealtor(as(p.owner), p.search, p.coBuyer.id), fails(/not_a_realtor/));
    await assert.rejects(removeRealtor(as(p.coBuyer), p.search, p.owner.id), fails(/not_a_realtor/));

    assert.equal(await removeRealtor(as(p[remover]), p.search, p.realtor.id), 'removed');
    assert.equal(await removeRealtor(as(p[remover]), p.search, p.realtor.id), 'not_connected', 'repeat removal is harmless');
    assert.equal(roleIn(p.search, p.realtor), null);
    assert.equal(roleIn(p.search, p.coBuyer), 'co_buyer');

    // Access ends immediately.
    assert.deepEqual(await getRealtorRelationships(as(p.realtor), p.realtor.id), []);
    for (const table of ['homes', 'search_member_priorities', 'realtor_suggestions']) {
      const { data } = await as(p.realtor).from(table).select('search_id').eq('search_id', p.search);
      assert.deepEqual(data, [], table);
    }
    const { data: states } = await as(p.realtor).from('home_member_state').select('home_id').eq('user_id', p.owner.id);
    assert.deepEqual(states, []);
    await assert.rejects(createRealtorSuggestion(as(p.realtor), p.search, { address: '22 Late Ave' }), denied);

    // Pending suggestion withdrawn permanently; accepted home and buyer records intact.
    assert.equal(db.admin(`select status from public.realtor_suggestions where id = '${pending.suggestion_id}'`)[0].status, 'withdrawn');
    assert.equal(db.admin(`select status from public.realtor_suggestions where id = '${accepted.suggestion_id}'`)[0].status, 'accepted');
    assert.deepEqual(db.admin(`select id, notes from public.homes where search_id = '${p.search}' and not suggestion_staged order by id`), homesBefore);
    assert.ok((await getHomesForUser(as(p.owner), p.owner.id, p.search)).some((home) => home.id === accepted.home_id && home.suggestedBy === 'Riley'));
    // Re-inviting does not bring the withdrawn suggestion back.
    await connectRealtor(p, p.coBuyer);
    assert.equal(db.admin(`select status from public.realtor_suggestions where id = '${pending.suggestion_id}'`)[0].status, 'withdrawn');
  }
});

/* ------------------------------ app wiring ------------------------------ */

import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Your People asks the database for every decision and keeps no revocation logic of its own', () => {
  const people = read('src/components/YourPeople.jsx');
  assert.match(people, /removeRealtor\(createClient\(\), searchId, realtor\.userId\)/);
  assert.match(people, /revokeInvitation\(createClient\(\), invitation\.id\)/);
  assert.match(people, /createRealtorInvitation\(createClient\(\), searchId, email\)/);
  // No client-side suggestion withdrawal or membership writes: the database does it.
  assert.doesNotMatch(people, /realtor_suggestions|search_members|\.from\(/);
  // The confirmation states what removal does.
  for (const line of ['will lose access to this search', 'Homes you already added from their suggestions stay in your Homes', 'Suggestions you haven’t answered yet will be withdrawn', 'won’t be able to see anyone’s priorities or reactions']) assert.ok(people.includes(line), line);
  const page = read('src/app/(app)/search/page.js');
  assert.match(page, /getSearchPeople\(supabase, search\.id\)/);
  assert.match(page, /listRealtorInvitations\(supabase, search\.id\)/);
});

test('a connection request is approved for the search the buyer uses, verified by the database', () => {
  const page = read('src/app/invite/[token]/page.js');
  assert.match(page, /const \{ search, role \} = await resolveOnboardingSearch\(supabase, userId\);/);
  const client = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
  assert.match(client, /approveRealtorConnection\(supabase, token, approvalTarget\.id\)/);
  assert.match(client, /: \{ success: false, reason: 'search_not_authorized' \}/);
  assert.match(read('src/lib/realtorEntry.js'), /if \(invitationDirection === 'realtor_to_buyer'\) return \{ destination: '\/onboarding', setActiveSearch: false \};/);
});
