import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');
const page = fs.readFileSync('src/app/(app)/homes/page.js', 'utf8');

test('My Homes filters have real derived counts and explicit bidirectional sorts', async () => {
  assert.match(board, /filterCounts = useMemo/);
  // My Homes Visual Refresh: "Sort By:" + the shared SORT_MENU (both directions of date, Match and price).
  assert.match(board, /<span className="hh-homes-sort-prefix">Sort By:<\/span>/);
  const { SORT_MENU } = await import('../src/lib/homesCollection.js');
  assert.deepEqual(SORT_MENU.map(({ key }) => key), ['newest', 'oldest', 'matchDesc', 'matchAsc', 'priceAsc', 'priceDesc']);
  assert.match(board, /\{f\.label\} \(\{filterCounts\[f\.key\]\}\)/);
});

test('card overlays expose truthful status, provenance, and co-buyer activity (no card heart in the refresh)', () => {
  // On Homes the Want to Tour button carries the state; other views keep the tag.
  assert.match(board, /\{onTourList && mode !== 'homes' && <span className="hh-card-status">WANT TO TOUR<\/span>\}/);
  assert.doesNotMatch(board, /hh-card-favorite|Add to favorites/);
  assert.match(board, /Suggested by \{home\.suggestedBy\}/);
  assert.match(board, /Co-buyer wants to tour/);
  assert.match(board, /Co-buyer favorited/);
  assert.doesNotMatch(board, /Archived by collaborator/);
});

test('card hierarchy keeps Must Haves, aggregate criteria coverage, facts, and unknown distinct', () => {
  assert.match(board, /className="hh-must-summary"/);
  assert.match(board, /selectHomeCardCriteria\(match\)/);
  assert.match(board, /mustOverflow > 0/);
  assert.doesNotMatch(board, /Personalized Criteria/);
  assert.match(board, /criteriaSummary\.matches\.length/);
  assert.match(board, /criteriaSummary\.mismatches\.length/);
  assert.match(board, /criteriaSummary\.unknown\.length/);
  assert.doesNotMatch(board, /positives\.map|negatives\.map/);
  assert.match(board, /className="hh-property-facts"/);
  assert.doesNotMatch(board, /Home Snapshot/);
  assert.doesNotMatch(board, /home\.crossroads &&/);
  assert.match(board, /const priorities = initialPriorities/);
  assert.doesNotMatch(board, /useState\(initialPriorities\)/);
});

test('desktop and mobile preserve the responsive four-to-one card grid', () => {
  assert.match(css, /\.hh-homes-grid \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.hh-homes-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.hh-home-card-photo \{[^}]*aspect-ratio: 4 \/ 3/);
  // The invitation line now sits in the toolbar (right of the chips) for every search.
  assert.match(page, /collaborationSlot=\{<CoBuyerHomesLine searchId=\{search\.id\} userId=\{user\.id\} isOwner=\{isOwner\} isCollaborative=\{isCollaborative\}/);
});
