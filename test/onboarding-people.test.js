// Onboarding V2, Step 3 (Your People). Choosing a card is an intention saved
// as the onboarding answer; an invitation exists only when the owner creates
// an invite link. Existing members and open invitations are shown as they are
// and never duplicated. Only reachable in the inactive six-step flow (3).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import {
  CURRENT_ONBOARDING_VERSION, advanceOnboarding, beginOnboarding, onboardingProgress, onboardingStepsFor, retreatOnboarding, setOnboardingAnswer,
} from '../src/lib/onboardingFlow.js';
import {
  addPending, choiceFromSelection, emptyPeople, findOpenInvite, initialChoice, inviteProblem, normalizePeople, peopleFromRows,
  selectionFromChoice, toggleSelection,
} from '../src/lib/onboardingPeople.js';
import { addSearchArea, searchAreasOf } from '../src/lib/searchAreas.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const OWN = { searchId: '11111111-1111-4111-8111-111111111111', role: 'owner' };

test('either card, both, or neither map to the existing collaboration answer', () => {
  assert.equal(choiceFromSelection({ co_buyer: false, realtor: false }), 'solo');
  assert.equal(choiceFromSelection({ co_buyer: true, realtor: false }), 'co_buyer');
  assert.equal(choiceFromSelection({ co_buyer: false, realtor: true }), 'realtor');
  assert.equal(choiceFromSelection({ co_buyer: true, realtor: true }), 'co_buyer_and_realtor');
  for (const choice of ['solo', 'co_buyer', 'realtor', 'co_buyer_and_realtor']) assert.equal(choiceFromSelection(selectionFromChoice(choice)), choice);
  assert.deepEqual(selectionFromChoice(null), { co_buyer: false, realtor: false });
  assert.equal(toggleSelection('co_buyer', 'realtor'), 'co_buyer_and_realtor');
  assert.equal(toggleSelection('co_buyer_and_realtor', 'co_buyer'), 'realtor');
  assert.equal(toggleSelection('realtor', 'realtor'), 'solo');
});

test('a saved answer wins; otherwise existing people and open invites set the starting cards', () => {
  const people = normalizePeople({ coBuyers: [{ name: 'Jordan' }], pending: [{ id: 'i', email: 'a@b.co', type: 'realtor', token: 't' }] });
  assert.equal(initialChoice('solo', people), 'solo');
  assert.equal(initialChoice(null, people), 'co_buyer_and_realtor');
  assert.equal(initialChoice(null, emptyPeople()), null);
});

test('people come only from real rows: expired or answered invitations are not shown as open', () => {
  const now = new Date('2026-10-11T00:00:00Z');
  const people = peopleFromRows({
    now,
    members: [{ role: 'co_buyer' }, { role: 'realtor' }],
    coBuyerName: 'Jordan',
    invitations: [
      { id: '1', invited_email: 'open@example.com', relationship_type: 'realtor', token: 'a', status: 'pending', expires_at: '2026-10-15T00:00:00Z' },
      { id: '2', invited_email: 'old@example.com', relationship_type: 'co_buyer', token: 'b', status: 'pending', expires_at: '2026-10-01T00:00:00Z' },
      { id: '3', invited_email: 'done@example.com', relationship_type: 'co_buyer', token: 'c', status: 'accepted', expires_at: '2026-10-15T00:00:00Z' },
    ],
  });
  assert.deepEqual(people.coBuyers, [{ name: 'Jordan' }]);
  assert.equal(people.realtors, 1);
  assert.deepEqual(people.pending.map((invite) => invite.email), ['open@example.com']);
});

test('invite emails are checked, and an open invite is found instead of duplicated', () => {
  assert.match(inviteProblem(''), /Enter their email/);
  assert.match(inviteProblem('not-an-email'), /full email address/);
  assert.match(inviteProblem(' You@Example.com ', { accountEmail: 'you@example.com' }), /your own email/);
  assert.equal(inviteProblem('partner@example.com', { accountEmail: 'you@example.com' }), null);
  const people = addPending(emptyPeople(), { id: 'x', email: 'agent@example.com', type: 'realtor', token: 't' });
  assert.equal(findOpenInvite(people, 'realtor', ' AGENT@example.com ').id, 'x');
  assert.equal(findOpenInvite(people, 'co_buyer', 'agent@example.com'), null, 'a different relationship is a different invite');
  assert.equal(addPending(people, { id: 'x', email: 'agent@example.com', type: 'realtor', token: 't' }).pending.length, 1);
});

