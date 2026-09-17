import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');
const page = fs.readFileSync('src/app/(app)/homes/page.js', 'utf8');

test('My Homes filters have real derived counts and explicit bidirectional sorts', () => {
  assert.match(board, /filterCounts = useMemo/);
  for (const label of ['Date added — newest', 'Date added — oldest', 'Match score — highest', 'Match score — lowest', 'Price — low to high', 'Price — high to low']) assert.ok(board.includes(label));
  assert.match(board, /\{f\.label\} \(\{filterCounts\[f\.key\]\}\)/);
});

test('card overlays expose truthful status, favorite, provenance, and co-buyer activity', () => {
  assert.match(board, />WANT TO TOUR<\/span>/);
  assert.match(board, /aria-label=\{isFavorite \? 'Remove from favorites' : 'Add to favorites'\}/);
  assert.match(board, /Suggested by \{home\.suggestedBy\}/);
  assert.match(board, /Co-buyer wants to tour/);
  assert.match(board, /Co-buyer favorited/);
  assert.doesNotMatch(board, /Archived by collaborator/);
});

test('card hierarchy keeps Must Haves, weighted tradeoffs, facts, and unknown distinct', () => {
  assert.match(board, /className="hh-must-summary"/);
  assert.match(board, /selectHomeCardCriteria\(match\)/);
  assert.match(board, /mustOverflow > 0/);
  assert.match(board, /Home Snapshot/);
  assert.doesNotMatch(board, /home\.crossroads &&/);
  assert.match(board, /const priorities = initialPriorities/);
  assert.doesNotMatch(board, /useState\(initialPriorities\)/);
});

test('desktop and mobile preserve the responsive four-to-one card grid', () => {
  assert.match(css, /repeat\(4, minmax\(300px, 1fr\)\)/);
  assert.match(css, /\.hh-homes-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.hh-home-card-photo[^}]*aspect-ratio: 4\/3/);
  assert.match(page, /\{!isCollaborative && <CoBuyerHomesLine/);
});
