import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SELECTED_TIER, FEATURES_SPECIFIC, TIER_META, getItemlistCategories, normalizePriorities } from '../src/lib/constants.js';
import { computeMatch, splitCategoryItems } from '../src/lib/matching.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('specific defaults are demoted without losing legacy selections or canonical tiers', () => {
  assert.equal(DEFAULT_SELECTED_TIER, 'important');
  assert.equal(TIER_META.must.weight, 4);
  assert.deepEqual(FEATURES_SPECIFIC.map(({ label }) => label), ['Guest / In-Law Suite', 'Basement Bedroom']);
  for (const intent of ['purchase', 'rental']) {
    const features = getItemlistCategories(intent).find(({ key }) => key === 'features');
    assert.ok(!features.suggestedItems.some(({ label }) => FEATURES_SPECIFIC.some((item) => item.label === label)));
    assert.deepEqual(features.specificItems, FEATURES_SPECIFIC);
  }
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'Basement Bedroom': 'must' } } });
  const before = structuredClone(priorities);
  const split = splitCategoryItems(getItemlistCategories('purchase')[1], priorities);
  assert.ok(split.custom.some(({ label }) => label === 'Basement Bedroom'));
  assert.deepEqual(priorities, before);
  assert.equal(computeMatch({ checks: { 'features:Basement Bedroom': true } }, priorities).pct, 100);
});

test('My Search makes names primary, importance quietly editable, responsive, and never draggable', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /hh-priority-editor-name/);
  assert.match(board, /<TierPicker quiet ariaLabel=/);
  assert.doesNotMatch(board, /draggable=|onDrag|drag-and-drop/i);
  assert.match(css, /\.hh-priority-editor-grid \{[^}]*repeat\(3/);
  assert.match(css, /\.hh-priority-editor-grid, \.hh-suggestion-grid, \.hh-how-to-notes \{ grid-template-columns: 1fr; \}/);
});

test('post-tour guidance appears once and uses the central experiential classification accessibly', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.equal(board.match(/Best answered after you tour<\/p>/g)?.length, 1);
  assert.match(board, /isExperientialCriterion\(item\.categoryKey, item\.label\)/);
  assert.match(board, /aria-label="Best answered after you tour"/);
  assert.doesNotMatch(board, /We&apos;ll ask after you tour/);
});

test('How to Use tells the current six-step, Match, and private collaboration story', () => {
  const shell = read('src/components/AppShell.jsx');
  assert.equal(shell.match(/\{ title:/g)?.length, 6);
  for (const copy of ['Zillow', 'not a listing-search engine', 'Favorite', 'Want to Tour', 'Overall Feeling', 'Compare the survivors', 'Map is another view']) assert.match(shell, new RegExp(copy));
  assert.match(shell, /unknown details aren&apos;t treated as misses/);
  assert.doesNotMatch(shell, /hard disqualification|dealbreaker/);
  assert.match(shell, /The house is ours\. The opinion is mine\./);
  assert.match(shell, /each person keeps their own priorities and opinions/);
  assert.match(shell, /there is no combined Couple Match/);
});
