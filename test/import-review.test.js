import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appendAllSuggestions, appendSuggestionToNotes, derivePriorityCheckPatch, extractEnrichmentSuggestions } from '../src/lib/importReview.js';
import { computeMatch } from '../src/lib/matching.js';

const priorities = {
  searchType: 'purchase',
  features: { tiers: { Basement: 'must', Fireplace: 'important', 'Central Air': 'nice', 'Home Office': 'nice' }, customItems: [{ label: 'Sauna', kind: 'check' }] },
  exterior: { tiers: { 'Fenced Yard': 'important', Garage: 'must' } },
};

test('selected allowlisted objective criteria receive explicit Yes and No only', () => {
  assert.deepEqual(derivePriorityCheckPatch('Finished basement. No fireplace.', priorities), {
    'features:Basement': true,
    'features:Fireplace': 'no',
  });
  assert.deepEqual(derivePriorityCheckPatch('A comfortable home.', priorities), {});
  assert.deepEqual(derivePriorityCheckPatch('Fireplace. No fireplace.', priorities), {});
});

test('unselected, existing, rating, custom, and collaborator checks remain untouched', () => {
  const mine = { 'features:Fireplace': true };
  const collaborator = { 'features:Basement': 'no' };
  const patch = derivePriorityCheckPatch('No fireplace. Fully fenced yard. Turnkey. Great schools. Open concept. Spacious rooms. Close to everything. Sauna.', priorities, mine);
  assert.deepEqual(patch, { 'exterior:Fenced Yard': true });
  assert.deepEqual(mine, { 'features:Fireplace': true });
  assert.deepEqual(collaborator, { 'features:Basement': 'no' });
  assert.equal(Object.hasOwn(patch, 'features:Sauna'), false);
  assert.equal(Object.keys(patch).some((key) => /Condition|Schools|Layout|Room Sizes|Walkability/.test(key)), false);
});

test('ambiguous language and listing omission stay Unknown', () => {
  assert.deepEqual(derivePriorityCheckPatch('Office potential. Space for a fireplace. Crawlspace. Community fenced yard.', priorities), {});
  assert.deepEqual(derivePriorityCheckPatch('', priorities), {});
});

test('shared Garage evidence does not create a personal check and Match behavior is unchanged', () => {
  assert.deepEqual(derivePriorityCheckPatch('Two-car garage.', priorities), {});
  assert.deepEqual(computeMatch({ garageSpaces: '2', checks: {} }, priorities), computeMatch({ garageSpaces: '2', checks: {} }, priorities));
});

test('high-signal suggestions are normalized, capped, and marketing is excluded', () => {
  const suggestions = extractEnrichmentSuggestions('Roof replaced in 2021. City water and city sewer. Seller offering 2-1 rate buydown. Granite countertops. Beautiful landscaping. Spacious bedrooms. Gorgeous curb appeal. Charming and stunning.');
  assert.deepEqual(suggestions.map((item) => item.text), [
    'Roof: replaced in 2021',
    'Water/Sewer: city water and city sewer',
    'Financing: seller offering 2-1 rate buydown',
  ]);
  assert.ok(suggestions.every((item) => item.id.startsWith('suggestion-')));
});

test('canonical, notes duplicates, conflicts, and generic subsumed facts are suppressed', () => {
  assert.deepEqual(extractEnrichmentSuggestions('HOA: fee $250 monthly.', { hoaFeeMonthly: 250 }), []);
  assert.deepEqual(extractEnrichmentSuggestions('Roof replaced in 2021.', { notes: 'Roof: replaced in 2021' }), []);
  assert.deepEqual(extractEnrichmentSuggestions('City water. Well water.'), []);
  const hvac = extractEnrichmentSuggestions('HVAC updated in 2022. Furnace updated in 2022.');
  assert.equal(hvac.filter((item) => item.type === 'hvac').length, 1);
});

test('Add and Add all append to Property Notes idempotently', () => {
  const [roof] = extractEnrichmentSuggestions('Roof replaced in 2021.');
  assert.equal(appendSuggestionToNotes('', roof), 'Roof: replaced in 2021');
  assert.equal(appendSuggestionToNotes('Roof: replaced in 2021', roof), 'Roof: replaced in 2021');
  const suggestions = extractEnrichmentSuggestions('Roof replaced in 2021. City water and city sewer.');
  const once = appendAllSuggestions('', suggestions);
  assert.equal(appendAllSuggestions(once, suggestions), once);
});

test('accepted IDs remain suppressed after manual note deletion without durable ignored state', () => {
  const [roof] = extractEnrichmentSuggestions('Roof replaced in 2021.');
  assert.deepEqual(extractEnrichmentSuggestions('Roof replaced in 2021.', { notes: '' }, { acceptedIds: [roof.id] }), []);
});

test('review UI uses ephemeral state, retains form on save error, and never writes conditionNotes', () => {
  const modal = fs.readFileSync('src/components/HomeModal.jsx', 'utf8');
  const review = fs.readFileSync('src/lib/importReview.js', 'utf8');
  assert.match(modal, /We found quite a lot!/);
  assert.match(modal, /your changes here haven&apos;t been lost|your changes here haven't been lost/);
  assert.match(modal, /acceptedSuggestionIds/);
  assert.doesNotMatch(review, /conditionNotes/);
  assert.doesNotMatch(modal.match(/const addSuggestion[\s\S]*?const addAllSuggestions/)[0], /conditionNotes/);
});
