import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/app/(app)/homes/page.js', 'utf8');
const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');

test('Homes list uses the canonical My Homes heading and truthful listing-intake copy', () => {
  assert.match(page, /<h1 className="hh-homes-purpose">My Homes<\/h1>/);
  assert.match(page, /Paste Zillow, Realtor\.com, Trulia, or other listings to score them against what matters to you\./);
  assert.doesNotMatch(page, /<PageIntro/);
  assert.match(page, /<CoBuyerHomesLine/);
});

test('Home cards only render an identity supporting line when the identity supplies one', () => {
  assert.match(board, /identity\.supporting && <div[^>]*>\{identity\.supporting\}<\/div>/);
  assert.doesNotMatch(board, /addressLine2 && <div/);
});
