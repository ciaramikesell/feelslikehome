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
// Only fields that already exist on the `homes` table are ever produced here, and
// only from fields RentCast documents (Property Data Schema / Property Listings
// Schema; see docs/rentcast-import-accuracy.md). A provider key that is not in
// the documented schema is never mapped, even if a response happens to carry it.

import { EVIDENCE_STRENGTH, findingsFromFields, resolveImport } from './importDomain.js';
import { fact } from './listingFacts.js';

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
    if (year === null || total === null || !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1 || total < 0) return;
    if (!best || year > best.year) best = { year, total };
  });
  return best;
}

// Basement and laundry wording helpers. RentCast's documented schema has no
// basement or laundry field, so the RentCast import no longer calls these; they
// stay for a future source that documents one.
export function canonicalBasementNotes(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || /^(?:yes|true|basement)$/i.test(normalized)) return null;
  if (/\bpart(?:ial|ially|ly)[ -]?finished\b/i.test(normalized)) return 'Partially finished';
  if (/\bfinished\b/i.test(normalized) && !/\bunfinished\b/i.test(normalized)) return 'Finished';
  if (/\bunfinished\b/i.test(normalized)) return 'Unfinished';
  if (/\bwalk[ -]?out\b/i.test(normalized)) return 'Walkout';
  return null;
}

// Structured basement wording -> the Home Facts basement condition / style. A
// bare "yes" or "basement" says nothing about either, so it maps to nothing.
export function canonicalBasementFacts(value) {
  const notes = canonicalBasementNotes(value);
  const raw = typeof value === 'string' ? value : '';
  const condition = notes === 'Partially finished' ? 'partially_finished' : notes === 'Finished' ? 'finished' : notes === 'Unfinished' ? 'unfinished' : null;
  const style = /\bwalk[ -]?out\b/i.test(raw) ? 'walkout' : null;
  return { basementCondition: condition, basementStyle: style };
}

// Attached / Detached only when the listing says exactly one of them.
export function canonicalGarageType(value) {
  if (typeof value !== 'string') return null;
  const attached = /\battached\b/i.test(value);
  const detached = /\bdetached\b/i.test(value);
  if (attached === detached) return null;
  return attached ? 'attached' : 'detached';
}

// Where the laundry is, only when the provider names exactly one location
// ("Basement", "First Floor", "Second Floor" …). Several locations, a bare
// yes/no, hookups, or anything else stays Unknown: a basement existing, or
// "laundry hookups", says nothing about where the laundry is.
const LAUNDRY_LOCATIONS = [
  ['basement', /\b(?:basement|lower level)\b/i],
  ['first_floor', /\b(?:first|1st|main|ground)[ -]?(?:floor|level)\b/i],
  // "Upper level" / "upstairs" are not necessarily the second floor.
  ['second_floor', /\b(?:second|2nd)[ -]?(?:floor|level)\b/i],
];
export function canonicalLaundryLocation(value) {
  const text = Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(', ') : typeof value === 'string' ? value : '';
  // "Hookups in basement" is where a washer could go, not where the laundry is.
  if (!text.trim() || /\bhook[ -]?ups?\b/i.test(text)) return null;
  const named = LAUNDRY_LOCATIONS.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
  return named.length === 1 ? named[0] : null;
}

// A descriptive system/material value ("Forced Air", "Vinyl Siding"). Booleans
// ("has heating: true") say nothing about the kind, so they are not values.
function descriptiveText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text && !/^(?:yes|no|true|false|none|unknown|n\/a)$/i.test(text) ? text.slice(0, 120) : null;
}


/* ----------------------------- Address matching ----------------------------- */
// RentCast answers an address query with its closest record, and we read only
// the first result. A record for a different house must never fill this home's
// facts, so each result is checked against the address we asked for. Only a
// definite difference (house number, street name, unit, ZIP or state) is a
// mismatch; spelling variants ("Drive" / "Dr") and a missing part are not.

