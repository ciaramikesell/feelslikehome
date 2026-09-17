import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRentCastFields } from '../src/lib/rentcast.js';
import { extractExplicitDescriptionFeatures, countListingDetails } from '../src/lib/listingFacts.js';

test('canonical RentCast normalizer preserves existing fields and exposes additional structured facts', () => {
  const result = normalizeRentCastFields({
    formattedAddress: '1268 Brys Dr, Grosse Pointe Woods, MI 48236', bedrooms: 3, bathrooms: 2,
    squareFootage: 1416, lotSize: 5227, yearBuilt: 1950, propertyType: 'Single Family',
    features: { garageSpaces: 2, garage: 'Detached', exteriorType: 'Brick', heating: 'Forced Air', cooling: 'Central', pool: false },
    hoa: { fee: 0 }, propertyTaxes: { 2024: { year: 2024, total: 5880 } },
  }, {
    price: 325000, daysOnMarket: 7, status: 'Active', id: 'MLS-123',
    description: 'Finished basement. Hardwood floors and a fenced yard. Updated kitchen.',
  });

  assert.deepEqual({ price: result.fields.price, beds: result.fields.beds, baths: result.fields.baths, sqft: result.fields.sqft, yearBuilt: result.fields.yearBuilt, garageSpaces: result.fields.garageSpaces, daysOnMarket: result.fields.daysOnMarket },
    { price: '325000', beds: '3', baths: '2', sqft: '1416', yearBuilt: '1950', garageSpaces: '2', daysOnMarket: '7' });
  assert.equal(result.fields.hoaFeeMonthly, 0);
  assert.equal(result.fields.propertyTaxAnnual, 5880);
  assert.equal(result.listingFacts.find((item) => item.key === 'pool').value, false);
  assert.equal(result.listingFacts.find((item) => item.key === 'hoa').value, false);
  assert.deepEqual(result.descriptionFeatures.map((item) => item.label), ['Finished basement', 'Hardwood floors', 'Fenced yard', 'Updated kitchen']);
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
