// Realtor entry and routing journeys, executed against a real Postgres for the
// data they depend on (memberships, searches, active search, permissions) and
// against the shared routing rules in src/lib/realtorEntry.js.
//
// There is no account-level Realtor role. An account enters as a Realtor by
// sign-up intent or by holding a Realtor membership on someone's search; the
// latter covers a Realtor who first signed up from a buyer's invitation.
// Skips the database parts unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import {
  REALTOR_WORKSPACE_PATH, entersAsRealtor, invitationAcceptance, isRealtorWorkspacePath, rememberRealtorWorkspace, remembersRealtorFromFailedInvitation,
} from '../src/lib/realtorEntry.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, approveRealtorConnection, resolveOnboardingSearch, createInvitation, createRealtorConnectionRequest, getRealtorRelationships, hasRealtorRelationship,
  previewInvitation, resolveActiveSearch, saveHomePersonalAndShared, savePriorities,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);

/* ------------------------------ routing rules ------------------------------ */

test('only an unfinished account that arrived as a Realtor skips buyer onboarding', () => {
  assert.equal(entersAsRealtor({ onboardingComplete: false, entryIntent: 'realtor', hasRealtorMembership: false }), true);
  assert.equal(entersAsRealtor({ onboardingComplete: false, entryIntent: undefined, hasRealtorMembership: true }), true);
  // Buyers and co-buyers: unchanged (onboarding).
  assert.equal(entersAsRealtor({ onboardingComplete: false, entryIntent: undefined, hasRealtorMembership: false }), false);
  // Anyone who finished buyer onboarding keeps their buyer Homes as home base.
  assert.equal(entersAsRealtor({ onboardingComplete: true, entryIntent: 'realtor', hasRealtorMembership: true }), false);
  assert.equal(REALTOR_WORKSPACE_PATH, '/people');
  for (const path of ['/people', '/people/abc', '/realtor']) assert.equal(isRealtorWorkspacePath(path), true);
  for (const path of ['/homes', '/onboarding', '/account']) assert.equal(isRealtorWorkspacePath(path), false);
});

test('invitation acceptance destinations', () => {
  assert.deepEqual(invitationAcceptance({ relationshipType: 'realtor', invitationDirection: 'buyer_to_collaborator', searchId: 's1' }), { destination: '/people/s1', setActiveSearch: false });
  assert.deepEqual(invitationAcceptance({ relationshipType: 'realtor', invitationDirection: null, searchId: null }), { destination: '/people', setActiveSearch: false });
  assert.deepEqual(invitationAcceptance({ relationshipType: 'co_buyer', invitationDirection: 'buyer_to_collaborator', searchId: 's1' }), { destination: '/homes', setActiveSearch: true });
  // A buyer approving a Realtor continues as before (onboarding, which sends an onboarded buyer on to Homes).
  assert.deepEqual(invitationAcceptance({ relationshipType: 'realtor', invitationDirection: 'realtor_to_buyer', searchId: 's1' }), { destination: '/onboarding', setActiveSearch: false });
});

