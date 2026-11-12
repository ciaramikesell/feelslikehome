// Add Home V3, phase 1: the simple save (docs/add-home-v3-simple-save.md).
// Pure helpers shared by the found card, the saved state and the tests.
// Nothing here saves, uploads or fetches.

import { formatHomePrice, formatLotSizeDisplay, splitAddressLines } from './homeDisplay.js';

const digits = (value) => {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// The few facts a buyer uses to recognize a home, from whatever the form holds
// (lookup, pasted text, typed). A field that is empty is left out, never shown
// as a placeholder; nothing is invented.
export function foundHomeEssentials(form = {}) {
  const sqft = digits(form.sqft);
  const year = /^\d{4}$/.test(String(form.yearBuilt ?? '').trim()) ? String(form.yearBuilt).trim() : '';
  return [
    form.beds ? `${form.beds} bd` : '',
    form.baths ? `${form.baths} ba` : '',
    sqft ? `${sqft.toLocaleString('en-US')} sq ft` : '',
    form.lotSize ? formatLotSizeDisplay(form.lotSize) : '',
    year ? `Built ${year}` : '',
  ].filter(Boolean);
}

// The price line on the card. An inactive listing never shows its last price
// as an asking price (#161); with no price at all it says so plainly.
export function foundHomePriceLine(form = {}, searchType, listingStatus = null) {
  return formatHomePrice(form.price, searchType) || (listingStatus === 'inactive' ? 'No current asking price' : 'Price unknown');
}

// Where a link came from, for the compact "Searched" line once a home shows
// ("zillow.com"). A plain address is shown as typed.
export function findInputLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (/^https?:$/.test(url.protocol)) return url.hostname.replace(/^www\./, '');
  } catch { /* not a URL: an address */ }
  return raw;
}

// What the saved state shows. The photo is the one actually saved: when an
// optional upload failed, the home was saved without it and says so.
export function savedHomeSummary(form = {}, { id, photoUrl = '', photoFailed = false, searchType, listingStatus = null } = {}) {
  const { line1, line2 } = splitAddressLines(form.address || '');
  return {
    id,
    line1: line1 || form.address || '',
    line2: line2 || '',
    price: foundHomePriceLine(form, searchType, listingStatus),
    facts: foundHomeEssentials(form),
    photoUrl: photoUrl || '',
    photoFailed: !!photoFailed,
  };
}
