// Tour Feedback from #151, integrated onto the #152 workspace (Home Facts →
// Match Criteria → Tour Feedback). See docs/tour-feedback-integration.md.
//
// #152's Match Criteria stays the only place Match answers are given; #151's
// Check the Match page is not carried over. What came across: the redesigned
// Tour Feedback (saved reaction and survey shown, pre-tour notes, pros/cons
// edited in place), co-buyer / Realtor attribution, and the alias-safe Unknown
// answer. The guarantees that matter most are exercised against real Postgres.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { criterionAnswer, criterionAnswerPatch } = await import('../src/lib/matchCriteria.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { emptyHome, normalizePriorities, TOUR_RATING_KEY } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { applyPostTourVerdict } = await import('../src/lib/lifecycle.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const detail = read('src/components/HomeDetail.jsx');
const tour = read('src/components/TourFeedback.jsx');
const postTour = read('src/components/PostTourModal.jsx');
const realtorPage = read('src/app/(app)/people/[searchId]/homes/[homeId]/page.js');

const buy = (entries = []) => entries.reduce((priorities, [categoryKey, label, tier, kind = 'check']) => addCriterion(priorities, { categoryKey, label, kind }, tier), applySearchChoice(normalizePriorities({}), 'home_buy'));
const criterion = (match, key) => match.allSelected.find((item) => item.key === key);

/* ------------------------------- what was (not) carried over ------------------------------- */

test('#152 Match Criteria stays the Match screen; #151’s Check the Match page is not carried over', () => {
  assert.equal(existsSync(new URL('../src/components/CheckTheMatch.jsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/lib/matchReview.js', import.meta.url)), false);
  assert.match(detail, /key: 'match', label: 'Match Criteria'/);
  assert.match(detail, /<MatchCriteria home=\{home\}/);
  assert.doesNotMatch(detail + tour, /CheckTheMatch|Check the Match/);
  // Tour Feedback shows the take; it never answers a Match criterion.
  assert.doesNotMatch(tour, /onAnswer|criterionAnswerPatch|saveHomePersonal/);
});

/* ------------------------------- Match Criteria: alias-safe Unknown ------------------------------- */

test('Yes / No write only this buyer’s checks; Unknown removes the answer and never becomes No', () => {
  const home = { ...emptyHome(), checks: { 'exterior:Fenced yard': true }, pros: 'Big yard' };
  assert.deepEqual(criterionAnswerPatch(home, 'features:Home office', true, 'purchase'), { personal: { checks: { 'exterior:Fenced yard': true, 'features:Home office': true } } });
  assert.deepEqual(criterionAnswerPatch(home, 'features:Home office', 'no', 'purchase'), { personal: { checks: { 'exterior:Fenced yard': true, 'features:Home office': 'no' } } });
  const cleared = criterionAnswerPatch({ ...home, checks: { 'features:Home office': 'no' } }, 'features:Home office', undefined, 'purchase');
  assert.deepEqual(cleared, { personal: { checks: {} } });
  assert.equal('pros' in cleared.personal, false, 'a personal answer never carries shared fields');
});

test('choosing Unknown hides an older alias answer instead of letting it reappear (and keeps it stored)', () => {
  // 'features:Home Office' is the pre-taxonomy alias of 'features:Home office'.
  const home = { ...emptyHome(), checks: { 'features:Home Office': true, 'features:Home office': 'no' } };
  const { personal } = criterionAnswerPatch(home, 'features:Home office', undefined, 'purchase');
  assert.equal(personal.checks['features:Home office'], false, 'false is Match’s existing Unknown marker');
  assert.equal(personal.checks['features:Home Office'], true, 'the old answer is kept, not deleted');
  const after = computeMatch({ ...home, checks: personal.checks }, buy([['features', 'Home office', 'must']]));
  assert.equal(criterion(after, 'features:Home office').evaluated, false);
  // The radio shows Unknown, not a stale Yes and not "nothing checked".
  assert.equal(criterionAnswer({ checks: personal.checks }, 'features:Home office', 'purchase'), undefined);
  // Before this fix, deleting the key let the alias's Yes fold straight back in.
  const naive = { ...home.checks }; delete naive['features:Home office'];
  assert.equal(criterionAnswer({ checks: naive }, 'features:Home office', 'purchase'), true);
});

test('a historical boolean false reads as Unknown in Match Criteria, exactly as computeMatch scores it', () => {
  assert.equal(criterionAnswer({ checks: { 'features:Home office': false } }, 'features:Home office', 'purchase'), undefined);
  assert.equal(criterionAnswer({ checks: { 'features:Home office': true } }, 'features:Home office', 'purchase'), true);
  assert.equal(criterionAnswer({ checks: { 'features:Home office': 'no' } }, 'features:Home office', 'purchase'), 'no');
});

