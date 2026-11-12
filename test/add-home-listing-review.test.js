// Add Home V3, phase 2: one simple listing review (docs/add-home-v3-listing-review.md).
// Shared Home Facts from pasted listing text are one checklist (explicit facts
// start checked; a named school and a converted HOA fee start unchecked) with
// one Add N facts. Personal Match answers are never in that bulk action: the
// found card defers them to each buyer's own Match view, where they are rebuilt
// after saving from the saved listing snapshot, per viewer, and never written.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  applyHomeFactSuggestion, homeFactDisagreements, importResultWithHomeFacts, isPreselectedHomeFact, resuggestHomeFacts, suggestHomeFacts, undoHomeFactSuggestion,
} = await import('../src/lib/listingTextHomeFacts.js');
const { applyListingAnswer, listingTextEvidence, savedListingAnswers, suggestListingAnswers } = await import('../src/lib/listingTextAnswers.js');
const { emptyHome, normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/HomeModal.jsx');
const criteria = read('src/components/MatchCriteria.jsx');
const overlay = read('src/components/HomeOverlay.jsx');
const card = modal.match(/function ImportFoundCard[\s\S]*?\n\}/)[0];
const checklist = modal.match(/function HomeFactReview[\s\S]*?\n\}/)[0];

const TEXT = [
  'Finished walkout basement with rec room.',
  'Laundry on the main level.',
  'Primary suite on the first floor.',
  'Attached 2-car garage.',
  'HOA dues of $1,200 per year.',
  'Rochester Community Schools.',
  'Gas fireplace in the family room.',
  'Fully fenced backyard.',
].join(' ');

const select = (priorities, ...entries) => entries.reduce((next, [categoryKey, label, tier = 'important']) => addCriterion(next, { categoryKey, label, kind: 'check' }, tier), priorities);
const buyerPriorities = () => select(applySearchChoice(normalizePriorities({}), 'home_buy'), ['features', 'Fireplace', 'must'], ['exterior', 'Fenced yard'], ['features', 'Finished basement']);
const coBuyerPriorities = () => select(applySearchChoice(normalizePriorities({}), 'home_buy'), ['features', 'Fireplace']);

/* -------------------------------- the checklist -------------------------------- */

test('explicit facts start checked; a named school and a converted HOA fee start unchecked', () => {
  const byField = Object.fromEntries(suggestHomeFacts(TEXT, emptyHome()).map((item) => [item.field, item]));
  for (const field of ['basementCondition', 'basementStyle', 'laundryLocation', 'primaryBedroomLocation', 'garageType', 'garageSpaces']) {
    assert.equal(isPreselectedHomeFact(byField[field]), true, field);
  }
  assert.equal(byField.hoaFeeMonthly.converted, true);
  assert.equal(byField.hoaFeeMonthly.display, '$100/mo ($1,200 per year)');
  assert.equal(isPreselectedHomeFact(byField.hoaFeeMonthly), false);
  assert.equal(byField.schoolDistrict.school, true);
  assert.equal(isPreselectedHomeFact(byField.schoolDistrict), false);
  // A fee stated per month is explicit and starts checked.
  const monthly = suggestHomeFacts('HOA $85/month.', emptyHome())[0];
  assert.equal(monthly.converted, false);
  assert.equal(isPreselectedHomeFact(monthly), true);
  assert.equal(isPreselectedHomeFact(null), false);
});

test('Add N facts writes only the checked ones, only into empty fields; unchecked ones stay Unknown', () => {
  const suggestions = suggestHomeFacts(TEXT, emptyHome());
  // The default selection, minus one the buyer unchecked (laundry).
  const chosen = suggestions.filter((item) => isPreselectedHomeFact(item) && item.field !== 'laundryLocation');
  const home = chosen.reduce(applyHomeFactSuggestion, emptyHome());
  assert.equal(home.basementCondition, 'finished');
  assert.equal(home.primaryBedroomLocation, 'Main Floor');
  assert.equal(home.laundryLocation ?? null, null, 'unchecked stays Unknown');
  assert.equal(home.hoaFeeMonthly ?? null, null, 'the converted fee starts unchecked');
  assert.equal(home.schoolDistrict ?? null, null, 'the named district starts unchecked');
  // Never silently overwrites: an existing value, '0', 'none' and $0 are real answers.
  const existing = { ...emptyHome(), laundryLocation: 'basement', garageSpaces: '0', basementCondition: 'none', basementStyle: 'none', hoaFeeMonthly: 0 };
  const after = suggestions.reduce(applyHomeFactSuggestion, existing);
  assert.deepEqual([after.laundryLocation, after.garageSpaces, after.basementCondition, after.basementStyle, after.hoaFeeMonthly], ['basement', '0', 'none', 'none', 0]);
  // And the home's filled fields get no suggestion in the first place.
  assert.equal(suggestHomeFacts(TEXT, existing).some((item) => ['laundryLocation', 'garageSpaces', 'basementCondition', 'basementStyle', 'hoaFeeMonthly'].includes(item.field)), false);
});

