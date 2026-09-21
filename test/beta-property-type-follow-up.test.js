import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeMatch } from '../src/lib/matching.js';

const persistence = fs.readFileSync('src/lib/supabase/collaboration.js', 'utf8');
const modal = fs.readFileSync('src/components/HomeModal.jsx', 'utf8');
const detail = fs.readFileSync('src/components/HomeDetail.jsx', 'utf8');
const board = fs.readFileSync('src/components/HomesBoard.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('Add Home writes and reads the canonical property type without a lossy legacy retry', () => {
  assert.match(modal, /value=\{form\.propertyType \?\? ''\}/);
  assert.match(modal, /set\('propertyType', e\.target\.value \|\| null\)/);
  assert.match(persistence, /property_type: home\.propertyType \?\? null/);
  assert.match(persistence, /propertyType: row\.property_type \?\? null/);
  assert.doesNotMatch(persistence, /upsert\(legacyRow\)/);
});

test('Edit Home preserves the loaded selection and updates the same shared field', () => {
  assert.match(modal, /useState\(initial\)/);
  assert.match(persistence, /SHARED_FIELDS[\s\S]*'propertyType'/);
  assert.match(persistence, /HOME_SHARED_COLUMNS[^\n]*property_type/);
});

test('saved actual property type resolves Preferred Property Type Match', () => {
  const priorities = { preferredPropertyTypes: { values: ['condo'], tier: 'must' } };
  assert.equal(computeMatch({ propertyType: 'condo' }, priorities).pct, 100);
  assert.equal(computeMatch({ propertyType: 'house' }, priorities).pct, 0);
  assert.equal(computeMatch({ propertyType: null }, priorities).pct, null);
});

test('property Notes examples remain placeholders rather than saved values', () => {
  const example = 'HOA details, sewer/water, financing options, recent updates, listing terms, or anything else worth noting.';
  // Home Detail's own separate "Property notes" edit flow keeps its original,
  // more descriptive placeholder — untouched by the Add/Edit Home inline-notes
  // pass (see onboarding-guidance-and-inline-notes.test.js), so it still uses
  // the longer example text.
  assert.match(detail, new RegExp(`placeholder="${example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.doesNotMatch(persistence, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Add/Edit Home's inline notes card uses the shorter, conversational
  // placeholder instead — still a placeholder, never a saved default value.
  assert.match(modal, /placeholder="Anything else you want to remember\?"/);
  assert.doesNotMatch(persistence, /Anything else you want to remember\?/);
});

// REVISION (My Homes card data consistency repair): the card previously showed only
// the first saved Place That Matters via a hardcoded slice(0, 1), even when several
// destinations had calculated commute results — beta testing surfaced this as a bug
// (a saved landmark silently missing from the card), not an intentional simplification.
// The card now renders every saved destination's commute row, in saved order.
test('Home Card commute inset is conditional, compact, shows every saved destination, and wraps long labels', () => {
  assert.match(board, /commuteDestinations\.length > 0/);
  assert.doesNotMatch(board, /commuteDestinations\.slice\(0,\s*1\)/);
  assert.match(board, /commuteDestinations\.map\(\(d\) => \(/);
  assert.match(board, /className="hh-card-commute"/);
  assert.doesNotMatch(board, /\+\{overflow\} more/);
  assert.match(css, /\.hh-card-commute \{[^}]*padding: 9px 11px/);
  assert.match(css, /\.hh-card-commute-route \{[^}]*overflow-wrap: anywhere/);
});
