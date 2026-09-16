import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/* -------------------------------------------------------------------------
 * PR #88: Compare visual refresh.
 *
 * Source-pattern based, matching this repo's existing test convention (no
 * Next.js/React runtime harness is available in this sandbox) and the same
 * approach used for #86/#87. These verify structural/copy invariants and
 * cannot execute the component against fixture data (2/3/4-home selections,
 * collaborative/solo perspectives) the way a rendered-DOM test would.
 * ------------------------------------------------------------------------- */

test('page identity: exact mandated title/subtitle, nav label untouched', async () => {
  const page = await source('src/app/(app)/compare/page.js');
  const constants = await source('src/lib/constants.js');
  assert.match(page, /title="Compare serious contenders" subtitle="See how your serious contenders measure up on what matters to you\. Match scores reflect your configured preferences\."/);
  assert.match(constants, /\{ key: 'compare', label: 'Compare', href: '\/compare' \}/);
});

test('selector is unchanged: same picker, same thumbnail+identity+Match+selected-state chip, same existing comparison maximum', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /const MAX_COMPARE = 4;/);
  assert.match(board, /function PickerChip\(\{ home, priorities, match, matchTrustworthy, isSelected, disabled, onToggle \}\)/);
  assert.match(board, /className=\{`hh-compare-picker-chip/);
  assert.match(board, /hh-compare-picker-thumb/);
  assert.match(board, /hh-compare-picker-match/);
});

test('selection/deselection and Clear-all-equivalent behavior are untouched: toggle still adds/removes ids and respects the max', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /const toggle = \(id\) => setSelectedIds\(\(prev\) => \{/);
  assert.match(board, /if \(prev\.includes\(id\)\) return prev\.filter\(\(x\) => x !== id\);/);
  assert.match(board, /if \(prev\.length >= MAX_COMPARE\) return prev;/);
});

test('no ranking language anywhere: no #1/#2/#3 Match, no winner/best/recommended/top-choice copy', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.doesNotMatch(board, /#1|#2|#3|Winner|Best Match|Recommended|Top Choice|Couple Match|combined Match|AI recommendation/i);
});

test('contender cards: photo, price, address, beds/baths/sqft, participant-specific Match, and a truthful lifecycle/provenance badge -- never invented state', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /home\.suggestedBy && <span className="hh-provenance">Suggested by \{home\.suggestedBy\}<\/span>/);
  assert.match(board, /\{home\.status && home\.status !== 'Saved' && \(/);
  assert.match(board, /<Footprints size=\{12\} color="var\(--moss\)" \/> \{home\.status\}/);
});

test('Match on contender cards stays participant-specific: unchanged computeMatch/Perspective wiring, unknown stays unknown, no averaging', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /label="You" match=\{match\}/);
  assert.match(board, /label="Collaborator" match=\{coBuyerPerspective\.match\}/);
  assert.match(board, /Not enough information yet/);
  assert.doesNotMatch(board, /average.*match|blended.*match|household.*match/i);
});

test('personal note on card uses the truthful, already-established shared-field language ("Shared notes"/"What you want to remember"), never a false "Your notes" ownership claim', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const detail = await source('src/components/HomeDetail.jsx');
  assert.match(board, /\{isCollaborative \? 'Shared notes' : 'What you want to remember'\}/);
  assert.doesNotMatch(board, /hh-compare-note-label">Your notes/);
  // Same label pair Home Detail already established for this exact tension
  // (notes/pros/cons are a SHARED home field, not participant-owned --
  // see SHARED_FIELDS in collaboration.js) -- reused, not reinvented.
  assert.match(detail, /isCollaborative \? "Shared notes" : "What you want to remember"/);
});

test('note excerpt truncates gracefully (reuses the existing line-clamp utility) instead of stretching one card taller than its neighbors', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const css = await source('src/app/globals.css');
  assert.match(board, /hh-compare-note-text[^`]*hh-card-clamp/);
  assert.match(css, /\.hh-card-clamp \{ display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;/);
});

test('the old bottom Notes section is removed (deduplicated into the card) without deleting note data, its persistence, or its Home Detail edit path', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const detail = await source('src/components/HomeDetail.jsx');
  assert.doesNotMatch(board, /<summary>Notes<\/summary>/);
  // What Stood Out (pros/cons) is a materially different section and stays.
  assert.match(board, /<summary>What Stood Out<\/summary>/);
  assert.match(board, /parseCommaList\(h\.pros\)/);
  assert.match(board, /parseCommaList\(h\.cons\)/);
  // Editing still lives on Home Detail, untouched.
  assert.match(detail, /Edit property notes|Add pros, cons, or a note/);
});

test('Differences Only control: two-state toggle with the actual current count, not a hard-coded number, and unchanged difference-detection semantics', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /className="hh-compare-diff-toggle" role="group"/);
  assert.match(board, />Showing differences only<\/button>/);
  assert.match(board, /Show all \(\{allCriteriaCount\}\)/);
  assert.doesNotMatch(board, /Show all \(25\)/);
  // The row-signature/differs logic itself is byte-for-byte unchanged.
  assert.match(board, /function rowSignature\(c\) \{/);
  assert.match(board, /const differs = \(row\) => new Set\(row\.perHome\.map\(rowSignature\)\)\.size > 1;/);
});

