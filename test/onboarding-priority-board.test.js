import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SELECTED_TIER,
  FEATURES_SPECIFIC,
  TIER_DESCRIPTIONS,
  TIER_META,
  TIER_ORDER,
  getItemlistCategories,
  isExperientialCriterion,
  normalizePriorities,
} from '../src/lib/constants.js';
import { selectPriorityItem, splitCategoryItems } from '../src/lib/matching.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('onboarding uses the shared three-tier board with integrated explanations', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(onboarding, /<PriorityBoard priorities=\{priorities\} patch=\{patch\} onboarding \/>/);
  assert.doesNotMatch(onboarding, /TIER_LEGEND/);
  assert.deepEqual(TIER_ORDER.slice(0, 3).map((tier) => TIER_META[tier].label), ['Must have', 'Important', 'Nice to have']);
  assert.deepEqual(TIER_DESCRIPTIONS, {
    must: 'One of your highest priorities.',
    important: 'This should weigh heavily in your Match.',
    nice: 'A bonus, but not a requirement.',
  });
  assert.match(board, /onboarding && <p className="hh-tier-description">\{TIER_DESCRIPTIONS\[tier\]\}<\/p>/);
  assert.match(board, /selected\.filter\(\(item\) => item\.tier === tier\)/);
});

test('onboarding keeps the complete canonical suggestion bank directly visible', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /const choicesOpen = onboarding \|\| addOpen/);
  assert.match(board, /\{choicesOpen && \(/);
  assert.match(board, /!onboarding && \([\s\S]*?\+ Add another priority/);
  assert.doesNotMatch(board, /<summary>More specific preferences<\/summary>/);
  assert.deepEqual(FEATURES_SPECIFIC.map((item) => item.label), ['Guest / In-Law Suite', 'Basement Bedroom']);
  assert.match(board, /\.\.\.\(def\.specificItems \|\| \[\]\)/);
  assert.deepEqual(getItemlistCategories('purchase').map((category) => category.title),
    ['Location', 'Home Features', 'Exterior & Property', 'Home Feel']);
});

test('suggestions click to Important and drag to any destination without persisting rank', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.equal(DEFAULT_SELECTED_TIER, 'important');
  assert.match(board, /className="hh-chip" onClick=\{\(\) => selectItem\(def, item\)\} onDragStart/);
  assert.match(board, /selectItem\(dragged\.def, dragged\.item, tier\)/);
  assert.match(board, /setTier\(dragged\.item\.categoryKey, dragged\.item\.label, tier\)/);
  assert.doesNotMatch(board, /\b(rank|sortIndex|position|order)\s*:/);

  const priorities = normalizePriorities({ searchType: 'purchase' });
  const features = getItemlistCategories('purchase').find((category) => category.key === 'features');
  const fireplace = features.coreItems.find((item) => item.label === 'Fireplace');
  const selected = selectPriorityItem(priorities.features, features, fireplace, DEFAULT_SELECTED_TIER);
  assert.equal(selected.tiers.Fireplace, 'important');
});

test('stored tiers, contextual movement, removal, and save architecture remain canonical', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const priorities = normalizePriorities({
    searchType: 'purchase',
    features: {
      customItems: [{ label: 'Central Air', kind: 'check' }],
      tiers: { Fireplace: 'must', Basement: 'nice', 'Central Air': 'important' },
    },
  });
  const features = getItemlistCategories('purchase').find((category) => category.key === 'features');
  const items = splitCategoryItems(features, priorities);
  for (const [label, tier] of Object.entries(priorities.features.tiers)) {
    assert.ok([...items.core, ...items.custom].some((item) => item.label === label));
    assert.equal(priorities.features.tiers[label], tier);
  }
  assert.match(board, /Move to \{TIER_META\[target\]\.label\}/);
  assert.match(board, />Remove priority<\/button>/);
  assert.match(board, /setTier\(item\.categoryKey, item\.label, 'dontcare'\)/);
  assert.match(onboarding, /savePriorities\(createClient\(\), \{ id: searchId \}, userId, next\)/);
});

test('Schools, custom priorities, and centralized experiential guidance are preserved', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const schools = read('src/components/SchoolsRelevanceGate.jsx');
  assert.match(onboarding, /<SchoolsRelevanceGate priorities=\{priorities\} patch=\{patch\} \/>/);
  assert.match(schools, /Will schools factor into your decision\?/);
  assert.match(schools, /tiers: \{ \.\.\.n\.location\.tiers, Schools: DEFAULT_SELECTED_TIER \}/);
  assert.match(board, /placeholder="Add your own\.\.\."/);
  assert.match(board, /addCustomItem\(newItemCategory/);
  assert.equal(isExperientialCriterion('homeFeel', 'Natural Light'), true);
  assert.equal(board.match(/Best answered after you tour<\/div>/g)?.length, 1);
  assert.doesNotMatch(board, /We'll ask after you tour/);
});

test('onboarding teaches drag and responds without horizontal scrolling', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /Drag a preference into the column that matches how much it matters to you\. You can move it later if you change your mind\. You can also click a preference to add it\./);
  assert.match(css, /\.hh-priority-tiers \{[^}]*repeat\(3/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.hh-onboarding-priority-board \.hh-priority-tiers \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(css, /hh-onboarding-priority-board[^}]*overflow-x/);
  assert.match(css, /\.hh-suggestion-grid \{[^}]*repeat\(4/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.hh-suggestion-grid \{ grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.hh-priority-tiers, \.hh-suggestion-grid[^}]*grid-template-columns: 1fr/);
});

test('Match weights are unchanged', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(TIER_META).map(([tier, meta]) => [tier, meta.weight])), {
    must: 4,
    important: 2,
    nice: 1,
    dontcare: 0,
  });
});
