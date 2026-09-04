// Pure display-formatting helpers for the "found automatically" summary card in
// HomeModal. These only format strings for presentation — they never fetch data,
// touch RentCast, or decide what was imported.

function withCommas(numStr) {
  const n = Number(numStr);
  return Number.isFinite(n) ? n.toLocaleString() : numStr;
}

// Splits "1918 Clawson Ave, Royal Oak, MI 48073" into two display lines.
export function splitAddressLines(address) {
  if (!address) return { line1: '', line2: '' };

  const idx = address.indexOf(',');

  if (idx === -1) {
    return { line1: address, line2: '' };
  }

  return {
    line1: address.slice(0, idx).trim(),
    line2: address.slice(idx + 1).trim(),
  };
}

// Builds the compact confirmation-card fact lines from whichever
// property fields were actually returned.
export function formatFoundCardFacts(fields) {
  const f = fields || {};

  const priceLine = f.price ? `$${withCommas(f.price)}` : '';

  const bedsBathsSqft = [
    f.beds ? `${f.beds} bd` : '',
    f.baths ? `${f.baths} ba` : '',
    f.sqft ? `${withCommas(f.sqft)} sq ft` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const secondaryFacts = [
    f.yearBuilt ? `Built ${f.yearBuilt}` : '',
    f.garageSpaces ? `${f.garageSpaces}-car garage` : '',
    f.lotSize ? `${f.lotSize} lot` : '',
    f.daysOnMarket
      ? `${f.daysOnMarket} day${f.daysOnMarket === '1' ? '' : 's'} on market`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    priceLine,
    bedsBathsSqft,
    secondaryFacts,
  };
}

// Count of property details found for the success message.
// Address identifies the home, so it is not counted as a property detail.
export function countFoundFacts(fields) {
  if (!fields) return 0;

  return Object.keys(fields).filter(
    (key) => key !== 'address' && fields[key]
  ).length;
}
