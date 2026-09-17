import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeMatch, selectHomeCardCriteria } from '../src/lib/matching.js';
import { defaultPriorities, emptyHome } from '../src/lib/constants.js';
import { formatCardGarage, homeCardSnapshot } from '../src/lib/homeCardPresentation.js';

const criterion = (key, tier, evaluated, met) => ({ key, label: key.split(':').at(-1), tier, evaluated, met });

test('Must Haves prioritize failed, then unknown, then met and use truthful overflow', () => {
  const match = { allSelected: [
    criterion('features:Fenced Yard', 'must', true, true),
    criterion('features:Office', 'must', false, null),
    criterion('features:Pool', 'must', true, false),
    criterion('features:Fireplace', 'must', true, true),
  ] };
  const result = selectHomeCardCriteria(match, 3);
  assert.deepEqual(result.mustHaves.map((item) => [item.label, item.evaluated, item.met]), [
    ['Pool', true, false], ['Office', false, null], ['Fenced Yard', true, true],
  ]);
  assert.equal(result.mustOverflow, 1);
});

test('Must Have preview never hides a failure to enforce its visual limit', () => {
  const match = { allSelected: [
    ...Array.from({ length: 6 }, (_, index) => criterion(`features:Failure ${index + 1}`, 'must', true, false)),
    criterion('features:Known good', 'must', true, true),
  ] };
  const result = selectHomeCardCriteria(match, 3);
  assert.equal(result.mustHaves.length, 6);
  assert.ok(result.mustHaves.every((item) => item.met === false));
  assert.deepEqual(result.hiddenMustHaves.map((item) => item.label), ['Known good']);
});

test('visible Must Haves include feature categories but exclude baseline search parameters', () => {
  const match = { allSelected: [
    criterion('preferredPropertyTypes', 'must', false, null),
    criterion('budget', 'must', true, false),
    criterion('beds', 'must', true, true),
    criterion('sqft', 'must', true, true),
    criterion('homeCondition', 'must', true, true),
    criterion('features:Home Office', 'must', true, true),
    criterion('features:Finished Basement', 'must', false, null),
    criterion('exterior:Fenced Yard', 'must', true, false),
  ] };
  const result = selectHomeCardCriteria(match);
  assert.deepEqual(result.mustHaves.map((item) => item.label), ['Fenced Yard', 'Finished Basement', 'Home Office']);
});

test('baseline Must Haves hidden from the preview still participate in Match', () => {
  const priorities = defaultPriorities();
  priorities.searchType = 'purchase';
  priorities.budget = { value: '300000', tier: 'must' };
  priorities.features.customItems = [{ label: 'Home Office', kind: 'check' }];
  priorities.features.tiers['Home Office'] = 'must';
  const home = { ...emptyHome(), price: '600000', checks: { 'features:Home Office': true } };
  const match = computeMatch(home, priorities);
  assert.equal(match.mustTotal, 2);
  assert.equal(match.mustEvaluated, 2);
  assert.equal(match.mustMet, 1);
  assert.equal(match.pct, 50);
  assert.deepEqual(selectHomeCardCriteria(match).mustHaves.map((item) => item.label), ['Home Office']);
});

