// Onboarding V2, Step 3 (Your People). The cards capture intent only, saved as
// the onboarding answer; onboarding never creates an invitation or a
// membership (inviting happens in My Search). People already in the search are
// shown as they are. Only reachable in the inactive six-step flow (3).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import {
  CURRENT_ONBOARDING_VERSION, advanceOnboarding, beginOnboarding, onboardingProgress, onboardingStepsFor, retreatOnboarding, setOnboardingAnswer,
} from '../src/lib/onboardingFlow.js';
import { choiceFromSelection, emptyPeople, hasRelationship, normalizePeople, peopleFromRows, selectionFromChoice, toggleSelection } from '../src/lib/onboardingPeople.js';
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
  assert.equal(toggleSelection('realtor', 'realtor'), 'solo');
});

test('people come only from real membership rows; nobody is invented', () => {
  assert.deepEqual(peopleFromRows({ members: [] }), emptyPeople());
  const people = peopleFromRows({ members: [{ role: 'co_buyer' }, { role: 'realtor' }], coBuyerName: 'Jordan' });
  assert.deepEqual(people.coBuyers, [{ name: 'Jordan' }]);
  assert.equal(hasRelationship(people, 'realtor'), true);
  // A missing name stays missing rather than becoming a placeholder person.
  assert.deepEqual(normalizePeople({ coBuyers: [{ name: '  ' }] }).coBuyers, [{ name: null }]);
});

test('Step 3 is 3/6 in the inactive approved flow only; navigation keeps the answer', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  const begun = beginOnboarding({ context: OWN, targetVersion: 3 }).state;
  const progress = onboardingProgress(3, begun, 'collaboration');
  assert.equal(progress.position, 3);
  assert.equal(progress.total, 6);
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
});

test('Step 3 has no invitation management, and choosing a card only saves the answer', () => {
  const step = read('src/components/onboarding/CollaborationStep.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  for (const removed of [/type="email"/, /Create invite link/, /Copy link/, /\/invite\//, /expires/i, /onInvite/, /createInvitation|createInvite/]) {
    assert.doesNotMatch(step, removed);
  }
  assert.doesNotMatch(onboarding, /createInvite|createInvitation|createOrReuseInvitation/);
  const choose = onboarding.slice(onboarding.indexOf('const chooseCollaboration'), onboarding.indexOf('const leave'));
  assert.match(choose, /setOnboardingAnswer\(progressRef\.current, 'collaboration', choice\)/);
  assert.doesNotMatch(choose, /services\./);
  // Existing people stay chosen in the saved answer and can't be unchosen here.
  assert.match(step, /co_buyer: Boolean\(relationships\.co_buyer\) \|\|/);
  assert.match(step, /onClick=\{fixed \? undefined : onToggle\}/);
  // Continue and Maybe later need nothing and change nothing.
  assert.match(step, /<button type="button" className="flh-text-action flh-ob-later" onClick=\{onMaybeLater\}>Maybe later<\/button>/);
  assert.match(step, /<OnboardingAction onClick=\{onNext\}>Continue<\/OnboardingAction>/);
  assert.match(onboarding, /onMaybeLater=\{\(\) => goTo\('collaboration'\)\}/);
  // The shared-search exit is untouched.
  assert.match(onboarding, /Not now—go to your own search/);
});

test('Step 3 uses the approved copy', () => {
  const step = read('src/components/onboarding/CollaborationStep.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /collaboration: 'Your People'/);
  assert.match(onboarding, /title=\{<>Searching with <em>someone\?<\/em><\/>\}/);
  assert.match(step, /co_buyer: \{ title: 'Co-buyer', description: 'Compare priorities and see how each home fits both of you\.'/);
  assert.match(step, /realtor: \{ title: 'Realtor', description: 'Share your wishlist and receive home suggestions from your agent\.'/);
  assert.match(step, /You’re searching with \$\{coBuyerName\}/);
  assert.match(step, /'Your Realtor is connected'/);
  assert.match(step, /<strong>Co-buyers<\/strong> share homes but keep their own priorities and ratings\./);
  assert.match(step, /<strong>Realtors<\/strong> can view what you share with them and suggest homes\./);
  assert.match(step, /<strong>Invitations<\/strong> can be sent later from My Search\./);
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
const { acceptInvitation, createInvitation, getSearchPeopleRows, savePriorities, resolvePriorities } = await import('../src/lib/supabase/collaboration.js');
const { getProfile, saveOnboardingProgress } = await import('../src/lib/supabase/data.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

const searchOf = (userId) => ({ id: db.admin(`select id from public.searches where user_id = '${userId}'`)[0].id, user_id: userId });
const counts = (searchId) => db.admin(`select (select count(*)::int from public.search_invitations where search_id = '${searchId}') as invitations, (select count(*)::int from public.search_members where search_id = '${searchId}') as members`)[0];

dbTest('choosing cards and Maybe later save only the onboarding answer; invitations and members are untouched', async () => {
  const owner = db.createUser({ email: 'owner.cards@example.com' });
  const search = searchOf(owner);
  const client = db.clientFor(owner);
  await savePriorities(client, search, owner, addSearchArea(normalizePriorities({}), { placeId: 'gp', name: 'Grosse Pointe', type: 'city' }));
  // An invitation created earlier in My Search.
  await createInvitation(client, search.id, owner, 'agent.cards@example.com', 'realtor');
  const before = counts(search.id);
  let state = beginOnboarding({ context: { searchId: search.id, role: 'owner' }, targetVersion: 3 }).state;
  state = { ...state, step: 'collaboration', completed: ['basics', 'locations'] };
  for (const choice of ['co_buyer', 'co_buyer_and_realtor', 'realtor', 'solo']) {
    state = setOnboardingAnswer(state, 'collaboration', choice);
    await saveOnboardingProgress(client, owner, { version: 3, state });
  }
  // Maybe later = advance only.
  state = advanceOnboarding(3, state, 'collaboration').state;
  await saveOnboardingProgress(client, owner, { version: 3, state });
  assert.deepEqual(counts(search.id), before);
  const saved = (await getProfile(client, owner)).onboarding_state;
  assert.equal(saved.answers.collaboration, 'solo');
  assert.equal(saved.step, 'priorities');
  assert.deepEqual(searchAreasOf(normalizePriorities(await resolvePriorities(client, search, owner))).map((area) => area.placeId), ['gp']);
});

dbTest('existing people are read as they are: a joined co-buyer with their name; pending invites are not people', async () => {
  const owner = db.createUser({ email: 'owner.people@example.com' });
  const partner = db.createUser({ email: 'partner.people@example.com', firstName: 'Jordan' });
  const search = searchOf(owner);
  const client = db.clientFor(owner);
  const invite = await createInvitation(client, search.id, owner, 'partner.people@example.com', 'co_buyer');
  assert.deepEqual(peopleFromRows(await getSearchPeopleRows(client, search)), emptyPeople(), 'a pending invite is not a co-buyer');
  assert.equal((await acceptInvitation(db.clientFor(partner), invite.token)).success, true);
  const people = peopleFromRows(await getSearchPeopleRows(client, search));
  assert.equal(people.coBuyers.length, 1);
  assert.equal(hasRelationship(people, 'realtor'), false);
  // The co-buyer sees only their own membership row (existing policy).
  const seen = await getSearchPeopleRows(db.clientFor(partner), search);
  assert.ok(seen.members.length <= 1);
});
