// Add Home V3, phase 6: Home Facts + Match UX polish after Save Home
// (docs/add-home-v3-phase6-ux-audit.md). Display only: which priorities are
// still open (matchProgress.js, Match Reveal's own "settled" rule), one next
// step, a Your Match shortcut, the listing context behind one dated row and a
// sheet, and clearer copy. No scoring, threshold, schema or write path change;
// nothing is answered for a buyer; answers stay per buyer.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { DOC_ADDRESS, documentedPropertyWithFeatures, documentedSaleListingWithHistory } from './support/rentcastDocumentedShapes.js';

register('./support/aliasHooks.mjs', import.meta.url);
const { matchProgress, matchProgressLine, matchShortcutLines, openCountByTier } = await import('../src/lib/matchProgress.js');
const { listingContextSummary, listingSnapshotContext, listingSnapshotLines, listingTypeYearNote } = await import('../src/lib/listingContext.js');
const { REVEAL_THRESHOLD, MIN_ELIGIBLE, matchCompleteness } = await import('../src/lib/matchReveal.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { answerableCriteriaKeys } = await import('../src/lib/matchCriteria.js');
const { emptyHome, normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { normalizeRentCastFields } = await import('../src/lib/rentcast.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState, saveHomeSharedFields } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
// The same fact links Match Criteria uses (FACT_LINKS keys), without importing JSX.
const FACT_KEYS = ['budget', 'sqft', 'lotSize', 'beds', 'baths', 'preferredPropertyTypes', 'homeLayout', 'homeCondition', 'primaryBedroomLocation', 'secondaryBedroomLocation'];
const c = (key, { tier = 'important', objective = true, evaluated = false, met = null, score = evaluated && met !== null ? (met ? 1 : 0) : null } = {}) => ({ key, label: key.split(':').pop(), tier, objective, evaluated, met, score });

function ownerPriorities() {
  let p = applySearchChoice(normalizePriorities({}), 'home_buy');
  p.budget = { ...p.budget, value: '400000', tier: 'must' };
  p.bedsMin = { ...p.bedsMin, value: '3', tier: 'must' };
  p.homeCondition = { values: ['Move-In Ready'], tier: 'important' };
  p = addCriterion(p, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  p = addCriterion(p, { categoryKey: 'features', label: 'Finished basement', kind: 'check' }, 'important');
  p = addCriterion(p, { categoryKey: 'features', label: 'Fireplace', kind: 'check' }, 'nice');
  return p;
}
const coBuyerPriorities = () => addCriterion(applySearchChoice(normalizePriorities({}), 'home_buy'), { categoryKey: 'features', label: 'Fireplace', kind: 'check' }, 'must');
const progressFor = (home, priorities) => matchProgress(computeMatch(home, priorities), { answerable: answerableCriteriaKeys(priorities), factKeys: FACT_KEYS });

/* --------------------------------- matchProgress --------------------------------- */

test('open = settleable before a tour and not yet Yes / No; Unknown is open, never No', () => {
  const answerable = new Set(['features:Fireplace', 'features:Finished basement']);
  const rows = [
    c('budget', { tier: 'must', evaluated: true, met: true }),
    c('features:Finished basement', { evaluated: true, met: false }), // an explicit No is settled
    c('homeCondition'), // Unknown fact
    c('features:Fireplace', { tier: 'nice' }), // Unknown answer
    c('homeFeel:Natural Light', { objective: false }), // after a tour
    c('location:Commute'), // computed, not answered here
  ];
  const progress = matchProgress({ allSelected: rows }, { answerable, factKeys: FACT_KEYS });
  assert.deepEqual([progress.eligible, progress.settled, progress.afterTour], [4, 2, 1]);
  assert.deepEqual(progress.open.map((item) => [item.key, item.how]), [['homeCondition', 'fact'], ['features:Fireplace', 'answer']]);
  assert.equal(progress.next.key, 'homeCondition');
  assert.deepEqual(openCountByTier(progress), { must: 0, important: 1, nice: 1 });
});

test('the next step follows tier order: a Must-Have before Important before Nice to Have', () => {
  const answerable = new Set(['a:Nice', 'a:Must', 'a:Important']);
  const progress = matchProgress({ allSelected: [c('a:Nice', { tier: 'nice' }), c('a:Important'), c('a:Must', { tier: 'must' })] }, { answerable });
  assert.deepEqual(progress.open.map((item) => item.key), ['a:Must', 'a:Important', 'a:Nice']);
});

test('settled uses exactly Match Reveal’s rule, so the two never disagree', () => {
  const rows = [c('a:1', { evaluated: true, met: true }), c('a:2', { evaluated: true, met: false }), c('a:3', { evaluated: true, met: null }), c('a:4'), c('location:Commute', { evaluated: true, met: true }), c('homeFeel:X', { objective: false, evaluated: true, met: true })];
  const progress = matchProgress({ allSelected: rows }, { answerable: new Set(['a:1', 'a:2', 'a:3', 'a:4']) });
  const completeness = matchCompleteness({ allSelected: rows });
  assert.deepEqual([progress.eligible, progress.settled], [completeness.eligible, completeness.determined]);
  // A neutral response is not a Yes / No: still open, as completeness counts it.
  assert.deepEqual(progress.open.map((item) => item.key), ['a:3', 'a:4']);
});

test('copy: the SCORE and its basis are said apart from what is unanswered; no completeness %', () => {
  const p = (open, { known = 4, afterTour = 0, eligible = 5 } = {}) => ({ eligible, known, open: Array.from({ length: open }, (_, i) => ({ key: `k${i}` })), afterTour });
  assert.equal(matchProgressLine(p(3), 100), 'Your 100% is based on 4 known priorities. 3 are still unanswered.');
  assert.equal(matchProgressLine(p(1, { known: 1, afterTour: 2 }), 67), 'Your 67% is based on 1 known priority. 1 is still unanswered. 2 more are for after a tour.');
  assert.equal(matchProgressLine(p(0, { known: 5 }), 80), 'Your 80% is based on 5 known priorities. Everything you can check before a tour is answered.');
  assert.equal(matchProgressLine(p(3, { known: 0 }), null), 'Nothing is known yet for your priorities, so there’s no % yet. 3 are still unanswered.');
  assert.equal(matchProgressLine(p(0, { eligible: 0 }), 100), '');
  assert.equal(matchProgressLine(null), '');
  assert.deepEqual(matchShortcutLines(p(3), 100), { main: '100% on 4 known priorities', sub: '3 unanswered' });
  assert.deepEqual(matchShortcutLines(p(0, { known: 1 }), 100), { main: '100% on 1 known priority', sub: 'See breakdown' });
  assert.deepEqual(matchShortcutLines(p(2, { known: 0 }), null), { main: 'No % yet', sub: '2 unanswered' });
  for (const text of [matchProgressLine(p(2), 90), matchShortcutLines(p(2), 90).main]) assert.doesNotMatch(text, /complete|open\b/i);
});

test('known = exactly the rows the Match % is computed from (scorable), tour and Commute included', () => {
  const rows = [c('a:1', { evaluated: true, met: true }), c('a:2'), c('location:Commute', { evaluated: true, met: true }), c('homeFeel:X', { objective: false, evaluated: true, met: true }), c('homeFeel:Neutral', { objective: false, evaluated: true, met: null })];
  assert.equal(matchProgress({ allSelected: rows }, { answerable: new Set(['a:1', 'a:2']) }).known, 3, 'a neutral response is evaluated but unscored, like computeMatch');
});

test('on real computeMatch: progress reads Match and changes nothing (same %, same rows, inputs untouched)', () => {
  const priorities = ownerPriorities();
  const home = { ...emptyHome(), price: '335000', beds: '5', garageSpaces: '2', checks: {} };
  const frozen = JSON.stringify({ home, priorities });
  const before = computeMatch(home, priorities);
  const progress = progressFor(home, priorities);
  assert.equal(JSON.stringify({ home, priorities }), frozen);
  assert.deepEqual(computeMatch(home, priorities), before);
  // The default buy search also prefers property types: Unknown on this home, so open (a Home Fact).
  assert.deepEqual(progress.open.map((item) => [item.key, item.how]), [['preferredPropertyTypes', 'fact'], ['homeCondition', 'fact'], ['features:Finished basement', 'answer'], ['features:Fireplace', 'answer']]);
  // The buyer's own answer settles it; a historical `false` stays Unknown, so stays open.
  assert.equal(progressFor({ ...home, checks: { 'features:Finished basement': 'no' } }, priorities).open.length, 3);
  assert.equal(progressFor({ ...home, checks: { 'features:Finished basement': false } }, priorities).open.length, 4);
  assert.equal(REVEAL_THRESHOLD, 75);
  assert.equal(MIN_ELIGIBLE, 3);
});

/* --------------------------------- listing context --------------------------------- */

const snapshot = (overrides = {}) => listingImportSnapshot({ ...normalizeRentCastFields(documentedPropertyWithFeatures(), documentedSaleListingWithHistory({ listingType: 'New Construction', ...overrides }), { requestedAddress: DOC_ADDRESS }), searchedAddress: DOC_ADDRESS }, '2026-10-18T12:00:00.000Z');

test('one dated summary row: status, listing type, days on market; never a price; county-only fallback', () => {
  const summary = listingContextSummary(listingSnapshotContext(snapshot()), true);
  assert.match(summary, /^When added \(Oct 18, 2026\): Active · listed as New Construction · \d+ days? on market$/);
  assert.doesNotMatch(summary, /\$|drop|reduc|cut/i);
  assert.equal(listingContextSummary(null, true), 'County records for this home');
  assert.equal(listingContextSummary(null, false), '');
  assert.equal(listingContextSummary({ asOf: '2026-10-18', status: 'inactive', listingType: null, daysOnMarket: null, earlier: [{ listedDate: '2025-03-02' }] }), 'When added (Oct 18, 2026): No longer listed · listed before');
});

test('a listing type is attributed to the listing; a conflicting year built is shown beside it, neither taken as right', () => {
  const context = listingSnapshotContext(snapshot());
  assert.ok(listingSnapshotLines(context).includes('The listing called it New Construction'));
  assert.ok(!listingSnapshotLines(context).some((line) => /^Listing type:/.test(line)));
  assert.equal(listingTypeYearNote(context, '1993'), 'Home Facts list the year built as 1993. Records and listings can disagree, and FLH doesn’t decide which is right. The listing agent can confirm.');
  // Nothing to reconcile: a recent year, no year, an odd value, or another listing type.
  for (const year of ['2026', '2025', '', null, 'c. 1990']) assert.equal(listingTypeYearNote(context, year), null, String(year));
  assert.equal(listingTypeYearNote({ ...context, listingType: 'Foreclosure' }, '1993'), null);
  assert.equal(listingTypeYearNote(null, '1993'), null);
  // The note never changes Home Facts: it is a pure reader of what is already there.
  const facts = read('src/components/HomeFacts.jsx');
  assert.doesNotMatch(facts.slice(facts.indexOf('function ListingContext('), facts.indexOf('function Row(')), /saveShared|onCommit|save\(/);
});

/* ------------------------------------ wiring ------------------------------------ */

test('wiring: Home Facts keeps the sheet pattern (no inline fold-out); the full context and provenance live in the sheet', () => {
  const facts = read('src/components/HomeFacts.jsx');
  assert.doesNotMatch(facts, /<details/);
  assert.match(facts, /<Sheet open=\{open\} onClose=\{\(\) => setOpen\(false\)\} title="Found when this home was added"/);
  assert.match(facts, /It isn’t refreshed after that and can be out of date\. None of it changes Home Facts or your Match\./);
  assert.match(facts, /\{lines\.map\(\(line\) => <p key=\{line\}>\{line\}<\/p>\)\}/);
  assert.match(facts, /Unknown means FLH hasn’t found it yet\. It never counts as No in your Match\./);
  // Unknown-only hints and every edit path are untouched.
  assert.match(facts, /hint=\{!layoutValues\(home\)\.length && record\.stories \?/);
  assert.match(facts, /\{!isReadOnly && matchShortcut\}/);
});

test('wiring: the next step only scrolls and focuses; answers still come only from the buyer’s own radio', () => {
  const overlay = read('src/components/HomeOverlay.jsx');
  const answerNext = overlay.slice(overlay.indexOf('const answerNext'), overlay.indexOf('const matchShortcut'));
  assert.doesNotMatch(answerNext, /save|answerCriterion|onAnswer|autosave/i);
  assert.match(answerNext, /openFact\(FACT_LINKS\[next\.key\]\[0\]\)/);
  assert.match(overlay, /openByTier=\{openCountByTier\(progress\)\} revealRequest=\{revealRequest\}/);
  const criteria = read('src/components/MatchCriteria.jsx');
  const tierEffect = criteria.slice(criteria.indexOf('const [focusKey'), criteria.indexOf('return <section className={`flh-mc2-tier'));
  assert.doesNotMatch(tierEffect, /onAnswer|onChange|click\(\)/);
  assert.match(criteria, /<input type="radio" name=\{name\} value=\{id\} checked=\{checked\} onChange=\{\(\) => onChange\(next\)\} \/>/);
  // Match Reveal's trigger is untouched: still only this buyer's persisted save.
  assert.match(overlay, /useEffect\(\(\) => \{ if \(autosave\.status === 'saved'\) considerReveal\(homeRef\.current\); \}, \[autosave\.status, autosave\.savedVersion, considerReveal\]\);/);
});

test('wiring: the saved state names one next step and keeps the same two actions; Save Home is unchanged', () => {
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /Next, when you’re ready: View \{vocabulary\.singularLower\} shows what FLH found and how it fits your priorities\. Nothing else is required\./);
  assert.match(modal, />Back to My Homes<\/button>/);
  assert.match(modal, />View \{vocabulary\.singularLower\} <ArrowRight/);
  // The found card attributes a non-standard listing type to the listing.
  assert.match(modal, /<span className="flh-found-type">Listed as \{importResult\.listing\.listingType\}<\/span>/);
});

test('scope: no scoring, threshold, schema, migration, dependency or Floor Plans change in this phase', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '25ef9e94d3c59dfadd0c683dc13d5988f9a5ef45', '--'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n').filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const path of [...changed, ...untracked]) {
    assert.doesNotMatch(path, /^supabase\/|^src\/lib\/(matching|matchReveal|homeFactCriteria|matchCriteria)\.js$|FloorPlan|floor-plan|package(-lock)?\.json$/i, `out of scope: ${path}`);
  }
});

/* --------------------------------- real Postgres --------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.phase6@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.phase6@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.phase6@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('saved and reloaded: shared facts are common, each buyer’s progress is their own, and one buyer’s answer never settles the other’s', async () => {
  const lookup = normalizeRentCastFields(documentedPropertyWithFeatures(), documentedSaleListingWithHistory({ listingType: 'New Construction' }), { requestedAddress: DOC_ADDRESS });
  const form = mergeImportFields({ ...emptyHome(), address: DOC_ADDRESS }, lookup.fields);
  const listingImport = listingImportSnapshot({ ...lookup, searchedAddress: DOC_ADDRESS }, '2026-10-18T12:00:00.000Z');
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...form, listingImport }, ids.owner, ids.search);
  const load = async (user) => (await getHomesForUser(db.clientFor(user), user, ids.search)).find((item) => item.id === saved.id);

  let asOwner = await load(ids.owner);
  let asCoBuyer = await load(ids.coBuyer);
  // Nothing answered at save; the context summary is the same for both.
  assert.deepEqual([asOwner.checks || {}, asCoBuyer.checks || {}], [{}, {}]);
  assert.equal(listingContextSummary(listingSnapshotContext(asOwner.listingImport), true), listingContextSummary(listingSnapshotContext(asCoBuyer.listingImport), true));
  assert.ok(progressFor(asOwner, ownerPriorities()).open.some((item) => item.key === 'features:Fireplace'));
  assert.deepEqual(progressFor(asCoBuyer, coBuyerPriorities()).open.map((item) => item.key), ['features:Fireplace']);

  // The co-buyer answers Fireplace: settled for them only.
  await saveHomePersonalState(db.clientFor(ids.coBuyer), { ...asCoBuyer, checks: { 'features:Fireplace': true } }, ids.coBuyer, ids.search);
  asOwner = await load(ids.owner);
  asCoBuyer = await load(ids.coBuyer);
  assert.equal(progressFor(asCoBuyer, coBuyerPriorities()).open.length, 0);
  assert.ok(progressFor(asOwner, ownerPriorities()).open.some((item) => item.key === 'features:Fireplace'), 'the co-buyer’s answer settled the owner’s');
  assert.equal((asOwner.checks || {})['features:Fireplace'], undefined);
  // The shared snapshot is untouched by reading or answering.
  assert.deepEqual(asOwner.listingImport, listingImport);
});

dbTest('shared search: a shared Home Fact settles that priority for BOTH buyers; personal answers settle only the buyer who gave them; counts are per viewer', async () => {
  const lookup = normalizeRentCastFields(documentedPropertyWithFeatures(), documentedSaleListingWithHistory({ listingType: 'New Construction' }), { requestedAddress: DOC_ADDRESS });
  const form = mergeImportFields({ ...emptyHome(), address: `2 ${DOC_ADDRESS}` }, lookup.fields);
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...form, homeCondition: [] }, ids.owner, ids.search);
  const load = async (user) => (await getHomesForUser(db.clientFor(user), user, ids.search)).find((item) => item.id === saved.id);
  // The co-buyer's own list: Fireplace (their answer) and Home Condition (a Home Fact), both Must-Haves.
  const coPriorities = { ...coBuyerPriorities(), homeCondition: { values: ['Move-In Ready'], tier: 'must' } };
  const openKeys = (home, priorities) => progressFor(home, priorities).open.map((item) => `${item.key}:${item.how}`);

  let asOwner = await load(ids.owner);
  let asCoBuyer = await load(ids.coBuyer);
  assert.ok(openKeys(asOwner, ownerPriorities()).includes('homeCondition:fact'));
  assert.ok(openKeys(asOwner, ownerPriorities()).includes('features:Finished basement:answer'));
  assert.deepEqual(openKeys(asCoBuyer, coPriorities).sort(), ['features:Fireplace:answer', 'homeCondition:fact']);
  // A priority the viewer never selected is never counted for them.
  assert.ok(!openKeys(asCoBuyer, coPriorities).some((key) => key.startsWith('features:Finished basement')));

  // The owner answers Fireplace and Finished basement: settled for the owner only.
  await saveHomePersonalState(db.clientFor(ids.owner), { ...asOwner, checks: { 'features:Fireplace': true, 'features:Finished basement': 'no' } }, ids.owner, ids.search);
  asOwner = await load(ids.owner);
  asCoBuyer = await load(ids.coBuyer);
  assert.ok(!openKeys(asOwner, ownerPriorities()).some((key) => key.startsWith('features:')));
  assert.ok(openKeys(asCoBuyer, coPriorities).includes('features:Fireplace:answer'), 'the owner’s answer settled the co-buyer’s');
  assert.deepEqual(asCoBuyer.checks || {}, {});

  // The co-buyer fills the shared Home Condition: settled for both, nobody's answers touched.
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), saved.id, { homeCondition: ['Move-In Ready'] });
  asOwner = await load(ids.owner);
  asCoBuyer = await load(ids.coBuyer);
  assert.ok(!openKeys(asOwner, ownerPriorities()).includes('homeCondition:fact'));
  assert.deepEqual(openKeys(asCoBuyer, coPriorities), ['features:Fireplace:answer']);
  assert.deepEqual(asOwner.checks, { 'features:Fireplace': true, 'features:Finished basement': 'no' });
  assert.deepEqual(asCoBuyer.checks || {}, {});
  // The score basis is per viewer too, and the % is computeMatch's own.
  assert.equal(progressFor(asOwner, ownerPriorities()).known, computeMatch(asOwner, ownerPriorities()).allSelected.filter((item) => item.evaluated && typeof item.score === 'number').length);
});