test('Personalized Criteria excludes Must Haves, reconciles all states, and preserves importance order', () => {
  const match = { allSelected: [
    criterion('budget', 'important', true, true),
    criterion('beds', 'important', true, true),
    criterion('sqft', 'important', true, true),
    criterion('homeCondition', 'important', true, true),
    criterion('features:Fenced Yard', 'must', true, true),
    criterion('features:Nice positive', 'nice', true, true),
    criterion('features:Important positive one', 'important', true, true),
    criterion('exterior:Important positive two', 'important', true, true),
    criterion('features:Extra positive', 'important', true, true),
    criterion('features:Unknown', 'important', false, null),
    criterion('features:Nice negative', 'nice', true, false),
    criterion('exterior:Important negative one', 'important', true, false),
    criterion('features:Important negative two', 'important', true, false),
    criterion('features:Extra negative', 'nice', true, false),
  ] };
  const result = selectHomeCardCriteria(match);
  const summary = result.criteriaSummary;
  assert.equal(summary.total, 13);
  assert.equal(summary.evaluated, 12);
  assert.equal(summary.matches.length, 8);
  assert.equal(summary.mismatches.length, 4);
  assert.equal(summary.unknown.length, 1);
  assert.equal(summary.evaluated, summary.matches.length + summary.mismatches.length);
  assert.equal(summary.total, summary.evaluated + summary.unknown.length);
  assert.ok([...summary.matches, ...summary.mismatches, ...summary.unknown].every((item) => item.tier !== 'must'));
  assert.deepEqual(summary.mismatches.map((item) => item.label), [
    'Important negative one', 'Important negative two', 'Nice negative', 'Extra negative',
  ]);
});

test('Personalized Criteria derives fresh counts and exact names from current participant state', () => {
  const first = selectHomeCardCriteria({ allSelected: [criterion('features:Central Air', 'important', true, true), criterion('features:Pool', 'nice', false, null)] }).criteriaSummary;
  const changed = selectHomeCardCriteria({ allSelected: [criterion('features:Central Air', 'important', true, false), criterion('features:Mudroom', 'nice', true, true)] }).criteriaSummary;
  assert.deepEqual(first.matches.map((item) => item.label), ['Central Air']);
  assert.deepEqual(first.unknown.map((item) => item.label), ['Pool']);
  assert.deepEqual(changed.matches.map((item) => item.label), ['Mudroom']);
  assert.deepEqual(changed.mismatches.map((item) => item.label), ['Central Air']);
  assert.equal(changed.unknown.length, 0);
});

test('compact card facts are normalized, ordered, and omit unknown values and school ratings', () => {
  assert.equal(formatCardGarage({ garageSpaces: 'Attached side 2 car', checks: {} }), '2 Car Attached');
  const facts = homeCardSnapshot({ garageSpaces: 'Attached side 2 car', basementNotes: 'Unfinished', schoolsNotes: 'Grosse Pointe — 8/10', homeCondition: ['Move-In Ready'] }, 'Two Story');
  assert.deepEqual(facts, [
    { label: 'Garage', value: '2 Car Attached' },
    { label: 'Basement', value: 'Unfinished' },
    { label: 'Home condition', value: 'Move-In Ready' },
    { label: 'Schools', value: 'Grosse Pointe' },
    { label: 'Style', value: 'Two Story' },
  ]);
  assert.deepEqual(homeCardSnapshot({ basementNotes: 'Unknown', schoolsNotes: 'N/A', homeCondition: [] }, ''), []);
});

test('compact facts have no Home Snapshot heading, box, or two-column grid', () => {
  const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');
  const css = fs.readFileSync('src/app/globals.css', 'utf8');
  assert.doesNotMatch(board, /Home Snapshot|hh-card-context-group|hh-snapshot-fact/);
  assert.match(board, /className="hh-card-facts"/);
  assert.doesNotMatch(css, /\.hh-card-facts[^}]*grid-template-columns|\.hh-card-facts[^}]*border|\.hh-card-facts[^}]*padding/);
});

test('card does not render crossroads or stale touring language', () => {
  const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');
  const ui = fs.readFileSync('src/components/ui.jsx', 'utf8');
  assert.doesNotMatch(board, /home\.crossroads/);
  assert.doesNotMatch(ui, /to review after touring/);
});

test('criteria disclosure supports hover, focus, touch/click, Escape, and outside dismissal', () => {
  const ui = fs.readFileSync('src/components/ui.jsx', 'utf8');
  for (const contract of ['onMouseEnter', 'onMouseLeave', 'onFocus', 'onClick', "event.key === 'Escape'", "document.addEventListener('pointerdown'"]) {
    assert.ok(ui.includes(contract), `missing ${contract}`);
  }
  assert.match(ui, /items\.map\(\(item\).*item\.label/);
});
