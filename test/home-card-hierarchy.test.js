import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectHomeCardCriteria } from '../src/lib/matching.js';
import { formatCardGarage, homeCardSnapshot } from '../src/lib/homeCardPresentation.js';

const criterion = (key, tier, evaluated, met) => ({ key, label: key.split(':').at(-1), tier, evaluated, met });

test('Must Haves prioritize failed, then unknown, then met and use truthful overflow', () => {
  const match = { allSelected: [
    criterion('features:Fenced Yard', 'must', true, true),
    criterion('features:Office', 'must', false, null),
    criterion('features:Pool', 'must', true, false),
    criterion('features:Fireplace', 'must', true, true),
  ] };
  const result = selectHomeCardCriteria(match);
  assert.deepEqual(result.mustHaves.map((item) => [item.label, item.evaluated, item.met]), [
    ['Pool', true, false], ['Office', false, null], ['Fenced Yard', true, true],
  ]);
  assert.equal(result.mustOverflow, 1);
});

test('Personalized Criteria is feature-only, ranked, deduplicated, known, and capped 2 + 2', () => {
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
  assert.deepEqual(result.positives.map((item) => item.label), ['Important positive one', 'Important positive two']);
  assert.deepEqual(result.negatives.map((item) => item.label), ['Important negative one', 'Important negative two']);
  assert.ok([...result.positives, ...result.negatives].every((item) => item.key.includes(':') && item.tier !== 'must' && item.evaluated));
});

test('Personalized Criteria shows fewer rows when fewer known feature results exist', () => {
  const result = selectHomeCardCriteria({ allSelected: [criterion('features:Central Air', 'nice', true, true), criterion('features:Pool', 'nice', false, null)] });
  assert.equal(result.positives.length, 1);
  assert.equal(result.negatives.length, 0);
});

test('Home Snapshot canonicalizes garage and omits unknown facts', () => {
  assert.equal(formatCardGarage({ garageSpaces: 'Attached side 2 car', checks: {} }), '2 Car Attached');
  const facts = homeCardSnapshot({ garageSpaces: '2', basementNotes: 'Unknown', schoolsNotes: 'Grosse Pointe — 8/10', homeCondition: [] }, 'Two Story');
  assert.deepEqual(facts, [
    { label: 'Garage', value: '2 Car' },
    { label: 'Style', value: 'Two Story' },
    { label: 'Schools', value: 'Grosse Pointe' },
  ]);
});

test('card does not render crossroads or stale touring language', () => {
  const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');
  const ui = fs.readFileSync('src/components/ui.jsx', 'utf8');
  assert.doesNotMatch(board, /home\.crossroads/);
  assert.doesNotMatch(ui, /to review after touring/);
});
