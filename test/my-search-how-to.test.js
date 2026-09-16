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

test('My Search keeps one compact canonical board while add choices are progressively disclosed', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const panel = read('src/components/MySearchPanel.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /hh-priority-tiers/);
  assert.match(board, /TIER_ORDER\.filter\(\(tier\) => tier !== 'dontcare'\)/);
  assert.match(board, /selected\.filter\(\(item\) => item\.tier === tier\)/);
  assert.equal(board.match(/hh-selected-priority"/g)?.length, 1);
  assert.match(board, /const choicesOpen = onboarding \|\| addOpen/);
  assert.match(board, /\{choicesOpen && \(/);
  assert.match(board, /\+ Add another priority/);
  assert.match(board, /Close choices/);
  assert.match(panel, /<PriorityBoard priorities=\{priorities\} patch=\{patch\} \/>/);
  assert.doesNotMatch(panel, /showHeader=!editOpen/);
  assert.match(css, /\.hh-selected-priority \{[^}]*background: transparent/);
  assert.doesNotMatch(board, /<TierPicker|aria-label=\{`Remove /);
});

test('selected rows expose contextual keyboard actions without resting-board clutter', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /aria-expanded=\{open\}/);
  assert.match(board, /onClick=\{\(\) => setActiveItem/);
  assert.match(board, /Move to \{TIER_META\[target\]\.label\}/);
  assert.match(board, /disabled=\{target === tier\}/);
  assert.match(board, />Remove priority<\/button>/);
  assert.match(board, /setTier\(item\.categoryKey, item\.label, 'dontcare'\)/);
});

test('selected and available drags use existing tier semantics without manual ranking', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /const setTier = \(categoryKey, label, tier\) => patch/);
  assert.match(board, /dragged\?\.type === 'selected'[\s\S]*?setTier\(dragged\.item\.categoryKey, dragged\.item\.label, tier\)/);
  assert.match(board, /dragged\?\.type === 'available'[\s\S]*?selectItem\(dragged\.def, dragged\.item, tier\)/);
  assert.match(board, /draggable[\s\S]*?type: 'selected'/);
  assert.match(board, /className="hh-chip"[\s\S]*?type: 'available'/);
  assert.doesNotMatch(board, /\b(order|rank|position|sortIndex)\s*:/);
});

test('Schools configuration and specific/custom preference discovery remain available', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /item\.label === 'Schools'[\s\S]*?School preference/);
  assert.match(board, /onChange=\{\(event\) => setSchoolsNote\(event\.target\.value\)\}/);
  assert.match(board, /\.\.\.\(def\.specificItems \|\| \[\]\)/);
  assert.doesNotMatch(board, /<summary>More specific preferences<\/summary>/);
  assert.match(board, /tierOf\(def, item\.label\) === 'dontcare'/);
  assert.match(board, /placeholder="Add your own\.\.\."/);
  assert.match(board, /addCustomItem\(newItemCategory/);
});

test('drag education explicitly covers suggestions, destination tiers, and existing priorities', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /Drag any preference below into Must Have, Important, or Nice to Have\./);
  assert.match(board, /drag your existing priorities between columns to change how much they matter\./);
  assert.match(board, /className="hh-chip" onClick=\{\(\) => selectItem\(def, item\)\} onDragStart/);
});

test('structured basics use a compact responsive grid and quieter importance controls', () => {
  const panel = read('src/components/MySearchPanel.jsx');
  const css = read('src/app/globals.css');
  assert.match(panel, /className="hh-basics-grid"/);
  for (const label of ['Minimum Square Footage', 'Minimum Lot Size', 'Minimum Bedrooms', 'Minimum Bathrooms']) assert.match(panel, new RegExp(label));
  assert.match(panel, /wide label=\{terminology\(p\.searchType\)\.budgetLabel\}/);
  assert.match(panel, /quiet ariaLabel=\{`\$\{label\} importance`\}/);
  assert.match(css, /\.hh-basics-grid \{[^}]*grid-template-columns: minmax\(210px, 1\.35fr\) repeat\(3/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.hh-basics-grid \{ grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.hh-basics-grid \{ grid-template-columns: 1fr/);
  assert.match(panel, /More specific layout preferences/);
});

test('available suggestions use four, two, and one-column responsive layouts', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-suggestion-grid \{[^}]*repeat\(4/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.hh-suggestion-grid \{ grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.hh-priority-tiers, \.hh-suggestion-grid, \.hh-how-to-notes \{ grid-template-columns: 1fr; \}/);
});

test('post-tour guidance appears once and uses the central experiential classification accessibly', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.equal(board.match(/Best answered after you tour<\/div>/g)?.length, 1);
  assert.match(board, /isExperientialCriterion\(item\.categoryKey, item\.label\)/);
  assert.match(board, /aria-label="Best answered after you tour"/);
  assert.doesNotMatch(board, /We&apos;ll ask after you tour/);
});

test('How it works tells the six-step decision journey in accessible DOM order', () => {
  const shell = read('src/components/AppShell.jsx');
  assert.equal(shell.match(/\{ title:/g)?.length, 6);
  assert.match(shell, /HelpCircle size=\{14\} \/> How it works/);
  assert.match(shell, /title="How Feels Like Home works"/);
  assert.match(shell, /You found the homes\. We&apos;ll help you choose\./);
  const headings = [
    'Find homes wherever you already look',
    'Bring the contenders here',
    "Decide what's worth seeing",
    'Go see them',
    'Tell us how it actually felt',
    'Compare your finalists',
  ];
  let previous = -1;
  for (const heading of headings) {
    const position = shell.indexOf(heading);
    assert.ok(position > previous, `${heading} follows the previous step in DOM order`);
    previous = position;
  }
  for (const copy of ['Zillow', 'not a listing-search engine', 'Favorite', 'Want to Tour', 'Overall Feeling', 'Compare your finalists', 'Map is another view']) assert.match(shell, new RegExp(copy));
  assert.doesNotMatch(shell, /Compare the survivors/);
  assert.match(shell, /unknown details don&apos;t count against a home/);
  assert.doesNotMatch(shell, /hard disqualification|dealbreaker/);
  assert.match(shell, /Match on paper/);
  assert.match(shell, /The house is ours\. The opinion is mine\./);
  assert.match(shell, /only their author can change them/);
  assert.match(shell, /there is no combined score or winner/);
  assert.match(shell, /<strong>Match shows how the known information about a home lines up with what matters to you\.<\/strong>/);
  assert.match(shell, /<strong>The house is ours\. The opinion is mine\. The conversation is shared\.<\/strong>/);
  assert.match(shell, /<Sheet open onClose=\{onClose\}/);
  assert.match(shell, />Got it<\/button>/);
});

test('How it works reuses the focus-managed Sheet and has intentional desktop and mobile layouts', () => {
  const shell = read('src/components/AppShell.jsx');
  const sheet = read('src/components/Sheet.jsx');
  const css = read('src/app/globals.css');
  for (const behavior of [/role="dialog"/, /aria-modal="true"/, /event\.key === 'Escape'/, /event\.key !== 'Tab'/, /previouslyFocused\?\.focus/, /document\.body\.style\.overflow = 'hidden'/]) assert.match(sheet, behavior);
  assert.match(sheet, /aria-label="Close"/);
  assert.match(css, /\.hh-sheet-journey \{ max-width: 1040px; \}/);
  assert.match(css, /\.hh-how-to-steps \{[^}]*repeat\(2/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.hh-how-to-steps \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.hh-how-to-actions \{ position: sticky/);
  assert.match(css, /\.hh-how-to-match \{[^}]*background: var\(--peach\)/);
  assert.match(css, /\.hh-how-to-together \{[^}]*background: var\(--sage\)/);
  assert.match(shell, /howToOpen && <HowToUseModal/);
  assert.match(shell, /onClick=\{\(\) => setHowToOpen\(true\)\}/);
});

test('manual help does not alter first-run tour persistence or eligibility', () => {
  const shell = read('src/components/AppShell.jsx');
  assert.match(shell, /const MOBILE_TOUR_DISMISS_KEY = 'flh-mobile-tour-dismissed'/);
  assert.match(shell, /localStorage\.getItem\(MOBILE_TOUR_DISMISS_KEY\) === '1'/);
  assert.match(shell, /localStorage\.setItem\(MOBILE_TOUR_DISMISS_KEY, '1'\)/);
  assert.match(shell, /tourEligibleDevice && !tourDismissed && pathname === '\/homes'/);
  assert.doesNotMatch(shell, /setHowToOpen\(true\)[\s\S]{0,100}MOBILE_TOUR_DISMISS_KEY/);
});
