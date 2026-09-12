import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { homeIdentity, homeVocabulary } from '../src/lib/homePresentation.js';

const apartmentPriorities = { searchType: 'rental', onboardingSearchType: 'apartment_rent' };

test('apartment presentation vocabulary is scoped to the apartment signal', () => {
  assert.equal(homeVocabulary(apartmentPriorities).plural, 'Properties');
  assert.equal(homeVocabulary({ searchType: 'rental', onboardingSearchType: 'home_rent' }).plural, 'Homes');
  assert.equal(homeVocabulary({ searchType: 'purchase' }).plural, 'Homes');
});

test('property identity keeps canonical address separate from the selected option', () => {
  const home = { propertyName: 'Amber Apartments', selectedFloorPlanName: 'B2 Plan', selectedUnitLabel: 'Unit 410', address: '4081 Crooks Rd, Royal Oak, MI' };
  assert.deepEqual(homeIdentity(home, apartmentPriorities), {
    primary: 'Amber Apartments',
    supporting: '4081 Crooks Rd, Royal Oak, MI',
    option: 'B2 Plan · Unit 410',
    accessible: 'Amber Apartments, B2 Plan · Unit 410, 4081 Crooks Rd, Royal Oak, MI',
  });
  assert.equal(home.address, '4081 Crooks Rd, Royal Oak, MI');
});

test('home identity splits the address into a street-only primary and a city/state/zip supporting line', () => {
  const home = { address: '1396 Vernier Rd, Grosse Pointe Woods, MI 48236' };
  assert.deepEqual(homeIdentity(home, { searchType: 'purchase' }), {
    primary: '1396 Vernier Rd',
    supporting: 'Grosse Pointe Woods, MI 48236',
    option: '',
    accessible: '1396 Vernier Rd, Grosse Pointe Woods, MI 48236',
  });
});

test('home identity with no locality segment falls back to the full address as primary', () => {
  const home = { address: '88 Elm St' };
  assert.deepEqual(homeIdentity(home, { searchType: 'purchase' }), {
    primary: '88 Elm St',
    supporting: '',
    option: '',
    accessible: '88 Elm St',
  });
});

test('migration is additive and preserves column-level ACLs', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/2026-09-11-apartment-v1-foundation.sql', import.meta.url), 'utf8');
  for (const column of ['property_name', 'selected_floor_plan_name', 'selected_unit_label', 'floor_plan_image_url']) assert.match(sql, new RegExp(`add column ${column} text null`));
  assert.doesNotMatch(sql, /grant\s+select\s+on\s+(table\s+)?public\.homes/i);
  assert.match(sql, /grant select \(property_name,/i);
});
