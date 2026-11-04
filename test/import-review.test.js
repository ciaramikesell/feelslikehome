import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appendAllSuggestions, appendSuggestionToNotes, extractEnrichmentSuggestions } from '../src/lib/importReview.js';

// Suggested Match answers moved to listingTextAnswers.js (see
// test/listing-text-answers.test.js); this file covers Property Notes suggestions.

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
  assert.match(modal, /acceptedSuggestionIds/);
  assert.match(modal, /your changes here haven&apos;t been lost|your changes here haven't been lost/);
  assert.match(modal, /acceptedSuggestionIds/);
  assert.doesNotMatch(review, /conditionNotes/);
  assert.doesNotMatch(modal.match(/const addSuggestion[\s\S]*?const addAllSuggestions/)[0], /conditionNotes/);
});
