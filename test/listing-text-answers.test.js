// Suggested Match answers from pasted listing text (src/lib/listingTextAnswers.js).
// Pasted text never writes a buyer's answer: it produces evidence-backed
// suggestions, and only a confirmed one becomes the viewing buyer's own Yes / No.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyListingAnswer, classifyListingText, criterionConcept, hasRecordedAnswer, listingTextEvidence,
  resuggestListingAnswers, suggestListingAnswers, undoListingAnswer,
} from '../src/lib/listingTextAnswers.js';
import * as importReview from '../src/lib/importReview.js';
import { computeMatch } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';
import { switchSearchType } from '../src/lib/whatMattersCatalog.js';
import { listingImportSnapshot } from '../src/lib/importSnapshot.js';
import { IMPORT_DESTINATIONS } from '../src/lib/importDomain.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const start = (type) => switchSearchType(normalizePriorities({}), type).priorities;
const select = (priorities, ...entries) => entries.reduce((next, [categoryKey, label, tier = 'important']) => addCriterion(next, { categoryKey, label, kind: 'check' }, tier), priorities);
const stated = (text) => Object.fromEntries(classifyListingText(text).map((item) => [item.concept, item.answer]));
const answers = (text, priorities, checks = {}) => Object.fromEntries(suggestListingAnswers(text, priorities, checks).map((item) => [item.key, item.answer]));

// A Home to Buy search with every criterion this PR reads, under today's labels.
const buyer = select(start('home_buy'),
  ['features', 'Finished basement'], ['features', 'Walkout basement'], ['features', 'Fireplace'], ['features', 'Central air'],
  ['features', 'Home office'], ['features', 'Primary ensuite'], ['features', 'First-floor laundry'], ['features', 'Second-Floor Laundry'],
  ['features', 'First-Floor Bedroom'], ['features', 'First-Floor Primary'], ['features', 'Walk-in Pantry'],
  ['exterior', 'Pool'], ['exterior', 'Fenced yard'], ['exterior', 'Privacy Fencing'], ['exterior', 'Patio / deck'], ['exterior', 'Garage'],
);

/* ----------------------------- The reported bug ----------------------------- */

test('"Does not have a finished basement" is never Yes; it suggests No with its sentence', () => {
  const [suggestion] = suggestListingAnswers('Does not have a finished basement.', buyer);
  assert.equal(suggestion.key, 'features:Finished basement');
  assert.equal(suggestion.answer, 'no');
  assert.equal(suggestion.evidence, 'Does not have a finished basement.');
  for (const text of ["The home doesn't have a finished basement.", 'There is no finished basement.', 'Home is without a finished basement.', 'Basement is not finished.', "Basement isn't finished."]) {
    assert.equal(answers(text, buyer)['features:Finished basement'], 'no', text);
  }
});

/* ------------------------- Every case named in scope ------------------------- */