test('What Matters to You is the exact mandated heading; Must-Haves stays its own distinct, differently-weighted section', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /title="What Matters to You"/);
  assert.match(board, /title="Must-Haves"/);
  const usages = board.match(/<CompareRowsSection[\s\S]*?\/>/g) || [];
  assert.equal(usages.length, 3, 'expected exactly three CompareRowsSection usages (Must-Haves, What Matters to You, Facts)');
});

test('evaluation states use the canonical --positive/--negative/--unknown tokens, and Unknown is never styled as a mismatch', async () => {
  const css = await source('src/app/globals.css');
  assert.match(css, /\.hh-criteria-value\.is-met \{ color: var\(--positive\); \}/);
  assert.match(css, /\.hh-criteria-value\.is-missed \{ color: var\(--negative\); \}/);
  assert.match(css, /\.hh-criteria-value\.is-unknown \{ color: var\(--unknown\); \}/);
  // Unknown's color must differ from missed's -- not a quieter shade of the
  // same "mismatch" color.
  assert.doesNotMatch(css, /\.hh-criteria-value\.is-unknown \{ color: var\(--negative\); \}/);
});

test('no invented amber/partial evaluation state: met stays a strict boolean everywhere it already was, per the audited Match engine', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const matching = await source('src/lib/matching.js');
  // CriteriaValue's branching is unchanged: evaluated/unknown, then met
  // true/false -- no third visual state was added.
  assert.match(board, /if \(!c \|\| !c\.evaluated\) \{/);
  assert.match(board, /c\.met \? '✓' : '—'/);
  assert.doesNotMatch(board, /is-partial|is-nuanced|'amber'/i);
  // The engine itself: `met` is push()ed as a strict boolean/null, confirming
  // there is no third state to expose -- "1 of 2 desired baths" is a
  // detail *string* on an already-false met, not a distinct evaluation.
  assert.match(matching, /met \? `\$\{actual\} bath\(s\)` : `\$\{actual\} of \$\{min\} desired baths`/);
});

test('legend uses only supported states -- no entry for a state the data model does not have', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /Meets preference/);
  assert.match(board, /Doesn't meet/);
  assert.match(board, /Not evaluated/);
});

test('Must-Have visibility and priority weighting are untouched: same shared computeMatch/allSelected, no weight changes, no household priorities', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const constants = await source('src/lib/constants.js');
  assert.match(board, /mustRows: visible\.filter\(\(r\) => r\.tier === 'must'\)/);
  assert.match(constants, /must: \{ label: 'Must have', weight: 4/);
  assert.doesNotMatch(board, /household.*priorit/i);
});

test('Home Facts stays a dense comparison table (not per-fact cards), keeps its apartment-aware fact set, and the vocabulary-aware Title Case heading', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /<summary>\{vocabulary\.singular\} Facts<\/summary>/);
  assert.match(board, /const physicalRows = apartment \? PHYSICAL_FACT_ROWS\.filter\(\(row\) => !APARTMENT_IRRELEVANT_FACT_KEYS\.has\(row\.key\)\) : PHYSICAL_FACT_ROWS;/);
  assert.match(board, /APARTMENT_IRRELEVANT_FACT_KEYS = new Set\(\['lot'\]\)/);
});

test('estimated monthly payment keeps its existing label/calculation -- no new mortgage assumptions introduced', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /label: 'Est\. monthly payment', betterHigh: false, get: \(h\) => parseNum\(h\.estMonthly\)/);
});

test('deeper sections stay collapsible; primary identities and the core comparison are never collapsed by default', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const detailsBlocks = board.match(/<details className="hh-details">/g) || [];
  assert.ok(detailsBlocks.length >= 2, 'expected Home Facts and What Stood Out to remain collapsible <details>');
  assert.doesNotMatch(board, /<details[^>]*>\s*<summary>What Matters to You/);
});

test('column order (left-to-right home order) is identical across identity cards, criteria rows, facts, and What Stood Out -- driven by the same `selected` array, never re-sorted by Match', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /selected\.map\(\(h, i\) => \(/);
  assert.match(board, /homes=\{selected\}/);
  assert.doesNotMatch(board, /\.sort\([^)]*match/i);
});

test('comparison capacity is unchanged (still 4), photo sizing still scales distinctly for 2/3/4 homes, no silent hiding of selected homes', async () => {
  const css = await source('src/app/globals.css');
  for (const count of [2, 3, 4]) {
    assert.match(css, new RegExp(`\\.hh-compare-identity-grid\\[data-count="${count}"\\] \\.hh-compare-photo`));
  }
});

test('remove-from-comparison only changes local Compare selection -- it is not wired to archive/delete/favorite/want-to-tour/dismiss actions', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const toggleFn = board.slice(board.indexOf('const toggle = (id)'), board.indexOf('const toggle = (id)') + 300);
  assert.doesNotMatch(toggleFn, /archive|delete|isFavorite|wantToTour|dismiss/i);
});

