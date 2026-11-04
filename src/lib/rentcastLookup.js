// Server-only RentCast lookup: one property-record request and one listing
// request for a single address, turned into the import response. Called by
// src/app/api/import-listing/route.js, which holds the key; kept separate so
// failure, partial and mismatch handling are testable without Next.js.

import { normalizeRentCastFields } from './rentcast.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const RENTCAST_BASE = 'https://api.rentcast.io';

// Each lookup ends in one of: ok, empty (no record for that address), or a
// failure reason — rate_limited (429), invalid_address (400: RentCast refused the
// address as a query), timeout, or unavailable (outage, auth, anything else). Upstream status codes are logged here, never sent to the browser.
export async function fetchRentCast(path, address, apiKey) {
  try {
    const url = `${RENTCAST_BASE}${path}?address=${encodeURIComponent(address)}`;
    const res = await fetchWithTimeout(url, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } });

    if (res.status === 404) return { status: 'empty', data: null };
    if (!res.ok) {
      console.error('RentCast request failed', { path, httpStatus: res.status });
      return { status: 'error', reason: res.status === 429 ? 'rate_limited' : res.status === 400 ? 'invalid_address' : 'unavailable', data: null };
    }

    const json = await res.json();
    const first = Array.isArray(json) ? json[0] : json;
    return first && typeof first === 'object' ? { status: 'ok', data: first } : { status: 'empty', data: null };
  } catch (err) {
    // Do not log the request: its URL carries the address. The name is enough.
    const reason = err?.name === 'AbortError' ? 'timeout' : 'unavailable';
    console.error('RentCast request failed', { path, errorName: err?.name || 'Error', reason });
    return { status: 'error', reason, data: null };
  }
}

const FAILURE_MESSAGES = {
  rate_limited: 'Property lookups are busy right now. Try again in a few minutes.',
  timeout: 'The property lookup took too long. Try again in a moment.',
  invalid_address: "We couldn't look up that address. Check it, or enter the details yourself.",
  unavailable: 'Property lookup is temporarily unavailable.',
};

function failureReason(...results) {
  const reasons = results.filter((r) => r.status === 'error').map((r) => r.reason);
  return ['rate_limited', 'timeout', 'invalid_address'].find((reason) => reasons.includes(reason)) || 'unavailable';
}

const FAILURE_STATUS = { rate_limited: 429, timeout: 504, invalid_address: 422, unavailable: 502 };
function failureResponse(...results) {
  const reason = failureReason(...results);
  return { status: FAILURE_STATUS[reason], body: { error: FAILURE_MESSAGES[reason], reason } };
}

export async function lookupRentCast(address, mode, apiKey) {
  const listingPath = mode === 'rental' || mode === 'apartment' ? '/v1/listings/rental/long-term' : '/v1/listings/sale';

  const [propertyResult, listingResult] = await Promise.all([
    fetchRentCast('/v1/properties', address, apiKey),
    fetchRentCast(listingPath, address, apiKey),
  ]);

  const failed = [propertyResult, listingResult].filter((r) => r.status === 'error');
  const succeeded = [propertyResult, listingResult].filter((r) => r.status === 'ok');
  // Nothing came back and at least one lookup failed: that is not "no property
  // at this address" — we don't know — so it is reported as a failure.
  if (failed.length && !succeeded.length) return failureResponse(propertyResult, listingResult);

  const { fields, findings, resolutions, listingFacts, descriptionFeatures, listing, addressCheck, foundAny } = normalizeRentCastFields(
    propertyResult.data,
    listingResult.data,
    { apartmentCommunity: mode === 'apartment', requestedAddress: address },
  );
  // Whatever did come back didn't match this address, and the other lookup
  // failed: still "we don't know", not "nothing here".
  if (!foundAny && failed.length) return failureResponse(propertyResult, listingResult);
  const sourceStatus = (result, check) => (result.status === 'ok' && check === 'mismatch' ? 'mismatch' : result.status);
  const sources = { property: sourceStatus(propertyResult, addressCheck.property), listing: sourceStatus(listingResult, addressCheck.listing) };
  // One lookup failed but the other found the home: keep the reliable part and
  // say which half is missing, without alarming anyone.
  const partial = foundAny && failed.length
    ? (propertyResult.status === 'error' ? 'property_unavailable' : 'listing_unavailable')
    : undefined;
  const mismatchOnly = !foundAny && Object.values(sources).includes('mismatch');

  return { status: 200, body: {
    found: foundAny,
    fields,
    findings,
    resolutions,
    listingFacts,
    descriptionFeatures,
    listing,
    sources,
    partial,
    message: foundAny ? undefined : mismatchOnly
      ? "We couldn't match property records to that exact address — you can enter details manually."
      : 'No property data was found for that address — you can enter details manually.',
  } };
}
