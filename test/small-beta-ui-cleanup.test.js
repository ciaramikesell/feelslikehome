import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/app/(app)/homes/page.js', 'utf8');
const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');

test('Homes list uses search-type-specific instructional copy without a page noun heading', () => {
  assert.match(page, /Keep the homes you're considering in one place\. Add them as you find them, then compare how each one lines up with what matters to you\./);
  assert.match(page, /Keep the properties you're considering in one place\. Add them as you find them, then compare the property, the option you're considering, and how well each one fits what matters to you\./);
  assert.doesNotMatch(page, /<PageIntro/);
  assert.match(page, /<CoBuyerHomesLine/);
});

test('Home cards only render an identity supporting line when the identity supplies one', () => {
  assert.match(board, /identity\.supporting && <div[^>]*>\{identity\.supporting\}<\/div>/);
  assert.doesNotMatch(board, /addressLine2 && <div/);
});