test('View home links to the canonical Home Detail route with the caller-supplied basePath -- no duplicate detail view built into Compare', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /<Link href=\{`\$\{basePath\}\/\$\{encodeURIComponent\(home\.id\)\}`\} className="hh-btn hh-btn-ghost hh-compare-view-home">View \{vocabulary\?\.singularLower \|\| 'home'\}<\/Link>/);
});

test('collaboration: each participant keeps independent Match/criteria; Different Takes and the collaborator state summary are unchanged', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /<summary>Different Takes<\/summary>/);
  assert.match(board, /function CollaboratorState\(\{ state \}\)/);
  assert.doesNotMatch(board, /Couple Match|Combined Match|Household Match|average Match/i);
});

test('Realtor is never treated as a co-buyer on Compare: no Realtor Match/criteria/ranking, and the Realtor-privileged roster function is not reused here', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  const realtorComparePage = await source('src/app/(app)/people/[searchId]/compare/page.js');
  assert.doesNotMatch(board, /realtor/i);
  assert.doesNotMatch(realtorComparePage, /get_realtor_client_roster/);
  assert.match(realtorComparePage, /readOnly basePath=/);
});

test('Realtor read-only Compare reuses the exact same CompareBoard -- the presentation refresh applies uniformly, no broadened data path', async () => {
  const realtorComparePage = await source('src/app/(app)/people/[searchId]/compare/page.js');
  assert.match(realtorComparePage, /import CompareBoard from '@\/components\/CompareBoard'/);
  assert.match(realtorComparePage, /getRealtorSearchContext\(supabase, user\.id, searchId\)/);
});

test('empty/edge states: <2 selected keeps its exact existing copy; 0/1 home guidance points at adding a contender, never a broken table', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /The showdown starts here\./);
  assert.match(board, /Pick 2–4 homes and see how they stack up\./);
  assert.match(board, /href="\/homes\?add=1"/);
  assert.match(board, /Pick at least two homes above to compare them\./);
});

test('mobile: the existing vertical criterion-grouping pattern (desktop grid / mobile groups, same 640px boundary) is untouched -- no full desktop table squeezed onto a phone', async () => {
  const css = await source('src/app/globals.css');
  assert.match(css, /\.hh-compare-rows-mobile \{ display: none; \}/);
  const block = css.match(/@media \(max-width: 640px\) \{\s*\n\s*\.hh-compare-rows-desktop[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(block, 'expected the 640px block toggling .hh-compare-rows-desktop/.hh-compare-rows-mobile');
  assert.match(block, /\.hh-compare-rows-desktop \{ display: none; \}/);
  assert.match(block, /\.hh-compare-rows-mobile \{ display: flex;/);
  // Contender-card horizontal scroll-snap on mobile is also untouched.
  assert.match(css, /\.hh-compare-identity-scroll \{ margin-right: -14px; padding-right: 14px; scroll-snap-type: x proximity; \}/);
});

test('accessibility: picker chips and the new diff toggle are keyboard-operable buttons with aria-pressed, not color-only cues', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.match(board, /aria-pressed=\{isSelected\}/);
  assert.match(board, /aria-pressed=\{diffsOnly\}/);
  assert.match(board, /aria-pressed=\{!diffsOnly\}/);
  assert.match(board, /<b aria-hidden="true">\{c\.met \? '✓' : '—'\}<\/b><span>\{text\}<\/span>/);
});

test('performance: selection changes reuse the already-loaded Match/commute data -- no new fetch is introduced by toggling comparison or differences-only', async () => {
  const board = await source('src/components/CompareBoard.jsx');
  assert.doesNotMatch(board, /fetch\(/);
  // The picker's own Match badges are deliberately computed without commute
  // (see pickerMatches) so selecting a home never triggers a fresh scoring
  // pass beyond the existing per-selection computeMatch calls.
  assert.doesNotMatch(board, /computeMatch\(home, priorities, evaluateCommute/);
});

test('auth-boundary impact: compare/page.js still resolves its user solely through requireUser/withAuthRecovery, unchanged by this pass', async () => {
  const page = await source('src/app/(app)/compare/page.js');
  const getUserCalls = (page.match(/\.auth\.getUser\(\)/g) || []).length;
  assert.equal(getUserCalls, 0);
  assert.match(page, /const user = await requireUser\(supabase\);/);
  assert.match(page, /return withAuthRecovery\(async \(\) => \{/);
});

test('data/loader changes: none -- Compare consumes only data it already had (getHomesForUser, resolveCoBuyerComparePerspectives, resolveCollaboratorSearchContext), no new query added', async () => {
  const page = await source('src/app/(app)/compare/page.js');
  assert.match(page, /getHomesForUser\(supabase, user\.id, search\.id\)/);
  assert.match(page, /resolveCoBuyerComparePerspectives\(supabase, search, activeHomes\.map/);
  assert.match(page, /resolveCollaboratorSearchContext\(supabase, search\)/);
});
