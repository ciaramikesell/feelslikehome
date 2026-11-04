import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectHomeCardCriteria } from '../src/lib/matching.js';
import { formatCardGarage, homeCardSnapshot } from '../src/lib/homeCardPresentation.js';

const criterion = (key, tier, evaluated, met, objective = true) => ({ key, label: key.split(':').at(-1), tier, evaluated, met, objective });

test('Must Haves list every one, failed first, then unknown, then met — no preview limit or overflow', () => {
  const match = { allSelected: [
    criterion('features:Fenced Yard', 'must', true, true),
    criterion('features:Office', 'must', false, null),
    criterion('features:Pool', 'must', true, false),
    criterion('features:Fireplace', 'must', true, true),
  ] };
  const result = selectHomeCardCriteria(match);
  assert.deepEqual(result.mustHaves.map((item) => [item.label, item.evaluated, item.met]), [
    ['Pool', true, false], ['Office', false, null], ['Fenced Yard', true, true], ['Fireplace', true, true],
  ]);
  assert.deepEqual(Object.keys(result).sort(), ['criteriaSummary', 'mustHaves'], 'no hidden / overflow fields');
});

test('a long Must Have list is never cut: twelve Must Haves, twelve rows', () => {
  const match = { allSelected: [
    ...Array.from({ length: 6 }, (_, index) => criterion(`features:Failure ${index + 1}`, 'must', true, false)),
    ...Array.from({ length: 5 }, (_, index) => criterion(`features:Good ${index + 1}`, 'must', true, true)),
    criterion('features:Unknown one', 'must', false, null),
  ] };
  const result = selectHomeCardCriteria(match);
  assert.equal(result.mustHaves.length, 12);
  assert.deepEqual(result.mustHaves.slice(0, 7).map((item) => item.label), ['Failure 1', 'Failure 2', 'Failure 3', 'Failure 4', 'Failure 5', 'Failure 6', 'Unknown one']);
});

test('the breakdown covers every selected criterion, Must Haves included, reconciles all states, and orders Must, Important, Nice', () => {
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
    criterion('features:Pool', 'must', true, false),
    criterion('features:Office', 'must', false, null),
  ] };
  const result = selectHomeCardCriteria(match);
  const summary = result.criteriaSummary;
  assert.equal(summary.total, 16);
  assert.equal(summary.matches.length, 9, 'the met Must Have counts');
  assert.equal(summary.mismatches.length, 5, 'the failed Must Have counts');
  assert.equal(summary.unknown.length, 2, 'the unknown Must Have counts');
  assert.equal(summary.evaluated, summary.matches.length + summary.mismatches.length);
  assert.equal(summary.total, summary.evaluated + summary.unknown.length + summary.neutral.length);
  assert.deepEqual(summary.mismatches.map((item) => item.label), [
    'Pool', 'Important negative one', 'Important negative two', 'Nice negative', 'Extra negative',
  ]);
  assert.deepEqual(summary.unknown.map((item) => item.label), ['Office', 'Unknown']);
  assert.equal(summary.matches[0].label, 'Fenced Yard', 'Must Haves first');
});

test('a failed Must Have is in the visible Must Have list AND the complete "don\'t match" list: 1 failed Must Have + 5 others = 6', () => {
  const match = { allSelected: [
    criterion('features:Finished basement', 'must', true, false),
    criterion('features:Garage', 'must', true, true),
    ...Array.from({ length: 3 }, (_, index) => criterion(`features:Important miss ${index + 1}`, 'important', true, false)),
    ...Array.from({ length: 2 }, (_, index) => criterion(`exterior:Nice miss ${index + 1}`, 'nice', true, false)),
    criterion('features:Nice hit', 'nice', true, true),
  ] };
  const { mustHaves, criteriaSummary } = selectHomeCardCriteria(match);
  assert.deepEqual(mustHaves.map((item) => item.label), ['Finished basement', 'Garage']);
  assert.equal(criteriaSummary.mismatches.length, 6);
  assert.deepEqual(criteriaSummary.mismatches.map((item) => item.label), ['Finished basement', 'Important miss 1', 'Important miss 2', 'Important miss 3', 'Nice miss 1', 'Nice miss 2']);
  assert.ok(mustHaves.includes(criteriaSummary.mismatches[0]), 'the same criterion object, listed in both places');
  assert.deepEqual(criteriaSummary.matches.map((item) => item.label), ['Garage', 'Nice hit']);
});

test('an unknown Must Have is Unknown, never a mismatch; a neutral criterion is in none of the three lists', () => {
  const match = { allSelected: [
    criterion('features:Fireplace', 'must', false, null),
    criterion('homeFeel:Natural Light', 'must', true, null, false),
    criterion('homeFeel:Layout / Flow', 'important', true, null, false),
    criterion('features:Pool', 'important', true, true),
  ] };
  const { mustHaves, criteriaSummary: s } = selectHomeCardCriteria(match);
  assert.deepEqual(mustHaves.map((item) => [item.label, item.evaluated, item.met]), [['Fireplace', false, null], ['Natural Light', true, null]]);
  assert.deepEqual(s.unknown.map((item) => item.label), ['Fireplace']);
  assert.deepEqual(s.mismatches, []);
  assert.deepEqual(s.matches.map((item) => item.label), ['Pool']);
  assert.deepEqual(s.neutral.map((item) => item.label), ['Natural Light', 'Layout / Flow']);
  assert.equal(s.total, s.matches.length + s.mismatches.length + s.unknown.length + s.neutral.length);
});

