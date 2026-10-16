// Check the Match + Tour Feedback redesign. See docs/home-evaluation-redesign.md.
//
// The answer-routing rules and the score explanation are tested as pure
// functions; the guarantees that matter most (each buyer's answers stay their
// own, shared facts are shared, nothing marks a home toured by itself, legacy
// notes survive, Realtors stay read-only) are exercised against real Postgres.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  answerSource, answerPatch, answerOptions, currentAnswer, matchOverview, priorityState, scoreExplanation,
} = await import('../src/lib/matchReview.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { emptyHome, normalizePriorities, TIER_META } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { applyPostTourVerdict } = await import('../src/lib/lifecycle.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const detail = read('src/components/HomeDetail.jsx');
const checkTheMatch = read('src/components/CheckTheMatch.jsx');
const tour = read('src/components/TourFeedback.jsx');
const modal = read('src/components/HomeModal.jsx');
const realtorPage = read('src/app/(app)/people/[searchId]/homes/[homeId]/page.js');

const buy = (entries = []) => entries.reduce((priorities, [categoryKey, label, tier, kind = 'check']) => addCriterion(priorities, { categoryKey, label, kind }, tier), applySearchChoice(normalizePriorities({}), 'home_buy'));
const criterion = (match, key) => match.allSelected.find((item) => item.key === key);

/* ------------------------------- answer routing ------------------------------- */

test('each priority is answered where it truly lives: Home Facts, places, shared fact, personal, or in person', () => {
  const priorities = { ...buy([['features', 'Home office', 'must'], ['exterior', 'Garage', 'important']]), budget: { value: '400000', tier: 'must' } };
  const match = computeMatch({ ...emptyHome() }, priorities);
  assert.equal(answerSource(criterion(match, 'budget')), 'facts');
  assert.equal(answerSource(criterion(match, 'exterior:Garage')), 'facts');
  assert.equal(answerSource(criterion(match, 'features:Home office')), 'personal');
  assert.equal(answerSource({ key: 'location:Commute', objective: true }), 'commute');
  assert.equal(answerSource({ key: 'features:Pets Allowed', objective: true }), 'shared');
  assert.equal(answerSource({ key: 'homeFeel:Natural Light', objective: false }), 'tour');
  assert.equal(answerSource({ key: 'location:Walkability', objective: false }), 'legacy');
  // Facts and commute are never answered here (no second stored answer).
  assert.deepEqual(answerOptions(criterion(match, 'budget')), []);
  assert.deepEqual(answerOptions({ key: 'location:Commute', objective: true }), []);
  assert.deepEqual(answerOptions({ key: 'location:Walkability', objective: false }), []);
});

test('personal answers write only this buyer’s checks; Unknown removes the answer and never becomes No', () => {
  const home = { ...emptyHome(), checks: { 'exterior:Fenced yard': true }, pros: 'Big yard', petsAllowed: null };
  const item = { key: 'features:Home office', objective: true };
  assert.deepEqual(answerPatch(home, item, true, 'purchase'), { personal: { checks: { 'exterior:Fenced yard': true, 'features:Home office': true } } });
  assert.deepEqual(answerPatch(home, item, 'no', 'purchase'), { personal: { checks: { 'exterior:Fenced yard': true, 'features:Home office': 'no' } } });
  const cleared = answerPatch({ ...home, checks: { 'features:Home office': 'no' } }, item, undefined, 'purchase');
  assert.deepEqual(cleared, { personal: { checks: {} } });
  // The patch never carries shared fields such as pros.
  assert.equal('pros' in cleared.personal, false);
});

test('clearing an answer also hides an older alias answer instead of letting it reappear', () => {
  const home = { ...emptyHome(), checks: { 'features:Home Office': true, 'features:Home office': 'no' } };
  const item = { key: 'features:Home office', objective: true };
  const { personal } = answerPatch(home, item, undefined, 'purchase');
  assert.equal(personal.checks['features:Home office'], false, 'false is Match’s existing "Unknown" marker');
  assert.equal(personal.checks['features:Home Office'], true, 'the old answer is kept, not deleted');
  const priorities = buy([['features', 'Home office', 'must']]);
  const after = computeMatch({ ...home, checks: personal.checks }, priorities);
  assert.equal(criterion(after, 'features:Home office').evaluated, false);
  assert.equal(currentAnswer({ checks: personal.checks }, item, 'purchase'), false);
});

test('shared property facts (Pets / Utilities / In-unit laundry) write the shared field, not a personal check', () => {
  const item = { key: 'features:Pets Allowed', objective: true };
  assert.deepEqual(answerPatch(emptyHome(), item, true), { shared: { petsAllowed: true } });
  assert.deepEqual(answerPatch(emptyHome(), item, 'no'), { shared: { petsAllowed: false } });
  assert.deepEqual(answerPatch(emptyHome(), item, undefined), { shared: { petsAllowed: null } });
});

test('in-person priorities use the existing tour responses in this buyer’s ratings', () => {
  const item = { key: 'homeFeel:Natural Light', objective: false };
  assert.deepEqual(answerOptions(item).map((option) => option.label), ['Disappointing', 'Fine', 'Great', 'Unknown']);
  const { personal } = answerPatch({ ...emptyHome(), ratings: { 'tour:overall': 4 } }, item, 'positive');
  assert.deepEqual(personal.ratings, { 'tour:overall': 4, 'homeFeel:Natural Light': 'positive' });
  assert.deepEqual(answerPatch({ ratings: personal.ratings }, item, undefined).personal.ratings, { 'tour:overall': 4 });
});

/* ------------------------------- overview & score honesty ------------------------------- */

test('the overview reads computeMatch as-is: Unknown is never a mismatch, Must-Haves come first, the score is untouched', () => {
  const priorities = buy([['features', 'Home office', 'must'], ['exterior', 'Fenced yard', 'important'], ['features', 'Fireplace', 'nice'], ['exterior', 'Patio / deck', 'nice']]);
  const home = { ...emptyHome(), checks: { 'features:Home office': 'no', 'features:Fireplace': true } };
  const match = computeMatch(home, priorities);
  const overview = matchOverview(match);
  assert.equal(overview.pct, match.pct, 'the displayed score is exactly computeMatch’s');
  assert.deepEqual(overview.mustMisses.map((item) => item.key), ['features:Home office']);
  assert.deepEqual(overview.unknown.map((item) => item.tier), overview.unknown.map((item) => item.tier).sort((a, b) => ['must', 'important', 'nice'].indexOf(a) - ['must', 'important', 'nice'].indexOf(b)));
  assert.equal(overview.mismatches.some((item) => !item.evaluated), false);
  assert.equal(overview.confirmedCount + overview.unknownCount, overview.total);
  assert.equal(priorityState(criterion(match, 'exterior:Fenced yard')), 'unknown');
  // Must No (weight 4, score 0) + Nice Yes (weight 1, score 1) → 1/5 = 20%.
  assert.equal(match.pct, 20);
});

test('the score explanation states the real weights and that Unknown is not counted; no score means no claim', () => {
  const overview = { pct: 72, total: 10, confirmedCount: 6, unknownCount: 4 };
  const text = scoreExplanation(overview);
  assert.match(text, new RegExp(`Must-Haves count ${TIER_META.must.weight}×, Important ${TIER_META.important.weight}×, Nice-to-Haves ${TIER_META.nice.weight}×`));
  assert.match(text, /The 4 still unknown aren’t counted either way/);
  assert.match(scoreExplanation({ pct: null, total: 3, confirmedCount: 0, unknownCount: 3 }), /no Match yet[\s\S]*Unknown never counts against it/);
  // A confirmed Nice-to-Have No is explained, not hidden.
  assert.match(checkTheMatch, /Nice-to-Have \$\{niceMisses === 1 \? 'answer is' : 'answers are'\} a confirmed No, which lowers the score a little\./);
  assert.doesNotMatch(checkTheMatch, /complete|completion|% done|finish/i);
});

/* ------------------------------- source guarantees ------------------------------- */

test('answers go through the path that owns them; the workspace shell, sections and URLs are unchanged', () => {
  assert.match(detail, /const patch = answerPatch\(home, criterion, value, priorities\.searchType\);\s*if \(!patch\) return null;\s*return patch\.shared \? saveWhole\(\{ \.\.\.home, \.\.\.patch\.shared \}\) : savePersonal\(patch\.personal\);/);
  assert.match(detail, /personal: \(next, userId, searchId\) => saveHomePersonalState\(createClient\(\), next, userId, searchId\)/);
  for (const key of ['facts', 'match', 'tour']) assert.match(detail, new RegExp(`key: '${key}'`));
  assert.match(detail, /url\.searchParams\.set\('section', next\)/);
  assert.match(detail, /<HomeFacts home=\{home\}/);
});

test('Tour Feedback never marks a home toured or records a reaction by itself', () => {
  assert.doesNotMatch(tour, /touredAt\s*:|reaction\s*:|applyPostTourVerdict|status:\s*'Toured'/);
  assert.match(tour, /onClick=\{onRecordTake\}>I’ve toured it — record my take/);
  assert.match(detail, /onRecordTake=\{\(\) => setReflecting\(true\)\}/);
  assert.match(detail, /!readOnly && reflecting && <PostTourModal/);
});

test('pros, cons and notes are edited in Tour Feedback; the workspace editor points there and keeps the fields intact', () => {
  assert.match(detail, /onSaveNotes=\{\(draft\) => saveWhole\(\{ \.\.\.home, \.\.\.draft \}\)\}/);
  assert.match(detail, /<HomeModal presentation="detail-panel" evaluationElsewhere initial=\{home\}/);
  assert.match(modal, /\{evaluationElsewhere && mode === 'edit' \? <section className="hh-edit-home-card flh-edit-elsewhere"/);
  // The form still saves every field (pros/cons/notes/checks included) unchanged.
  assert.match(modal, /await onSave\(\{ \.\.\.form, photoUrl: finalPhotoUrl/);
  // Add Home and the My Homes card editor are unchanged.
  assert.doesNotMatch(read('src/components/HomesBoard.jsx'), /evaluationElsewhere/);
});

test('Realtor view: read-only everywhere, reflections attributed to each buyer by name', () => {
  assert.match(realtorPage, /perspectiveName=\{owner\?\.display_name \|\| null\} coBuyerName=\{coBuyer\?\.display_name \|\| null\}/);
  assert.match(checkTheMatch, /const answerable = !readOnly && \['personal', 'shared', 'tour'\]\.includes\(source\);/);
  assert.match(checkTheMatch, /\{!readOnly && source === 'facts'/);
  assert.match(tour, /\{!readOnly && <div className="flh-tour-plans"/);
  assert.match(tour, /\{!readOnly && !editing && <button/);
  assert.match(tour, /const whose = readOnly \? `\$\{perspectiveName \|\| 'The buyer'\}’s` : 'Your';/);
});

/* ------------------------------- real Postgres ------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.evaluation@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.evaluation@example.com' });
  ids.realtor = db.createUser({ email: 'realtor.evaluation@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  for (const [email, role, user] of [['cobuyer.evaluation@example.com', 'co_buyer', ids.coBuyer], ['realtor.evaluation@example.com', 'realtor', ids.realtor]]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, email, role);
    assert.equal((await acceptInvitation(db.clientFor(user), invitation.token)).success, true);
  }
});
after(() => db?.drop());

const viewOf = async (user, homeId) => (await getHomesForUser(db.clientFor(user), user, ids.search)).find((home) => home.id === homeId);
const LEGACY = { pros: 'Big backyard, Quiet street', cons: 'Dated kitchen', notes: 'Ask about the roof age.' };
const office = { key: 'features:Home office', objective: true };

dbTest('saved Match answers persist per buyer; a co-buyer’s answers never overwrite the owner’s, and legacy notes survive', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '1 Evaluation Way', ...LEGACY }, ids.owner, ids.search);

  // Owner: Yes. Co-buyer: No. Exactly what Check the Match sends (answerPatch → saveHomePersonalState).
  const ownerView = await viewOf(ids.owner, home.id);
  await saveHomePersonalState(db.clientFor(ids.owner), { ...ownerView, ...answerPatch(ownerView, office, true, 'purchase').personal }, ids.owner, ids.search);
  const coView = await viewOf(ids.coBuyer, home.id);
  await saveHomePersonalState(db.clientFor(ids.coBuyer), { ...coView, ...answerPatch(coView, office, 'no', 'purchase').personal }, ids.coBuyer, ids.search);

  const ownerAfter = await viewOf(ids.owner, home.id);
  const coAfter = await viewOf(ids.coBuyer, home.id);
  assert.deepEqual(ownerAfter.checks, { 'features:Home office': true });
  assert.deepEqual(coAfter.checks, { 'features:Home office': 'no' });
  // Each buyer's Match uses their own answers (and their own priorities).
  const priorities = buy([['features', 'Home office', 'must']]);
  assert.equal(computeMatch(ownerAfter, priorities).pct, 100);
  assert.equal(computeMatch(coAfter, priorities).pct, 0);
  // Answering never touched the shared notes.
  for (const field of ['pros', 'cons', 'notes']) assert.equal(ownerAfter[field], LEGACY[field]);

  // Clearing back to Unknown persists as no answer at all.
  await saveHomePersonalState(db.clientFor(ids.owner), { ...ownerAfter, ...answerPatch(ownerAfter, office, undefined, 'purchase').personal }, ids.owner, ids.search);
  assert.deepEqual((await viewOf(ids.owner, home.id)).checks, {});
  assert.deepEqual((await viewOf(ids.coBuyer, home.id)).checks, { 'features:Home office': 'no' });
});

dbTest('a shared property-fact answer is one shared value both buyers see', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '2 Shared Fact Rd' }, ids.owner, ids.search);
  const coView = await viewOf(ids.coBuyer, home.id);
  await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), { ...coView, ...answerPatch(coView, { key: 'features:Pets Allowed', objective: true }, true).shared }, ids.coBuyer, ids.search);
  assert.equal((await viewOf(ids.owner, home.id)).petsAllowed, true);
  assert.deepEqual((await viewOf(ids.owner, home.id)).checks, {});
});

dbTest('recording a take persists tour status, reaction and survey answers per buyer, and appends to — never replaces — legacy notes', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '3 Toured Ct', ...LEGACY, status: 'Want to Tour' }, ids.owner, ids.search);
  const before = await viewOf(ids.owner, home.id);
  assert.equal(before.touredAt, null, 'nothing marks a home toured until a take is recorded');

  // Exactly HomeDetail.handleVerdict: a note entry changes shared notes → whole save.
  const next = applyPostTourVerdict(before, 'love', { ratings: { 'tour-v2:layout': 'positive', 'tour-v2:neighborhood': 'negative' }, noteEntry: 'Light was lovely.' }, '2026-10-11T15:00:00.000Z');
  await saveHomePersonalAndShared(db.clientFor(ids.owner), next, ids.owner, ids.search);

  const owner = await viewOf(ids.owner, home.id);
  assert.equal(owner.reaction, 'love');
  assert.ok(owner.touredAt);
  assert.deepEqual(owner.ratings, { 'tour-v2:layout': 'positive', 'tour-v2:neighborhood': 'negative' });
  assert.equal(owner.notes, 'Ask about the roof age.\n\nLight was lovely.');
  assert.equal(owner.pros, LEGACY.pros);
  assert.equal(owner.cons, LEGACY.cons);
  // The co-buyer's own take is untouched: still not toured, no reaction.
  const co = await viewOf(ids.coBuyer, home.id);
  assert.equal(co.touredAt, null);
  assert.equal(co.reaction, null);
  assert.deepEqual(co.ratings, {});
});

dbTest('editing pros and cons in Tour Feedback saves the shared notes and keeps every buyer’s personal state', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '4 Notes Ln', ...LEGACY, checks: { 'features:Home office': true } }, ids.owner, ids.search);
  const coView = await viewOf(ids.coBuyer, home.id);
  await saveHomePersonalState(db.clientFor(ids.coBuyer), { ...coView, checks: { 'features:Home office': 'no' }, reaction: 'considering' }, ids.coBuyer, ids.search);
  // Co-buyer edits pros (exactly TourFeedback → onSaveNotes → saveWhole).
  const fresh = await viewOf(ids.coBuyer, home.id);
  await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), { ...fresh, pros: `${LEGACY.pros}, Mature trees`, cons: fresh.cons, notes: fresh.notes }, ids.coBuyer, ids.search);
  const owner = await viewOf(ids.owner, home.id);
  assert.equal(owner.pros, 'Big backyard, Quiet street, Mature trees');
  assert.equal(owner.cons, LEGACY.cons);
  assert.equal(owner.notes, LEGACY.notes);
  assert.deepEqual(owner.checks, { 'features:Home office': true }, 'the owner’s answers are untouched');
  assert.equal((await viewOf(ids.coBuyer, home.id)).reaction, 'considering');
});

dbTest('a Realtor can read the search but cannot answer, record a take, or edit notes for a buyer', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '5 Realtor Row', ...LEGACY }, ids.owner, ids.search);
  const rejected = (error) => /row-level security|permission denied|expected one row|0 rows|JSON object requested|violates/i.test(error?.message || String(error));
  // Writing a buyer's personal row under the buyer's id is refused.
  await assert.rejects(db.clientFor(ids.realtor).from('home_member_state').upsert({ home_id: home.id, user_id: ids.owner, status: 'Toured', reaction: 'love', checks: { 'features:Home office': true }, ratings: {} }, { onConflict: 'home_id,user_id' }).then(({ error }) => { if (error) throw error; }), rejected);
  // Editing the shared notes is refused.
  await assert.rejects(saveHomePersonalAndShared(db.clientFor(ids.realtor), { ...home, pros: 'Realtor edit' }, ids.realtor, ids.search), rejected);
  const owner = await viewOf(ids.owner, home.id);
  assert.equal(owner.pros, LEGACY.pros);
  assert.equal(owner.reaction, null);
  assert.deepEqual(owner.checks, {});
});
