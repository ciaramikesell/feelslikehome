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
  assert.match(panel, /<PriorityBoard priorities=\{priorities\} patch=\{patch\} catalogOpen=\{catalogOpen\} onCatalogOpenChange=\{onCatalogOpenChange\} \/>/);
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

test('drag education is concise and non-redundant: the top heading teaches rearranging, the lower panel teaches adding', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /Drag a preference below into a column to add it to your priorities\./);
  assert.doesNotMatch(board, /drag your existing priorities between columns to change how much they matter/);
  assert.match(board, /className="hh-chip" onClick=\{\(\) => selectItem\(def, item\)\} onDragStart/);
});

test('My Search gives the priority board its own always-visible "drag to rank" heading, not buried in the collapsed add-priority panel', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /\{!onboarding && \(\s*<div className="hh-priority-instructions">/);
  assert.match(board, /<h3 className="hh-priority-instructions-heading">Rank what matters to you<\/h3>/);
  // Simplified per round-2 feedback: the column names are already visibly
  // labeled immediately below, so the instruction no longer re-lists them.
  assert.match(board, /<p className="hh-priority-instructions-copy">Drag any priority to move it between the three columns\.<\/p>/);
  assert.match(css, /\.hh-priority-instructions-heading \{[^}]*font: 600 18px var\(--font-serif\)/);
  // The instructions render ahead of both the desktop tier columns and the
  // mobile tier-summary rows, not nested inside either branch.
  const instructionsIndex = board.indexOf('hh-priority-instructions">');
  const mobileBranchIndex = board.indexOf('mobileCompact ? (');
  assert.ok(instructionsIndex > -1 && instructionsIndex < mobileBranchIndex);
});

test('each selected priority card carries a decorative grip handle that visually signals drag, without a competing "Change" action or a second drag target', () => {
  const board = read('src/components/PriorityBoard.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /import \{ ChevronRight, GripVertical, Plus \} from 'lucide-react'/);
  assert.match(board, /<GripVertical className="hh-priority-grip" size=\{16\} aria-hidden="true" \/>\s*<span>\{criterionDisplayLabel/);
  // "Change" competed visually with the grip and implied clicking was how you
  // moved a priority — removed since the row itself has no separate handler
  // for it (aria-label already says "Open priority actions").
  assert.doesNotMatch(board, /hh-priority-change|>Change<\/small>/);
  // The grip has no handlers of its own — the whole existing button stays
  // the one draggable + clickable target (Section 9's "decorative only" rule).
  assert.equal((board.match(/onDragStart=/g) || []).length, 2);
  assert.equal((board.match(/GripVertical/g) || []).length, 2);
  assert.match(css, /\.hh-priority-grip \{[^}]*color: var\(--ink-soft\)/);
});

test('desktop drag affordance: existing grab/grabbing cursor is preserved and the grip stays neutral (not orange) even on hover', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-selected-priority \{[^}]*cursor: grab;/);
  assert.match(css, /\.hh-selected-priority:active \{ cursor: grabbing; \}/);
  assert.match(css, /\.hh-selected-priority:hover \.hh-priority-grip, \.hh-selected-priority:focus-visible \.hh-priority-grip \{ color: var\(--ink-soft\); \}/);
});

