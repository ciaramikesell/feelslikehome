// Pure functions for turning RentCast API responses into the exact field shape
// HomeModal/emptyHome already uses. No network calls live here — see
// src/app/api/import-listing/route.js for the (server-only) fetch calls.
//
// RentCast separates two kinds of data for the same address:
//   - a property RECORD (structural facts: beds, baths, sqft, lot size, year built,
//     coordinates, HOA fee, tax history — these barely change and exist whether or
//     not the home is currently listed)
//   - a current LISTING (price, days on market, listed date, status — only exists
//     while the home is actively for sale/rent, and is more current for anything
//     price- or market-related)
// We prefer listing values where both exist, and fill gaps from the property record.
//
// Only fields that already exist on the `homes` table are ever produced here.

import { EVIDENCE_STRENGTH, findingsFromFields, resolveImport } from './importDomain.js';

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

function canonicalPropertyType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[ _-]+/g, ' ');
  return ({
    apartment: 'apartment',
    'single family': 'house',
    house: 'house',
    townhouse: 'townhome',
    townhome: 'townhome',
    condo: 'condo',
    condominium: 'condo',
    'multi family': 'multifamily',
    multifamily: 'multifamily',
    other: 'other',
  })[normalized] || null;
}

// RentCast's `propertyTaxes` field is an OBJECT keyed by year (e.g. { "2023": {...},
// "2024": {...} }), not an array — their docs describe it as "tax history" without
// guaranteeing key or property iteration order. Rather than trust insertion order,
// this explicitly reads each entry's own `year`/`total` fields and picks the entry
// with the numerically highest year, so we always select the true most-recent value
// regardless of how the object happens to enumerate.
function mostRecentPropertyTax(propertyTaxes) {
  if (!propertyTaxes || typeof propertyTaxes !== 'object') return null;
  let best = null;
  Object.values(propertyTaxes).forEach((entry) => {
    const year = num(entry?.year);
    const total = num(entry?.total);
    if (year === null || total === null) return;
    if (!best || year > best.year) best = { year, total };
  });
  return best;
}

/**
 * @param {object|null} property - first result from /v1/properties, or null
 * @param {object|null} listing - first result from /v1/listings/sale or
 *   /v1/listings/rental/long-term, or null
 * @returns {{ fields: object, foundAny: boolean }}
 */
export function normalizeRentCastFields(property, listing, { apartmentCommunity = false } = {}) {
  const fields = {};

  const address = apartmentCommunity
    ? property?.formattedAddress || listing?.formattedAddress
    : listing?.formattedAddress || property?.formattedAddress;
  if (address) fields.address = address;

  // A community address can return one arbitrary advertised unit. In apartment
  // mode that listing is not evidence about the option the user is considering.
  const optionListing = apartmentCommunity ? null : listing;
  const price = optionListing?.price;
  if (price !== undefined && price !== null) fields.price = formatPrice(price);

  const beds = optionListing?.bedrooms ?? (apartmentCommunity ? null : property?.bedrooms);
  if (beds !== undefined && beds !== null) fields.beds = formatDecimal(beds);

  const baths = optionListing?.bathrooms ?? (apartmentCommunity ? null : property?.bathrooms);
  if (baths !== undefined && baths !== null) fields.baths = formatDecimal(baths);

  const sqft = optionListing?.squareFootage ?? (apartmentCommunity ? null : property?.squareFootage);
  if (sqft !== undefined && sqft !== null) fields.sqft = formatInt(sqft);

  const lotSize = property?.lotSize ?? optionListing?.lotSize;
  if (lotSize !== undefined && lotSize !== null) {
    const formatted = formatLotSize(lotSize);
    if (formatted) fields.lotSize = formatted;
  }

  const yearBuilt = property?.yearBuilt;
  if (yearBuilt !== undefined && yearBuilt !== null) fields.yearBuilt = formatInt(yearBuilt);

  const propertyType = canonicalPropertyType(optionListing?.propertyType ?? property?.propertyType);
  if (propertyType) fields.propertyType = propertyType;

  const garageSpaces = apartmentCommunity ? null : property?.features?.garageSpaces;
  if (garageSpaces !== undefined && garageSpaces !== null) fields.garageSpaces = formatInt(garageSpaces);

  const daysOnMarket = optionListing?.daysOnMarket;
  if (daysOnMarket !== undefined && daysOnMarket !== null) fields.daysOnMarket = formatInt(daysOnMarket);

  // --- Auto Enrichment 1.0: already-returned facts we previously discarded ---

  // Coordinates: infrastructure for future location intelligence — never shown in
  // the UI in this pass, stored as plain numbers (not the string-formatted style
  // used above, since these will only ever be consumed programmatically for now).
  const latitude = num(property?.latitude);
  if (latitude !== null) fields.latitude = latitude;
  const longitude = num(property?.longitude);
  if (longitude !== null) fields.longitude = longitude;

  // HOA fee: RentCast's own documentation ("Property Data" and API changelog pages)
  // explicitly and consistently describes this field as "the homeowner's association
  // MONTHLY fee or assessment amount" — confirmed directly from their docs, not
  // assumed — so labeling it "/mo" downstream is source-accurate.
  const hoaFeeMonthly = num(property?.hoa?.fee);
  if (hoaFeeMonthly !== null) fields.hoaFeeMonthly = hoaFeeMonthly;

  // Property tax: factual annual amount only — never turned into a monthly/escrow
  // estimate, and always paired with the year it actually applies to.
  const recentTax = mostRecentPropertyTax(property?.propertyTaxes);
  if (recentTax) {
    fields.propertyTaxAnnual = recentTax.total;
    fields.propertyTaxYear = recentTax.year;
  }

  // Drop any keys that ended up null/empty after formatting.
  Object.keys(fields).forEach((k) => {
    if (fields[k] === null || fields[k] === undefined || fields[k] === '') delete fields[k];
  });

  const findings = findingsFromFields(fields, {
    sourceType: 'structured_listing',
    sourceProvider: 'rentcast',
    evidenceStrength: EVIDENCE_STRENGTH.AUTHORITATIVE,
  });
  const { resolutions, fieldPatch } = resolveImport(findings);
  return { fields: fieldPatch, findings, resolutions, foundAny: Object.keys(fieldPatch).length > 0 };
}