test('the named phrases: affirmative, negated, hedged, optional and community wording', () => {
  const cases = [
    ['Does not have a finished basement', { finishedBasement: 'no' }],
    ['No fireplace', { fireplace: 'no' }],
    ['Decorative fireplace only', {}],
    ['Room for a pool', {}],
    ['Community pool', {}],
    ['Private in-ground pool', { pool: 'yes' }],
    ['Fully fenced backyard', { fencedYard: 'yes' }],
    ['Partially fenced yard', {}],
    ['First-floor laundry', { firstFloorLaundry: 'yes' }],
    ['Optional first-floor guest suite', {}],
    ['Bedroom on the main level', { firstFloorBedroom: 'yes' }],
    ['Walk-in pantry', { walkInPantry: 'yes', pantry: 'yes' }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(stated(text), expected, text);
});

test('the named phrases become suggestions only for the buyer\'s own selected criteria', () => {
  assert.deepEqual(answers([
    'Does not have a finished basement.', 'No fireplace.', 'Private in-ground pool.', 'Fully fenced backyard.',
    'First-floor laundry.', 'Bedroom on the main level.', 'Walk-in pantry.',
  ].join(' '), buyer), {
    'features:Finished basement': 'no', 'features:Fireplace': 'no', 'exterior:Pool': true, 'exterior:Fenced yard': true,
    'features:First-floor laundry': true, 'features:First-Floor Bedroom': true, 'features:Walk-in Pantry': true,
  });
  assert.deepEqual(answers('Decorative fireplace only. Room for a pool. Community pool. Partially fenced yard. Optional first-floor guest suite.', buyer), {});
});

/* --------------------------------- Negation --------------------------------- */

test('explicit negation in its common forms suggests No', () => {
  for (const [text, concept] of [
    ['No fireplace.', 'fireplace'], ['Fireplace: none', 'fireplace'], ['Fireplaces: 0', 'fireplace'], ['Home lacks a fireplace.', 'fireplace'],
    ['No pool.', 'pool'], ['There is no pool.', 'pool'], ['Unfenced yard.', 'fencedYard'], ['No fence.', 'fencedYard'], ['Yard is not fenced.', 'fencedYard'],
    ['Unfinished basement.', 'finishedBasement'], ['No basement.', 'finishedBasement'], ['Not a walkout basement.', 'walkoutBasement'],
    ['Laundry in the basement.', 'firstFloorLaundry'], ['All bedrooms upstairs.', 'firstFloorBedroom'], ['Primary suite is upstairs.', 'firstFloorPrimary'],
    ['No central air.', 'centralAir'], ['Window units only.', 'centralAir'], ['No pantry.', 'walkInPantry'], ['No deck or patio.', 'patioDeck'],
  ]) assert.equal(stated(text)[concept], 'no', text);
});

test('a negation earlier in the sentence never turns a later feature into Yes or No', () => {
  // "No HOA, finished basement": the "No" belongs to the HOA; the basement stays Unknown.
  assert.deepEqual(stated('No HOA, finished basement.'), {});
  assert.deepEqual(stated('No fireplace, pool or deck.'), { fireplace: 'no' });
  assert.deepEqual(stated('No carpet in the basement.'), {});
  assert.deepEqual(stated('No basement bedrooms.'), {});
  // A contrast word ends the negation's reach.
  assert.equal(stated('No HOA, but a fully fenced backyard.').fencedYard, 'yes');
  // A negation after the feature in its own clause makes it unclear.
  assert.deepEqual(stated('Fireplace does not work.'), {});
  // Said in a separate sentence or clause, each keeps its own meaning.
  assert.deepEqual(stated('Finished basement, no fireplace.'), { finishedBasement: 'yes', basement: 'yes', fireplace: 'no' });
});

/* -------------------------- Hedging and marketing --------------------------- */

test('hedged, hypothetical, optional, partial and non-working wording stays Unknown', () => {
  for (const text of [
    'Basement could be finished.', 'Finished basement possible.', 'Potential for a home office.', 'Space for a fireplace.', 'Fireplace is decorative only.',
    'Non-functional fireplace.', 'Fireplace sold as-is.', 'Pool-ready backyard.', 'Plans for a pool.', 'Imagine a pool here.', 'Partially finished basement.',
    'Fence allowed.', 'Optional bedroom on the main level.', 'Flex room on the main level could be a bedroom.', 'Laundry hookups on the main floor.',
    'Seller believes the basement could be finished.', 'Former fireplace was removed.', 'Den could be used as an office.', 'Invisible fence for pets.',
    'Sliding patio door to the yard.', 'Crawl space foundation.',
  ]) assert.deepEqual(stated(text), {}, text);
});

test('marketing language neither creates nor blocks an explicit statement', () => {
  assert.deepEqual(stated('Stunning wood-burning fireplace!'), { fireplace: 'yes' });
  assert.equal(stated('Move-in-ready ranch with a fully fenced yard.').fencedYard, 'yes');
  assert.deepEqual(stated('Turnkey. Dream home. Gorgeous curb appeal. Spacious and bright. Close to everything.'), {});
  assert.deepEqual(stated('Dream of summers by your own pool.'), {});
});

test('community, shared and nearby amenities are not the home\'s own', () => {
  for (const text of ['Community pool.', 'Amenities: clubhouse, heated pool.', 'Residents enjoy a shared patio.', 'HOA pool and tennis.', 'Community fenced dog area with fenced yard access.', 'Walk to the neighborhood pool.', 'Shared laundry on the first floor.']) {
    assert.deepEqual(stated(text), {}, text);
  }
  // A neighborhood mentioned in another clause doesn't make the yard shared.
  assert.equal(stated('Quiet neighborhood, fully fenced backyard.').fencedYard, 'yes');
  // A bare "pool" is too often a community amenity to suggest Yes.
  assert.deepEqual(stated('Pool.'), {});
});

/* ------------------------- Conflicts and absence --------------------------- */

test('a conflict or an omission suggests nothing, and absence is never No', () => {
  assert.equal(stated('Gas fireplace. No fireplace.').fireplace, 'conflict');
  assert.deepEqual(answers('Gas fireplace. No fireplace.', buyer), {});
  assert.deepEqual(answers('', buyer), {});
  assert.deepEqual(answers('Lovely 3 bed, 2 bath colonial on a quiet street.', buyer), {});
  // The text mentions only a fireplace; nothing else is suggested, least of all No.
  const only = suggestListingAnswers('Gas fireplace in the living room.', buyer);
  assert.deepEqual(only.map((item) => [item.key, item.answer]), [['features:Fireplace', true]]);
});

/* ------------------- Canonical keys, aliases and inversions ------------------ */

test('suggestions use the criterion key Match reads, for current and older labels', () => {
  // Today's purchase labels.
  for (const [category, label, concept] of [['features', 'First-floor laundry', 'firstFloorLaundry'], ['exterior', 'Patio / deck', 'patioDeck'], ['features', 'Primary ensuite', 'primaryEnsuite'], ['exterior', 'Fenced yard', 'fencedYard']]) {
    assert.equal(criterionConcept(category, label).concept, concept);
  }
  // Older labels (rental / investment catalogs, and pre-unification purchase aliases).
  for (const [category, label, concept] of [['features', 'First-Floor Laundry', 'firstFloorLaundry'], ['exterior', 'Patio / Deck / Outdoor Living', 'patioDeck'], ['features', 'Primary Ensuite', 'primaryEnsuite'], ['exterior', 'Fenced Yard', 'fencedYard'], ['features', 'Pantry', 'pantry']]) {
    assert.equal(criterionConcept(category, label).concept, concept);
  }
  // A purchase search saved under an older label is folded to today's label, and the
  // suggestion is keyed by it — the key computeMatch evaluates.
  const legacy = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'First-Floor Laundry': 'important', 'Home Office': 'nice' }, customItems: [] }, exterior: { tiers: { 'Patio / Deck / Outdoor Living': 'important' }, customItems: [] } });
  const keys = answers('First-floor laundry. Home office. Private deck.', legacy);
  assert.deepEqual(keys, { 'features:First-floor laundry': true, 'features:Home office': true, 'exterior:Patio / deck': true });
  const match = computeMatch({ checks: keys, ratings: {} }, legacy);
  for (const key of Object.keys(keys)) assert.equal(match.allSelected.find((entry) => entry.key === key)?.met, true, key);
  // An answer recorded under the older key still counts as answered.
  assert.deepEqual(answers('Home office.', legacy, { 'features:Home Office': 'no' }), {});
});

