// Match Reveal (src/lib/matchReveal.js, docs/match-reveal.md): completeness is
// not Match; the reveal unlocks at 90% of a buyer's own pre-tour criteria,
// fires once on their own persisted save that crosses it, and its copy follows
// the real Match % honestly. Real-Postgres persistence: match-reveal-db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFETTI_ABOVE, MIN_ELIGIBLE, REVEAL_THRESHOLD, crossedRevealThreshold, isCompletenessEligible, matchCompleteness, revealCopy } from '../src/lib/matchReveal.js';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const { claimMatchReveal } = await import('../src/lib/supabase/collaboration.js');
import { computeMatch } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const c = (key, { objective = true, evaluated = false, met = null, tier = 'important' } = {}) => ({ key, label: key, tier, objective, evaluated, met });
const known = (n, met = true) => Array.from({ length: n }, (_, i) => c(`features:Known ${i}`, { evaluated: true, met }));
const unknown = (n) => Array.from({ length: n }, (_, i) => c(`features:Unknown ${i}`));

/* --------------------------------- completeness --------------------------------- */

test('completeness: 0%, 74%, exactly 75%, 90% and 100%', () => {
  assert.equal(REVEAL_THRESHOLD, 75);
  assert.deepEqual(matchCompleteness({ allSelected: unknown(10) }), { eligible: 10, determined: 0, pct: 0, unlocked: false });
  assert.deepEqual(matchCompleteness({ allSelected: [...known(74), ...unknown(26)] }), { eligible: 100, determined: 74, pct: 74, unlocked: false });
  assert.deepEqual(matchCompleteness({ allSelected: [...known(75), ...unknown(25)] }), { eligible: 100, determined: 75, pct: 75, unlocked: true });
  assert.deepEqual(matchCompleteness({ allSelected: [...known(3), ...unknown(1)] }), { eligible: 4, determined: 3, pct: 75, unlocked: true });
  assert.deepEqual(matchCompleteness({ allSelected: [...known(9), ...unknown(1)] }), { eligible: 10, determined: 9, pct: 90, unlocked: true });
  assert.deepEqual(matchCompleteness({ allSelected: known(12) }), { eligible: 12, determined: 12, pct: 100, unlocked: true });
  // 5 of 7 is 71.4% and 8 of 11 is 72.7%: locked; 11 of 15 is 73.3%: locked (never rounded up).
  for (const [k, n] of [[5, 7], [8, 11], [11, 15]]) assert.equal(matchCompleteness({ allSelected: [...known(k), ...unknown(n - k)] }).unlocked, false, `${k}/${n}`);
});

test('determined Yes and No both count; Unknown and neutral never do', () => {
  const r = matchCompleteness({ allSelected: [...known(2, true), ...known(2, false).map((x, i) => ({ ...x, key: `no ${i}` })), c('features:Neutral', { evaluated: true, met: null }), ...unknown(1)] });
  assert.deepEqual([r.eligible, r.determined], [6, 4]);
});

test('tour-only criteria, star ratings and Commute are not eligible; nothing selected never unlocks', () => {
  assert.equal(isCompletenessEligible(c('homeFeel:Natural Light', { objective: false, evaluated: true, met: true })), false);
  assert.equal(isCompletenessEligible(c('location:Commute', { evaluated: true, met: true })), false);
  assert.equal(isCompletenessEligible(c('budget', { evaluated: true, met: true })), true);
  // Answered tour criteria never inflate completeness.
  const r = matchCompleteness({ allSelected: [...known(2), ...unknown(2), ...Array.from({ length: 6 }, (_, i) => c(`homeFeel:Tour ${i}`, { objective: false, evaluated: true, met: true }))] });
  assert.deepEqual([r.eligible, r.determined, r.unlocked], [4, 2, false]);
  assert.deepEqual(matchCompleteness({ allSelected: [] }), { eligible: 0, determined: 0, pct: 0, unlocked: false });
  assert.deepEqual(matchCompleteness(null), { eligible: 0, determined: 0, pct: 0, unlocked: false });
  // A meaningful denominator: fewer than three eligible criteria never unlock, even at 100%.
  assert.equal(MIN_ELIGIBLE, 3);
  assert.equal(matchCompleteness({ allSelected: known(2) }).unlocked, false);
  assert.equal(matchCompleteness({ allSelected: known(3) }).unlocked, true);
});

