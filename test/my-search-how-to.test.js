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

test('My Search priority board groups selected criteria by tier with compact accessible controls', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /TIER_ORDER\.filter\(\(t\) => t !== 'dontcare'\)/);
  assert.match(board, /selectedPooled\.filter\(\(i\) => i\.tier === tier\)/);
  assert.match(board, /hh-priority-column-\$\{tier\}/);
  assert.match(board, /TIER_META\[tier\]\.label/);
  assert.match(board, /hh-priority-editor-name/);
  assert.match(board, /<TierPicker quiet ariaLabel=/);
  assert.match(board, /aria-label=\{`Remove /);
  assert.doesNotMatch(board, /hh-priority-editor-item/);
  assert.match(css, /\.hh-priority-board \{[^}]*repeat\(3/);
  assert.match(css, /\.hh-priority-board-item \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.hh-priority-column-must[^}]*var\(--brick\)/);
  assert.match(css, /\.hh-priority-column-important[^}]*var\(--moss\)/);
  assert.match(css, /\.hh-priority-column-nice[^}]*#b49a78/);
});

test('dragging only changes tiers through the same priority mutation as the dropdown', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /const setTier = \(categoryKey, label, tier\) => patch/);
  assert.match(board, /onChange=\{\(tier\) => setTier\(item\.categoryKey, item\.label, tier\)\}/);
  assert.match(board, /if \(draggedItem && draggedItem\.tier !== tier\)/);
  assert.match(board, /setTier\(draggedItem\.categoryKey, draggedItem\.label, tier\)/);
  assert.match(board, /className="hh-priority-drag-handle"[\s\S]*?draggable/);
  assert.doesNotMatch(board, /\b(order|rank|position|sortIndex)\s*:/);
});

test('configured Schools remains usable inside a compact item', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /item\.label === 'Schools'[\s\S]*?<input/);
  assert.match(board, /onChange=\{\(e\) => setSchoolsNote\(e\.target\.value\)\}/);
  assert.match(css, /\.hh-priority-board-item > \.hh-input \{ grid-column: 2 \/ -1; \}/);
});

test('available preferences use four, two, and one-column responsive layouts', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-suggestion-grid \{[^}]*repeat\(4/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.hh-suggestion-grid \{ grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.hh-priority-board, \.hh-suggestion-grid, \.hh-how-to-notes \{ grid-template-columns: 1fr; \}/);
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
  assert.match(shell, /<strong>Match shows how the known information about a home lines up with your priorities\.<\/strong>/);
  assert.match(shell, /<strong>The house is ours\. The opinion is mine\.<\/strong>/);
  assert.match(shell, /role="dialog" aria-modal="true"/);
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-how-to \{[^}]*max-width: 940px;[^}]*max-height: calc\(100dvh - 48px\);[^}]*overflow-y: auto/);
  assert.match(css, /\.hh-how-to-steps \{[^}]*repeat\(2/);
  assert.match(shell, />Got it<\/button>/);
});