test('conflicts are named, never resolved: existing values kept, contradictions and self-conflicts left Unknown', () => {
  const home = { ...emptyHome(), laundryLocation: 'basement', basementStyle: 'none' };
  const notes = homeFactDisagreements(TEXT, home);
  const of = (field) => notes.find((item) => item.field === field);
  assert.deepEqual([of('laundryLocation').kind, of('laundryLocation').listing, of('laundryLocation').current], ['differs', 'First floor', 'Basement']);
  assert.equal(of('basementCondition').kind, 'contradicts', 'finished basement vs "no basement" on the home');
  assert.deepEqual(homeFactDisagreements('HOA $85/month. HOA $95/month.', emptyHome()).map((item) => [item.field, item.kind]), [['hoaFeeMonthly', 'unclear']]);
  assert.deepEqual(homeFactDisagreements('Attached 2-car garage and a detached garage.', emptyHome()).map((item) => item.kind), ['unclear']);
  assert.deepEqual(homeFactDisagreements('No basement. Finished walkout basement.', emptyHome()).map((item) => item.kind), ['unclear']);
  // Nothing to say when the text agrees with the home or is silent.
  assert.deepEqual(homeFactDisagreements('Laundry on the main level.', { ...emptyHome(), laundryLocation: 'first_floor' }), []);
  assert.deepEqual(homeFactDisagreements('Lovely home.', emptyHome()), []);
  // Self-conflicts and contradictions produce no suggestion either.
  assert.deepEqual(suggestHomeFacts('HOA $85/month. HOA $95/month.', emptyHome()), []);
  assert.equal(suggestHomeFacts(TEXT, home).some((item) => item.field.startsWith('basement')), false);
});

test('hedged, community and ambiguous wording stays Unknown (no row in the checklist)', () => {
  for (const text of ['Basement could be finished.', 'Community pool and fenced dog park.', 'Laundry hookups in basement.', 'Voluntary HOA, approximately $50/month.', 'Bedroom on the main level.', 'Top-rated schools nearby.']) {
    assert.deepEqual(suggestHomeFacts(text, emptyHome()).map((item) => item.field), [], text);
  }
});

test('Undo and a repeated paste touch only what a suggestion wrote; a typed value is never reverted', () => {
  const suggestions = suggestHomeFacts(TEXT, emptyHome());
  const laundry = suggestions.find((item) => item.field === 'laundryLocation');
  const used = { [laundry.id]: laundry };
  const applied = applyHomeFactSuggestion(emptyHome(), laundry);
  assert.equal(undoHomeFactSuggestion(applied, laundry).laundryLocation, null);
  assert.equal(undoHomeFactSuggestion({ ...applied, laundryLocation: 'second_floor' }, laundry).laundryLocation, 'second_floor');
  // Re-pasting text that leaves it out keeps it: the buyer accepted it (still owned, so Undo works).
  const rerun = resuggestHomeFacts('Gas fireplace in the family room.', applied, used);
  assert.equal(rerun.home.laundryLocation, 'first_floor');
  assert.deepEqual(rerun.cleared, []);
  assert.ok(rerun.used[laundry.id] && rerun.suggestions.some((item) => item.id === laundry.id));
  // Text that says something else keeps it too, and names the disagreement read-only.
  const other = resuggestHomeFacts('Laundry in the basement.', applied, used);
  assert.equal(other.home.laundryLocation, 'first_floor');
  assert.equal(other.suggestions.some((item) => item.field === 'laundryLocation' && item.value === 'basement'), false);
  assert.deepEqual(homeFactDisagreements('Laundry in the basement.', applied).map((item) => [item.field, item.kind, item.listing]), [['laundryLocation', 'differs', 'Basement']]);
  // A used fact the buyer then edited is theirs: no longer tracked, never reverted.
  const edited = resuggestHomeFacts(TEXT, { ...applied, laundryLocation: 'second_floor' }, used);
  assert.equal(edited.home.laundryLocation, 'second_floor');
  assert.equal(edited.used[laundry.id], undefined);
});