test('on real computeMatch: Home Facts-derived answers count, historical false and tour answers do not, Match is untouched', () => {
  let p = normalizePriorities({ searchType: 'purchase' });
  p.budget = { value: '500000', tier: 'must' };
  p.bedsMin = { value: '3', tier: 'important' };
  for (const [categoryKey, label, tier, kind] of [['features', 'Finished basement', 'must'], ['exterior', 'Garage', 'important'], ['features', 'Fireplace', 'nice'],
    ['features', 'Home office', 'important'], ['homeFeel', 'Natural Light', 'important', 'rating']]) p = addCriterion(p, { categoryKey, label, kind: kind || 'check' }, tier);
  const base = { price: '450000', beds: '4', basementCondition: 'finished', garageSpaces: '2', checks: {}, ratings: {} };
  // budget, beds, Finished basement (fact), Garage (fact) = 4 of 6 eligible; Natural Light is tour-only.
  assert.deepEqual(matchCompleteness(computeMatch(base, p)), { eligible: 6, determined: 4, pct: 66, unlocked: false });
  assert.deepEqual(matchCompleteness(computeMatch({ ...base, checks: { 'features:Fireplace': false, 'features:Home office': 'no' } }, p)).determined, 5, 'historical false stays Unknown');
  assert.equal(matchCompleteness(computeMatch({ ...base, ratings: { 'homeFeel:Natural Light': 'positive' } }, p)).determined, 4, 'a tour answer is not completeness');
  const done = { ...base, checks: { 'features:Fireplace': 'no', 'features:Home office': true } };
  assert.deepEqual(matchCompleteness(computeMatch(done, p)), { eligible: 6, determined: 6, pct: 100, unlocked: true });
  // Completeness reads Match; it never changes it.
  const before = JSON.stringify(computeMatch(done, p));
  matchCompleteness(computeMatch(done, p));
  assert.equal(JSON.stringify(computeMatch(done, p)), before);
  assert.doesNotMatch(read('src/lib/matching.js'), /matchReveal/);
});

/* ----------------------------------- trigger ----------------------------------- */

test('only a crossing from locked to unlocked triggers', () => {
  const locked = { unlocked: false }; const open = { unlocked: true };
  assert.equal(crossedRevealThreshold(locked, open), true);
  assert.equal(crossedRevealThreshold(open, open), false, 'already above (e.g. at launch, or auto-filled on arrival)');
  assert.equal(crossedRevealThreshold(open, locked), false, 'falling below never triggers or resets anything');
  assert.equal(crossedRevealThreshold(locked, locked), false);
});

test('the overlay: baseline from the server copy, trigger only on persisted saves, claim before showing', () => {
  const overlay = read('src/components/HomeOverlay.jsx');
  assert.match(overlay, /useEffect\(\(\) => \{ revealBaseline\.current = matchCompleteness\(computeMatch\(serverHome, prioritiesRef\.current\)\); \}, \[serverHome\]\);/);
  assert.match(overlay, /useEffect\(\(\) => \{ if \(autosave\.status === 'saved'\) considerReveal\(homeRef\.current\); \}, \[autosave\.status, autosave\.savedVersion, considerReveal\]\);/, 'once per completed save');
  assert.match(read('src/lib/autosaveQueue.js'), /failed, pending, saves \};/);
  assert.match(overlay, /setFullEditor\(false\); considerReveal\(saved\); return saved;/, 'the full editor after a successful save only');
  assert.match(overlay, /claimMatchReveal\(createClient\(\), persisted\.id, \{ token: crypto\.randomUUID\(\) \}\)\.then\(\(claimed\) => \{ if \(claimed\) setRevealOpen\(true\); \}\);/);
  assert.match(overlay, /const nestedOpen = reflecting \|\| !!archiveTarget \|\| fullEditor \|\| revealOpen;/, 'Escape / Tab belong to the reveal while it is open');
  // Nowhere else can reveal: not Add Home, the board, the Realtor's read-only Home Detail or Compare.
  for (const file of ['src/components/HomesBoard.jsx', 'src/components/HomeModal.jsx', 'src/components/HomeDetail.jsx', 'src/components/RealtorWorkspace.jsx', 'src/components/CompareBoard.jsx']) {
    assert.doesNotMatch(read(file), /claimMatchReveal|MatchReveal/, file);
  }
  // claimMatchReveal: see the token / retry test below.
});