test('a rental search keeps its own labels', () => {
  const rental = select(start('home_rent'), ['features', 'Finished basement'], ['exterior', 'Fenced yard'], ['features', 'Fireplace']);
  assert.deepEqual(answers('Unfinished basement. Unfenced yard. Wood-burning fireplace.', rental), {
    'features:Finished basement': 'no', 'exterior:Fenced yard': 'no', 'features:Fireplace': true,
  });
});

test('Unfenced Yard reads the fence evidence the other way around', () => {
  const prefers = select(start('home_buy'), ['exterior', 'Unfenced Yard']);
  assert.deepEqual(answers('Unfenced yard.', prefers), { 'exterior:Unfenced Yard': true });
  assert.deepEqual(answers('Fully fenced backyard.', prefers), { 'exterior:Unfenced Yard': 'no' });
  assert.deepEqual(answers('Partially fenced yard.', prefers), {});
});

test('unselected, typed, shared-fact and Garage criteria are never suggested', () => {
  const text = 'Gas fireplace. Pets allowed. In-unit laundry. Two-car attached garage. Sauna.';
  assert.deepEqual(answers(text, start('home_buy')), {});
  const typed = addCriterion(start('home_buy'), { categoryKey: 'features', label: 'Fireplace', kind: 'check', source: 'custom' });
  assert.deepEqual(answers(text, typed), {});
  assert.equal(Object.hasOwn(answers(text, buyer), 'exterior:Garage'), false);
  const apartment = select(start('apartment_rent'), ['features', 'Pets Allowed'], ['features', 'In-Unit Laundry']);
  assert.deepEqual(answers(text, apartment), {});
});

