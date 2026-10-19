// What Add Home persists from a RentCast import, and when the imported map
// point can be trusted. Pure, so the save path and the tests share it.
//
// homes.listing_import (jsonb, no migration) keeps the snapshot that proves what
// came "From listing" (homeProvenance). Alongside the imported fields it records
// where they came from and how fresh the listing was, so a later reader can tell
// property-record facts, listing facts and the buyer's own edits apart.

import { addressFingerprint, normalizeAddress, validMapPoint } from './commute.js';

export function listingImportSnapshot(importResult, importedAt = new Date().toISOString()) {
  if (!importResult) return null;
  const snapshot = {
    fields: importResult.fields || {},
    listingFacts: importResult.listingFacts || [],
    descriptionFeatures: importResult.descriptionFeatures || [],
  };
  // Pasted listing text is the buyer's own material, not a provider lookup.
  if (importResult.source === 'raw-text') return { ...snapshot, source: 'pasted_text', importedAt };
  return {
    ...snapshot,
    source: 'rentcast',
    importedAt,
    ...(importResult.listing ? { listing: importResult.listing } : {}),
    ...(importResult.sources ? { sources: importResult.sources } : {}),
  };
}

// The importer only emits coordinates from a RentCast result whose address
// matched the looked-up address (normalizeRentCastFields). They become the
// home's resolved location only while that is still true at save time: same
// address, and the point is still the imported one. Otherwise nothing changes
// and the commute route geocodes the address exactly as before.
export async function importedCoordinatePatch(form, importResult) {
  const fields = importResult?.fields || {};
  if (importResult?.source === 'raw-text' || !importResult?.searchedAddress) return {};
  const point = validMapPoint({ lat: fields.latitude, lng: fields.longitude });
  if (!point || form?.latitude !== fields.latitude || form?.longitude !== fields.longitude) return {};
  if (!form?.address || normalizeAddress(form.address) !== normalizeAddress(importResult.searchedAddress)) return {};
  if (form.coordinateStatus === 'resolved') return {};
  try {
    return {
      coordinateStatus: 'resolved',
      coordinateSource: 'rentcast',
      coordinateAddressFingerprint: await addressFingerprint(form.address),
    };
  } catch {
    // No Web Crypto (an insecure context): never block saving; the geocoder
    // resolves the address later, as it always has.
    return {};
  }
}