/* ------------------------------------ copy ------------------------------------ */

const match = (pct, must = []) => ({ pct, allSelected: must });
const done = { pct: 92 };
const failedMust = c('features:Pool', { tier: 'must', evaluated: true, met: false });
const unknownMust = c('features:Office', { tier: 'must' });
const metMust = c('features:Garage', { tier: 'must', evaluated: true, met: true });

test('confetti follows the Match score: 85% none, 86% and up yes, whatever the Must Haves', () => {
  assert.equal(CONFETTI_ABOVE, 85);
  for (const must of [[], [metMust], [failedMust], [unknownMust], [failedMust, unknownMust]]) {
    assert.equal(revealCopy(match(85, must), done).celebrate, false, `85 ${must.length}`);
    for (const pct of [86, 89, 90, 95, 100]) assert.equal(revealCopy(match(pct, must), done).celebrate, true, `${pct} ${must.length}`);
  }
  for (const pct of [84, 75, 60, 30]) assert.equal(revealCopy(match(pct), done).celebrate, false);
});

test('copy bands follow the real Match %; 86%+ with a missed Must Have celebrates but names the miss', () => {
  assert.deepEqual(revealCopy(match(96, [metMust]), done), { band: 'high', headline: 'Well, hello there!', body: 'It lines up with nearly everything you told us matters.', progress: 'You’ve gathered 92% of the details that matter to you, and a few are still worth confirming.', celebrate: true });
  assert.equal(revealCopy(match(86, [metMust]), done).headline, 'Well, hello there!', '86% gets the warm headline');
  const missed = revealCopy(match(95, [failedMust, metMust]), done);
  assert.equal(missed.celebrate, true);
  assert.match(missed.body, /misses a Must Have/);
  assert.match(revealCopy(match(87, [failedMust]), done).body, /misses a Must Have/);
  assert.match(revealCopy(match(80, [failedMust]), done).body, /misses a Must Have/);
  assert.equal(revealCopy(match(85, [metMust]), done).headline, 'There’s something here!');
  assert.equal(revealCopy(match(62), done).headline, 'A little give and take.');
  assert.equal(revealCopy(match(31, [failedMust]), done).headline, 'Not quite your match?');
  for (const [pct, band] of [[100, 'high'], [86, 'high'], [85, 'good'], [75, 'good'], [74, 'mixed'], [50, 'mixed'], [49, 'low'], [0, 'low']]) assert.equal(revealCopy(match(pct), done).band, band, String(pct));
  // Complete information drops the "still worth confirming" note.
  assert.equal(revealCopy(match(96), { pct: 100 }).progress, 'You’ve gathered 100% of the details that matter to you.');
  assert.equal(revealCopy(match(96), { pct: 75 }).progress, 'You’ve gathered 75% of the details that matter to you, and a few are still worth confirming.');
});