/* ------------------------ Confirmation never overwrites ---------------------- */

test('confirming writes only an unanswered key; existing answers always win', () => {
  const [pool] = suggestListingAnswers('Private in-ground pool.', buyer);
  assert.deepEqual(applyListingAnswer({}, pool, buyer.searchType), { 'exterior:Pool': true });
  const mine = { 'exterior:Pool': 'no' };
  assert.equal(applyListingAnswer(mine, pool, buyer.searchType), mine);
  assert.deepEqual(mine, { 'exterior:Pool': 'no' });
  // Already answered: no suggestion at all.
  assert.deepEqual(answers('Private in-ground pool.', buyer, { 'exterior:Pool': true }), {});
  // Historical `false` is Unknown (as Match reads it), so it can be suggested and confirmed.
  assert.equal(hasRecordedAnswer({ 'exterior:Pool': false }, 'exterior:Pool', buyer.searchType), false);
  assert.deepEqual(applyListingAnswer({ 'exterior:Pool': false }, pool, buyer.searchType), { 'exterior:Pool': true });
  // Garbage never writes.
  assert.deepEqual(applyListingAnswer({}, { key: 'exterior:Pool', answer: false }, buyer.searchType), {});
});

test('undo reverts only the answer the suggestion wrote', () => {
  const [pool] = suggestListingAnswers('Private in-ground pool.', buyer);
  assert.deepEqual(undoListingAnswer({ 'exterior:Pool': true, 'features:Fireplace': 'no' }, pool), { 'features:Fireplace': 'no' });
  const changed = { 'exterior:Pool': 'no' };
  assert.equal(undoListingAnswer(changed, pool), changed);
});

/* ----------------------- Owner / co-buyer separation ------------------------ */

test('each buyer gets suggestions for their own criteria, and confirming touches only their checks', () => {
  const owner = select(start('home_buy'), ['exterior', 'Pool'], ['features', 'Fireplace']);
  const coBuyer = select(start('home_buy'), ['features', 'Finished basement']);
  const text = 'Private in-ground pool. Gas fireplace. Does not have a finished basement.';
  assert.deepEqual(answers(text, owner), { 'exterior:Pool': true, 'features:Fireplace': true });
  assert.deepEqual(answers(text, coBuyer), { 'features:Finished basement': 'no' });
  const ownerChecks = Object.freeze({ 'features:Fireplace': 'no' });
  const coBuyerChecks = Object.freeze({});
  // The owner's own No stops their suggestion; the co-buyer is unaffected by it.
  assert.deepEqual(answers(text, owner, ownerChecks), { 'exterior:Pool': true });
  const [basement] = suggestListingAnswers(text, coBuyer, coBuyerChecks);
  const after = applyListingAnswer(coBuyerChecks, basement, coBuyer.searchType);
  assert.deepEqual(after, { 'features:Finished basement': 'no' });
  assert.deepEqual(ownerChecks, { 'features:Fireplace': 'no' });
  assert.deepEqual(coBuyerChecks, {});
});

/* ------------------------------ Match is unchanged --------------------------- */