test('provenance: added facts join the snapshot with their sentences; unchecked ones never do', () => {
  const suggestions = suggestHomeFacts(TEXT, emptyHome());
  const chosen = suggestions.filter(isPreselectedHomeFact);
  const home = chosen.reduce(applyHomeFactSuggestion, emptyHome());
  const used = Object.fromEntries(chosen.map((item) => [item.id, item]));
  const snapshot = listingImportSnapshot(importResultWithHomeFacts({ source: 'raw-text', fields: {}, listingFacts: [], descriptionFeatures: listingTextEvidence(TEXT) }, used, home), 'x');
  assert.equal(snapshot.source, 'pasted_text');
  assert.deepEqual(snapshot.pastedFacts.map((item) => item.field).sort(), chosen.map((item) => item.field).sort());
  assert.ok(snapshot.pastedFacts.every((item) => item.evidence && item.sourceProvider === 'user_paste'));
  assert.equal('hoaFeeMonthly' in snapshot.fields, false);
  assert.equal('schoolDistrict' in snapshot.fields, false);
  // The personal-answer evidence is kept for later (descriptionFeatures), with no buyer's answers in it.
  assert.ok(snapshot.descriptionFeatures.some((item) => item.concept === 'fireplace' && item.stated === 'yes'));
  assert.doesNotMatch(JSON.stringify(snapshot), /"checks"|features:Fireplace/);
});

/* ------------------------- deferred personal Match answers ------------------------- */

test('saved evidence gives back the same possible answers, for this buyer only, without re-pasting', () => {
  const priorities = buyerPriorities();
  const snapshot = { descriptionFeatures: listingTextEvidence(TEXT) };
  const fromText = suggestListingAnswers(TEXT, priorities, {}).map((item) => [item.key, item.answer]).sort();
  const fromSaved = savedListingAnswers(snapshot, priorities, {}).map((item) => [item.key, item.answer]).sort();
  assert.deepEqual(fromSaved, fromText);
  assert.deepEqual(fromSaved.map(([key]) => key), ['exterior:Fenced yard', 'features:Finished basement', 'features:Fireplace']);
  // A co-buyer with other priorities sees only their own criteria.
  assert.deepEqual(savedListingAnswers(snapshot, coBuyerPriorities(), {}).map((item) => item.key), ['features:Fireplace']);
});

test('an answer the buyer gave always wins; Unknown stays Unknown; nothing is written', () => {
  const priorities = buyerPriorities();
  const snapshot = { descriptionFeatures: listingTextEvidence(TEXT) };
  // Yes or No already given: no suggestion for it.
  assert.equal(savedListingAnswers(snapshot, priorities, { 'features:Fireplace': 'no' }).some((item) => item.key === 'features:Fireplace'), false);
  assert.equal(savedListingAnswers(snapshot, priorities, { 'features:Fireplace': true }).some((item) => item.key === 'features:Fireplace'), false);
  // Historical false is Unknown (as Match reads it), so the suggestion still shows.
  assert.equal(savedListingAnswers(snapshot, priorities, { 'features:Fireplace': false }).some((item) => item.key === 'features:Fireplace'), true);
  // Reading suggestions never changes the checks, and Match is unchanged until the buyer answers.
  const checks = Object.freeze({});
  const home = { ...emptyHome(), checks, listingImport: snapshot };
  const before = computeMatch(home, priorities);
  savedListingAnswers(snapshot, priorities, checks);
  assert.deepEqual(computeMatch(home, priorities), before);
  assert.equal(before.allSelected.find((item) => item.key === 'features:Fireplace').evaluated, false, 'Unknown, not No');
});

