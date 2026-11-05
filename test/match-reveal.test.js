// Match Reveal (src/lib/matchReveal.js, docs/match-reveal.md): completeness is
// not Match; the reveal unlocks at 90% of a buyer's own pre-tour criteria,
// fires once on their own persisted save that crosses it, and its copy follows
// the real Match % honestly. Real-Postgres persistence: match-reveal-db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_ELIGIBLE, REVEAL_THRESHOLD, crossedRevealThreshold, isCompletenessEligible, matchCompleteness, revealCopy } from '../src/lib/matchReveal.js';
import { computeMatch } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const c = (key, { objective = true, evaluated = false, met = null, tier = 'important' } = {}) => ({ key, label: key, tier, objective, evaluated, met });
const known = (n, met = true) => Array.from({ length: n }, (_, i) => c(`features:Known ${i}`, { evaluated: true, met }));
const unknown = (n) => Array.from({ length: n }, (_, i) => c(`features:Unknown ${i}`));

/* --------------------------------- completeness --------------------------------- */

test('completeness: 0%, 89%, exactly 90% and 100%', () => {
  assert.equal(REVEAL_THRESHOLD, 90);
  assert.deepEqual(matchCompleteness({ allSelected: unknown(10) }), { eligible: 10, determined: 0, pct: 0, unlocked: false });
  assert.deepEqual(matchCompleteness({ allSelected: [...known(89), ...unknown(11)] }), { eligible: 100, determined: 89, pct: 89, unlocked: false });
  assert.deepEqual(matchCompleteness({ allSelected: [...known(9), ...unknown(1)] }), { eligible: 10, determined: 9, pct: 90, unlocked: true });
  assert.deepEqual(matchCompleteness({ allSelected: known(12) }), { eligible: 12, determined: 12, pct: 100, unlocked: true });
  // 8 of 9 is 88.9%: shown as 88 and still locked (never rounded up to 90).
  assert.deepEqual(matchCompleteness({ allSelected: [...known(8), ...unknown(1)] }), { eligible: 9, determined: 8, pct: 88, unlocked: false });
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
  const r = matchCompleteness({ allSelected: [...known(3), ...unknown(1), ...Array.from({ length: 6 }, (_, i) => c(`homeFeel:Tour ${i}`, { objective: false, evaluated: true, met: true }))] });
  assert.deepEqual([r.eligible, r.determined, r.unlocked], [4, 3, false]);
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
  assert.match(overlay, /useEffect\(\(\) => \{ if \(autosave\.status === 'saved'\) considerReveal\(homeRef\.current\); \}, \[autosave\.status, considerReveal\]\);/);
  assert.match(overlay, /setFullEditor\(false\); considerReveal\(saved\); return saved;/, 'the full editor after a successful save only');
  assert.match(overlay, /claimMatchReveal\(createClient\(\), persisted\.id\)\.then\(\(claimed\) => \{ if \(claimed\) setRevealOpen\(true\); \}\);/);
  assert.match(overlay, /const nestedOpen = reflecting \|\| !!archiveTarget \|\| fullEditor \|\| revealOpen;/, 'Escape / Tab belong to the reveal while it is open');
  // Nowhere else can reveal: not Add Home, the board, the Realtor's read-only Home Detail or Compare.
  for (const file of ['src/components/HomesBoard.jsx', 'src/components/HomeModal.jsx', 'src/components/HomeDetail.jsx', 'src/components/RealtorWorkspace.jsx', 'src/components/CompareBoard.jsx']) {
    assert.doesNotMatch(read(file), /claimMatchReveal|MatchReveal/, file);
  }
  // A failed claim is just "no reveal".
  assert.match(read('src/lib/supabase/collaboration.js'), /export async function claimMatchReveal\(supabase, homeId\) \{\n  try \{\n    const \{ data, error \} = await supabase\.rpc\('claim_match_reveal', \{ p_home_id: homeId \}\);\n    \/\/ PostgREST returns a scalar boolean as `true`; tolerate a one-row array too\.\n    return !error && \(Array\.isArray\(data\) \? data\[0\] : data\) === true;\n  \} catch \{\n    return false;/);
});

/* ------------------------------------ copy ------------------------------------ */

const match = (pct, must = []) => ({ pct, allSelected: must });
const done = { pct: 92 };
const failedMust = c('features:Pool', { tier: 'must', evaluated: true, met: false });
const unknownMust = c('features:Office', { tier: 'must' });
const metMust = c('features:Garage', { tier: 'must', evaluated: true, met: true });

test('copy bands follow the real Match %; a high Match with a failed Must Have is not a celebration', () => {
  assert.deepEqual(revealCopy(match(96, [metMust]), done), { band: 'high', headline: 'Well, hello there!', body: 'It lines up with nearly everything you told us matters.', progress: 'You’ve gathered 92% of the details that matter to you.', celebrate: true });
  const catchy = revealCopy(match(95, [failedMust, metMust]), done);
  assert.equal(catchy.celebrate, false);
  assert.equal(catchy.headline, 'Strong, with one catch.');
  assert.match(catchy.body, /misses a Must Have/);
  assert.match(revealCopy(match(80, [failedMust]), done).body, /misses a Must Have/);
  assert.equal(revealCopy(match(80, [metMust]), done).headline, 'There’s something here!');
  assert.equal(revealCopy(match(62), done).headline, 'A little give and take.');
  assert.equal(revealCopy(match(31, [failedMust]), done).headline, 'Not quite your match?');
  assert.equal(revealCopy(match(90), done).band, 'high');
  assert.equal(revealCopy(match(89), done).band, 'good');
  assert.equal(revealCopy(match(75), done).band, 'good');
  assert.equal(revealCopy(match(74), done).band, 'mixed');
  assert.equal(revealCopy(match(50), done).band, 'mixed');
  assert.equal(revealCopy(match(49), done).band, 'low');
});

test('unknown Must Haves are never implied verified; nothing is "perfect", guaranteed or ruled out', () => {
  const high = revealCopy(match(94, [unknownMust, metMust]), done);
  assert.match(high.body, /still need confirming/);
  assert.match(revealCopy(match(81, [unknownMust]), done).body, /still to confirm/);
  const all = [96, 95, 90, 85, 80, 75, 60, 50, 40, 10].flatMap((pct) => [[], [failedMust], [unknownMust], [metMust]].map((must) => revealCopy(match(pct, must), done)));
  for (const copy of all) {
    assert.doesNotMatch(`${copy.headline} ${copy.body}`, /perfect|guarantee|ideal|dream|ruled out|deal ?breaker|definitely|bad|poor|fail/i, copy.headline);
    if (copy.celebrate) assert.equal(copy.band, 'high');
  }
  assert.equal(all.filter((copy) => copy.celebrate).length, 9, 'celebration only at 90%+ with no failed Must Have (3 scores × 3 Must Have states)');
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
