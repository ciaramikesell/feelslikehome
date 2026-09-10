import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMatch, summarizeForCard } from '../src/lib/matching.js';
import { defaultPriorities, emptyHome, TIER_META } from '../src/lib/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('home layout and condition retain canonical shared-fact controls without preference values', () => {
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /visibleMultiselect\.map/);
  assert.match(modal, /def\.options\.filter\(\(o\) => o !== 'No Preference'\)/);
  assert.deepEqual(emptyHome().homeLayout, []);
  assert.deepEqual(emptyHome().homeCondition, []);
  assert.match(read('src/lib/supabase/collaboration.js'), /home_layout: home\.homeLayout \|\| \[\]/);
  assert.match(read('src/lib/supabase/collaboration.js'), /home_condition: Array\.isArray\(home\.homeCondition\)/);
});

test('condition notes stay a separate lossless shared fact', () => {
  const modal = read('src/components/HomeModal.jsx');
  const collaboration = read('src/lib/supabase/collaboration.js');
  assert.match(modal, /label="Condition notes" value=\{form\.conditionNotes\}/);
  assert.match(collaboration, /conditionNotes: row\.condition_notes \|\| ''/);
  assert.match(collaboration, /condition_notes: home\.conditionNotes \|\| ''/);
});

test('layout and condition use existing weights and unknown remains excluded', () => {
  const priorities = defaultPriorities();
  priorities.searchType = 'purchase';
  priorities.homeLayout = { values: ['Two Story'], tier: 'must' };
  priorities.homeCondition = { values: ['Move-In Ready'], tier: 'important' };
  const unknown = computeMatch(emptyHome(), priorities);
  assert.equal(unknown.pct, null);
  assert.equal(unknown.evaluatedCount, 0);
  const known = computeMatch({ ...emptyHome(), homeLayout: ['Two Story'], homeCondition: ['Move-In Ready'] }, priorities);
  assert.equal(known.pct, 100);
  assert.equal(TIER_META.must.weight, 4);
  assert.equal(TIER_META.important.weight, 2);
  assert.equal(TIER_META.nice.weight, 1);
  assert.equal(TIER_META.dontcare.weight, 0);
});

test('card unknown summary separates centralized experiential criteria', () => {
  const priorities = defaultPriorities();
  priorities.searchType = 'purchase';
  priorities.budget = { value: '500000', tier: 'important' };
  priorities.homeFeel.tiers['Natural Light'] = 'must';
  priorities.homeFeel.customItems = [{ label: 'Natural Light', kind: 'rating' }];
  const summary = summarizeForCard(computeMatch(emptyHome(), priorities));
  assert.equal(summary.preTourUnknown.length, 1);
  assert.equal(summary.afterTour.length, 1);
  assert.equal(summary.notConfirmed.length, 2);
  const ui = read('src/components/ui.jsx');
  assert.match(ui, /'detail' : 'details'\} still unknown/);
  assert.match(ui, /to answer after touring/);
  assert.doesNotMatch(ui, /need more information/);
});

test('home cards show known condition and schools without placeholders or a row cap', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /label: 'Home condition', text: home\.homeCondition\.join/);
  assert.match(board, /home\.schoolsNotes && \{ label: 'Schools'/);
  const propertyFacts = board.match(/const propertyFacts = \[[\s\S]*?\]\.filter\(Boolean\);/)?.[0];
  assert.ok(propertyFacts);
  assert.doesNotMatch(propertyFacts, /slice/);
});

test('map adds only current-user search-scoped destinations and distinct accessible markers', () => {
  const page = read('src/app/(app)/map/page.js');
  const map = read('src/components/SavedHomesMap.jsx');
  assert.match(page, /getCommuteDestinations\(supabase, search\.id, user\.id\)/);
  assert.match(page, /currentDestinationCoordinates/);
  assert.match(map, /hh-map-destination-marker/);
  assert.match(map, /Selected place/);
  assert.match(map, /bounds\.extend\(destination\.mapPosition\)/);
  assert.match(map, /Mapped homes/);
  assert.doesNotMatch(page, /listing discovery/i);
});
