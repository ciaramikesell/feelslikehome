import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeMatch, evaluateSearchBasics } from '../src/lib/matching.js';

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

test('saved actual property type resolves the Home type Search Basic (never a Match weight)', () => {
  const priorities = { preferredPropertyTypes: { values: ['condo'], tier: 'must' } };
  const homeType = (home) => evaluateSearchBasics(home, priorities).find((basic) => basic.key === 'preferredPropertyTypes');
  assert.deepEqual([homeType({ propertyType: 'condo' }).met, homeType({ propertyType: 'house' }).met], [true, false]);
  // Unknown stays Unknown, never a mismatch.
  assert.deepEqual([homeType({ propertyType: null }).evaluated, homeType({ propertyType: null }).met], [false, null]);
  // Even at the old 'must' tier, a Basic contributes nothing to Match.
  assert.equal(computeMatch({ propertyType: 'house' }, priorities), null);
});

test('property Notes examples remain placeholders rather than saved values', () => {
  const example = 'HOA details, sewer/water, financing options, recent updates, listing terms, or anything else worth noting.';
  assert.match(modal, new RegExp(`placeholder="${example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(detail, new RegExp(`placeholder="${example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.doesNotMatch(persistence, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Home Card commute inset is conditional, compact, lists every saved place, and wraps long labels', () => {
  assert.match(board, /commuteDestinations\.length > 0/);
  // Every saved place, in stored order — never only the first (commutes[0]).
  assert.doesNotMatch(board, /commuteDestinations\.slice\(0, 1\)/);
  assert.match(board, /const shown = commuteDestinations;/);
  assert.match(board, /className="hh-card-commute"/);
  assert.doesNotMatch(board, /\+\{overflow\} more/);
  assert.match(css, /\.hh-card-commute \{[^}]*padding: 9px 11px/);
  assert.match(css, /\.hh-card-commute-route \{[^}]*overflow-wrap: anywhere/);
});