test('suggestions change no Match result until confirmed; a confirmed answer scores like a manual one', () => {
  const home = { checks: {}, ratings: {} };
  const text = 'Private in-ground pool. Does not have a finished basement.';
  const before = computeMatch(home, buyer);
  const suggestions = suggestListingAnswers(text, buyer, home.checks);
  assert.deepEqual(home.checks, {});
  assert.deepEqual(computeMatch(home, buyer), before);
  assert.equal(before.allSelected.find((entry) => entry.key === 'features:Finished basement').evaluated, false);
  const confirmed = suggestions.reduce((checks, suggestion) => applyListingAnswer(checks, suggestion, buyer.searchType), {});
  const manual = { 'exterior:Pool': true, 'features:Finished basement': 'no' };
  assert.deepEqual(computeMatch({ checks: confirmed, ratings: {} }, buyer), computeMatch({ checks: manual, ratings: {} }, buyer));
});

/* ------------------------------- Provenance -------------------------------- */

test('listing evidence is priority-independent listing material, never a buyer answer', () => {
  const evidence = listingTextEvidence('Private in-ground pool. No fireplace. Gas fireplace. Community pool.');
  assert.deepEqual(evidence.map((item) => [item.concept, item.stated, item.label]), [['pool', 'yes', 'Private pool']]);
  assert.deepEqual(Object.keys(evidence[0]).sort(), ['concept', 'evidence', 'id', 'label', 'sourceProvider', 'sourceType', 'stated']);
  assert.equal(evidence[0].sourceType, 'listing_text');
  assert.equal(evidence[0].sourceProvider, 'user_paste');
  assert.equal(JSON.stringify(evidence).includes('exterior:'), false, 'no criterion keys');
  assert.deepEqual(listingTextEvidence('No fireplace.').map((item) => item.label), ['No fireplace']);
});

test('the saved snapshot labels pasted text as pasted text, with its evidence, never RentCast', () => {
  const snapshot = listingImportSnapshot({ source: 'raw-text', fields: { beds: '3' }, descriptionFeatures: listingTextEvidence('Fully fenced backyard.') }, '2026-11-02T00:00:00.000Z');
  assert.equal(snapshot.source, 'pasted_text');
  assert.equal(snapshot.descriptionFeatures[0].sourceType, 'listing_text');
  assert.equal(JSON.stringify(snapshot).includes('rentcast'), false);
  assert.equal(Object.hasOwn(snapshot, 'checks'), false);
});

/* --------------------------- No silent writes left --------------------------- */

