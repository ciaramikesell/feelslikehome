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
const { matchProgress, matchProgressLine, openCountByTier } = await import('../src/lib/matchProgress.js');
const { listingContextSummary, listingSnapshotContext } = await import('../src/lib/listingContext.js');
const { REVEAL_THRESHOLD, MIN_ELIGIBLE, matchCompleteness } = await import('../src/lib/matchReveal.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { answerableCriteriaKeys } = await import('../src/lib/matchCriteria.js');
const { emptyHome, normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { normalizeRentCastFields } = await import('../src/lib/rentcast.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
// The same fact links Match Criteria uses (FACT_LINKS keys), without importing JSX.
const FACT_KEYS = ['budget', 'sqft', 'lotSize', 'beds', 'baths', 'preferredPropertyTypes', 'homeLayout', 'homeCondition', 'primaryBedroomLocation', 'secondaryBedroomLocation'];
const c = (key, { tier = 'important', objective = true, evaluated = false, met = null } = {}) => ({ key, label: key.split(':').pop(), tier, objective, evaluated, met });

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

test('copy: open count, "counts only what’s known", after-tour note, settled state, nothing selected', () => {
  const p = (open, afterTour = 0, eligible = 5) => ({ eligible, open: Array.from({ length: open }, (_, i) => ({ key: `k${i}` })), afterTour });
  assert.equal(matchProgressLine(p(3)), '3 priorities are still open. Your % counts only what’s known.');
  assert.equal(matchProgressLine(p(1, 2)), '1 priority is still open. Your % counts only what’s known. 2 more are for after a tour.');
  assert.equal(matchProgressLine(p(0)), 'Everything you can check before a tour is settled.');
  assert.equal(matchProgressLine(p(0, 1)), 'Everything you can check before a tour is settled. 1 more is for after a tour.');
  assert.equal(matchProgressLine(p(0, 0, 0)), '');
  assert.equal(matchProgressLine(null), '');
  assert.doesNotMatch(matchProgressLine(p(2)), /%\s*complete|\d+%/, 'never a completeness percentage');
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
  assert.match(summary, /^When added \(Oct 18, 2026\): Active · New Construction · \d+ days? on market$/);
  assert.doesNotMatch(summary, /\$|drop|reduc|cut/i);
  assert.equal(listingContextSummary(null, true), 'County records for this home');
  assert.equal(listingContextSummary(null, false), '');
  assert.equal(listingContextSummary({ asOf: '2026-10-18', status: 'inactive', listingType: null, daysOnMarket: null, earlier: [{ listedDate: '2025-03-02' }] }), 'When added (Oct 18, 2026): No longer listed · listed before');
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
