import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePriorities, TIER_META } from '../src/lib/constants.js';
import { computeMatch, selectHomeCardCriteria } from '../src/lib/matching.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const criterion = (key, tier, evaluated, met, objective = true) => ({ key, label: key.split(':').at(-1), tier, evaluated, met, objective });

/* ============================================================
 * BUG 1 — commute truncation: structural regression guard
 * ============================================================ */

test('the My Homes card renders every saved commute destination, never a hardcoded single-destination slice', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.doesNotMatch(board, /commuteDestinations\.slice\(0,\s*1\)/);
  assert.doesNotMatch(board, /commuteDestinations\[0\]/);
  assert.match(board, /\{commuteDestinations\.map\(\(d\) => \(/);
  assert.match(board, /commuteRowLabel\(d, getCommuteState\(d\)\)/);
  assert.match(board, /import \{ evaluateCommute, commuteRowLabel \} from '@\/lib\/commute'/);
});

/* ============================================================
 * BUG 2 — Match / Must Have / Personalized Criteria contradiction
 * ============================================================
 * Root cause traced to matching.js's selectHomeCardCriteria: "Other Priorities"
 * (formerly labeled "Personalized Criteria") deliberately excludes tier === 'must'
 * criteria — Must Haves get their own dedicated list above it — but the OLD label
 * ("Personalized Criteria") didn't communicate that exclusion, so a Must Have shown
 * as a mismatch above appeared to contradict a "10/10 evaluated, 0 don't match"
 * count immediately below it, even though both blocks already read from the exact
 * same computeMatch().allSelected array (there is only one evaluation source; see
 * the "reconcile" test below and the doc comment on selectHomeCardCriteria).
 */

test('Case A: 10 known non-Must criteria, all Yes -> 10/10 evaluated, 10 match, 0 don\'t match, 0 unknown', () => {
  const allSelected = Array.from({ length: 10 }, (_, i) => criterion(`features:Item ${i}`, 'important', true, true));
  const { criteriaSummary } = selectHomeCardCriteria({ allSelected });
  assert.equal(criteriaSummary.total, 10);
  assert.equal(criteriaSummary.evaluated, 10);
  assert.equal(criteriaSummary.matches.length, 10);
  assert.equal(criteriaSummary.mismatches.length, 0);
  assert.equal(criteriaSummary.unknown.length, 0);
});

test('Case B: 10 known non-Must criteria, 7 Yes / 3 No -> 10/10 evaluated, 7 match, 3 don\'t match, 0 unknown', () => {
  const allSelected = [
    ...Array.from({ length: 7 }, (_, i) => criterion(`features:Yes ${i}`, 'important', true, true)),
    ...Array.from({ length: 3 }, (_, i) => criterion(`features:No ${i}`, 'nice', true, false)),
  ];
  const { criteriaSummary } = selectHomeCardCriteria({ allSelected });
  assert.equal(criteriaSummary.total, 10);
  assert.equal(criteriaSummary.evaluated, 10);
  assert.equal(criteriaSummary.matches.length, 7);
  assert.equal(criteriaSummary.mismatches.length, 3);
  assert.equal(criteriaSummary.unknown.length, 0);
});

test('Case C: 7 Yes / 1 No / 2 Unknown -> 8/10 evaluated, 7 match, 1 don\'t match, 2 unknown', () => {
  const allSelected = [
    ...Array.from({ length: 7 }, (_, i) => criterion(`features:Yes ${i}`, 'important', true, true)),
    criterion('features:No', 'nice', true, false),
    ...Array.from({ length: 2 }, (_, i) => criterion(`features:Unknown ${i}`, 'important', false, null)),
  ];
  const { criteriaSummary } = selectHomeCardCriteria({ allSelected });
  assert.equal(criteriaSummary.total, 10);
  assert.equal(criteriaSummary.evaluated, 8);
  assert.equal(criteriaSummary.matches.length, 7);
  assert.equal(criteriaSummary.mismatches.length, 1);
  assert.equal(criteriaSummary.unknown.length, 2);
  // The UI must never claim "evaluated" totals that don't reconcile arithmetically.
  assert.equal(criteriaSummary.evaluated, criteriaSummary.matches.length + criteriaSummary.mismatches.length);
  assert.equal(criteriaSummary.total, criteriaSummary.evaluated + criteriaSummary.unknown.length);
});

function purchasePriorities(overrides = {}) {
  return normalizePriorities({
    searchType: 'purchase',
    exterior: { tiers: { 'Fenced yard': 'must', Garage: 'must' }, customItems: [{ label: 'Fenced yard', kind: 'check' }, { label: 'Garage', kind: 'check' }] },
    features: { tiers: { 'Central air': 'must' }, customItems: [{ label: 'Central air', kind: 'check' }] },
    ...overrides,
  });
}

test('Case D: Must Have Fenced Yard = No — the Must Have shows a mismatch, "Other Priorities" never contradicts it, the filter excludes the home, and the percentage reflects the miss', () => {
  const priorities = purchasePriorities();
  // features:Central air = Yes, exterior:Garage = Yes (via garageSpaces), exterior:Fenced yard = No.
  const home = { garageSpaces: '2', checks: { 'features:Central air': true, 'exterior:Fenced yard': 'no' } };
  const match = computeMatch(home, priorities);

  const fencedYard = match.allSelected.find((c) => c.key === 'exterior:Fenced yard');
  assert.equal(fencedYard.tier, 'must');
  assert.equal(fencedYard.evaluated, true);
  assert.equal(fencedYard.met, false);

  const { mustHaves, criteriaSummary } = selectHomeCardCriteria(match);
  assert.ok(mustHaves.some((item) => item.key === 'exterior:Fenced yard' && item.met === false));
  // The single canonical Fenced Yard record is either the one shown as a Must Have
  // mismatch, or (impossible here, since it's tier 'must') counted in Other
  // Priorities — never both, and never contradicting itself between the two.
  assert.ok(!(criteriaSummary?.matches || []).some((item) => item.key === 'exterior:Fenced yard'));
  assert.ok(!(criteriaSummary?.mismatches || []).some((item) => item.key === 'exterior:Fenced yard'));

  // "No Must-Haves Missing" filter semantics (HomesBoard.jsx: m.mustMet === m.mustEvaluated).
  assert.notEqual(match.mustMet, match.mustEvaluated);

  // The percentage is computed from the SAME evaluated set that includes Fenced Yard's
  // miss — must=weight 4 each; Fenced Yard (0/4) + Central air (4/4) + Garage (4/4) = 8/12.
  const expectedPct = Math.round((8 / 12) * 100);
  assert.equal(match.pct, expectedPct);
  assert.ok(match.pct < 100, 'a confirmed Must-Have miss must pull the percentage below 100%');
});

test('Case E: Must Have Fenced Yard = Unknown — displays Unknown, is never treated as No, and counts toward unknown, not don\'t-match', () => {
  const priorities = purchasePriorities();
  const home = { garageSpaces: '2', checks: { 'features:Central air': true } }; // Fenced yard fact never recorded
  const match = computeMatch(home, priorities);

  const fencedYard = match.allSelected.find((c) => c.key === 'exterior:Fenced yard');
  assert.equal(fencedYard.evaluated, false);
  assert.equal(fencedYard.met, null);

  const { mustHaves } = selectHomeCardCriteria(match);
  const cardRow = mustHaves.find((item) => item.key === 'exterior:Fenced yard');
  assert.equal(cardRow.evaluated, false); // renders '?' in the UI, never '✕'
  assert.notEqual(cardRow.met, false);

  // Unknown must-haves don't disqualify "No Must-Haves Missing".
  assert.equal(match.mustMet, match.mustEvaluated);
  assert.ok(match.mustTotal > match.mustEvaluated, 'an unknown Must Have should not count as evaluated');
});

test('a legacy Title-Case "Fenced Yard" priority and the canonical "Fenced yard" both resolve to the exact same single evaluated record — no duplicate, no contradiction', () => {
  // Reproduces a plausible pre-2026-taxonomy beta record: the priority was saved
  // under the old Title-Case identity before normalizePriorities' alias fold existed.
  const priorities = normalizePriorities({ searchType: 'purchase', exterior: { tiers: { 'Fenced Yard': 'must' }, customItems: [{ label: 'Fenced Yard', kind: 'check' }] } });
  assert.equal(priorities.exterior.tiers['Fenced yard'], 'must');
  assert.equal(priorities.exterior.tiers['Fenced Yard'], undefined);

  const home = { checks: { 'exterior:Fenced yard': 'no' } };
  const match = computeMatch(home, priorities);
  const fencedYardEntries = match.allSelected.filter((c) => c.key.toLowerCase() === 'exterior:fenced yard');
  assert.equal(fencedYardEntries.length, 1, 'exactly one canonical Fenced Yard record, never a duplicate under the old casing');
  assert.equal(fencedYardEntries[0].met, false);
});

test('TIER_META weights used by the percentage are must=4/important=2/nice=1, matching the Case D calculation above', () => {
  assert.equal(TIER_META.must.weight, 4);
  assert.equal(TIER_META.important.weight, 2);
  assert.equal(TIER_META.nice.weight, 1);
});

test('the "No Must-Haves Missing" filter in HomesBoard.jsx reads the exact same canonical mustMet/mustEvaluated fields the card itself derives from — no separate interpretation', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /m\.mustMet === m\.mustEvaluated/);
  assert.match(board, /computeMatch\(h, priorities\)/);
});

test('selectHomeCardCriteria documents and enforces one canonical evaluation source, never a second scoring path', () => {
  const matchingSrc = read('src/lib/matching.js');
  assert.match(matchingSrc, /ONE canonical Match result \(match\.allSelected\)/);
  assert.match(matchingSrc, /Other Priorities/);
});