test('saved evidence is read defensively: conflicts, other sources, duplicates and parking No', () => {
  const priorities = select(buyerPriorities(), ['exterior', 'Parking']);
  const fire = (stated, sentence = 'Gas fireplace.') => ({ concept: 'fireplace', stated, evidence: sentence, sourceProvider: 'user_paste' });
  assert.equal(savedListingAnswers({ descriptionFeatures: [fire('yes'), fire('no')] }, priorities, {}).some((item) => item.key === 'features:Fireplace'), false, 'two stated answers: nothing');
  assert.equal(savedListingAnswers({ descriptionFeatures: [fire('yes'), fire('yes', 'Wood fireplace.')] }, priorities, {}).filter((item) => item.key === 'features:Fireplace').length, 1, 'duplicates: one');
  assert.deepEqual(savedListingAnswers({ descriptionFeatures: [{ ...fire('yes'), sourceProvider: 'rentcast' }] }, priorities, {}), []);
  assert.deepEqual(savedListingAnswers({ descriptionFeatures: [{ concept: 'fireplace', stated: 'conflict', evidence: 'x', sourceProvider: 'user_paste' }] }, priorities, {}), []);
  assert.deepEqual(savedListingAnswers({ descriptionFeatures: [{ concept: 'notAConcept', stated: 'yes', evidence: 'x', sourceProvider: 'user_paste' }] }, priorities, {}), []);
  assert.deepEqual(savedListingAnswers(null, priorities, {}), []);
  assert.deepEqual(savedListingAnswers({ descriptionFeatures: listingTextEvidence(TEXT) }, null, {}), []);
  // Without the full text, a No for Parking is never offered from saved evidence.
  const parking = listingTextEvidence('Street parking only. No driveway.');
  assert.equal(savedListingAnswers({ descriptionFeatures: parking }, priorities, {}).some((item) => item.key === 'exterior:Parking' && item.answer === 'no'), false);
});

/* ------------------------------------ wiring ------------------------------------ */