test('the card-level label is visually subordinate to the actionable "Rank what matters to you" heading', () => {
  const panel = read('src/components/MySearchPanel.jsx');
  assert.match(panel, /<SearchCard showHeader=\{false\}>\s*<p className="hh-label"[^>]*>What Matters Most to Me<\/p>/);
  // hh-label is the app's existing small/muted caption style (see e.g. field
  // labels in BasicsCard) — reused here rather than inventing a new one.
  assert.match(read('src/app/globals.css'), /\.hh-label \{ font-size: 12\.5px; color: var\(--ink-soft\)/);
});

test('the pre-existing tap-to-open "Move to X" / "Remove priority" menu remains the accessible non-drag alternative for touch and keyboard, unchanged by the new grip affordance', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /aria-expanded=\{open\}/);
  assert.match(board, /onClick=\{\(\) => setActiveItem\(open \? null : key\)\}/);
  assert.match(board, /Move to \{TIER_META\[target\]\.label\}/);
  assert.match(board, />Remove priority<\/button>/);
  // Clicking the card still only opens the menu — no navigation was introduced.
  assert.doesNotMatch(board, /router\.push|router\.replace|href=\{.*item\.label/);
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

test('My Search omits redundant guidance while retaining contextual tour language only', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.doesNotMatch(board, /Choose the pre-tour details/);
  assert.doesNotMatch(board, /Best answered after you tour<\/div>/);
  assert.doesNotMatch(board, /experiential priorities stay Unknown/);
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

/* ------------------------------ global buyer-shell availability + Realtor exclusion ------------------------------ */

test('the How it works trigger and modal are owned by the single shared AppShell, not any individual page — every buyer route that renders through it inherits it automatically', () => {
  const shell = read('src/components/AppShell.jsx');
  // One canonical component/content source — no per-page duplicates.
  assert.equal((shell.match(/function HowToUseModal/g) || []).length, 1);
  for (const other of [
    'src/app/(app)/homes/page.js', 'src/app/(app)/homes/[homeId]/page.js', 'src/app/(app)/tour/page.js',
    'src/app/(app)/compare/page.js', 'src/app/(app)/map/page.js', 'src/app/(app)/search/page.js',
    'src/app/(app)/account/page.js', 'src/app/(app)/favorites/page.js', 'src/app/(app)/archive/page.js',
  ]) {
    const src = read(other);
    assert.doesNotMatch(src, /HowToUseModal|How Feels Like Home works/, `${other} must not own its own copy of the modal`);
  }
});

test('How it works is excluded from Realtor workspace — the trigger and the modal itself are both gated on !isRealtorWorkspace', () => {
  const shell = read('src/components/AppShell.jsx');
  assert.match(shell, /\{!isRealtorWorkspace && \(\s*<button className="hh-shell-action" onClick=\{\(\) => setHowToOpen\(true\)\}>/);
  assert.match(shell, /\{!isRealtorWorkspace && howToOpen && <HowToUseModal onClose=\{\(\) => setHowToOpen\(false\)\} \/>\}/);
});

test('Realtor-workspace exclusion is route-scoped (/people, /realtor), not a global account label — the same isRealtorWorkspace flag every other Realtor-only shell element already uses', () => {
  const layout = read('src/app/(app)/layout.js');
  assert.match(layout, /isRealtorWorkspace = requestedPath\.startsWith\('\/people'\) \|\| requestedPath\.startsWith\('\/realtor'\)/);
  assert.doesNotMatch(layout, /account_entry_intent.*isRealtorWorkspace|users\.role/);
  // /account never takes the isRealtorWorkspace branch — a Realtor-only
  // account visiting Account Settings still gets the buyer shell (and so
  // still gets How it works), matching every other buyer-shell utility
  // (My Search, tabs, mobile nav) that Account Settings already inherits.
  const realtorBranch = layout.match(/if \(isRealtorWorkspace\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.doesNotMatch(realtorBranch, /\/account/);
});

test('a dual-role person (owns a buyer search and assists as a Realtor) sees How it works on their own buyer routes but not on /people or /realtor — context is route-scoped, matching the existing Realtor Home/People I’m Helping links', () => {
  const shell = read('src/components/AppShell.jsx');
  // Same isRealtorWorkspace flag already gates every other Realtor-only
  // shell affordance (tabs, mobile nav, My Search) — How it works now
  // follows that identical, already-proven pattern rather than inventing a
  // new one.
  assert.match(shell, /!isRealtorWorkspace && <nav className="hh-tabs"/);
  assert.match(shell, /!isRealtorWorkspace && <MobileNav/);
  assert.match(shell, /!isRealtorWorkspace && howToOpen/);
});

test('opening/closing How it works never navigates, writes to the database, or touches search/participant/Match state — it is local UI state only', () => {
  const shell = read('src/components/AppShell.jsx');
  const modalFn = shell.match(/function HowToUseModal[\s\S]*?\n}\n/)?.[0] || '';
  assert.doesNotMatch(modalFn, /router\.push|router\.replace|supabase|await |onboarding_complete/i);
  // The trigger/state live in AppShell itself, not behind a route change —
  // clicking it is a plain useState toggle, so the current URL/route is
  // never touched.
  assert.match(shell, /const \[howToOpen, setHowToOpen\] = useState\(false\)/);
});

test('manual help does not alter first-run tour persistence or eligibility', () => {
  const shell = read('src/components/AppShell.jsx');
  assert.match(shell, /const MOBILE_TOUR_DISMISS_KEY = 'flh-mobile-tour-dismissed'/);
  assert.match(shell, /localStorage\.getItem\(MOBILE_TOUR_DISMISS_KEY\) === '1'/);
  assert.match(shell, /localStorage\.setItem\(MOBILE_TOUR_DISMISS_KEY, '1'\)/);
  assert.match(shell, /tourEligibleDevice && !tourDismissed && pathname === '\/homes'/);
  assert.doesNotMatch(shell, /setHowToOpen\(true\)[\s\S]{0,100}MOBILE_TOUR_DISMISS_KEY/);
});
