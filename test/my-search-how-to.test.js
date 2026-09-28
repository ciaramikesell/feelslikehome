import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SELECTED_TIER, FEATURES_SPECIFIC, TIER_META, getItemlistCategories, normalizePriorities } from '../src/lib/constants.js';
import { computeMatch, splitCategoryItems } from '../src/lib/matching.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('purchase catalog has only the three pre-tour families', () => {
  assert.equal(DEFAULT_SELECTED_TIER, 'important');
  assert.deepEqual(getItemlistCategories('purchase').map(({ title }) => title), ['Location & Surroundings', 'Home Features', 'Exterior & Property']);
});

test('My Search keeps one compact canonical board while add choices are progressively disclosed', () => {
  const board = read('src/components/RankBoard.jsx');
  const editor = read('src/components/RankPrioritiesEditor.jsx');
  const panel = read('src/components/MySearchPanel.jsx');
  // One board, three levels, one row treatment — shared by onboarding and My Search.
  assert.match(board, /levels\.map\(\(level\) =>/);
  assert.equal(board.match(/className=\{`flh-rank-row /g)?.length, 1);
  // Add choices are progressively disclosed in their own Sheet, never inline on the resting board.
  assert.match(editor, /const \[adding, setAdding\] = useState\(false\)/);
  assert.match(editor, /<AddPrioritySheet open=\{adding\}/);
  assert.match(editor, /Add a priority/);
  // The overview summarizes; editing happens in the focused editor.
  assert.match(panel, /href="\/search\/priorities"/);
  assert.doesNotMatch(panel, /<RankBoard/);
  assert.doesNotMatch(board, /<TierPicker|aria-label=\{`Remove /);
});

test('selected rows expose contextual keyboard actions without resting-board clutter', () => {
  const board = read('src/components/RankBoard.jsx');
  // Tapping a priority (or pressing Enter/Space on its handle) opens an explicit level picker.
  assert.match(board, /onClick=\{\(\) => setPicker\(item\)\}/);
  assert.match(board, /if \(event\.key === 'Enter' \|\| event\.key === ' '\) \{ event\.preventDefault\(\); setPicker\(item\); \}/);
  assert.match(board, /role="radio"[\s\S]*?aria-checked=\{picker\.tier === tier\}/);
  assert.match(board, /PRIORITY_LEVELS\.map\(\(tier\) =>/);
  assert.match(board, />Remove priority<\/button>/);
  const editor = read('src/components/RankPrioritiesEditor.jsx');
  assert.match(editor, /onRemove=\{\(item\) => setDraft\(\(current\) => moveCriterion\(current, item\.categoryKey, item\.label, 'dontcare'\)\)\}/);
});

test('selected and available drags use existing tier semantics without manual ranking', async () => {
  const board = read('src/components/RankBoard.jsx');
  // Dragging only ever changes a priority's level through onMove(item, tier).
  assert.match(board, /if \(current\.overTier && current\.overTier !== current\.item\.tier\) onMove\(current\.item, current\.overTier\);/);
  assert.match(board, /data-rank-tier=\{level\.tier\}/);
  // Pointer events (not HTML5 drag-and-drop, which iOS touch never fires) and a tap fallback.
  assert.match(board, /onPointerDown=\{\(event\) => handlePointerDown\(event, item\)\}/);
  assert.match(board, /if \(!current\.moved\) \{ setPicker\(current\.item\); return; \}/);
  assert.doesNotMatch(board, /\b(order|rank|position|sortIndex)\s*:/);
  const { moveCriterion } = await import('../src/lib/searchProfile.js');
  const before = normalizePriorities({ searchType: 'purchase', features: { customItems: [{ label: 'Fireplace', kind: 'check' }], tiers: { Fireplace: 'important' }, order: ['Fireplace'] } });
  const after = moveCriterion(before, 'features', 'Fireplace', 'must');
  assert.equal(after.features.tiers.Fireplace, 'must');
  assert.deepEqual(after.features.order, ['Fireplace']);
  assert.deepEqual(after.features.customItems, before.features.customItems);
});

test('Schools configuration and specific/custom preference discovery remain available', async () => {
  const board = read('src/components/RankBoard.jsx');
  const editor = read('src/components/RankPrioritiesEditor.jsx');
  assert.match(board, /picker\.label === 'Schools'[\s\S]*?School preference/);
  assert.match(board, /onChange=\{\(event\) => onSchoolsNoteChange\(event\.target\.value\)\}/);
  assert.match(editor, /Schools: note/);
  assert.match(editor, /placeholder="What else matters\?"/);
  assert.match(editor, /addCustomCriterion\(current, category, label, offered\)/);
  const profile = read('src/lib/searchProfile.js');
  assert.match(profile, /\.\.\.\(def\.specificItems \|\| \[\]\)/);
});

test('drag education distinguishes moving existing priorities from adding new ones', () => {
  const editor = read('src/components/RankPrioritiesEditor.jsx');
  assert.match(editor, /Rank what matters to you/);
  assert.match(editor, /Drag a priority by its handle, or tap it to choose its level\./);
  assert.match(editor, /New priorities start as Important\. You can move them once they’re on your board\./);
});

test('structured basics use a compact responsive grid and carry no importance controls', () => {
  const panel = read('src/components/BasicsEditor.jsx');
  const css = read('src/app/globals.css');
  assert.match(panel, /className="hh-basics-grid"/);
  for (const label of ['Minimum Square Footage', 'Minimum Lot Size', 'Minimum Bedrooms', 'Minimum Bathrooms']) assert.match(panel, new RegExp(label));
  assert.match(panel, /wide label=\{terminology\(p\.searchType\)\.budgetLabel\}/);
  // Search Basics are not weighted in Match, so they have no tier picker at all.
  assert.doesNotMatch(panel, /TierPicker|importance`/);
  assert.match(panel, /aren’t weighted in Match/);
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

test('My Search omits redundant guidance while retaining contextual tour language only', () => {
  for (const path of ['src/components/RankBoard.jsx', 'src/components/RankPrioritiesEditor.jsx', 'src/components/MySearchPanel.jsx']) {
    const source = read(path);
    assert.doesNotMatch(source, /Choose the pre-tour details/);
    assert.doesNotMatch(source, /Best answered after you tour<\/div>/);
    assert.doesNotMatch(source, /experiential priorities stay Unknown/);
    assert.doesNotMatch(source, /We&apos;ll ask after you tour/);
  }
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