const STREET_WORDS = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', boulevard: 'blvd',
  place: 'pl', terrace: 'ter', circle: 'cir', parkway: 'pkwy', highway: 'hwy', trail: 'trl', square: 'sq',
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};
const STREET_SUFFIXES = new Set(['st', 'ave', 'rd', 'dr', 'ln', 'ct', 'blvd', 'pl', 'ter', 'cir', 'pkwy', 'hwy', 'trl', 'sq', 'way', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
const UNIT_WORDS = /^(?:apt|apartment|unit|ste|suite|#)$/;

function parseAddress(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.toLowerCase().replace(/#\s*/g, ' # ').split(',').map((part) => part.trim()).filter(Boolean);
  const tokens = (parts[0] || '').replace(/[.]/g, '').split(/\s+/).filter(Boolean).map((token) => STREET_WORDS[token] || token);
  const rest = parts.slice(1);
  const unitIndex = tokens.findIndex((token) => UNIT_WORDS.test(token));
  let unit = unitIndex >= 0 ? tokens[unitIndex + 1] || null : null;
  const street = unitIndex >= 0 ? tokens.slice(0, unitIndex) : tokens;
  // "Apt 4B" can also be its own comma part.
  rest.forEach((part) => { const m = part.match(/^(?:apt|apartment|unit|ste|suite|#)\s*(\S+)$/); if (m) unit = m[1]; });
  const tail = rest.join(' ');
  const zip = tail.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || null;
  const state = tail.match(/\b([a-z]{2})\b(?=\s*(?:\d{5}|$))/)?.[1] || null;
  const number = /^\d+[a-z]?$/.test(street[0] || '') ? street[0] : null;
  const name = street.slice(number ? 1 : 0).filter((token) => !STREET_SUFFIXES.has(token)).join(' ');
  return { number, name, unit, zip, state };
}

/** @returns {'match'|'mismatch'|'unknown'} */
export function rentCastAddressMatch(requested, returned) {
  const a = parseAddress(requested);
  const b = parseAddress(returned);
  if (!a || !b || !a.number || !b.number) return 'unknown';
  const differs = (x, y) => !!x && !!y && x !== y;
  if (a.number !== b.number || differs(a.name, b.name) || differs(a.unit, b.unit) || differs(a.zip, b.zip) || differs(a.state, b.state)) return 'mismatch';
  return 'match';
}

/* ------------------------------- Coordinates -------------------------------- */
// Documented on both the property record and the listing. A point is used only
// when it is a real map position (not 0,0 "Null Island", not out of range) and,
// when both sources give one, when they agree to within ~250 m.
const COORDINATE_AGREEMENT_METERS = 250;

function validPoint(lat, lng) {
  const latitude = num(lat);
  const longitude = num(lng);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

function metersBetween(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function rentCastCoordinates(property, listing) {
  const fromProperty = property ? validPoint(property.latitude, property.longitude) : null;
  const fromListing = listing ? validPoint(listing.latitude, listing.longitude) : null;
  if (fromProperty && fromListing && metersBetween(fromProperty, fromListing) > COORDINATE_AGREEMENT_METERS) return null;
  return fromProperty || fromListing;
}

/* ----------------------------- Listing freshness ---------------------------- */
// Documented listing status is "Active" or "Inactive". An inactive listing still
// carries its last known price, which is not a current asking price. Anything
// else (missing, unrecognized) is "unknown" and is never presented as active.
export function rentCastListingStatus(listing) {
  const status = typeof listing?.status === 'string' ? listing.status.trim().toLowerCase() : '';
  return status === 'active' ? 'active' : status === 'inactive' ? 'inactive' : 'unknown';
}

function isoDateOnly(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function listingSnapshot(listing) {
  if (!listing) return null;
  const status = rentCastListingStatus(listing);
  const price = num(listing.price);
  const snapshot = {
    status,
    lastKnownPrice: price !== null && price >= 0 ? price : null,
    listedDate: isoDateOnly(listing.listedDate),
    removedDate: isoDateOnly(listing.removedDate),
    lastSeenDate: isoDateOnly(listing.lastSeenDate),
    daysOnMarket: num(listing.daysOnMarket),
    mlsName: descriptiveText(listing.mlsName),
    mlsNumber: listing.mlsNumber == null ? null : descriptiveText(String(listing.mlsNumber)),
  };
  return snapshot;
}

const LISTING_STATUS_LABELS = { active: 'Active', inactive: 'Inactive (no longer listed)', unknown: 'Not reported' };

function formatUsd(value) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/**
 * @param {object|null} property - first result from /v1/properties, or null
 * @param {object|null} listing - first result from /v1/listings/sale or
 *   /v1/listings/rental/long-term, or null
 * @param {{ apartmentCommunity?: boolean, requestedAddress?: string }} options
 */
export function normalizeRentCastFields(rawProperty, rawListing, { apartmentCommunity = false, requestedAddress = '' } = {}) {
  // A result for a different address is dropped, never merged.
  const addressCheck = {
    property: rawProperty ? rentCastAddressMatch(requestedAddress, rawProperty.formattedAddress) : null,
    listing: rawListing ? rentCastAddressMatch(requestedAddress, rawListing.formattedAddress) : null,
  };
  const property = addressCheck.property === 'mismatch' ? null : rawProperty;
  const listing = addressCheck.listing === 'mismatch' ? null : rawListing;
  const fields = {};

  const address = apartmentCommunity
    ? property?.formattedAddress || listing?.formattedAddress
    : listing?.formattedAddress || property?.formattedAddress;
  if (address) fields.address = address;

  // A community address can return one arbitrary advertised unit. In apartment
  // mode that listing is not evidence about the option the user is considering.
  const optionListing = apartmentCommunity ? null : listing;
  const listingStatus = optionListing ? rentCastListingStatus(optionListing) : null;
  // Only an Active listing's price is an asking price (or current rent), and only
  // an Active listing is still accumulating days on market. An Inactive or
  // unreported listing's last price stays in the snapshot, labelled as such.
  const activeListing = listingStatus === 'active' ? optionListing : null;
  const price = activeListing?.price;
  if (price !== undefined && price !== null) fields.price = formatPrice(price);

  // Size: a current listing first, then the property record, then the last known
  // attributes of an inactive listing. Apartment communities take none of them.
  const sized = (key) => (apartmentCommunity ? null : activeListing?.[key] ?? property?.[key] ?? optionListing?.[key]);
  const beds = sized('bedrooms');
  if (beds !== undefined && beds !== null) fields.beds = formatDecimal(beds);

  const baths = sized('bathrooms');
  if (baths !== undefined && baths !== null) fields.baths = formatDecimal(baths);

  const sqft = sized('squareFootage');
  if (sqft !== undefined && sqft !== null) fields.sqft = formatInt(sqft);

  // Documented in square feet. Zero or negative is not a lot size.
  const lotSize = num(property?.lotSize ?? optionListing?.lotSize);
  if (lotSize !== null && lotSize > 0) fields.lotSize = formatLotSize(lotSize);

  const yearBuilt = property?.yearBuilt;
  if (yearBuilt !== undefined && yearBuilt !== null) fields.yearBuilt = formatInt(yearBuilt);

  const propertyType = canonicalPropertyType(optionListing?.propertyType ?? property?.propertyType);
  if (propertyType) fields.propertyType = propertyType;

  const features = (!apartmentCommunity && property?.features && typeof property.features === 'object') ? property.features : {};

  const garageSpaces = num(features.garageSpaces);
  if (garageSpaces !== null && garageSpaces >= 0) fields.garageSpaces = formatInt(garageSpaces);

  // Home Facts details: only the documented descriptive fields. The documented
  // features.heating / features.cooling are presence flags; a flag says nothing
  // about the kind of system, so it never becomes a heating or cooling value.
  const heating = descriptiveText(features.heatingType);
  if (heating) fields.heating = heating;
  const cooling = descriptiveText(features.coolingType);
  if (cooling) fields.cooling = cooling;
  const exterior = descriptiveText(features.exteriorType);
  if (exterior) fields.exterior = exterior;
  const roof = descriptiveText(features.roofType);
  if (roof) fields.roof = roof;
  const garageType = canonicalGarageType(features.garageType);
  if (garageType) fields.garageType = garageType;

  // The MLS number is the listing's own ID; RentCast's internal record id is not.
  const listingId = descriptiveText(optionListing?.mlsNumber == null ? null : String(optionListing.mlsNumber));
  if (listingId) fields.listingId = listingId;

  const daysOnMarket = activeListing?.daysOnMarket;
  if (daysOnMarket !== undefined && daysOnMarket !== null) fields.daysOnMarket = formatInt(daysOnMarket);

  // Coordinates only from a result whose address matched the one we asked for,
  // so the point can be trusted for this exact address (see HomeModal submit).
  const coordinates = rentCastCoordinates(
    addressCheck.property === 'match' ? property : null,
    addressCheck.listing === 'match' ? optionListing : null,
  );
  if (coordinates) {
    fields.latitude = coordinates.latitude;
    fields.longitude = coordinates.longitude;
  }

  // HOA fee: documented on both the property record and the listing as the
  // MONTHLY fee. 0 is a confirmed $0/mo, not "no HOA"; absent stays Unknown.
  const hoaFee = num(property?.hoa?.fee ?? optionListing?.hoa?.fee);
  if (hoaFee !== null && hoaFee >= 0) fields.hoaFeeMonthly = hoaFee;

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
  const listingMeta = listingSnapshot(optionListing);
  // A presence flag is shown only when it says the system exists and no type
  // was given. false is not shown: it is not documented as "has none".
  const systemFact = (type, flag) => descriptiveText(type) || (flag === true ? true : null);
  const listingFacts = [
    fact('stories', 'Stories / levels', features.floorCount, 'structure'),
    fact('architecture', 'Style', descriptiveText(features.architectureType), 'structure'),
    fact('exterior', 'Exterior', descriptiveText(features.exteriorType), 'structure'),
    fact('roof', 'Roof', descriptiveText(features.roofType), 'structure'),
    fact('foundation', 'Foundation', descriptiveText(features.foundationType), 'structure'),
    fact('garageType', 'Garage', descriptiveText(features.garageType) || (features.garage === true ? true : null), 'parking'),
    fact('heating', 'Heating', systemFact(features.heatingType, features.heating), 'utilities'),
    fact('cooling', 'Cooling', systemFact(features.coolingType, features.cooling), 'utilities'),
    listingMeta && fact('status', 'Listing status', LISTING_STATUS_LABELS[listingMeta.status], 'listing'),
    listingMeta && listingMeta.status !== 'active' && listingMeta.lastKnownPrice !== null
      && fact('lastKnownPrice', 'Last listed price', `${formatUsd(listingMeta.lastKnownPrice)} (not a current asking price)`, 'listing'),
    listingMeta && fact('listedDate', 'Listed', listingMeta.listedDate, 'listing'),
    listingMeta && fact('removedDate', 'Removed from market', listingMeta.removedDate, 'listing'),
    listingMeta && fact('lastSeenDate', 'Listing last seen', listingMeta.lastSeenDate, 'listing'),
    listingMeta && fact('mls', 'Listing ID', listingMeta.mlsNumber, 'listing'),
    listingMeta && fact('mlsName', 'MLS', listingMeta.mlsName, 'listing'),
  ].filter(Boolean);
  // RentCast's documented listing schema has no description / remarks field, so
  // there is nothing to extract features from. (Pasted listing text still is.)
  const descriptionFeatures = [];
  return {
    fields: fieldPatch, findings, resolutions, listingFacts, descriptionFeatures,
    listing: listingMeta, addressCheck,
    foundAny: Object.keys(fieldPatch).length > 0 || listingFacts.length > 0,
  };
}
