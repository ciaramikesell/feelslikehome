import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/app/(app)/homes/(board)/layout.js', 'utf8');
const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');

test('My Homes keeps an accessible page heading but no visible header or subtitle (approved refresh)', () => {
  assert.match(page, /<h1 className="sr-only">My \{homeVocabulary\(normalizedPriorities\)\.plural\}<\/h1>/);
  assert.doesNotMatch(page, /All the places you’re considering|hh-homes-purpose/);
  assert.doesNotMatch(page, /<PageIntro/);
  assert.match(page, /collaborationSlot=\{<CoBuyerHomesLine/);
});

test('Home cards only render an identity supporting line when the identity supplies one', () => {
  assert.match(board, /identity\.supporting && <p className="hh-card-locality">\{identity\.supporting\}<\/p>/);
  assert.doesNotMatch(board, /addressLine2 && <div/);
});
