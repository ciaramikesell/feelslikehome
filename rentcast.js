// Pure functions for turning RentCast API responses into the exact field shape
// HomeModal/emptyHome already uses. No network calls live here — see
// src/app/api/import-listing/route.js for the (server-only) fetch calls.
//
// RentCast separates two kinds of data for the same address:
//   - a property RECORD (structural facts: beds, baths, sqft, lot size, year built —
//     these barely change and exist whether or not the home is currently listed)
//   - a current LISTING (price, days on market, listed date, HOA fee, status —
//     only exists while the home is actively for sale/rent, and is more current
//     for anything price- or market-related)
// We prefer listing values where both exist, and fill gaps from the property record.
//
// Only fields that already exist on the `homes` table are ever produced here —
// anything RentCast returns that Feels Like Home doesn't track yet (property type,
// HOA fee, listing status, MLS number, etc.) is intentionally left out rather than
// growing the schema for V1.

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(v) {
  const n = num(v);
  return n === null ? null : String(Math.round(n));
}

function formatLotSize(v) {
  // RentCast reports lot size in square feet.
  const n = num(v);
  if (n === null) return null;
  if (n >= 43560) return `${(n / 43560).toFixed(2)} acres`;
  return `${Math.round(n)} sq ft`;
}

function formatInt(v) {
  const n = num(v);
  return n === null ? null : String(Math.round(n));
}

function formatDecimal(v) {
  const n = num(v);
  return n === null ? null : String(n);
}

/**
 * @param {object|null} property - first result from /v1/properties, or null
 * @param {object|null} listing - first result from /v1/listings/sale or
 *   /v1/listings/rental/long-term, or null
 * @returns {{ fields: object, foundAny: boolean }}
 */
export function normalizeRentCastFields(property, listing) {
  const fields = {};

  const address = listing?.formattedAddress || property?.formattedAddress;
  if (address) fields.address = address;

  const price = listing?.price;
  if (price !== undefined && price !== null) fields.price = formatPrice(price);

  const beds = listing?.bedrooms ?? property?.bedrooms;
  if (beds !== undefined && beds !== null) fields.beds = formatDecimal(beds);

  const baths = listing?.bathrooms ?? property?.bathrooms;
  if (baths !== undefined && baths !== null) fields.baths = formatDecimal(baths);

  const sqft = listing?.squareFootage ?? property?.squareFootage;
  if (sqft !== undefined && sqft !== null) fields.sqft = formatInt(sqft);

  const lotSize = property?.lotSize ?? listing?.lotSize;
  if (lotSize !== undefined && lotSize !== null) {
    const formatted = formatLotSize(lotSize);
    if (formatted) fields.lotSize = formatted;
  }

  const yearBuilt = property?.yearBuilt;
  if (yearBuilt !== undefined && yearBuilt !== null) fields.yearBuilt = formatInt(yearBuilt);

  const garageSpaces = property?.features?.garageSpaces;
  if (garageSpaces !== undefined && garageSpaces !== null) fields.garageSpaces = formatInt(garageSpaces);

  const daysOnMarket = listing?.daysOnMarket;
  if (daysOnMarket !== undefined && daysOnMarket !== null) fields.daysOnMarket = formatInt(daysOnMarket);

  // Drop any keys that ended up null/empty after formatting.
  Object.keys(fields).forEach((k) => {
    if (fields[k] === null || fields[k] === undefined || fields[k] === '') delete fields[k];
  });

  return { fields, foundAny: Object.keys(fields).length > 0 };
}