test('unknown Must Haves are never implied verified; nothing is "perfect", guaranteed or ruled out', () => {
  assert.match(revealCopy(match(94, [unknownMust, metMust]), done).body, /still need confirming/);
  assert.match(revealCopy(match(81, [unknownMust]), done).body, /still to confirm/);
  const all = [100, 96, 90, 86, 85, 80, 75, 60, 50, 40, 10].flatMap((pct) => [[], [failedMust], [unknownMust], [metMust]].map((must) => [must, revealCopy(match(pct, must), done)]));
  for (const [must, copy] of all) {
    assert.doesNotMatch(`${copy.headline} ${copy.body}`, /perfect|guarantee|ideal|dream|ruled out|deal ?breaker|definitely|bad|poor|fail/i, copy.headline);
    if (must.includes(unknownMust) && copy.band !== 'mixed' && copy.band !== 'low') assert.match(copy.body, /confirm/, `unknown Must Have at ${copy.band}`);
    if (must.includes(unknownMust)) assert.doesNotMatch(copy.body, /nearly everything you told us/, 'never the all-clear line with an unconfirmed Must Have');
  }
});

/* --------------------------- claiming: one token per crossing --------------------------- */

const fakeRpc = (responses) => {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); const next = responses.shift(); if (next instanceof Error) throw next; return next; } };
};

test('claim: a lost response is retried with the same token; a definite answer is never retried', async () => {
  // Network drop, then the server says true (this token's claim was recorded): shown once.
  let api = fakeRpc([new Error('Failed to fetch'), { data: true, error: null }]);
  assert.equal(await claimMatchReveal(api, 'h1', { token: 't1', retryDelayMs: 1 }), true);
  assert.deepEqual(api.calls.map(([, args]) => args.p_token), ['t1', 't1'], 'same token on retry');
  api = fakeRpc([{ data: null, error: { message: 'Failed to fetch' } }, { data: [true], error: null }]);
  assert.equal(await claimMatchReveal(api, 'h1', { token: 't2', retryDelayMs: 1 }), true);
  // Definite answers stop at once: already claimed, no permission, function missing.
  for (const response of [{ data: false, error: null }, { data: null, error: { code: '42501', message: 'Match reveal not available' } }, { data: null, error: { code: 'PGRST202', message: 'not found' } }, { data: null, error: { status: 404, message: 'Not found' } }]) {
    api = fakeRpc([response, { data: true, error: null }]);
    assert.equal(await claimMatchReveal(api, 'h1', { token: 't3', retryDelayMs: 1 }), false);
    assert.equal(api.calls.length, 1, JSON.stringify(response));
  }
  // Gives up after three tries; no token, no call.
  api = fakeRpc([new Error('x'), new Error('x'), new Error('x'), { data: true, error: null }]);
  assert.equal(await claimMatchReveal(api, 'h1', { token: 't4', retryDelayMs: 1 }), false);
  assert.equal(api.calls.length, 3);
  api = fakeRpc([{ data: true, error: null }]);
  assert.equal(await claimMatchReveal(api, 'h1'), false);
  assert.equal(api.calls.length, 0);
});

test('the dialog: real %, labelled, Escape / close / outside click, focus on the main action, reduced motion', () => {
  const ui = read('src/components/MatchReveal.jsx');
  assert.match(ui, /role="dialog" aria-modal="true" aria-labelledby="flh-reveal-title" aria-describedby="flh-reveal-body"/);
  assert.match(ui, /<strong>\{match\.pct\}%<\/strong> Match/);
  assert.match(ui, /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); onClose\(\); return; \}/);
  assert.match(ui, /onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) onClose\(\); \}\}/);
  assert.match(ui, /primaryRef\.current\?\.focus/);
  assert.match(ui, /previouslyFocused\.focus/);
  assert.match(ui, /aria-label="Close"/);
  assert.match(ui, /\{copy\.celebrate && <div className="flh-reveal-confetti" aria-hidden="true">/);
  const css = read('src/app/globals.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.flh-reveal-backdrop, \.flh-reveal \{ animation: none; \}\n  \.flh-reveal-confetti \{ display: none; \}\n\}/);
  assert.match(css, /\.flh-reveal \{[^}]*max-height: calc\(100dvh - 32px\); overflow-y: auto;/);
});
