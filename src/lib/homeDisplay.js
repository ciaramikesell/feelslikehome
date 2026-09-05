// Pure display-formatting helpers for property facts in HomeModal (the "found
// automatically" summary card and the compact Property Details area). These only
// format strings for presentation — they never fetch data, touch RentCast, or
// mutate the underlying stored value (that's normalizeRentCastFields in
// src/lib/rentcast.js, which is untouched by this file).

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

// Strips everything but digits — used when writing back from a currency-formatted
// input so the stored value stays a plain numeric string (matching.js's parseNum
// already strips non-digits too, but keeping storage plain avoids double-formatting).
export function digitsOnly(v) {
  return String(v || '').replace(/[^0-9]/g, '');
}

// Normalizes a stored lot-size string for DISPLAY ONLY — never rewrites the
// underlying value. Handles three cases without double-converting:
//   - already says "acres" -> re-render with 2 decimals, don't touch the unit
//   - says "sq ft"/"sqft"/"square feet" (or is a bare number, our default
//     convention for unlabeled values) -> convert using 1 acre = 43,560 sq ft
//   - anything unparsable -> returned verbatim rather than guessed at
// Sub-436 sq ft (rounds to under 0.01 acres) stays in sq ft, since "0.00 acres"
// isn't meaningful.
export function formatLotSizeDisplay(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (!str) return '';

  const acreMatch = str.match(/([\d,.]+)\s*acres?/i);
  if (acreMatch) {
    const n = Number(acreMatch[1].replace(/,/g, ''));
    return Number.isFinite(n) ? `${n.toFixed(2)} acres` : str;
  }

  const sqftMatch = str.match(/([\d,.]+)/);
  if (sqftMatch) {
    const n = Number(sqftMatch[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) {
      const acres = n / 43560;
      if (acres < 0.01) return `${Math.round(n)} sq ft`;
      return `${acres.toFixed(2)} acres`;
    }
  }

  return str;
}

// Builds the fact lines for the compact confirmation card from whichever fields
// were actually returned — never invents a field that wasn't found, and never
// shows an empty placeholder for something unavailable.
export function formatFoundCardFacts(fields) {
  const f = fields || {};
  const priceLine = f.price ? `$${withCommas(f.price)}` : '';

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
  const hoaTaxLine = [
    f.hoaFeeMonthly ? `HOA: $${withCommas(f.hoaFeeMonthly)}/mo` : '',
    f.propertyTaxAnnual ? `Property tax: $${withCommas(f.propertyTaxAnnual)}/yr${f.propertyTaxYear ? ` · ${f.propertyTaxYear}` : ''}` : '',
  ].filter(Boolean).join(' · ');

  // School district — a plain district name only, never a rating/quality label.
  // Omitted entirely (not "Unknown") when no district was resolved.
  const schoolLine = f.schoolDistrict || '';

  return { priceLine, bedsBathsSqft, secondaryFacts, hoaTaxLine, schoolLine };
}

// Count of "property details" found, for the "We found N property details" message.
// Address identifies the home rather than describing a fact about it, and latitude/
// longitude are invisible infrastructure fields, never shown in the UI — both kinds
// are excluded so the count only reflects what the user can actually see.
export function countFoundFacts(fields) {
  if (!fields) return 0;
  return Object.keys(fields).filter((k) => k !== 'address' && k !== 'latitude' && k !== 'longitude' && fields[k]).length;
}
