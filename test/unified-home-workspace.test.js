import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../src/components/HomeModal.jsx', import.meta.url), 'utf8');
const persistence = readFileSync(new URL('../src/lib/supabase/collaboration.js', import.meta.url), 'utf8');

test('Add and Edit converge on one mode-driven workspace after discovery', () => {
  assert.match(modal, /function EditHomeEditor\(\{ mode = 'edit'/);
  assert.match(modal, /mode=\{isNewHome \? 'add' : 'edit'\}/);
  assert.match(modal, /workspaceReady = !isNewHome \|\| \['success', 'text-success', 'empty', 'error'\]/);
  assert.match(modal, /mode === 'add' \? 'Save home' : 'Save changes'/);
});

test('listing provenance is immutable context separate from canonical fields', () => {
  assert.match(modal, /inspectorResult = importResult \|\| form\.listingImport/);
  assert.match(modal, /listingImport: \{ fields: importResult\.fields/);
  assert.match(persistence, /listingImport: row\.listing_import/);
  assert.match(persistence, /listing_import: home\.listingImport/);
});