test('Step 3 is 3/6 in the inactive approved flow only; the live flow is unchanged', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  const begun = beginOnboarding({ context: OWN, targetVersion: 3 }).state;
  const progress = onboardingProgress(3, begun, 'collaboration');
  assert.equal(progress.position, 3);
  assert.equal(progress.total, 6);
  // Continue/Maybe later both go to Step 4; Back returns to Location; nothing is cleared.
  let state = setOnboardingAnswer({ ...begun, step: 'collaboration', completed: ['basics', 'locations'] }, 'collaboration', 'co_buyer');
  state = advanceOnboarding(3, state, 'collaboration').state;
  assert.equal(state.step, 'priorities');
  state = retreatOnboarding(3, state, 'priorities');
  assert.equal(state.step, 'collaboration');
  assert.equal(state.answers.collaboration, 'co_buyer');
  assert.equal(retreatOnboarding(3, state, 'collaboration').step, 'locations');
  // An invited co-buyer always searches with a co-buyer.
  const invited = beginOnboarding({ context: { ...OWN, role: 'co_buyer' }, targetVersion: 3 }).state;
  assert.throws(() => setOnboardingAnswer(invited, 'collaboration', 'realtor'));
  assert.equal(setOnboardingAnswer(invited, 'collaboration', 'co_buyer_and_realtor').answers.collaboration, 'co_buyer_and_realtor');
});

