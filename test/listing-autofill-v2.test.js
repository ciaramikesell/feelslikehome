import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRentCastFields } from '../src/lib/rentcast.js';
import { extractExplicitDescriptionFeatures, countListingDetails } from '../src/lib/listingFacts.js';

test('canonical RentCast normalizer preserves existing fields and exposes additional structured facts', () => {
  const result = normalizeRentCastFields({
    formattedAddress: '1268 Brys Dr, Grosse Pointe Woods, MI 48236', bedrooms: 3, bathrooms: 2,
    squareFootage: 1416, lotSize: 5227, yearBuilt: 1950, propertyType: 'Single Family',
    features: { garageSpaces: 2, garage: true, garageType: 'Detached', exteriorType: 'Brick', heating: true, heatingType: 'Forced Air', cooling: true, coolingType: 'Central', pool: false },
    hoa: { fee: 0 }, propertyTaxes: { 2024: { year: 2024, total: 5880 } },
  }, {
    price: 325000, daysOnMarket: 7, status: 'Active', id: 'MLS-123',
    description: 'Finished basement. Hardwood floors and a fenced yard. Updated kitchen.',
  });

  assert.deepEqual({ price: result.fields.price, beds: result.fields.beds, baths: result.fields.baths, sqft: result.fields.sqft, yearBuilt: result.fields.yearBuilt, garageSpaces: result.fields.garageSpaces, daysOnMarket: result.fields.daysOnMarket },
    { price: '325000', beds: '3', baths: '2', sqft: '1416', yearBuilt: '1950', garageSpaces: '2', daysOnMarket: '7' });
  assert.equal(result.fields.hoaFeeMonthly, 0);
  assert.equal(result.fields.propertyTaxAnnual, 5880);
  assert.equal(result.fields.heating, 'Forced Air');
  assert.equal(result.fields.cooling, 'Central');
  assert.equal(result.fields.garageType, 'detached');
  // A $0/mo fee is shown as $0/mo, never as "No HOA"; pool is not in the
  // confirmed schema; a listing description is not documented, so none is read.
  assert.equal(result.listingFacts.some((item) => item.key === 'hoa' || item.key === 'pool'), false);
  assert.deepEqual(result.descriptionFeatures, []);
});

test('missing structured values stay Unknown rather than becoming negative facts', () => {
  const result = normalizeRentCastFields({ formattedAddress: '1 Main St' }, null);
  assert.equal(result.listingFacts.some((item) => item.key === 'hoa' || item.key === 'basement' || item.key === 'cooling'), false);
  assert.equal(result.fields.garageSpaces, undefined);
});

test('description extraction rejects negation, hypotheticals, uncertainty, conversion, and repair needs', () => {
  const text = 'No basement. Room for a future deck. Hardwood believed to be under carpet. Garage converted to living space. Roof will need replacement. Bright chef-inspired gathering space.';
  assert.deepEqual(extractExplicitDescriptionFeatures(text), []);
});

test('description extraction recognizes only explicit allowlisted phrases with provenance', () => {
  const features = extractExplicitDescriptionFeatures('Partially finished basement; first-floor laundry. Detached garage. Home office.');
  assert.deepEqual(features.map((item) => item.label), ['Partially finished basement', 'First-floor laundry', 'Detached garage', 'Home office']);
  assert.ok(features.every((item) => item.sourceType === 'listing_description'));
});

test('detail count is computed from actual normalized results', () => {
  assert.equal(countListingDetails({ address: '1 Main', price: '' }, [{ key: 'roof' }], [{ id: 'deck' }]), 3);
});

test('canonical mapping seeds only semantically precise basement and garage facts', async () => {
  const { canonicalBasementNotes } = await import('../src/lib/rentcast.js');
  assert.equal(canonicalBasementNotes('Finished basement'), 'Finished');
  assert.equal(canonicalBasementNotes('Partially finished basement'), 'Partially finished');
  assert.equal(canonicalBasementNotes('Basement'), null);
  assert.equal(canonicalBasementNotes(true), null);

  const result = normalizeRentCastFields({
    formattedAddress: '1 Main St', floorCount: 1,
    features: { garage: true, cooling: true, basement: 'Finished basement', floorCount: 1 },
  }, null);
  assert.equal(result.fields.basementNotes, undefined, 'RentCast documents no basement field');
  assert.equal(result.fields.garageSpaces, undefined, 'generic garage presence does not invent a space count');
  assert.equal(result.fields.homeLayout, undefined, 'a story count does not imply the Home Layout taxonomy');
  assert.equal(result.fields.checks, undefined, 'generic cooling does not assert Central Air Match evidence');
  assert.equal(result.listingFacts.find((fact) => fact.key === 'stories').value, 1);
  assert.equal(result.listingFacts.find((fact) => fact.key === 'cooling').value, true);
});
