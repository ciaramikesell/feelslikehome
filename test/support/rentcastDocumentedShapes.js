// RentCast response shapes for tests. DOCUMENTATION-DERIVED, NOT LIVE RESPONSES.
//
// Field names, nesting and types follow RentCast's Property Data Schema and
// Property Listings Schema as confirmed in docs/rentcast-import-accuracy.md
// (the "Confirmed" rows). formattedAddress, propertyType, bedrooms, bathrooms,
// squareFootage and yearBuilt are the long-standing fields the importer already
// read; they are marked "used, not re-confirmed" there until the full schema is
// re-read. Nothing outside those two lists is included.
// Every value (address, numbers, dates, MLS number) is invented for testing and
// describes no real property; owner, agent and office fields are deliberately
// absent. Do not treat these as a sample of what RentCast actually returns for
// any address.

export const DOC_ADDRESS = '100 Example Ln, Testville, MI 48000';

export function documentedProperty(overrides = {}) {
  return {
    formattedAddress: DOC_ADDRESS,
    latitude: 42.5001, longitude: -83.1002,
    propertyType: 'Single Family',
    bedrooms: 3, bathrooms: 2, squareFootage: 1650, lotSize: 8712, yearBuilt: 1978,
    hoa: { fee: 0 },
    features: {
      architectureType: 'Colonial', floorCount: 2, foundationType: 'Basement',
      heating: true, heatingType: 'Forced Air',
      cooling: true, coolingType: 'Central',
      garage: true, garageSpaces: 2, garageType: 'Attached',
      exteriorType: 'Vinyl Siding', roofType: 'Asphalt',
    },
    propertyTaxes: { 2023: { year: 2023, total: 3900 }, 2024: { year: 2024, total: 4125 } },
    ...overrides,
  };
}

export function documentedSaleListing(overrides = {}) {
  return {
    formattedAddress: DOC_ADDRESS,
    latitude: 42.5001, longitude: -83.1002,
    propertyType: 'Single Family', bedrooms: 3, bathrooms: 2, squareFootage: 1650, lotSize: 8712, yearBuilt: 1978,
    hoa: { fee: 0 },
    status: 'Active', price: 289000,
    listedDate: '2026-09-20T00:00:00.000Z', removedDate: null, lastSeenDate: '2026-10-18T00:00:00.000Z', daysOnMarket: 29,
    mlsName: 'ExampleMLS', mlsNumber: '20260000001',
    ...overrides,
  };
}

export function documentedRentalListing(overrides = {}) {
  return documentedSaleListing({ price: 2150, mlsNumber: '20260000002', ...overrides });
}

// Phase 3 (docs/add-home-v3-rentcast-context.md): the further documented fields
// FLH now reads. Shapes follow RentCast's Property Data Schema (features.fireplace /
// fireplaceType, features.pool / poolType, features.viewType, subdivision) and
// Property Listings Schema (listingType; history keyed by YYYY-MM-DD, each entry
// { event, price, listingType, listedDate, removedDate, daysOnMarket }), as seen
// in the documentation's descriptions and sample records (search-confirmed; the
// pages could not be fetched directly). Values are invented. The enum lists for
// fireplace / pool / view types were not visible, so these use the documented
// sample values ("Masonry", "Concrete", "City").
export function documentedPropertyWithFeatures(overrides = {}) {
  const base = documentedProperty();
  return {
    ...base,
    subdivision: 'EXAMPLE HILLS',
    features: { ...base.features, fireplace: true, fireplaceType: 'Masonry', pool: true, poolType: 'Concrete', viewType: 'City', ...(overrides.features || {}) },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'features')),
  };
}

export function documentedSaleListingWithHistory(overrides = {}) {
  return documentedSaleListing({
    listingType: 'Standard',
    history: {
      '2026-09-20': { event: 'Sale Listing', price: 289000, listingType: 'Standard', listedDate: '2026-09-20T00:00:00.000Z', removedDate: null, daysOnMarket: 29 },
      '2025-03-02': { event: 'Sale Listing', price: 299000, listingType: 'Standard', listedDate: '2025-03-02T00:00:00.000Z', removedDate: '2025-04-30T00:00:00.000Z', daysOnMarket: 59 },
    },
    ...overrides,
  });
}
