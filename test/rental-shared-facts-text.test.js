// Pasted rental listing text → the shared Pets Allowed / Utilities Included /
// In-Unit Laundry facts that Match reads directly (parseRentalSharedFacts in
// src/lib/matching.js). These fill empty shared fields, so a misread is a Match
// answer for everyone in the search: only explicit, uncontradicted statements count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMatch, parseListingText, parseRentalSharedFacts } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';
import { switchSearchType } from '../src/lib/whatMattersCatalog.js';

const facts = (text) => parseRentalSharedFacts(text);
const rental = (text) => parseListingText(text, 'rental');

test('laundry hookups never establish In-Unit Laundry', () => {
  for (const text of ['In-unit laundry hookups.', 'In-unit washer/dryer hookups.', 'Washer and dryer hookups in unit.', 'Laundry hookups only, no appliances.', 'In-unit laundry hook-ups available.', 'Washer/dryer hookups; laundry available']) {
    assert.equal(facts(text).inUnitLaundry, undefined, text);
  }
});

test('In-Unit Laundry: explicit Yes and No still read; unavailable, optional or paid extras stay Unknown', () => {
  for (const text of ['In-unit laundry.', 'Washer/dryer in unit.', 'In-unit washer and dryer.']) assert.equal(facts(text).inUnitLaundry, true, text);
  for (const text of ['No in-unit laundry.', 'Shared laundry only.', 'In-unit laundry is not available.', 'In-unit laundry: no', 'Building without in-unit laundry.']) assert.equal(facts(text).inUnitLaundry, false, text);
  for (const text of ['In-unit laundry possible.', 'In-unit laundry available for an additional fee.', 'Washer/dryer in unit not included.', 'In-unit laundry?', 'Coin-op laundry on site.']) assert.equal(facts(text).inUnitLaundry, undefined, text);
});

test('Utilities Included: a negated, partial or excepted statement is never Yes', () => {
  for (const text of ['Utilities included.', 'All utilities included.', 'All utilities are included.']) assert.equal(facts(text).utilitiesIncluded, true, text);
  for (const text of ['No utilities included.', 'Utilities included: none', 'Utilities not included.', 'Utilities are not included.', 'Tenant pays all utilities.']) assert.equal(facts(text).utilitiesIncluded, false, text);
  for (const text of ['Some utilities included.', 'Water and trash utilities included.', 'Gas utilities included.', 'Utilities included except electric.', 'Utilities are included except internet.', 'Utilities may be included.', 'Utilities can be included for an extra $150.', 'Heat and water included, tenant pays electric.']) {
    assert.equal(facts(text).utilitiesIncluded, undefined, text);
  }
});

test('Pets Allowed: questions, limits and nearby pet-friendly places are not answers', () => {
  for (const text of ['Pets allowed.', 'Pet friendly building.', 'Pet-friendly community.', 'Dogs and cats allowed.', 'Pets allowed with deposit.', 'Pets allowed. No pets over 25 lbs.']) assert.equal(facts(text).petsAllowed, true, text);
  for (const text of ['No pets.', 'No pets allowed.', 'Pets not allowed.', 'Sorry, no pets.', 'Pets allowed: no']) assert.equal(facts(text).petsAllowed, false, text);
  for (const text of ['Pets allowed? Ask landlord.', 'Close to pet-friendly parks.', 'Pet-friendly neighborhood.', 'Pets negotiable.', 'Cats allowed, no dogs.', 'Pet deposit: $500']) assert.equal(facts(text).petsAllowed, undefined, text);
});

test('a Yes and a No in different sentences is a conflict, left Unknown', () => {
  assert.deepEqual(facts('Pets allowed. No pets.'), {});
  assert.deepEqual(facts('Utilities included. Tenant pays all utilities.'), {});
  assert.deepEqual(facts('In-unit laundry. Shared laundry only.'), {});
});

test('the rental parser uses these rules, and only for rental searches', () => {
  assert.equal(rental('2 bed apartment. In-unit laundry hookups. No utilities included.').inUnitLaundry, undefined);
  assert.equal(rental('No utilities included.').utilitiesIncluded, false);
  assert.equal(parseListingText('In-unit laundry. Pets allowed.', 'purchase').inUnitLaundry, undefined);
  assert.equal(parseListingText('In-unit laundry. Pets allowed.', 'purchase').petsAllowed, undefined);
});

test('a hookups-only listing leaves In-Unit Laundry Unknown in Match, never Yes', () => {
  const priorities = addCriterion(switchSearchType(normalizePriorities({}), 'home_rent').priorities, { categoryKey: 'features', label: 'In-Unit Laundry', kind: 'check' }, 'must');
  const laundry = (text) => computeMatch({ ...rental(text), checks: {}, ratings: {} }, priorities).allSelected.find((item) => item.key === 'features:In-Unit Laundry');
  assert.equal(laundry('In-unit laundry hookups.').evaluated, false);
  assert.deepEqual([laundry('In-unit washer and dryer.').evaluated, laundry('In-unit washer and dryer.').met], [true, true]);
});
