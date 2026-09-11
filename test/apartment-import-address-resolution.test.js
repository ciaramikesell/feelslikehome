import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractAddressFromListingUrl, extractApartmentIdentityFromListingUrl } from '../src/lib/listingUrl.js';
import { mergeImportFields } from '../src/lib/importDomain.js';

const zillowCommunity = 'https://www.zillow.com/apartments/harper-woods-mi/haven-at-grosse-pointe/5XqMP2/';

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
  assert.match(autocomplete, /place_changed/);
  assert.match(autocomplete, /formatted_address/);
  assert.match(autocomplete, /onChange=\{\(event\) => onChange/);
  assert.match(autocomplete, /aria-live="polite"/);
  assert.match(modal, /onKeyDown=\{\(e\) => e\.key === 'Enter'/);
  assert.match(modal, /lookupAddress\(address, \{ listingUrl: form\.listingUrl \}\)/);
  assert.match(modal, /hh-find-home-row/);
  assert.match(modal, /We found the property\./);
});