test('root, layout, sign-up and invitation acceptance all use the shared rules', () => {
  const root = read('src/app/page.js');
  assert.match(root, /entersAsRealtor\(/);
  assert.match(root, /hasRealtorRelationship\(supabase, user\.id\)/);
  assert.match(root, /redirect\(realtor \? REALTOR_WORKSPACE_PATH : '\/onboarding'\)/);
  const layout = read('src/app/(app)/layout.js');
  assert.match(layout, /const isRealtorEntry = isRealtorWorkspace && entersAsRealtor\(/);
  // The membership read only happens for an unfinished account on a Realtor route without the intent flag.
  assert.match(layout, /hasRealtorMembership: !storedProfile\?\.onboarding_complete && user\.user_metadata\?\.account_entry_intent !== 'realtor'\s*&& await hasRealtorRelationship/);
  assert.match(layout, /isRealtorEntry && isRealtorWorkspace \? \{ \.\.\.storedProfile, onboarding_complete: true \}/);
  assert.match(read('src/components/auth/AuthForm.jsx'), /isRealtorEntry \? REALTOR_WORKSPACE_PATH : redirectTo/);
  const accept = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
  assert.match(accept, /invitationAcceptance\(\{/);
  assert.match(accept, /if \(next\.setActiveSearch && user && result\.search_id\)/);
  assert.match(accept, /router\.push\(next\.destination\)/);
  assert.doesNotMatch(accept, /router\.push\(isBuyerInvite \? '\/onboarding' : '\/homes'\)/);
  // The Realtor workspace preference: on a successful Realtor acceptance, and for a failed Realtor invitation on an unfinished account.
  assert.match(accept, /if \(asRealtor\) await rememberRealtorWorkspace\(supabase\);/);
  assert.match(accept, /if \(remembersRealtorFromFailedInvitation\(\{ preview: initialPreview, onboardingComplete \}\)\) rememberRealtorWorkspace\(createClient\(\)\)/);
  assert.match(read('src/app/invite/[token]/page.js'), /onboardingComplete=\{Boolean\(profile\?\.onboarding_complete\)\}/);
  // Preference is routing only: no database object reads it.
  for (const file of ['supabase/schema.sql', 'supabase/migrations/2026-10-12-realtor-access-and-home-ownership.sql']) assert.doesNotMatch(read(file), /account_entry_intent/);
  // Onboarding (live and V2) is untouched by Realtor routing.
  assert.doesNotMatch(read('src/app/onboarding/page.js'), /account_entry_intent|entersAsRealtor|hasRealtorRelationship/);
});

/* --------------------------- journeys (database) --------------------------- */

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

let seq = 0;
const newUser = (name, meta = {}) => {
  seq += 1;
  const email = `${name}.${seq}@example.com`;
  const id = db.createUser({ email, firstName: name });
  if (Object.keys(meta).length) db.exec(`update auth.users set raw_user_meta_data = raw_user_meta_data || '${JSON.stringify(meta)}'::jsonb where id = '${id}'`);
  return { id, email };
};
const as = (user) => db.clientFor(user.id);
const ownedSearch = (user) => db.admin(`select id from public.searches where user_id = '${user.id}'`)[0]?.id;
const searchCount = () => db.admin('select count(*)::int as n from public.searches')[0].n;
const activeSearch = (user) => db.admin(`select active_search_id from public.profiles where id = '${user.id}'`)[0].active_search_id;
const onboarded = (user) => db.admin(`select onboarding_complete from public.profiles where id = '${user.id}'`)[0].onboarding_complete;
const completeOnboarding = (user) => db.exec(`update public.profiles set onboarding_complete = true where id = '${user.id}'`);
// What the root page and (app) layout decide for this account right now.
const storedIntent = (user) => db.admin(`select raw_user_meta_data->>'account_entry_intent' as intent from auth.users where id = '${user.id}'`)[0].intent || undefined;
const lands = async (user, intent = storedIntent(user)) => entersAsRealtor({
  onboardingComplete: onboarded(user),
  entryIntent: intent,
  hasRealtorMembership: await hasRealtorRelationship(as(user), user.id),
}) ? REALTOR_WORKSPACE_PATH : (onboarded(user) ? '/homes' : '/onboarding');

async function buyerWithSearch(name) {
  const buyer = newUser(name);
  completeOnboarding(buyer);
  await savePriorities(as(buyer), { id: ownedSearch(buyer) }, buyer.id, { searchType: 'purchase', budget: { value: '600000', tier: 'must' } });
  await saveHomePersonalAndShared(as(buyer), { address: `1 ${name} St`, status: 'Saved', checks: {}, ratings: {} }, buyer.id, ownedSearch(buyer));
  return buyer;
}
// supabase.auth for this user, backed by auth.users in the test database, so
// rememberRealtorWorkspace runs exactly as in the browser (getUser, then a
// merging updateUser of the person's own metadata).
const writes = [];
const authFor = (user) => ({
  auth: {
    getUser: async () => ({ data: { user: { id: user.id, user_metadata: db.admin(`select raw_user_meta_data as m from auth.users where id = '${user.id}'`)[0].m } } }),
    updateUser: async ({ data }) => {
      writes.push(user.id);
      db.exec(`update auth.users set raw_user_meta_data = raw_user_meta_data || '${JSON.stringify(data)}'::jsonb where id = '${user.id}'`);
      return { data: {}, error: null };
    },
  },
});
const metadata = (user) => db.admin(`select raw_user_meta_data as m from auth.users where id = '${user.id}'`)[0].m;

// The Realtor-side acceptance exactly as AcceptInvitationClient performs it.
async function acceptAsInvitee(user, token) {
  const preview = await previewInvitation(as(user), token);
  // As AcceptInvitationClient does: a Realtor's connection request is approved
  // for the search this buyer is using (the invite page's approvalTarget).
  const result = preview.invitation_direction === 'realtor_to_buyer'
    ? await approveRealtorConnection(as(user), token, (await resolveOnboardingSearch(as(user), user.id)).search.id)
    : await acceptInvitation(as(user), token);
  assert.equal(result.success, true, result.reason);
  const next = invitationAcceptance({ relationshipType: preview.relationship_type, invitationDirection: preview.invitation_direction, searchId: result.search_id });
  if (preview.relationship_type === 'realtor' && preview.invitation_direction !== 'realtor_to_buyer') await rememberRealtorWorkspace(authFor(user));
  if (next.setActiveSearch) db.exec(`update public.profiles set active_search_id = '${result.search_id}' where id = '${user.id}'`);
  return { result, next };
}

dbTest('independent Realtor sign-up lands in People, with no client data and buyer onboarding still available', async () => {
  const realtor = newUser('solo.realtor', { account_entry_intent: 'realtor' });
  assert.equal(await hasRealtorRelationship(as(realtor), realtor.id), false);
  assert.equal(await lands(realtor, 'realtor'), '/people');
  assert.deepEqual(await getRealtorRelationships(as(realtor), realtor.id), []);
  assert.equal(onboarded(realtor), false, 'buyer onboarding is left for later, not skipped');
});

dbTest('an existing Realtor accepting a buyer invitation goes to that client workspace; no search is created or switched', async () => {
  const buyer = await buyerWithSearch('inviting.buyer');
  const realtor = newUser('existing.realtor', { account_entry_intent: 'realtor' });
  const before = { searches: searchCount(), active: activeSearch(realtor) };
  const invitation = await createInvitation(as(buyer), ownedSearch(buyer), buyer.id, realtor.email, 'realtor');
  const { result, next } = await acceptAsInvitee(realtor, invitation.token);

  assert.equal(result.search_id, ownedSearch(buyer));
  assert.deepEqual(next, { destination: `/people/${ownedSearch(buyer)}`, setActiveSearch: false });
  assert.equal(searchCount(), before.searches, 'no search created');
  assert.equal(activeSearch(realtor), before.active, 'the client search never becomes the Realtor\'s own active search');
  assert.deepEqual(db.admin(`select role from public.search_members where search_id = '${ownedSearch(buyer)}' and user_id = '${realtor.id}'`), [{ role: 'realtor' }]);
  // The client workspace loads; the Realtor's own buyer side still resolves to their own search.
  assert.deepEqual((await getRealtorRelationships(as(realtor), realtor.id)).map((row) => row.id), [ownedSearch(buyer)]);
  assert.equal((await resolveActiveSearch(as(realtor), realtor.id)).search.id, ownedSearch(realtor));
  // PR #143 permissions intact: read-only on the client search.
  const write = await as(realtor).from('homes').update({ notes: 'x' }).eq('search_id', ownedSearch(buyer)).select('id');
  assert.ok(write.error || (write.data || []).length === 0);
  const del = await as(realtor).from('homes').delete().eq('search_id', ownedSearch(buyer)).select('id');
  assert.ok(del.error || (del.data || []).length === 0);
  assert.equal(db.admin(`select count(*)::int as n from public.homes where search_id = '${ownedSearch(buyer)}'`)[0].n, 1);
});

dbTest('a Realtor who first signs up from a buyer invitation (no intent flag) still lands in People, not buyer onboarding', async () => {
  const buyer = await buyerWithSearch('first.buyer');
  const invitation = await createInvitation(as(buyer), ownedSearch(buyer), buyer.id, `invited.realtor.${seq + 1}@example.com`, 'realtor');
  const realtor = newUser('invited.realtor');
  assert.equal(await lands(realtor, undefined), '/onboarding', 'before accepting, nothing marks them as a Realtor');
  const before = searchCount();
  const { next } = await acceptAsInvitee(realtor, invitation.token);
  assert.equal(next.destination, `/people/${ownedSearch(buyer)}`);
  assert.equal(searchCount(), before, 'acceptance creates no search');
  assert.equal(activeSearch(realtor), null);
  // Any later visit to / (or a People route) uses the membership, not the missed intent.
  assert.equal(await hasRealtorRelationship(as(realtor), realtor.id), true);
  assert.equal(await lands(realtor, undefined), '/people');
  assert.equal(onboarded(realtor), false);
});

dbTest('a buyer with an existing search approving a Realtor connection request keeps their one search and their routing', async () => {
  const buyer = await buyerWithSearch('approving.buyer');
  const realtor = newUser('connecting.realtor', { account_entry_intent: 'realtor' });
  const before = { searches: searchCount(), mine: ownedSearch(buyer) };
  const request = await createRealtorConnectionRequest(as(realtor), buyer.email);
  const { result, next } = await acceptAsInvitee(buyer, request.token);
  assert.equal(result.search_id, before.mine, 'the Realtor joins the buyer\'s existing search');
  assert.equal(searchCount(), before.searches, 'no duplicate search');
  assert.deepEqual(next, { destination: '/onboarding', setActiveSearch: false });
  // /onboarding sends an onboarded buyer straight on to Homes; the buyer is not routed as a Realtor.
  assert.equal(await hasRealtorRelationship(as(buyer), buyer.id), false);
  assert.equal(await lands(buyer, undefined), '/homes');
  assert.equal(await lands(realtor, 'realtor'), '/people');
  assert.deepEqual((await getRealtorRelationships(as(realtor), realtor.id)).map((row) => row.id), [before.mine]);
});

dbTest('a Realtor with several clients sees each one, and each acceptance goes to its own client', async () => {
  const realtor = newUser('busy.realtor');
  const buyers = [await buyerWithSearch('client.one'), await buyerWithSearch('client.two'), await buyerWithSearch('client.three')];
  const destinations = [];
  for (const buyer of buyers) {
    const invitation = await createInvitation(as(buyer), ownedSearch(buyer), buyer.id, realtor.email, 'realtor');
    destinations.push((await acceptAsInvitee(realtor, invitation.token)).next.destination);
  }
  assert.deepEqual(destinations, buyers.map((buyer) => `/people/${ownedSearch(buyer)}`));
  assert.deepEqual((await getRealtorRelationships(as(realtor), realtor.id)).map((row) => row.id).sort(), buyers.map(ownedSearch).sort());
  assert.equal(activeSearch(realtor), null);
  assert.equal(await lands(realtor, undefined), '/people');
});

dbTest('buyers and co-buyers keep today\'s routing: onboarding first, then their shared search', async () => {
  const owner = await buyerWithSearch('owner.unchanged');
  const coBuyer = newUser('cobuyer.unchanged');
  assert.equal(await lands(coBuyer, undefined), '/onboarding');
  const invitation = await createInvitation(as(owner), ownedSearch(owner), owner.id, coBuyer.email, 'co_buyer');
  const before = searchCount();
  const { next } = await acceptAsInvitee(coBuyer, invitation.token);
  assert.deepEqual(next, { destination: '/homes', setActiveSearch: true });
  assert.equal(activeSearch(coBuyer), ownedSearch(owner), 'a co-buyer still continues in the shared search');
  assert.equal(searchCount(), before);
  assert.equal(await hasRealtorRelationship(as(coBuyer), coBuyer.id), false);
  assert.equal(await lands(coBuyer, undefined), '/onboarding', 'an unfinished co-buyer still goes through onboarding');

  const freshBuyer = newUser('fresh.buyer');
  assert.equal(await lands(freshBuyer, undefined), '/onboarding');
});

dbTest('a Realtor keeps the Realtor workspace after losing their last client, and the preference grants no access', async () => {
  const buyer = await buyerWithSearch('removing.buyer');
  const realtor = newUser('removed.realtor');
  const invitation = await createInvitation(as(buyer), ownedSearch(buyer), buyer.id, realtor.email, 'realtor');
  await acceptAsInvitee(realtor, invitation.token);
  assert.equal(metadata(realtor).account_entry_intent, 'realtor', 'accepting records the Realtor workspace preference');
  assert.equal(metadata(realtor).first_name, 'removed.realtor', 'and keeps the rest of their metadata');
  db.exec(`delete from public.search_members where search_id = '${ownedSearch(buyer)}' and user_id = '${realtor.id}'`);
  assert.equal(await hasRealtorRelationship(as(realtor), realtor.id), false);
  assert.equal(await lands(realtor), '/people', 'zero clients, still the Realtor workspace');
  // Never authorization: nothing of the former client is readable.
  assert.deepEqual(await getRealtorRelationships(as(realtor), realtor.id), []);
  for (const table of ['homes', 'search_member_priorities', 'realtor_suggestions']) {
    const { data } = await as(realtor).from(table).select('search_id').eq('search_id', ownedSearch(buyer));
    assert.deepEqual(data, [], table);
  }
  const { data: searches } = await as(realtor).from('searches').select('id').eq('id', ownedSearch(buyer));
  assert.deepEqual(searches, []);
});

dbTest('a zero-client Realtor (sign-up intent only) sees an empty workspace and can read no buyer search', async () => {
  const realtor = newUser('zero.realtor', { account_entry_intent: 'realtor' });
  const stranger = await buyerWithSearch('stranger.buyer');
  assert.equal(await lands(realtor), '/people');
  assert.deepEqual(await getRealtorRelationships(as(realtor), realtor.id), []);
  for (const table of ['homes', 'search_member_priorities']) {
    const { data } = await as(realtor).from(table).select('search_id').eq('search_id', ownedSearch(stranger));
    assert.deepEqual(data, [], table);
  }
  await assert.rejects(as(realtor).rpc('create_realtor_suggestion', { p_search_id: ownedSearch(stranger), p_home: { address: '1 Nope' } }).then(({ error }) => { if (error) throw new Error(error.message); }), /access denied/i);
});

dbTest('expired, revoked or already-used Realtor invitations keep a new Realtor out of buyer onboarding; someone else\'s do not', async () => {
  const buyer = await buyerWithSearch('expiring.buyer');
  const cases = [];
  for (const status of ['expired', 'revoked', 'accepted']) {
    const realtor = newUser(`late.${status}.realtor`);
    const invitation = await createInvitation(as(buyer), ownedSearch(buyer), buyer.id, realtor.email, 'realtor');
    if (status === 'expired') db.exec(`update public.search_invitations set expires_at = now() - interval '1 day' where token = '${invitation.token}'`);
    else db.exec(`update public.search_invitations set status = '${status}' where token = '${invitation.token}'`);
    cases.push({ realtor, invitation });
  }
  for (const { realtor, invitation } of cases) {
    const before = searchCount();
    const preview = await previewInvitation(as(realtor), invitation.token);
    assert.equal(preview.valid, false);
    assert.equal(remembersRealtorFromFailedInvitation({ preview, onboardingComplete: onboarded(realtor) }), true, preview.reason);
    await rememberRealtorWorkspace(authFor(realtor));
    assert.equal(await lands(realtor), '/people', preview.reason);
    // The failed invitation grants nothing and creates nothing.
    assert.equal(await hasRealtorRelationship(as(realtor), realtor.id), false);
    assert.equal(searchCount(), before);
  }
  // An invitation addressed to someone else marks nobody.
  const other = newUser('bystander');
  const forSomeoneElse = await createInvitation(as(buyer), ownedSearch(buyer), buyer.id, `nobody.${seq}@example.com`, 'realtor');
  const preview = await previewInvitation(as(other), forSomeoneElse.token);
  assert.equal(preview.reason, 'wrong_account');
  assert.equal(remembersRealtorFromFailedInvitation({ preview, onboardingComplete: false }), false);
  assert.equal(await lands(other), '/onboarding');
  // A failed co-buyer invitation, or a buyer approving a Realtor, never marks a Realtor.
  assert.equal(remembersRealtorFromFailedInvitation({ preview: { valid: false, reason: 'expired', relationship_type: 'co_buyer' }, onboardingComplete: false }), false);
  assert.equal(remembersRealtorFromFailedInvitation({ preview: { valid: false, reason: 'expired', relationship_type: 'realtor', invitation_direction: 'realtor_to_buyer' }, onboardingComplete: false }), false);
  // Nor someone who already has a buyer experience.
  assert.equal(remembersRealtorFromFailedInvitation({ preview: { valid: false, reason: 'expired', relationship_type: 'realtor' }, onboardingComplete: true }), false);
});

dbTest('repeat sign-ins and visits write the preference once and route the same way every time', async () => {
  const buyer = await buyerWithSearch('repeat.buyer');
  const realtor = newUser('repeat.realtor');
  const invitation = await createInvitation(as(buyer), ownedSearch(buyer), buyer.id, realtor.email, 'realtor');
  await acceptAsInvitee(realtor, invitation.token);
  const count = () => writes.filter((id) => id === realtor.id).length;
  assert.equal(count(), 1);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await rememberRealtorWorkspace(authFor(realtor)), false, 'already remembered');
    assert.equal(await lands(realtor), '/people');
  }
  assert.equal(count(), 1);
  // A re-visit of the used invitation link changes nothing either.
  const preview = await previewInvitation(as(realtor), invitation.token);
  assert.equal(preview.valid, false);
  await rememberRealtorWorkspace(authFor(realtor));
  assert.equal(count(), 1);
});

dbTest('a buyer who also serves as a Realtor keeps their buyer experience; a Realtor can still become a buyer later', async () => {
  const realtorBuyer = await buyerWithSearch('realtor.buyer');
  const myPriorities = db.admin(`select priorities from public.search_member_priorities where user_id = '${realtorBuyer.id}'`)[0].priorities;
  const client = await buyerWithSearch('their.client');
  const invitation = await createInvitation(as(client), ownedSearch(client), client.id, realtorBuyer.email, 'realtor');
  const { next } = await acceptAsInvitee(realtorBuyer, invitation.token);
  assert.equal(next.destination, `/people/${ownedSearch(client)}`);
  assert.equal(metadata(realtorBuyer).account_entry_intent, 'realtor');
  // Their own buyer experience is untouched and remains their home base.
  assert.equal(onboarded(realtorBuyer), true);
  assert.equal(activeSearch(realtorBuyer), null);
  assert.equal((await resolveActiveSearch(as(realtorBuyer), realtorBuyer.id)).search.id, ownedSearch(realtorBuyer));
  assert.deepEqual(db.admin(`select priorities from public.search_member_priorities where user_id = '${realtorBuyer.id}'`)[0].priorities, myPriorities);
  assert.equal(await lands(realtorBuyer), '/homes');

  // A Realtor-only account that later starts its own home search becomes a buyer too.
  const realtor = newUser('later.buyer', { account_entry_intent: 'realtor' });
  assert.equal(await lands(realtor), '/people');
  completeOnboarding(realtor);
  await savePriorities(as(realtor), { id: ownedSearch(realtor) }, realtor.id, { searchType: 'rental', budget: { value: '2500', tier: 'must' } });
  assert.equal(await lands(realtor), '/homes');
  assert.equal((await resolveActiveSearch(as(realtor), realtor.id)).search.id, ownedSearch(realtor));
  // The shell offers that way in from the Realtor workspace.
  assert.match(read('src/components/AppShell.jsx'), /isRealtorWorkspace && <Link href="\/homes"[^>]*>.*My home search<\/Link>/);
});

dbTest('rememberRealtorWorkspace never throws and never touches an account it cannot read', async () => {
  assert.equal(await rememberRealtorWorkspace({ auth: { getUser: async () => ({ data: { user: null } }) } }), false);
  assert.equal(await rememberRealtorWorkspace({ auth: { getUser: async () => { throw new Error('offline'); } } }), false);
  assert.equal(await rememberRealtorWorkspace({ auth: { getUser: async () => ({ data: { user: { id: 'x', user_metadata: {} } } }), updateUser: async () => ({ error: { message: 'nope' } }) } }), false);
});