test('choosing a card never invites anyone; only the explicit invite form does', () => {
  const step = read('src/components/onboarding/CollaborationStep.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  // The one call to onInvite is inside the invite form's submit handler.
  assert.equal((step.match(/onInvite\(/g) || []).length, 1);
  assert.match(step, /const create = async \(event\) => \{[\s\S]*?await onInvite\(kind, email\)/);
  assert.match(step, /<form className="flh-ob-invite-form" onSubmit=\{create\}/);
  // The card toggle only records the choice.
  assert.match(step, /const toggle = \(kind\) => onChoose\(\{ \.\.\.selection, \[kind\]: !selection\[kind\] \}\);/);
  const choose = onboarding.slice(onboarding.indexOf('const chooseCollaboration'), onboarding.indexOf('const collaborationChoice'));
  assert.match(choose, /setOnboardingAnswer\(progressRef\.current, 'collaboration', choice\)/);
  assert.doesNotMatch(choose, /createInvite|services\./);
  assert.equal((onboarding.match(/services\.createInvite\(/g) || []).length, 1);
  // No invitation is required: Continue and Maybe later are never disabled.
  assert.match(step, /<button type="button" className="flh-text-action flh-ob-later" onClick=\{onMaybeLater\}>Maybe later<\/button>/);
  assert.match(step, /<OnboardingAction onClick=\{onNext\}>Continue<\/OnboardingAction>/);
  // Sent vs saved is explicit, and nothing claims an email was sent.
  assert.match(step, /Nothing is sent\./);
  assert.doesNotMatch(step, /invitation (was )?sent|we(’|')ll (email|send)|email (sent|them)/i);
  // Only the owner manages invitations.
  assert.match(step, /if \(role !== 'owner'\) \{/);
  assert.doesNotMatch(step, /We’ll remember/, 'shared-search setup does not store this answer');
});

test('Step 3 uses the approved copy', () => {
  const step = read('src/components/onboarding/CollaborationStep.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /collaboration: 'Your People'/);
  assert.match(onboarding, /title=\{<>Searching with <em>someone\?<\/em><\/>\} lead="Home searching is better together\. Invite the people who are part of your journey—or add them later\."/);
  assert.match(step, /title: 'A co-buyer',\n\s+description: 'Searching with a partner or someone making the decision with you\? You’ll each have your own priorities, all in one shared search\.'/);
  assert.match(step, /title: 'A Realtor',\n\s+description: 'Working with an agent\? They can follow your search, see what matters to you, and suggest homes worth a look\.'/);
  assert.match(step, /No invitations now—you can bring someone in whenever you’re ready\./);
});

test('people are loaded only when the flow includes Step 3, and a failed read is reported', () => {
  const page = read('src/app/onboarding/page.js');
  assert.match(page, /if \(!onboardingStepsFor\(progress\.version, progress\.state\)\.includes\('collaboration'\)\) return \{ initialPeople: null, peopleError: null \};/);
  assert.match(page, /peopleError: 'Couldn’t load who’s already in your search\./);
});

test('Step 3 styles are scoped to onboarding', () => {
  const css = read('src/app/globals.css');
  const block = css.slice(css.indexOf('/* ── Onboarding V2 — Step 3'));
  assert.ok(block.length > 100);
  for (const selector of block.match(/^[^@\s/}][^{]*\{/gm) || []) {
    assert.match(selector, /\.flh-onboarding-root|\.flh-ob-/, `unscoped selector: ${selector}`);
  }
});

/* ------------------------------ real Postgres ------------------------------ */

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createOrReuseInvitation, getSearchPeopleRows, savePriorities, resolvePriorities,
} = await import('../src/lib/supabase/collaboration.js');
const { getProfile, saveOnboardingProgress } = await import('../src/lib/supabase/data.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

const searchOf = (userId) => ({ id: db.admin(`select id from public.searches where user_id = '${userId}'`)[0].id, user_id: userId });
const inviteCount = (searchId) => db.admin(`select count(*)::int as n from public.search_invitations where search_id = '${searchId}'`)[0].n;

dbTest('choosing cards saves only the onboarding answer; no invitation is created', async () => {
  const owner = db.createUser({ email: 'owner.cards@example.com' });
  const search = searchOf(owner);
  const client = db.clientFor(owner);
  // Step 2 answers already saved.
  await savePriorities(client, search, owner, addSearchArea(normalizePriorities({}), { placeId: 'gp', name: 'Grosse Pointe', type: 'city' }));
  let state = beginOnboarding({ context: { searchId: search.id, role: 'owner' }, targetVersion: 3 }).state;
  for (const choice of ['co_buyer', 'co_buyer_and_realtor', 'realtor', 'solo']) {
    state = setOnboardingAnswer(state, 'collaboration', choice);
    await saveOnboardingProgress(client, owner, { version: 3, state });
  }
  assert.equal(inviteCount(search.id), 0);
  assert.equal((await getProfile(client, owner)).onboarding_state.answers.collaboration, 'solo');
  // Earlier answers are untouched.
  assert.deepEqual(searchAreasOf(normalizePriorities(await resolvePriorities(client, search, owner))).map((area) => area.placeId), ['gp']);
});

dbTest('an explicit invite creates one open link, reused for the same person; joined people replace it', async () => {
  const owner = db.createUser({ email: 'owner.invite@example.com' });
  const partner = db.createUser({ email: 'partner.invite@example.com', firstName: 'Jordan' });
  const search = searchOf(owner);
  const client = db.clientFor(owner);
  const first = await createOrReuseInvitation(client, search.id, owner, 'Partner.Invite@example.com', 'co_buyer');
  const again = await createOrReuseInvitation(client, search.id, owner, ' partner.invite@example.com ', 'co_buyer');
  assert.equal(again.reused, true);
  assert.equal(again.id, first.id);
  assert.equal(inviteCount(search.id), 1);
  // A Realtor invite for the same address is a different relationship.
  await createOrReuseInvitation(client, search.id, owner, 'agent.invite@example.com', 'realtor');
  let people = peopleFromRows(await getSearchPeopleRows(client, search));
  assert.deepEqual(people.pending.map((invite) => [invite.type, invite.email]), [['co_buyer', 'partner.invite@example.com'], ['realtor', 'agent.invite@example.com']]);
  assert.deepEqual(people.coBuyers, []);
  // Once accepted, the co-buyer is a member and the invite is no longer open.
  const accepted = await acceptInvitation(db.clientFor(partner), first.token);
  assert.equal(accepted.success, true);
  people = peopleFromRows(await getSearchPeopleRows(client, search));
  assert.equal(people.coBuyers.length, 1);
  assert.deepEqual(people.pending.map((invite) => invite.type), ['realtor']);
  assert.equal(initialChoice(null, people), 'co_buyer_and_realtor');
});

dbTest('only the owner can create or see invitations', async () => {
  const owner = db.createUser({ email: 'owner.perm@example.com' });
  const partner = db.createUser({ email: 'partner.perm@example.com' });
  const search = searchOf(owner);
  const invite = await createOrReuseInvitation(db.clientFor(owner), search.id, owner, 'partner.perm@example.com', 'co_buyer');
  await acceptInvitation(db.clientFor(partner), invite.token);
  const coBuyer = db.clientFor(partner);
  await assert.rejects(createOrReuseInvitation(coBuyer, search.id, partner, 'agent.perm@example.com', 'realtor'));
  const { invitations } = await getSearchPeopleRows(coBuyer, search);
  assert.deepEqual(invitations, [], 'a co-buyer cannot read the owner’s invitations');
  assert.equal(inviteCount(search.id), 1);
});

dbTest('an expired invite is never reused or shown as open', async () => {
  const owner = db.createUser({ email: 'owner.expired@example.com' });
  const search = searchOf(owner);
  const client = db.clientFor(owner);
  const old = await createOrReuseInvitation(client, search.id, owner, 'late@example.com', 'co_buyer');
  db.exec(`update public.search_invitations set expires_at = now() - interval '1 day' where id = '${old.id}';`);
  const fresh = await createOrReuseInvitation(client, search.id, owner, 'late@example.com', 'co_buyer');
  assert.notEqual(fresh.id, old.id);
  assert.notEqual(fresh.reused, true);
  assert.deepEqual(peopleFromRows(await getSearchPeopleRows(client, search)).pending.map((invite) => invite.id), [fresh.id]);
});
