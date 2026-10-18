// Preloaded into the Next.js dev server for full-stack QA only
// (NODE_OPTIONS="--import ./scripts/qa/rentcast-fixture.mjs"). Answers the
// server-side RentCast lookups from a fixture so the import path runs for real
// without a RentCast key or network. Every other request is untouched.
const PROPERTY = {
  formattedAddress: '51613 Sass Rd, New Baltimore, MI 48047', bedrooms: 5, bathrooms: 2, squareFootage: 2080, lotSize: 12632,
  yearBuilt: 1993, propertyType: 'Single Family', latitude: 42.68, longitude: -82.73,
  features: { heatingType: 'Forced Air', cooling: true, exteriorType: 'Vinyl Siding', roofType: 'Asphalt Shingle', garageType: 'Attached Garage', garageSpaces: 2, basement: 'Unfinished', fireplaceCount: 1, laundry: 'First Floor Laundry Room' },
  propertyTaxes: { 2025: { year: 2025, total: 4210 } },
};
const LISTING = { formattedAddress: PROPERTY.formattedAddress, price: 335000, bedrooms: 5, bathrooms: 2, squareFootage: 2080, daysOnMarket: 23, mlsNumber: '20261076983', status: 'Active', description: 'Bright two-story with first-floor laundry and a deck.' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (url && url.startsWith('https://api.rentcast.io/')) {
    if (process.env.QA_RENTCAST_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.QA_RENTCAST_DELAY_MS)));
    const body = url.includes('/v1/properties') ? [PROPERTY] : url.includes('/v1/listings') ? [LISTING] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};
