// Pure display-formatting helpers for property facts in HomeModal (the "found
// automatically" summary card and the compact Property Details area). These only
// format strings for presentation — they never fetch data, touch RentCast, or
// mutate the underlying stored value (that's normalizeRentCastFields in
// src/lib/rentcast.js, which is untouched by this file).

import { normalizeSearchIntent, PROPERTY_TYPE_LABELS } from './searchIntent.js';
import { isUnitlessLotSize, lotSizeAcres } from './lotSize.js';

function withCommas(numStr) {
  const n = Number(numStr);
  return Number.isFinite(n) ? n.toLocaleString() : numStr;
}

// Splits "1918 Clawson Ave, Royal Oak, MI 48073" into two display lines at the
// first comma: the street line, and the city/state/zip line.
export function splitAddressLines(address) {
  if (!address) return { line1: '', line2: '' };
  const idx = address.indexOf(',');
  if (idx === -1) return { line1: address, line2: '' };
  return { line1: address.slice(0, idx).trim(), line2: address.slice(idx + 1).trim() };
}

// $264900 (or "264,900", "$264,900", etc.) -> "$264,900". Returns '' for empty/
// unparsable input so callers can fall back to their own placeholder treatment.
export function formatCurrencyDisplay(v) {
  if (!v) return '';
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n === 0) return '';
  return `$${Math.round(n).toLocaleString()}`;
}

// The listing price is the monthly rent only for the canonical Rental intent and
// its two legacy aliases. Investment prices remain purchase prices.
export function formatHomePrice(value, searchType) {
  const amount = formatCurrencyDisplay(value);
  return amount && normalizeSearchIntent(searchType) === 'rental' ? `${amount}/mo` : amount;
}

export function homePriceLabel(searchType) {
  return normalizeSearchIntent(searchType) === 'rental' ? 'Monthly Rent' : 'Price';
}

export function preferencePriceLabel(searchType) {
  return normalizeSearchIntent(searchType) === 'rental' ? 'Maximum Monthly Price' : 'Maximum Budget';
}

export function formatPropertyType(value) {
  return PROPERTY_TYPE_LABELS[value] || 'Unknown';
}

export function formatTriState(value) {
  return value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
}

// Parse PostgreSQL date semantics directly instead of passing through Date, which
// would shift the calendar day in time zones west of UTC.
export function formatDateOnly(value, locale = 'en-US') {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'Unknown';
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return 'Unknown';
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

// Strips everything but digits — used when writing back from a currency-formatted
// input so the stored value stays a plain numeric string (matching.js's parseNum
// already strips non-digits too, but keeping storage plain avoids double-formatting).
export function digitsOnly(v) {
  return String(v || '').replace(/[^0-9]/g, '');
}

// Normalizes a stored lot-size string for DISPLAY ONLY — never rewrites the
// underlying value. It reads the value exactly as Match does (lotSizeAcres):
//   - a recognized unit (acres, sq ft, sq m, hectares) -> acres, 2 decimals
//   - a saved bare number has no recorded unit; Match treats it as Unknown,
//     so it is shown as saved with "(unit not recorded)", never converted
//   - anything else Match treats as Unknown (a fraction, words, zero) ->
//     returned verbatim rather than guessed at
// Under 0.01 acres ("0.00 acres" isn't meaningful) the saved value is shown.
export function formatLotSizeDisplay(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return '';
  if (isUnitlessLotSize(str)) return `${str} (unit not recorded)`;
  const acres = lotSizeAcres(str);
  if (acres === null || acres < 0.01) return str;
  return `${acres.toFixed(2)} acres`;
}

// Builds the fact lines for the compact confirmation card from whichever fields
// were actually returned — never invents a field that wasn't found, and never
// shows an empty placeholder for something unavailable.
export function formatFoundCardFacts(fields, searchType) {
  const f = fields || {};
  const priceLine = formatHomePrice(f.price, searchType);

  const bedsBathsSqft = [
    f.beds ? `${f.beds} bd` : '',
    f.baths ? `${f.baths} ba` : '',
    f.sqft ? `${withCommas(f.sqft)} sq ft` : '',
  ].filter(Boolean).join(' · ');

  const secondaryFacts = [
    f.yearBuilt ? `Built ${f.yearBuilt}` : '',
    f.garageSpaces ? `${f.garageSpaces}-car garage` : '',
    f.lotSize ? `${formatLotSizeDisplay(f.lotSize)} lot` : '',
    f.daysOnMarket ? `${f.daysOnMarket} day${f.daysOnMarket === '1' ? '' : 's'} on market` : '',
  ].filter(Boolean).join(' · ');

  // HOA/property tax — plain factual amounts only, each omitted entirely (not
  // shown as "Not available") when RentCast didn't return it for this property.
  const hoaTaxLine = normalizeSearchIntent(searchType) === 'rental' ? '' : [
    f.hoaFeeMonthly ? `HOA: $${withCommas(f.hoaFeeMonthly)}/mo` : '',
    f.propertyTaxAnnual ? `Property tax: $${withCommas(f.propertyTaxAnnual)}/yr${f.propertyTaxYear ? ` · ${f.propertyTaxYear}` : ''}` : '',
  ].filter(Boolean).join(' · ');

  return { priceLine, bedsBathsSqft, secondaryFacts, hoaTaxLine };
}

// Pros, cons and notes are freeform shared text. They are shown exactly as
// written and never split on commas: "Bright, open living room" is one phrase,
// and there is no reliable way to tell where one item ends.
export function freeformText(text) {
  return typeof text === 'string' ? text.trim() : '';
}

// How many note fields a home has written (notes, condition notes, pros, cons):
// one per non-empty field, never one per comma.
export function noteFieldCount(home) {
  return [home?.notes, home?.conditionNotes, home?.pros, home?.cons].filter((text) => freeformText(text)).length;
}

// Count of "property details" found, for the "We found N property details" message.
// Address identifies the home rather than describing a fact about it, and latitude/
// longitude are invisible infrastructure fields, never shown in the UI — both kinds
// are excluded so the count only reflects what the user can actually see.
export function countFoundFacts(fields) {
  if (!fields) return 0;
  return Object.keys(fields).filter((k) => k !== 'address' && k !== 'latitude' && k !== 'longitude' && fields[k]).length;
}
