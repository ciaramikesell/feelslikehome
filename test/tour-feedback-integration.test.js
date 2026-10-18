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
const { criterionAnswer, criterionAnswerPatch, inPersonAnswer, inPersonAnswerPatch, inPersonCriteria } = await import('../src/lib/matchCriteria.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { emptyHome, normalizePriorities, TIER_META, TOUR_RATING_KEY } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { applyPostTourVerdict } = await import('../src/lib/lifecycle.js');
const { freeformText, noteFieldCount } = await import('../src/lib/homeDisplay.js');
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
  // Tour Feedback answers only in-person criteria (onAnswerInPerson); Yes / No checks stay in Match Criteria.
  assert.doesNotMatch(tour, /criterionAnswerPatch|criterionAnswer\b|saveHomePersonal|MatchCriteria/);
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

/* ------------------------------- Things to check in person ------------------------------- */

// In-person criteria are active in rental searches, and in purchase searches only
// where the buyer created them as custom priorities (the purchase built-ins are
// retired; see RETIRED_PURCHASE_BUILT_INS). A rental search with two of them:
const inPersonSearch = () => normalizePriorities({
  searchType: 'rental',
  homeFeel: { tiers: { 'Natural Light': 'must' }, customItems: [{ label: 'Natural Light', kind: 'rating' }] },
  exterior: { tiers: { 'Noise Level': 'nice' }, customItems: [{ label: 'Noise Level', kind: 'rating' }] },
  features: { tiers: { Fireplace: 'important' }, customItems: [{ label: 'Fireplace', kind: 'check' }] },
});

test('the scorer reads in-person answers from this buyer’s ratings[key] with the existing weights (unchanged)', () => {
  const priorities = inPersonSearch();
  const score = (ratings, checks = {}) => computeMatch({ ...emptyHome(), ratings, checks }, priorities);
  // Unknown: nothing evaluated → no score.
  assert.equal(score({}).pct, null);
  assert.equal(criterion(score({}), 'homeFeel:Natural Light').evaluated, false);
  // positive → 1, negative → 0, weighted Must 4 / Nice 1.
  assert.equal(TIER_META.must.weight, 4); assert.equal(TIER_META.nice.weight, 1);
  assert.equal(score({ 'homeFeel:Natural Light': 'positive', 'exterior:Noise Level': 'negative' }).pct, 80);
  assert.equal(score({ 'homeFeel:Natural Light': 'negative', 'exterior:Noise Level': 'positive' }).pct, 20);
  // neutral is answered but not scored.
  const neutral = score({ 'homeFeel:Natural Light': 'neutral', 'exterior:Noise Level': 'positive' });
  assert.equal(criterion(neutral, 'homeFeel:Natural Light').evaluated, true);
  assert.equal(criterion(neutral, 'homeFeel:Natural Light').met, null);
  assert.equal(neutral.pct, 100);
  // An older 1–5 rating keeps its established score.
  assert.equal(score({ 'homeFeel:Natural Light': 4 }).pct, 80);
  // The post-tour survey and overall feeling are not Match criteria.
  assert.equal(score({ 'tour-v2:layout': 'negative', [TOUR_RATING_KEY]: 1 }).pct, null);
});

test('only selected in-person criteria are listed — no survey questions, no checks, no duplicates', () => {
  const match = computeMatch({ ...emptyHome() }, inPersonSearch());
  assert.deepEqual(inPersonCriteria(match).map((item) => item.key).sort(), ['exterior:Noise Level', 'homeFeel:Natural Light']);
  assert.equal(new Set(match.allSelected.map((item) => item.key)).size, match.allSelected.length, 'no duplicate criteria');
  assert.deepEqual(inPersonCriteria(null), []);
  // An older purchase search keeps its custom in-person priorities; retired built-ins never appear.
  const purchase = normalizePriorities({ searchType: 'purchase', exterior: { tiers: { 'Noise Level': 'important', 'Curb Appeal': 'nice' }, customItems: [{ label: 'Noise Level', kind: 'rating', source: 'custom' }, { label: 'Curb Appeal', kind: 'rating' }] } });
  assert.deepEqual(inPersonCriteria(computeMatch({ ...emptyHome() }, purchase)).map((item) => item.key), ['exterior:Noise Level']);
});

test('an in-person answer changes only that one key of this buyer’s ratings; Unknown removes it', () => {
  const home = { ...emptyHome(), reaction: 'love', touredAt: '2026-10-01T00:00:00Z', status: 'Toured', notes: 'n', pros: 'Bright, open living room', ratings: { 'tour-v2:layout': 'positive', [TOUR_RATING_KEY]: 4 }, checks: { 'features:Fireplace': true } };
  const patch = inPersonAnswerPatch(home, 'homeFeel:Natural Light', 'neutral');
  assert.deepEqual(Object.keys(patch), ['ratings'], 'nothing but ratings travels in the patch');
  assert.deepEqual(patch.ratings, { 'tour-v2:layout': 'positive', [TOUR_RATING_KEY]: 4, 'homeFeel:Natural Light': 'neutral' });
  assert.deepEqual(inPersonAnswerPatch({ ...home, ratings: patch.ratings }, 'homeFeel:Natural Light', undefined).ratings, { 'tour-v2:layout': 'positive', [TOUR_RATING_KEY]: 4 });
  assert.equal(inPersonAnswer({ ratings: { 'homeFeel:Natural Light': 'positive' } }, 'homeFeel:Natural Light'), 'positive');
  assert.equal(inPersonAnswer({ ratings: { 'homeFeel:Natural Light': 4 } }, 'homeFeel:Natural Light'), undefined, 'an older numeric rating is not a current answer');
  assert.match(detail, /const answerInPerson = \(item, next\) => savePersonal\(inPersonAnswerPatch\(home, item\.key, next\)\);/);
  assert.match(detail, /onAnswerInPerson=\{answerInPerson\}/);
});

test('answering in person never reads as a tour or a recorded take; the survey stays separate', () => {
  assert.match(tour, /const hasTake = Boolean\(verdict \|\| overall > 0 \|\| survey\.length\);/);
  assert.match(tour, /<h3 id="tour-in-person-checks-title" className="hh-serif">Things to check in person<\/h3>/);
  assert.match(tour, /\{readOnly\s*\? <span className=\{`flh-mc-readonly/);
  // On the home overlay an after-tour criterion only points to Tour Feedback.
  assert.match(read('src/components/MatchCriteria.jsx'), /else if \(isAfterTour\(item\) && tourHref\) source = <a className="flh-mc2-source" href=\{tourHref\}>After tour/);
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

test('pros and cons are shown exactly as written, never split on commas', () => {
  assert.doesNotMatch(tour, /parseCommaList/);
  assert.match(tour, /\{pros \? <p>\{pros\}<\/p>/);
  assert.match(tour, /\{cons \? <p>\{cons\}<\/p>/);
});

test('freeform pros / cons keep every phrase intact, and the My Homes notes count is one per field', () => {
  // Shown verbatim (trimmed only), commas and line breaks included.
  assert.equal(freeformText('  Bright, open living room, Huge backyard \n'), 'Bright, open living room, Huge backyard');
  assert.equal(freeformText('Kitchen feels dated,\nBusy road'), 'Kitchen feels dated,\nBusy road');
  assert.equal(freeformText(null), '');
  assert.equal(freeformText(undefined), '');
  // "Bright, open living room" is one written pro, not two notes.
  assert.equal(noteFieldCount({ pros: 'Bright, open living room' }), 1);
  assert.equal(noteFieldCount({ pros: 'Bright, open living room, Huge backyard', cons: 'Busy road', notes: 'Ask about the roof.', conditionNotes: '' }), 3);
  assert.equal(noteFieldCount({ pros: '   ', cons: null }), 0);
});

test('My Homes cards and Compare show pros / cons as written: no comma splitting anywhere', () => {
  const cards = read('src/components/HomesBoard.jsx');
  const compare = read('src/components/CompareBoard.jsx');
  const display = read('src/lib/homeDisplay.js');
  for (const source of [cards, compare, tour, display]) assert.doesNotMatch(source, /parseCommaList|split\(','\)/);
  assert.match(cards, /const noteCount = noteFieldCount\(home\);/);
  assert.match(compare, /const liked = freeformText\(h\.pros\);/);
  assert.match(compare, /<strong style=\{\{ color: 'var\(--moss\)' \}\}>Liked: <\/strong>\{liked\}<\/div>/);
  assert.match(compare, /<strong style=\{\{ color: 'var\(--brick\)' \}\}>Didn't like: <\/strong>\{disliked\}<\/div>/);
  assert.match(read('src/app/globals.css'), /\.hh-compare-freeform \{ white-space: pre-wrap; overflow-wrap: anywhere; \}/);
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
  // The Realtor never sees "Your take" as the page eyebrow; it names the buyers.
  assert.match(detail, /const eyebrow = readOnly && section === 'tour' \? \(\[perspectiveName, coBuyerName\]\.filter\(Boolean\)\.join\(' & '\) \|\| 'The buyers'\) : sectionMeta\.eyebrow;/);
  // Realtor notes are labeled as shared; private client notes are elsewhere.
  assert.match(read('src/components/RealtorContributions.jsx'), /Your private client notes stay in My Clients\./);
  assert.doesNotMatch(tour + detail, /ClientPrivateNotes|client_records/);
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

dbTest('in-person answers save to this buyer only, show in Match at once, and never touch the take, survey, notes or tour state', async () => {
  const priorities = inPersonSearch();
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '7 In Person Pl', ...LEGACY }, ids.owner, ids.search);
  // A recorded take first (reaction, survey, overall, note), then the co-buyer's own answer.
  const seeded = await viewOf(ids.owner, home.id);
  await saveHomePersonalState(db.clientFor(ids.owner), { ...seeded, status: 'Toured', touredAt: '2026-10-05T12:00:00.000Z', reaction: 'love', ratings: { 'tour-v2:layout': 'positive', [TOUR_RATING_KEY]: 4 } }, ids.owner, ids.search);
  const coSeed = await viewOf(ids.coBuyer, home.id);
  await saveHomePersonalState(db.clientFor(ids.coBuyer), { ...coSeed, ...inPersonAnswerPatch(coSeed, 'homeFeel:Natural Light', 'negative') }, ids.coBuyer, ids.search);
  const before = await viewOf(ids.owner, home.id);

  // Exactly HomeDetail.answerInPerson → savePersonal (personal path).
  await saveHomePersonalState(db.clientFor(ids.owner), { ...before, ...inPersonAnswerPatch(before, 'homeFeel:Natural Light', 'positive') }, ids.owner, ids.search);
  let owner = await viewOf(ids.owner, home.id);
  assert.deepEqual(owner.ratings, { 'tour-v2:layout': 'positive', [TOUR_RATING_KEY]: 4, 'homeFeel:Natural Light': 'positive' });
  for (const field of ['reaction', 'touredAt', 'status']) assert.equal(owner[field], before[field], `${field} changed`);
  for (const field of ['pros', 'cons', 'notes']) assert.equal(owner[field], LEGACY[field]);
  assert.equal(criterion(computeMatch(owner, priorities), 'homeFeel:Natural Light').met, true, 'Match reads the answer');

  // Change it, then clear it back to Unknown.
  await saveHomePersonalState(db.clientFor(ids.owner), { ...owner, ...inPersonAnswerPatch(owner, 'homeFeel:Natural Light', 'neutral') }, ids.owner, ids.search);
  owner = await viewOf(ids.owner, home.id);
  assert.equal(owner.ratings['homeFeel:Natural Light'], 'neutral');
  await saveHomePersonalState(db.clientFor(ids.owner), { ...owner, ...inPersonAnswerPatch(owner, 'homeFeel:Natural Light', undefined) }, ids.owner, ids.search);
  owner = await viewOf(ids.owner, home.id);
  assert.deepEqual(owner.ratings, { 'tour-v2:layout': 'positive', [TOUR_RATING_KEY]: 4 });
  assert.equal(criterion(computeMatch(owner, priorities), 'homeFeel:Natural Light').evaluated, false);
  assert.equal(owner.reaction, 'love');

  // The co-buyer's own answer was never touched.
  const co = await viewOf(ids.coBuyer, home.id);
  assert.deepEqual(co.ratings, { 'homeFeel:Natural Light': 'negative' });
  assert.equal(co.touredAt, null);
});

dbTest('answering in person before a tour does not mark the home toured or add a reaction', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '8 Not Yet Toured Rd', ...LEGACY, status: 'Want to Tour' }, ids.owner, ids.search);
  const before = await viewOf(ids.owner, home.id);
  await saveHomePersonalState(db.clientFor(ids.owner), { ...before, ...inPersonAnswerPatch(before, 'exterior:Noise Level', 'negative') }, ids.owner, ids.search);
  const after = await viewOf(ids.owner, home.id);
  assert.equal(after.touredAt, null);
  assert.equal(after.status, 'Want to Tour');
  assert.equal(after.reaction, null);
  assert.deepEqual(after.ratings, { 'exterior:Noise Level': 'negative' });
});

dbTest('a Realtor cannot write a buyer’s in-person answer', async () => {
  const home = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '9 Realtor Read Ln' }, ids.owner, ids.search);
  const rejected = (error) => /row-level security|permission denied|violates/i.test(error?.message || String(error));
  await assert.rejects(db.clientFor(ids.realtor).from('home_member_state').upsert({ home_id: home.id, user_id: ids.owner, status: 'Saved', ratings: { 'homeFeel:Natural Light': 'positive' }, checks: {} }, { onConflict: 'home_id,user_id' }).then(({ error }) => { if (error) throw error; }), rejected);
  assert.deepEqual((await viewOf(ids.owner, home.id)).ratings, {});
});
