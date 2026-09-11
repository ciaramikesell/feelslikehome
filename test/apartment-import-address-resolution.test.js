import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractAddressFromListingUrl, extractApartmentIdentityFromListingUrl } from '../src/lib/listingUrl.js';
import { mergeImportFields } from '../src/lib/importDomain.js';
import { normalizeRentCastFields } from '../src/lib/rentcast.js';

const zillowCommunity = 'https://www.zillow.com/apartments/harper-woods-mi/haven-at-grosse-pointe/5XqMP2/';

test('Ponds at Georgetown resolves as property identity without inventing an address', () => {
  assert.deepEqual(extractApartmentIdentityFromListingUrl('https://www.zillow.com/apartments/ann-arbor-mi/ponds-at-georgetown-apartments/5XrtNG/'), {
    propertyName: 'Ponds at Georgetown Apartments', locality: 'Ann Arbor, MI', source: 'zillow',
  });
});

test('Zillow apartment URL yields identity and locality but never an address', () => {
  assert.deepEqual(extractApartmentIdentityFromListingUrl(zillowCommunity), {
    propertyName: 'Haven at Grosse Pointe', locality: 'Harper Woods, MI', source: 'zillow',
  });
  assert.equal(extractAddressFromListingUrl(zillowCommunity), null);
});

test('Apartments.com and Rent.com conservatively decompose demonstrated community shapes', () => {
  assert.deepEqual(extractApartmentIdentityFromListingUrl('https://www.apartments.com/haven-at-grosse-pointe-harper-woods-mi/8qqd0s2/'), {
    propertyName: 'Haven at Grosse Pointe', locality: 'Harper Woods, MI', source: 'apartments.com',
  });
  assert.deepEqual(extractApartmentIdentityFromListingUrl('https://www.rent.com/apartment/haven-at-grosse-pointe-harper-woods-mi-lc6702947'), {
    propertyName: 'Haven at Grosse Pointe', locality: 'Harper Woods, MI', source: 'rent.com',
  });
});

test('a defensible community domain provides only a property-name candidate', () => {
  assert.deepEqual(extractApartmentIdentityFromListingUrl('https://www.havenatgrossepointe.com/'), {
    propertyName: 'Haven at Grosse Pointe', locality: null, source: 'community-domain',
  });
});

test('ambiguous and generic URLs gracefully provide no identity', () => {
  assert.equal(extractApartmentIdentityFromListingUrl('https://www.apartments.com/green-acres-mi/abc123/'), null);
  assert.equal(extractApartmentIdentityFromListingUrl('https://example.com/some-listing'), null);
  assert.equal(extractApartmentIdentityFromListingUrl('not a url'), null);
  assert.equal(extractApartmentIdentityFromListingUrl('https://www.apartmentlist.com/light_cycle?code=x&rental_ids=p26850569'), null);
});

test('community RentCast lookup promotes only property-scoped facts', () => {
  const property = { formattedAddress: '2511 Packard St, Ann Arbor, MI 48104', bedrooms: 99, bathrooms: 99, squareFootage: 99999, yearBuilt: 1974, propertyType: 'Apartment', lotSize: 43560, latitude: 42.25, longitude: -83.72 };
  const arbitraryUnit = { price: 1976, bedrooms: 2, bathrooms: 2, squareFootage: 1050, daysOnMarket: 8 };
  assert.deepEqual(normalizeRentCastFields(property, arbitraryUnit, { apartmentCommunity: true }).fields, {
    address: property.formattedAddress, lotSize: '1.00 acres', yearBuilt: '1974', propertyType: 'apartment', latitude: 42.25, longitude: -83.72,
  });
});

test('community listing cannot populate option and explicit user option survives', () => {
  const result = normalizeRentCastFields({ formattedAddress: '1 Community Way' }, { price: 2200, bedrooms: 3, bathrooms: 2, squareFootage: 1200 }, { apartmentCommunity: true });
  assert.equal(result.fields.price, undefined);
  assert.equal(result.fields.beds, undefined);
  assert.deepEqual(mergeImportFields({ selectedFloorPlanName: 'B2', selectedUnitLabel: '', price: '2100' }, result.fields), { selectedFloorPlanName: 'B2', selectedUnitLabel: '', price: '2100', address: '1 Community Way' });
});

test('ordinary rentals remain unchanged and an explicitly scoped option can merge', () => {
  assert.equal(normalizeRentCastFields(null, { price: 1976, bedrooms: 2 }).fields.price, '1976');
  const candidate = { selectedFloorPlanName: 'B2', price: '2050', beds: '2' };
  assert.deepEqual(mergeImportFields({ selectedFloorPlanName: '', price: '', beds: '' }, candidate), candidate);
});

test('existing address-bearing sales URLs remain unchanged', () => {
  assert.equal(extractAddressFromListingUrl('https://www.zillow.com/homedetails/123-Main-St-Ann-Arbor-MI-48104/123_zpid/').address, '123 Main St, Ann Arbor, MI 48104');
  assert.equal(extractAddressFromListingUrl('https://www.redfin.com/MI/Ann-Arbor/123-Main-St-48104/home/1').address, '123 Main St, Ann Arbor, MI 48104');
  assert.equal(extractAddressFromListingUrl('https://www.realtor.com/realestateandhomes-detail/123-Main-St_Ann-Arbor_MI_48104_M1').address, '123 Main St, Ann Arbor, MI 48104');
});

test('canonical address and corrected values survive conservative enrichment', () => {
  const form = { propertyName: 'My corrected name', address: '10 Correct Ave', beds: '' };
  assert.deepEqual(mergeImportFields(form, { propertyName: 'URL candidate', address: 'Provider address', beds: '2' }), {
    propertyName: 'My corrected name', address: '10 Correct Ave', beds: '2',
  });
});

test('address UI keeps selection, free typing, keyboard support, RentCast, and compact mobile class', () => {
  const autocomplete = fs.readFileSync('src/components/AddressAutocomplete.jsx', 'utf8');
  const modal = fs.readFileSync('src/components/HomeModal.jsx', 'utf8');
  assert.match(autocomplete, /AutocompleteSuggestion\.fetchAutocompleteSuggestions/);
  assert.match(autocomplete, /fetchFields\(\{ fields: \['formattedAddress'\] \}\)/);
  assert.doesNotMatch(autocomplete, /new Autocomplete\(/);
  assert.match(autocomplete, /onChange=\{\(event\) => onChange/);
  assert.match(autocomplete, /aria-live="polite"/);
  assert.match(autocomplete, /role="combobox"/);
  assert.match(autocomplete, /ArrowDown/);
  assert.match(modal, /onKeyDown=\{\(e\) => e\.key === 'Enter'/);
  assert.match(modal, /lookupAddress\(address, \{ listingUrl: form\.listingUrl \}\)/);
  assert.match(modal, /hh-find-home-row/);
  assert.match(modal, /We found the property\./);
  assert.match(modal, /!vocabulary\.apartment && <CompactField label="Basement"/);
});
