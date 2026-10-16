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
  createRealtorSuggestion, getHomesForUser, getRealtorConnectionTarget, getRealtorRelationships, getSearchPeople, listRealtorInvitations, setActiveSearch,
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

/* ------------------------- approval target resolution ------------------------- */

const pointTo = (user, searchId) => db.exec(`update public.profiles set active_search_id = ${searchId ? `'${searchId}'` : 'null'} where id = '${user.id}'`);
const membershipsOf = (user) => db.admin(`select search_id from public.search_members where user_id = '${user.id}' order by search_id`).map((row) => row.search_id);

dbTest('the approval target is the search each buyer is using, named for the approval screen', async () => {
  const p = await household();
  // The co-buyer works in the owner's shared search (their active search).
  assert.deepEqual(await getRealtorConnectionTarget(as(p.coBuyer)), { searchId: p.search, role: 'co_buyer', partnerName: 'Olive', homeCount: 1 });
  // The owner has no other active search: their own (shared) search.
  assert.deepEqual(await getRealtorConnectionTarget(as(p.owner)), { searchId: p.search, role: 'owner', partnerName: 'Casey', homeCount: 1 });
  // A solo buyer: their own search, no partner.
  const solo = newUser('sol');
  assert.deepEqual(await getRealtorConnectionTarget(as(solo)), { searchId: ownedSearch(solo), role: 'owner', partnerName: null, homeCount: 0 });
  // Not callable by anonymous visitors; the internal resolver is not callable at all.
  const internal = await as(p.owner).rpc('realtor_connection_target_for', { p_user: p.coBuyer.id });
  assert.ok(internal.error && denied(internal.error), 'internal resolver is not exposed');
});

dbTest('a buyer with more than one search: the active one is used, and a mismatched target is refused', async () => {
  const p = await household();
  const casyOwn = ownedSearch(p.coBuyer);
  const request = await createRealtorConnectionRequest(as(p.realtor), p.coBuyer.email);
  // Active = shared search: approving for their own (unused) search is refused, not silently redirected.
  const wrong = await approveRealtorConnection(as(p.coBuyer), request.token, casyOwn);
  assert.deepEqual([wrong.success, wrong.reason], [false, 'search_changed']);
  // They switch to their own search in the app: now the shared search is the mismatch.
  pointTo(p.coBuyer, casyOwn);
  assert.equal((await getRealtorConnectionTarget(as(p.coBuyer))).searchId, casyOwn);
  const stale = await approveRealtorConnection(as(p.coBuyer), request.token, p.search);
  assert.deepEqual([stale.success, stale.reason], [false, 'search_changed']);
  assert.deepEqual(membershipsOf(p.realtor), [], 'nothing connected by refused attempts');
  // Approving the search actually in use works, and connects only that one.
  const ok = await approveRealtorConnection(as(p.coBuyer), request.token, casyOwn);
  assert.deepEqual([ok.success, ok.search_id], [true, casyOwn]);
  assert.deepEqual(membershipsOf(p.realtor), [casyOwn]);
});

dbTest('a stale active search (removed from it) has no safe target: nothing is connected until the buyer chooses', async () => {
  const p = await household();
  const casyOwn = ownedSearch(p.coBuyer);
  const before = searchCount();
  const request = await createRealtorConnectionRequest(as(p.realtor), p.coBuyer.email);
  // The owner removes the co-buyer; their active-search pointer still names the shared search.
  db.exec(`delete from public.search_members where search_id = '${p.search}' and user_id = '${p.coBuyer.id}'`);
  assert.equal(db.admin(`select active_search_id from public.profiles where id = '${p.coBuyer.id}'`)[0].active_search_id, p.search);
  assert.deepEqual(await getRealtorConnectionTarget(as(p.coBuyer)), { reason: 'active_search_unavailable' });
  // No fallback to the search they own, and no access to the one they left.
  for (const target of [casyOwn, p.search]) {
    const result = await approveRealtorConnection(as(p.coBuyer), request.token, target);
    assert.equal(result.success, false);
    assert.ok(['active_search_unavailable', 'search_not_authorized'].includes(result.reason), result.reason);
  }
  assert.deepEqual(membershipsOf(p.realtor), []);
  assert.equal(invStatus(db.admin(`select id from public.search_invitations where token = '${request.token}'`)[0].id), 'pending');
  // Recovery: they explicitly choose their own search in the app, then approve it.
  await setActiveSearch(as(p.coBuyer), p.coBuyer.id, casyOwn);
  assert.equal((await getRealtorConnectionTarget(as(p.coBuyer))).searchId, casyOwn);
  assert.equal((await approveRealtorConnection(as(p.coBuyer), request.token, casyOwn)).success, true);
  assert.deepEqual(membershipsOf(p.realtor), [casyOwn]);
  assert.equal(searchCount(), before, 'no search created');
});