test('no criterion appears twice in a disclosure, even if a result repeats a key', () => {
  const twice = criterion('features:Pool', 'nice', true, false);
  const { criteriaSummary: s } = selectHomeCardCriteria({ allSelected: [twice, { ...twice }, criterion('features:Pool', 'must', true, true)] });
  assert.deepEqual(s.mismatches.map((item) => item.key), ['features:Pool']);
  assert.deepEqual(s.matches, []);
  for (const list of [s.matches, s.mismatches, s.unknown, s.neutral]) assert.equal(new Set(list.map((item) => item.key)).size, list.length);
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

test('compact property facts use canonical values, fixed order, and omit unknown facts', () => {
  assert.equal(formatCardGarage({ garageSpaces: 'Attached side 2 car', checks: {} }), '2 Car Attached');
  const facts = homeCardSnapshot({ garageSpaces: 'Attached side 2 car', basementNotes: 'Unfinished', schoolsNotes: 'Anchor Bay Schools — 8/10', homeCondition: ['Move-In Ready'] }, 'Two Story');
  assert.deepEqual(facts, [
    { label: 'Garage', value: '2 Car Attached' },
    { label: 'Basement', value: 'Unfinished' },
    { label: 'Home condition', value: 'Move-In Ready' },
    { label: 'Schools', value: 'Anchor Bay Schools' },
    { label: 'Style', value: 'Two Story' },
  ]);
  assert.deepEqual(homeCardSnapshot({ basementNotes: 'Unknown', schoolsNotes: 'N/A', homeCondition: [] }, null), []);
});

test('every Must Have is listed regardless of category, and the match itself is untouched', () => {
  const allSelected = [
    criterion('preferredPropertyTypes', 'must', true, false),
    criterion('budget', 'must', true, false),
    criterion('beds', 'must', true, false),
    criterion('sqft', 'must', false, null),
    criterion('homeCondition', 'must', true, true),
    criterion('features:Home Office', 'must', true, true),
    criterion('exterior:Fenced Yard', 'must', false, null),
    criterion('features:Natural Light', 'must', true, true, false),
  ];
  const match = { allSelected, pct: 42 };
  const result = selectHomeCardCriteria(match);
  // Failures first, then Unknown, then met — all eight, nothing excluded for its category.
  assert.deepEqual(result.mustHaves.map(({ label }) => label), ['preferredPropertyTypes', 'budget', 'beds', 'sqft', 'Fenced Yard', 'homeCondition', 'Home Office', 'Natural Light']);
  assert.equal(result.criteriaSummary.mismatches.length, 3);
  assert.equal(result.criteriaSummary.unknown.length, 2);
  assert.equal(match.allSelected, allSelected);
  assert.deepEqual(allSelected.map(({ label }) => label), ['preferredPropertyTypes', 'budget', 'beds', 'sqft', 'homeCondition', 'Home Office', 'Fenced Yard', 'Natural Light'], 'sorting never reorders computeMatch\'s array');
  assert.equal(match.pct, 42);
});

test('card renders compact unboxed facts and preserves adjacent component contracts', () => {
  const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');
  const css = fs.readFileSync('src/app/globals.css', 'utf8');
  assert.doesNotMatch(board, /Home Snapshot|hh-snapshot-fact|hh-card-context-group/);
  // Unboxed (no border, padding or background); a two-column facts grid with
  // each label above its value, and a long value taking the full row.
  const factListRule = css.match(/\.hh-property-facts\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(factListRule, /border|padding|background/);
  assert.match(factListRule, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.hh-property-fact\.is-wide \{ grid-column: 1 \/ -1; \}/);
  assert.match(board, /className="hh-property-facts"/);
  assert.match(board, /className=\{`hh-property-fact\$\{String\(value\)\.length > 24 \? ' is-wide' : ''\}`\}/);
  assert.doesNotMatch(board, /Property Snapshot|PROPERTY SNAPSHOT|Must Haves<\/(h\d|strong|span)>/i, 'no added headings');
  // My Homes Visual Refresh: the "Personalized Criteria — n/n evaluated" heading is
  // gone; one compact summary line (matches · misses · unknown) replaces it.
  assert.doesNotMatch(board, /Personalized Criteria|Personalized Match|<strong>Must Haves<\/strong>/);
  assert.match(board, /className="hh-match-summary-line"/);
  assert.match(board, /<CriteriaDisclosure symbol="\?"/);
  assert.match(board, /className="hh-card-commute"/);
  assert.match(board, /className="hh-home-card-actions"/);
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

test('card polish: room under the score, link-like criteria summaries with focus ring, fact labels 12px small caps, values 13px', () => {
  const css = fs.readFileSync('src/app/globals.css', 'utf8');
  assert.match(css, /\.hh-must-summary \{[^}]*margin: 14px 0 0;/);
  assert.match(css, /\.hh-home-card \.hh-match-score-value strong \{ font-size: 21px;/);
  assert.match(css, /\.hh-match-score-value strong \{ font-size: 20px; font-weight: 700; \}/, 'Compare keeps its score size');
  assert.match(css, /\.hh-match-summary-line \.hh-criteria-disclosure > button \{ text-decoration: underline;/);
  assert.match(css, /button\[aria-expanded="true"\] \{ text-decoration-color: currentColor; \}/);
  assert.match(css, /\.hh-criteria-disclosure>button:focus-visible\{outline:2px solid var\(--focus-ring\)/, 'the shared focus ring stays');
  assert.match(css, /\.hh-property-fact dt \{[^}]*font: 600 12px\/1\.25 var\(--font-ui\); letter-spacing: \.035em; text-transform: uppercase;/);
  assert.match(css, /\.hh-property-fact dd \{[^}]*font-size: 13px;/);
});