test('shared property facts (Pets / Utilities / In-Unit Laundry) still write the shared field', () => {
  assert.deepEqual(criterionAnswerPatch(emptyHome(), 'features:Pets Allowed', true), { shared: { petsAllowed: true } });
  assert.deepEqual(criterionAnswerPatch(emptyHome(), 'features:Pets Allowed', 'no'), { shared: { petsAllowed: false } });
  assert.deepEqual(criterionAnswerPatch(emptyHome(), 'features:Pets Allowed', undefined), { shared: { petsAllowed: null } });
  assert.match(detail, /return patch\.shared \? saveWhole\(\{ \.\.\.home, \.\.\.patch\.shared \}\) : savePersonal\(patch\.personal\);/);
});

/* ------------------------------- Tour Feedback: source guarantees ------------------------------- */

test('Tour Feedback shows the saved reaction and survey from the existing PostTourModal definitions', () => {
  assert.match(postTour, /export const POST_TOUR_VERDICTS = \[/);
  assert.match(postTour, /export const POST_TOUR_RESPONSES = \[/);
  assert.match(tour, /import \{ POST_TOUR_EVALUATIONS, POST_TOUR_RESPONSES, POST_TOUR_VERDICTS \} from '@\/components\/PostTourModal';/);
  assert.match(tour, /const verdict = POST_TOUR_VERDICTS\.find\(\(item\) => item\.key === postTourVerdict\(home\)\);/);
  assert.match(tour, /const survey = POST_TOUR_EVALUATIONS\.filter\(\(item\) => home\.ratings\?\.\[item\.key\]\)/);
  // Older overall-feeling stars still show.
  assert.match(tour, /const overall = home\.ratings\?\.\[TOUR_RATING_KEY\] \|\| 0;/);
});

test('Tour Feedback never marks a home toured or records a reaction by itself', () => {
  assert.doesNotMatch(tour, /touredAt\s*:|reaction\s*:|applyPostTourVerdict|status:\s*'Toured'/);
  assert.match(tour, /onClick=\{onRecordTake\}>I’ve toured it — record my take/);
  assert.match(detail, /onRecordTake=\{\(\) => setReflecting\(true\)\}/);
  assert.match(detail, /!readOnly && reflecting && <PostTourModal/);
});

test('pre-tour notes are labeled as notes, and pros / cons / notes save through the shared-home path', () => {
  assert.match(tour, /title=\{toured \? 'What stood out' : 'Notes so far'\}/);
  assert.match(tour, /these are notes, not tour feedback/);
  assert.match(detail, /onSaveNotes=\{\(draft\) => saveWhole\(\{ \.\.\.home, \.\.\.draft \}\)\}/);
  // A failed notes save keeps the draft open with an error, never a silent loss.
  assert.match(tour, /catch \{ setError\('We couldn’t save your notes\. Please try again — nothing you typed is lost\.'\); setSaving\(false\); \}/);
});

test('Realtor view: read-only, and each buyer’s take attributed by name', () => {
  assert.match(realtorPage, /perspectiveName=\{owner\?\.display_name \|\| null\} coBuyerName=\{coBuyer\?\.display_name \|\| null\}/);
  assert.match(tour, /\{!readOnly && <div className="flh-tour-plans"/);
  assert.match(tour, /\{!readOnly && !editing && <button/);
  assert.match(tour, /\{!readOnly && <button type="button" className="hh-btn hh-btn-ghost" onClick=\{onRecordTake\}>/);
  assert.match(tour, /const whose = readOnly \? `\$\{perspectiveName \|\| 'The buyer'\}’s` : 'Your';/);
  assert.match(tour, /coBuyerName \? `\$\{coBuyerName\}’s take` : 'Your co-buyer’s take'/);
  assert.match(detail, /coBuyerName \? `\$\{coBuyerName\}’s Match` : 'How your co-buyer sees this home'/);
});

/* ------------------------------- real Postgres ------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.tour@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.tour@example.com' });
  ids.realtor = db.createUser({ email: 'realtor.tour@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  for (const [email, role, user] of [['cobuyer.tour@example.com', 'co_buyer', ids.coBuyer], ['realtor.tour@example.com', 'realtor', ids.realtor]]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, email, role);
    assert.equal((await acceptInvitation(db.clientFor(user), invitation.token)).success, true);
  }
});
after(() => db?.drop());

const viewOf = async (user, homeId) => (await getHomesForUser(db.clientFor(user), user, ids.search)).find((home) => home.id === homeId);
const LEGACY = { pros: 'Big backyard, Quiet street', cons: 'Dated kitchen', notes: 'Ask about the roof age.' };

dbTest('Match Criteria answers persist per buyer; Unknown clears; a co-buyer never overwrites the owner; notes survive', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '1 Criteria Way', ...LEGACY }, ids.owner, ids.search);
  const ownerView = await viewOf(ids.owner, home.id);
  await saveHomePersonalState(db.clientFor(ids.owner), { ...ownerView, ...criterionAnswerPatch(ownerView, 'features:Home office', true, 'purchase').personal }, ids.owner, ids.search);
  const coView = await viewOf(ids.coBuyer, home.id);
  await saveHomePersonalState(db.clientFor(ids.coBuyer), { ...coView, ...criterionAnswerPatch(coView, 'features:Home office', 'no', 'purchase').personal }, ids.coBuyer, ids.search);

  const ownerAfter = await viewOf(ids.owner, home.id);
  assert.deepEqual(ownerAfter.checks, { 'features:Home office': true });
  assert.deepEqual((await viewOf(ids.coBuyer, home.id)).checks, { 'features:Home office': 'no' });
  for (const field of ['pros', 'cons', 'notes']) assert.equal(ownerAfter[field], LEGACY[field]);

  await saveHomePersonalState(db.clientFor(ids.owner), { ...ownerAfter, ...criterionAnswerPatch(ownerAfter, 'features:Home office', undefined, 'purchase').personal }, ids.owner, ids.search);
  assert.deepEqual((await viewOf(ids.owner, home.id)).checks, {});
  assert.deepEqual((await viewOf(ids.coBuyer, home.id)).checks, { 'features:Home office': 'no' });
});

dbTest('Unknown on an aliased answer persists as Unknown and keeps the old alias value stored', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '2 Alias Ave', checks: { 'features:Home Office': true } }, ids.owner, ids.search);
  const view = await viewOf(ids.owner, home.id);
  assert.equal(criterionAnswer(view, 'features:Home office', 'purchase'), true, 'the legacy answer folds in before');
  await saveHomePersonalState(db.clientFor(ids.owner), { ...view, ...criterionAnswerPatch(view, 'features:Home office', undefined, 'purchase').personal }, ids.owner, ids.search);
  const after = await viewOf(ids.owner, home.id);
  assert.deepEqual(after.checks, { 'features:Home Office': true, 'features:Home office': false });
  assert.equal(criterionAnswer(after, 'features:Home office', 'purchase'), undefined);
});

dbTest('recording a take persists toured, reaction and survey per buyer, and appends to — never replaces — legacy notes', async () => {
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
  const co = await viewOf(ids.coBuyer, home.id);
  assert.equal(co.touredAt, null);
  assert.equal(co.reaction, null);
  assert.deepEqual(co.ratings, {});
});

dbTest('older tour data (overall-feeling stars, in-person criteria responses) is kept when a new take is recorded', async () => {
  const legacyRatings = { [TOUR_RATING_KEY]: 4, 'homeFeel:Natural Light': 'positive' };
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '4 Legacy Tour Ln', ...LEGACY }, ids.owner, ids.search);
  const seeded = await viewOf(ids.owner, home.id);
  await saveHomePersonalState(db.clientFor(ids.owner), { ...seeded, status: 'Toured', touredAt: '2026-05-01T12:00:00.000Z', ratings: legacyRatings }, ids.owner, ids.search);
  const before = await viewOf(ids.owner, home.id);
  assert.deepEqual(before.ratings, legacyRatings);
  // PostTourModal starts from home.ratings, so an edited take carries older keys forward.
  const next = applyPostTourVerdict(before, 'considering', { ratings: { ...before.ratings, 'tour-v2:privacy': 'neutral' }, noteEntry: '' });
  await saveHomePersonalState(db.clientFor(ids.owner), next, ids.owner, ids.search);
  const after = await viewOf(ids.owner, home.id);
  assert.deepEqual(after.ratings, { ...legacyRatings, 'tour-v2:privacy': 'neutral' });
  assert.equal(after.touredAt, before.touredAt, 'the original tour date is kept');
  assert.equal(after.reaction, 'considering');
  for (const field of ['pros', 'cons', 'notes']) assert.equal(after[field], LEGACY[field]);
});

dbTest('editing pros and cons in Tour Feedback saves the shared notes and keeps every buyer’s personal state', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '5 Notes Ln', ...LEGACY, checks: { 'features:Home office': true } }, ids.owner, ids.search);
  const coView = await viewOf(ids.coBuyer, home.id);
  await saveHomePersonalState(db.clientFor(ids.coBuyer), { ...coView, checks: { 'features:Home office': 'no' }, reaction: 'considering' }, ids.coBuyer, ids.search);
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
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '6 Realtor Row', ...LEGACY }, ids.owner, ids.search);
  const rejected = (error) => /row-level security|permission denied|expected one row|0 rows|JSON object requested|violates/i.test(error?.message || String(error));
  await assert.rejects(db.clientFor(ids.realtor).from('home_member_state').upsert({ home_id: home.id, user_id: ids.owner, status: 'Toured', reaction: 'love', checks: { 'features:Home office': true }, ratings: {} }, { onConflict: 'home_id,user_id' }).then(({ error }) => { if (error) throw error; }), rejected);
  await assert.rejects(saveHomePersonalAndShared(db.clientFor(ids.realtor), { ...home, pros: 'Realtor edit' }, ids.realtor, ids.search), rejected);
  const owner = await viewOf(ids.owner, home.id);
  assert.equal(owner.pros, LEGACY.pros);
  assert.equal(owner.reaction, null);
  assert.deepEqual(owner.checks, {});
});
