// Preloaded into the Next.js dev server for full-stack QA only
// (NODE_OPTIONS="--import ./scripts/qa/rentcast-fixture.mjs"). Answers the
// server-side RentCast lookups from a fixture so the import path runs for real
// without a RentCast key or network. Every other request is untouched.
//
// Field names and shapes follow RentCast's documented Property Data and Property
// Listings schemas (see docs/rentcast-import-accuracy.md). The values are made
// up for QA; this is not a captured live response.
const PROPERTY = {
  formattedAddress: '51613 Sass Rd, New Baltimore, MI 48047', bedrooms: 5, bathrooms: 2, squareFootage: 2080, lotSize: 12632,
  yearBuilt: 1993, propertyType: 'Single Family', latitude: 42.68, longitude: -82.73,
  features: { heating: true, heatingType: 'Forced Air', cooling: true, exteriorType: 'Vinyl Siding', roofType: 'Asphalt Shingle', garage: true, garageType: 'Attached Garage', garageSpaces: 2, floorCount: 2 },
  hoa: { fee: 0 },
  propertyTaxes: { 2025: { year: 2025, total: 4210 } },
};
const LISTING = {
  formattedAddress: PROPERTY.formattedAddress, latitude: 42.68, longitude: -82.73, price: 335000, bedrooms: 5, bathrooms: 2, squareFootage: 2080,
  status: process.env.QA_RENTCAST_LISTING_STATUS || 'Active', listedDate: '2026-09-26T00:00:00.000Z', removedDate: null, lastSeenDate: '2026-10-18T00:00:00.000Z',
  daysOnMarket: 23, mlsName: 'QA MLS', mlsNumber: '20261076983',
};
// QA_RENTCAST_FAIL=listing|property|both answers that lookup with HTTP 503 (or 429 with QA_RENTCAST_FAIL_STATUS).
//
// rentcast-import-e2e.mjs picks a scenario by house number on Sass Rd, so one
// dev server covers them all: 51615 listing lookup down (503), 51617 listing
// Inactive, 51619 both lookups rate-limited (429). Any other number is complete.
const SCENARIOS = { 51615: { fail: 'listing', status: 503 }, 51617: { listingStatus: 'Inactive' }, 51619: { fail: 'both', status: 429 } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (url && url.startsWith('https://api.rentcast.io/')) {
    if (process.env.QA_RENTCAST_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.QA_RENTCAST_DELAY_MS)));
    const kind = url.includes('/v1/properties') ? 'property' : 'listing';
    const number = (new URL(url).searchParams.get('address') || '').match(/^\s*(\d+)/)?.[1] || '51613';
    const scenario = SCENARIOS[number] || {};
    const fail = scenario.fail || process.env.QA_RENTCAST_FAIL;
    if ([kind, 'both'].includes(fail)) return new Response('{}', { status: Number(scenario.status || process.env.QA_RENTCAST_FAIL_STATUS || 503) });
    const formattedAddress = PROPERTY.formattedAddress.replace(/^\d+/, number);
    const body = kind === 'property' ? [{ ...PROPERTY, formattedAddress }]
      : url.includes('/v1/listings') ? [{ ...LISTING, formattedAddress, ...(scenario.listingStatus ? { status: scenario.listingStatus } : {}) }] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};