dbTest('an active search the buyer only helps with as a Realtor is not a target', async () => {
  const p = await household();
  const other = await household();
  // Olive also works as a Realtor for another household, and that search is her active one.
  await connectRealtor({ ...other, realtor: p.owner });
  pointTo(p.owner, other.search);
  assert.deepEqual(await getRealtorConnectionTarget(as(p.owner)), { reason: 'active_search_unavailable' });
  const request = await createRealtorConnectionRequest(as(p.realtor), p.owner.email);
  for (const target of [other.search, p.search]) {
    const result = await approveRealtorConnection(as(p.owner), request.token, target);
    assert.equal(result.success, false, target);
  }
  assert.deepEqual(membershipsOf(p.realtor), []);
  assert.equal(roleIn(other.search, p.owner), 'realtor', 'her Realtor role elsewhere is untouched');
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
  for (const line of ['loses access right away, including everyone’s priorities and reactions', 'Homes you added from their suggestions stay in your Homes', 'Suggestions you haven’t answered are withdrawn']) assert.ok(people.includes(line), line);
  // Invitations are links the buyer sends; nothing is emailed.
  for (const line of ['No email is sent.', 'Feels Like Home doesn’t send it for you', 'We haven’t emailed anyone. Copy this link and send it yourself.', 'Create private link']) assert.ok(people.includes(line), line);
  const page = read('src/app/(app)/search/page.js');
  assert.match(page, /getSearchPeople\(supabase, search\.id\)/);
  assert.match(page, /listRealtorInvitations\(supabase, search\.id\)/);
});

test('a connection request is approved for the search the buyer uses, verified by the database', () => {
  const page = read('src/app/invite/[token]/page.js');
  assert.match(page, /const target = await getRealtorConnectionTarget\(supabase\);/);
  assert.doesNotMatch(page, /resolveOnboardingSearch|resolveActiveSearch/, 'no app-side fallback target');
  // Without a safe target, the page offers only searches the buyer buys in.
  assert.match(page, /search\.relationshipType === 'owner' \|\| search\.relationshipType === 'co_buyer'/);
  const client = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
  assert.match(client, /approvalTarget\?\.id \? await approveRealtorConnection\(supabase, token, approvalTarget\.id\)/);
  assert.match(client, /const needsTarget = isBuyerInvite && Boolean\(approvalTarget\?\.error\);/);
  assert.match(client, /Which home search should \{inviterName\} help with\?/);
  assert.match(read('src/lib/realtorEntry.js'), /if \(invitationDirection === 'realtor_to_buyer'\) return \{ destination: '\/onboarding', setActiveSearch: false \};/);
});

/* --------------------------- production preflight --------------------------- */

import { POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';
const MIGRATION = 'supabase/migrations/2026-10-15-buyer-realtor-management.sql';
const PREFLIGHT = read('supabase/buyer-realtor-management-preflight.sql').replace(/^--.*$/gm, '').trim().replace(/;$/, '');
const notOk = (rows, stage) => rows.filter((row) => row.stage === stage && row.ok !== true).map((row) => `${row.item} ${row.detail || ''}`);

dbTest('the read-only preflight passes before the migration, confirms it after, and changes nothing', () => {
  const pre = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const fingerprint = () => pre.admin(`select
      (select json_agg(p order by p.tablename, p.policyname) from pg_policies p where p.schemaname = 'public') as policies,
      (select json_agg(f.proname order by f.proname) from pg_proc f where f.pronamespace = 'public'::regnamespace) as functions,
      (select count(*) from public.search_invitations) as invitations`)[0];
    const before = fingerprint();
    const report = pre.admin(PREFLIGHT);
    assert.deepEqual(notOk(report, 'required'), []);
    assert.ok(report.filter((row) => row.stage === 'after').every((row) => row.ok === null), 'nothing to verify yet');
    assert.ok(report.some((row) => row.section === 4 && row.detail === 'not present: will be created'));
    assert.deepEqual(fingerprint(), before, 'the preflight writes nothing');

    const policiesBefore = pre.admin(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`);
    assert.equal(pre.applyFile(MIGRATION).error, null);
    // The migration adds functions only: every policy is byte-for-byte unchanged.
    assert.deepEqual(pre.admin(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`), policiesBefore);
    const after = pre.admin(PREFLIGHT);
    assert.deepEqual(notOk(after, 'required'), []);
    assert.deepEqual(notOk(after, 'after'), [], 'definer, pinned search_path, EXECUTE only where intended');
    assert.equal(pre.applyFile(MIGRATION).error, null, 're-runnable');
    assert.deepEqual(notOk(pre.admin(PREFLIGHT), 'after'), []);
  } finally {
    pre.drop();
  }
});

dbTest('the preflight flags a conflicting overload, a missing prerequisite and a widened grant', () => {
  const pre = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    pre.exec(`create function public.get_search_people(p_search_id text) returns int language sql as $$ select 1 $$;`);
    pre.exec(`drop trigger search_members_withdraw_realtor_suggestions on public.search_members;`);
    pre.exec(`create policy "search_invitations_anyone_update" on public.search_invitations for update using (true);`);
    const failing = notOk(pre.admin(PREFLIGHT), 'required');
    assert.ok(failing.some((line) => line.startsWith('no other function named get_search_people') && line.includes('get_search_people(p_search_id text)')), failing.join('\n'));
    assert.ok(failing.some((line) => line.includes('withdrawal trigger')), failing.join('\n'));
    assert.ok(failing.some((line) => line.includes('search_invitations policies are exactly')), failing.join('\n'));
  } finally {
    pre.drop();
  }
  const post = createTestDatabase();
  try {
    post.exec('grant execute on function public.realtor_connection_target_for(uuid) to authenticated;');
    post.exec('grant execute on function public.get_search_people(uuid) to anon;');
    const failing = notOk(post.admin(PREFLIGHT), 'after');
    assert.deepEqual(failing.map((line) => line.split(':')[0]).sort(), ['get_search_people', 'realtor_connection_target_for']);
  } finally {
    post.drop();
  }
});