test('the found card shows one shared checklist and defers personal answers; the Save Home order is unchanged', () => {
  assert.doesNotMatch(card, /<ListingAnswerReview/, 'no personal review on the card');
  const at = (needle) => card.indexOf(needle);
  const order = ['className="hh-btn flh-found-add"', '<ListingDetailsPaste paste={paste} />', '<HomeFactReview review={factReview} />', '<DeferredAnswersNote', 'className="hh-details flh-found-notes"'].map(at);
  assert.ok(order.every((index) => index > 0), `missing: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // The folded paste's count is shared facts only.
  assert.match(card, /const pending = factReview \? factReview\.suggestions\.filter\(\(item\) => factReview\.decisions\[item\.id\] !== 'used'\)\.length : 0;/);
  assert.match(modal, /const personalDeferred = importLanding && !initial\.address && !vocabulary\.apartment;/);
  assert.match(modal, /const pending = personalDeferred \? 0 : visiblePersonalSuggestions/);
  assert.match(modal, /That’s for your own Match, so nothing is answered here: after you save/);
  // The full editor (apartments, Edit Home, Realtor suggestions) keeps its own Match step review.
  assert.match(modal, /<ListingAnswerReview review=\{answerReview\} \/>/);
});

test('the checklist: field and value, the sentence on demand, deselectable, one Add N facts, Undo, not-changed notes', () => {
  // Rows and the Add button are the shared FactChecklist (one implementation for Add Home and the later review).
  const shared = read('src/components/FactChecklist.jsx');
  assert.match(checklist, /<FactChecklistRows suggestions=\{pending\} isSelected=\{isSelected\} onToggle=\{onToggle\}/);
  assert.match(checklist, /<AddFactsButton chosen=\{chosen\} onAdd=\{onAddSelected\} \/>/);
  assert.match(shared, /<input type="checkbox" checked=\{selected\} onChange=\{\(\) => onToggle\(suggestion\)\} \/>/);
  assert.match(shared, /<b>\{suggestion\.label\}<\/b><span className="flh-fact-check-value">\{suggestion\.display \|\| String\(suggestion\.value\)\}<\/span>/);
  assert.match(shared, /<details className="flh-fact-why"><summary>Why\?<\/summary><blockquote><span>“\{suggestion\.evidence\}”<\/span>/);
  assert.match(shared, /onClick=\{\(\) => onAdd\(chosen\)\} disabled=\{!chosen\.length\}/);
  assert.match(shared, /Add \{chosen\.length\} fact\{chosen\.length === 1 \? '' : 's'\}/);
  assert.match(checklist, /onClick=\{\(\) => onUndo\(suggestion\)\}/);
  assert.match(shared, /FLH hasn’t verified it or checked school boundaries\./);
  assert.match(checklist, /this home has <b>\{item\.current\}<\/b>\. Kept as is\./);
  // Selection: checked by the buyer, or by default when preselected; unchecking is the old Skip.
  assert.match(modal, /const isFactSelected = \(suggestion\) => factDecisions\[suggestion\.id\] === 'selected'\s*\|\| \(factDecisions\[suggestion\.id\] === undefined && isPreselectedHomeFact\(suggestion\)\);/);
  assert.match(modal, /isFactSelected\(suggestion\) \? 'skipped' : 'selected'/);
  // Add N facts is the existing guarded writer: empty fields only, form only, no save.
  const add = modal.match(/const useAllFacts = \(pending\) => \{[\s\S]*?\n {2}\};/)[0];
  assert.match(add, /applyHomeFactSuggestion\(next, suggestion\)/);
  assert.doesNotMatch(add, /onSave|createClient|fetch\(|submit\(|checks/);
});

test('Match view: the hint shows only on this buyer’s unanswered, non-fact criteria, and never answers', () => {
  assert.match(overlay, /const listingAnswers = savedListingAnswers\(home\.listingImport, priorities, home\.checks\);/);
  assert.match(overlay, /listingAnswers=\{listingAnswers\}/);
  assert.match(criteria, /const hint = canAnswer && !readOnly && own === undefined && !factBacked \? listingHints\.get\(item\.key\) : null;/);
  const hint = criteria.match(/function ListingHint[\s\S]*?\n\}/)[0];
  assert.match(hint, /Listing suggests/);
  assert.match(hint, /Choose Yes or No yourself\./);
  assert.doesNotMatch(hint, /onAnswer|onChange|checks/);
});

/* --------------------------------- real Postgres --------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.listingreview@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.listingreview@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.listingreview@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('saved: checked facts shared with provenance; each buyer’s deferred answers come back from the snapshot and stay their own', async () => {
  const suggestions = suggestHomeFacts(TEXT, emptyHome());
  const chosen = suggestions.filter(isPreselectedHomeFact);
  const form = { ...chosen.reduce(applyHomeFactSuggestion, emptyHome()), address: '12 Review Way, Testville, MI 48000' };
  const used = Object.fromEntries(chosen.map((item) => [item.id, item]));
  const listingImport = listingImportSnapshot(importResultWithHomeFacts({ source: 'raw-text', fields: {}, listingFacts: [], descriptionFeatures: listingTextEvidence(TEXT) }, used, form), 'x');
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...form, listingImport }, ids.owner, ids.search);
  const row = db.admin(`select basement_condition, laundry_location, hoa_fee_monthly, school_district, listing_import from public.homes where id = '${saved.id}'`)[0];
  assert.deepEqual([row.basement_condition, row.laundry_location, row.hoa_fee_monthly, row.school_district], ['finished', 'first_floor', null, null]);
  assert.ok(row.listing_import.pastedFacts.length === chosen.length && row.listing_import.descriptionFeatures.length > 0);
  // No personal answer was written for anyone.
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${saved.id}' and checks <> '{}'::jsonb`)[0].n, 0);

  // The co-buyer sees the shared facts and, from the same snapshot, only their own possible answers.
  const asCoBuyer = (await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search)).find((home) => home.id === saved.id);
  assert.equal(asCoBuyer.basementCondition, 'finished');
  assert.deepEqual(savedListingAnswers(asCoBuyer.listingImport, coBuyerPriorities(), asCoBuyer.checks).map((item) => item.key), ['features:Fireplace']);

  // The owner answers Fireplace No themselves (their override): their suggestion goes away, the co-buyer's stays.
  const asOwner = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).find((home) => home.id === saved.id);
  const ownerSuggestion = savedListingAnswers(asOwner.listingImport, buyerPriorities(), asOwner.checks).find((item) => item.key === 'features:Fireplace');
  assert.equal(ownerSuggestion.answer, true);
  await saveHomePersonalState(db.clientFor(ids.owner), { ...asOwner, checks: { ...(asOwner.checks || {}), 'features:Fireplace': 'no' } }, ids.owner, ids.search);
  const ownerAfter = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).find((home) => home.id === saved.id);
  assert.equal(ownerAfter.checks['features:Fireplace'], 'no', 'the buyer’s own No wins over the listing');
  assert.equal(savedListingAnswers(ownerAfter.listingImport, buyerPriorities(), ownerAfter.checks).some((item) => item.key === 'features:Fireplace'), false);
  const coBuyerAfter = (await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search)).find((home) => home.id === saved.id);
  assert.equal(coBuyerAfter.checks?.['features:Fireplace'], undefined, 'the co-buyer’s answers are untouched');
  assert.deepEqual(savedListingAnswers(coBuyerAfter.listingImport, coBuyerPriorities(), coBuyerAfter.checks).map((item) => item.key), ['features:Fireplace']);
  // Confirming through the existing writer touches only that buyer's checks.
  assert.deepEqual(applyListingAnswer(coBuyerAfter.checks, ownerSuggestion, 'home_buy'), { ...(coBuyerAfter.checks || {}), 'features:Fireplace': true });
});
