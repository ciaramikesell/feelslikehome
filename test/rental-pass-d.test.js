import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeMatch, parseListingText } from '../src/lib/matching.js';
import { HOME_PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABELS } from '../src/lib/searchIntent.js';

const modal = fs.readFileSync('src/components/HomeModal.jsx', 'utf8');
const persistence = fs.readFileSync('src/lib/supabase/collaboration.js', 'utf8');

test('actual property type uses the exact universal optional vocabulary', () => {
  assert.deepEqual(HOME_PROPERTY_TYPE_OPTIONS, ['apartment', 'house', 'townhome', 'condo', 'multifamily', 'other']);
  assert.deepEqual(HOME_PROPERTY_TYPE_OPTIONS.map((value) => PROPERTY_TYPE_LABELS[value]), ['Apartment', 'House', 'Townhome', 'Condo', 'Multifamily', 'Other']);
  assert.match(modal, /Unknown \/ not specified/);
  assert.match(modal, /e\.target\.value \|\| null/);
});

test('rental controls are capability-gated and all clear to null', () => {
  assert.match(modal, /searchIntentCapabilities\(priorities\.searchType\)/);
  assert.match(modal, /showsRentalFacts && <section/);
  for (const label of ['Available On', 'Pets Allowed', 'Utilities Included', 'In-Unit Laundry']) assert.match(modal, new RegExp(label));
  assert.match(modal, /set\('availableOn', e\.target\.value \|\| null\)/);
  assert.match(modal, /key === 'unknown' \? null/);
  assert.doesNotMatch(modal, /setCheckItem\('features', '(?:Pets Allowed|Utilities Included|In-Unit Laundry)'/);
});

test('shared fact persistence remains on the existing homes shared-row path', () => {
  for (const mapping of [
    ['property_type', 'propertyType'], ['available_on', 'availableOn'], ['pets_allowed', 'petsAllowed'],
    ['utilities_included', 'utilitiesIncluded'], ['in_unit_laundry', 'inUnitLaundry'],
  ]) assert.match(persistence, new RegExp(`${mapping[0]}: home\\.${mapping[1]} \\?\\? null`));
  assert.match(persistence, /SHARED_FIELDS[\s\S]*'propertyType', 'availableOn', 'petsAllowed', 'utilitiesIncluded', 'inUnitLaundry'/);
});

test('rental monthly prices populate price and never estimated monthly payment', () => {
  for (const text of ['$2,150/mo', '$2,150 / month', '$2,150 per month', 'Rent: $2,150']) {
    assert.deepEqual(parseListingText(text, 'rental'), { price: '2150' });
  }
  assert.deepEqual(parseListingText('$450,000\nEst. payment: $2,150', 'purchase'), { price: '450000', estMonthly: '2150' });
});

test('listing facts are extracted only from explicit conservative evidence', () => {
  assert.deepEqual(parseListingText('Property Type: Apartment', 'purchase'), { propertyType: 'apartment' });
  assert.deepEqual(parseListingText('Home Type: Townhouse', 'rental'), { propertyType: 'townhome' });
  assert.deepEqual(parseListingText('Unit 4, $2,150 rent, 2 bedrooms', 'rent_apartment'), { beds: '2' });
  assert.deepEqual(parseListingText('Available October 1, 2026', 'rental'), { availableOn: '2026-10-01' });
  assert.deepEqual(parseListingText('Available 10/1/2026', 'rent_home'), { availableOn: '2026-10-01' });
  assert.deepEqual(parseListingText('Available now', 'rental'), {});

  assert.equal(parseListingText('Pet friendly', 'rental').petsAllowed, true);
  assert.equal(parseListingText('No pets', 'rental').petsAllowed, false);
  assert.equal(parseListingText('Pet deposit: $500', 'rental').petsAllowed, undefined);
  assert.equal(parseListingText('All utilities included', 'rental').utilitiesIncluded, true);
  assert.equal(parseListingText('Tenant pays all utilities', 'rental').utilitiesIncluded, false);
  assert.equal(parseListingText('Some utilities included', 'rental').utilitiesIncluded, undefined);
  assert.equal(parseListingText('In-unit washer and dryer', 'rental').inUnitLaundry, true);
  assert.equal(parseListingText('Shared laundry only', 'rental').inUnitLaundry, false);
  assert.equal(parseListingText('Washer/dryer hookups; laundry available', 'rental').inUnitLaundry, undefined);
});

test('canonical shared booleans are authoritative positive Match requirements', () => {
  for (const [label, field] of [['Pets Allowed', 'petsAllowed'], ['Utilities Included', 'utilitiesIncluded'], ['In-Unit Laundry', 'inUnitLaundry']]) {
    const priorities = { searchType: 'rental', features: { tiers: { [label]: 'must' }, customItems: [{ label, kind: 'check' }], order: [], hiddenCore: [] } };
    const yes = computeMatch({ [field]: true, checks: {}, ratings: {} }, priorities);
    const no = computeMatch({ [field]: false, checks: {}, ratings: {} }, priorities);
    const unknownWithLegacyYes = computeMatch({ [field]: null, checks: { [`features:${label}`]: true }, ratings: {} }, priorities);
    assert.equal(yes.pct, 100); assert.equal(yes.allSelected[0].met, true);
    assert.equal(no.pct, 0); assert.equal(no.allSelected[0].met, false);
    assert.equal(unknownWithLegacyYes.pct, null); assert.equal(unknownWithLegacyYes.allSelected[0].evaluated, false);
  }
});

test('unselected shared criteria and legacy checks remain non-participating', () => {
  const result = computeMatch({ petsAllowed: false, checks: { 'features:Pet Policy': true }, ratings: {} }, { searchType: 'rental' });
  assert.equal(result, null);
});
