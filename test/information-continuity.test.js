import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMatch, summarizeForCard } from '../src/lib/matching.js';
import { defaultPriorities, emptyHome, HOME_CONDITION_OPTIONS, LAYOUT_OPTIONS, TIER_META } from '../src/lib/constants.js';
import { EXISTING_STRUCTURED_FACT_VALUE, structuredFactSelectValue, structuredFactValueFromSelect } from '../src/lib/homeStructuredFacts.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('home layout and condition use compact selects with canonical array persistence', () => {
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /<StructuredFactSelect/);
  assert.match(modal, /definition\.options\.filter\(\(option\) => option !== 'No Preference'\)/);
  assert.doesNotMatch(modal, /toggleMulti/);
  assert.deepEqual(emptyHome().homeLayout, []);
  assert.deepEqual(emptyHome().homeCondition, []);
  assert.deepEqual(LAYOUT_OPTIONS, ['Ranch / Single Story', 'Two Story', 'Split Level', 'Other', 'No Preference']);
  assert.deepEqual(HOME_CONDITION_OPTIONS, ['New Construction', 'Move-In Ready', 'Renovation Potential', 'No Preference']);
  assert.deepEqual(structuredFactValueFromSelect('Two Story'), ['Two Story']);
  assert.deepEqual(structuredFactValueFromSelect('Move-In Ready'), ['Move-In Ready']);
  assert.deepEqual(structuredFactValueFromSelect(''), []);
  assert.equal(structuredFactSelectValue(['Split Level'], ['Split Level']), 'Split Level');
  assert.equal(structuredFactSelectValue([], ['Split Level']), '');
  assert.equal(structuredFactSelectValue(['Ranch / Single Story', 'Other'], ['Ranch / Single Story', 'Other']), EXISTING_STRUCTURED_FACT_VALUE);
  const collaboration = read('src/lib/supabase/collaboration.js');
  assert.match(collaboration, /homeLayout: row\.home_layout \|\| \[\]/);
  assert.match(collaboration, /homeCondition: Array\.isArray\(row\.home_condition\)/);
  assert.match(collaboration, /home_layout: home\.homeLayout \|\| \[\]/);
  assert.match(collaboration, /home_condition: Array\.isArray\(home\.homeCondition\)/);
});

test('condition notes leave the editor but remain a lossless shared fact', () => {
  const modal = read('src/components/HomeModal.jsx');
  const collaboration = read('src/lib/supabase/collaboration.js');
  assert.doesNotMatch(modal, /label="Condition notes"/);
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

test('card unknown summary uses canonical unknown criteria without stale after-tour copy', () => {
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
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /'criterion' : 'criteria'\} still unknown/);
  assert.doesNotMatch(board, /answer after touring|to review after touring/i);
  assert.doesNotMatch(ui, /to review after touring/);
  assert.doesNotMatch(ui, /need more information/);
});

test('home snapshot shows only known facts and strips unsupported legacy school ratings', () => {
  const presentation = read('src/lib/homeCardPresentation.js');
  assert.match(presentation, /label: 'Home condition'/);
  assert.match(presentation, /label: 'Schools'/);
  assert.match(presentation, /label: 'Basement'/);
  assert.doesNotMatch(presentation, /\|\| 'Unknown'/);
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