test('the silent answer writer is gone, and nothing here can reach a database', () => {
  assert.equal(Object.hasOwn(importReview, 'derivePriorityCheckPatch'), false);
  const lib = read('src/lib/listingTextAnswers.js');
  assert.doesNotMatch(lib, /supabase|fetch\(|localStorage|onSave/);
  const modal = read('src/components/HomeModal.jsx');
  const autofill = modal.match(/const runAutofill = \(\) => \{[\s\S]*?\n {2}\};/)[0];
  // The only checks a rerun hands back come from resuggestListingAnswers, which
  // can keep or clear a suggestion-confirmed answer but never adds or changes one
  // (see the "Rerunning extraction" tests below).
  assert.equal((autofill.match(/checks\s*:/g) || []).length, 2, 'checks come only from the rerun reconciliation');
  assert.match(autofill, /checks: rerun\.checks/);
  assert.match(autofill, /: \{ suggestions: \[\], checks: form\.checks,/, 'a Realtor rerun leaves checks as they are');
  assert.doesNotMatch(autofill, /setCheckItem|applyListingAnswer/, 'pasting never writes checks');
  assert.equal(IMPORT_DESTINATIONS.includes('checks') || IMPORT_DESTINATIONS.includes('ratings'), false, 'the field merge cannot reach answers');
  assert.doesNotMatch(autofill, /onSave|createClient|fetch\(/);
  assert.match(autofill, /personalAnswers\s*\? resuggestListingAnswers\(pasteText, priorities, form\.checks, confirmedAnswers\)/);
  const handlers = modal.match(/const confirmAnswer = [\s\S]*?const answerReview = /)[0];
  assert.doesNotMatch(handlers, /onSave|createClient|fetch\(|submit\(/, 'confirming changes the form only; Save is still the buyer\'s action');
  assert.match(handlers, /hasRecordedAnswer\(form\.checks/);
  // A Realtor suggesting a home has no Match answers, so gets no suggestions.
  assert.match(read('src/components/RealtorSuggestHome.jsx'), /personalAnswers=\{false\}/);
});

/* -------------- Rerunning extraction after confirming a suggestion -------------- */

// What HomeModal does, without React: Confirm records { key: answer } in its
// session-only `confirmedAnswers`; a manual edit drops that key; rerunning
// extraction goes through resuggestListingAnswers.
const fireplaceBuyer = select(start('home_buy'), ['features', 'Fireplace'], ['exterior', 'Pool']);
const FIRE = 'features:Fireplace';
function confirmFrom(text, key, checks = {}) {
  const suggestion = suggestListingAnswers(text, fireplaceBuyer, checks).find((item) => item.key === key);
  return { checks: applyListingAnswer(checks, suggestion, fireplaceBuyer.searchType), confirmed: { [key]: suggestion.answer }, suggestion };
}

test('rerun 1: a confirmed Yes, then "No fireplace", goes back to Unknown and suggests No for review', () => {
  const session = confirmFrom('Gas fireplace in the den.', FIRE, { 'exterior:Pool': 'no', 'ratings:x': 3 });
  assert.equal(session.checks[FIRE], true);
  const rerun = resuggestListingAnswers('No fireplace.', fireplaceBuyer, session.checks, session.confirmed);
  assert.equal(Object.hasOwn(rerun.checks, FIRE), false, 'the outdated Yes is not kept');
  assert.deepEqual(rerun.cleared, [FIRE], 'and the buyer is told it was cleared');
  assert.deepEqual(rerun.suggestions.map((item) => [item.key, item.answer, item.evidence]), [[FIRE, 'no', 'No fireplace.']]);
  assert.deepEqual(rerun.decisions, {}, 'the new No waits for the buyer');
  assert.deepEqual(rerun.confirmed, {});
  assert.deepEqual(rerun.checks, { 'exterior:Pool': 'no', 'ratings:x': 3 }, 'unrelated answers are untouched');
});

test('rerun 2: a confirmed Yes, then text that never mentions a fireplace, goes back to Unknown', () => {
  const session = confirmFrom('Wood-burning fireplace.', FIRE);
  const rerun = resuggestListingAnswers('Bright kitchen with quartz counters. New roof in 2021.', fireplaceBuyer, session.checks, session.confirmed);
  assert.deepEqual(rerun.checks, {});
  assert.deepEqual(rerun.cleared, [FIRE]);
  assert.deepEqual(rerun.suggestions, [], 'absence is never No');
  // A conflict in the new text is not support either.
  const conflict = resuggestListingAnswers('Gas fireplace. No fireplace.', fireplaceBuyer, session.checks, session.confirmed);
  assert.deepEqual(conflict.checks, {});
  assert.deepEqual(conflict.cleared, [FIRE]);
});

test('rerun 3: identical text keeps the confirmed Yes, still confirmed and undoable', () => {
  const text = 'Gas fireplace in the den.';
  const session = confirmFrom(text, FIRE);
  const rerun = resuggestListingAnswers(text, fireplaceBuyer, session.checks, session.confirmed);
  assert.deepEqual(rerun.checks, { [FIRE]: true });
  assert.deepEqual(rerun.confirmed, { [FIRE]: true });
  assert.deepEqual(rerun.cleared, []);
  const [shown] = rerun.suggestions;
  assert.equal(shown.id, session.suggestion.id);
  assert.equal(rerun.decisions[shown.id], 'confirmed');
  assert.deepEqual(undoListingAnswer(rerun.checks, shown), {});
  // Different wording with the same answer is still support.
  const reworded = resuggestListingAnswers('Living room with a stone fireplace.', fireplaceBuyer, session.checks, session.confirmed);
  assert.deepEqual(reworded.checks, { [FIRE]: true });
  assert.equal(reworded.decisions[reworded.suggestions[0].id], 'confirmed');
});

test('rerun 4: a manual answer set before extraction is never overwritten, removed or re-suggested', () => {
  const manual = Object.freeze({ [FIRE]: true });
  for (const text of ['No fireplace.', 'Bright kitchen.', 'Gas fireplace.']) {
    const rerun = resuggestListingAnswers(text, fireplaceBuyer, manual, {});
    assert.deepEqual(rerun.checks, { [FIRE]: true }, text);
    assert.deepEqual(rerun.cleared, [], text);
    assert.deepEqual(rerun.suggestions, [], text);
  }
  // Same if the buyer typed No by hand.
  assert.deepEqual(resuggestListingAnswers('Gas fireplace.', fireplaceBuyer, { [FIRE]: 'no' }, {}).checks, { [FIRE]: 'no' });
});

test('rerun 5: confirm, then change the answer by hand: it is the buyer\'s own answer, and Undo cannot touch it', () => {
  const session = confirmFrom('Gas fireplace.', FIRE);
  // The manual edit (setCheckItem) drops the key from confirmedAnswers.
  const checks = { ...session.checks, [FIRE]: 'no' };
  const confirmed = {};
  assert.deepEqual(undoListingAnswer(checks, session.suggestion), checks, 'Undo of the Yes never reverts a manual No');
  const rerun = resuggestListingAnswers('Bright kitchen.', fireplaceBuyer, checks, confirmed);
  assert.deepEqual(rerun.checks, { [FIRE]: 'no' });
  assert.deepEqual(rerun.cleared, []);
  // Even a stale confirmed entry is ignored once the value differs from what Confirm wrote.
  assert.deepEqual(resuggestListingAnswers('No fireplace.', fireplaceBuyer, checks, session.confirmed).checks, { [FIRE]: 'no' });
  // HomeModal also hides the confirmed row, and refuses Undo, unless confirmedAnswers still owns the key.
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /const undoAnswer = \(suggestion\) => \{\n\s*\/\/[^\n]*\n\s*if \(confirmedAnswers\[suggestion\.key\] !== suggestion\.answer\) return;/);
  assert.match(modal, /form\.checks\?\.\[suggestion\.key\] === suggestion\.answer && confirmedAnswers\[suggestion\.key\] === suggestion\.answer/);
  assert.match(modal, /const setCheckItem = \(cat, label, value\) => \{\n\s*setConfirmedAnswers\(/, 'a manual edit ends the suggestion\'s ownership');
});

test('rerun 6: one confirmed, one left Unknown, reprocess the same text: confirmed stays, Unknown is offered again', () => {
  const text = 'Gas fireplace. Private in-ground pool.';
  const session = confirmFrom(text, FIRE);
  const rerun = resuggestListingAnswers(text, fireplaceBuyer, session.checks, session.confirmed);
  assert.deepEqual(rerun.checks, { [FIRE]: true }, 'the Unknown criterion is still not answered');
  const byKey = Object.fromEntries(rerun.suggestions.map((item) => [item.key, item]));
  assert.equal(rerun.decisions[byKey[FIRE].id], 'confirmed');
  assert.equal(rerun.decisions[byKey['exterior:Pool'].id], undefined, 'Pool is pending again, never auto-confirmed');
});

test('a rerun never adds or changes an answer: it can only keep or clear one Confirm wrote', () => {
  const texts = ['Gas fireplace. Private in-ground pool.', 'No fireplace. No pool.', 'Bright kitchen.', ''];
  const starts = [{}, { [FIRE]: true }, { [FIRE]: 'no', 'exterior:Pool': true }, { 'exterior:Pool': false }];
  for (const text of texts) for (const checks of starts) for (const confirmed of [{}, { [FIRE]: true }, { 'exterior:Pool': true }]) {
    const rerun = resuggestListingAnswers(text, fireplaceBuyer, checks, confirmed);
    for (const [key, value] of Object.entries(rerun.checks)) assert.equal(checks[key], value, `${text} ${key}`);
    for (const key of Object.keys(checks)) {
      if (!Object.hasOwn(rerun.checks, key)) assert.equal(confirmed[key], checks[key], `only a Confirm-owned answer is cleared: ${key}`);
    }
  }
});
