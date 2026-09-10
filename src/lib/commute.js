export function normalizeAddress(address) {
  return String(address || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function addressFingerprint(address) {
  const bytes = new TextEncoder().encode(normalizeAddress(address));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function coordinatesAreCurrent(record, fingerprint) {
  return record?.coordinate_status === 'resolved'
    && record.coordinate_address_fingerprint === fingerprint
    && Number.isFinite(Number(record.latitude))
    && Number.isFinite(Number(record.longitude));
}

// One canonical trust decision for every consumer of a home's resolved location.
// Coordinate source is intentionally not restricted: both RentCast and the
// server-side Google resolver are valid when provenance matches the current address.
export async function currentHomeCoordinates(home) {
  const fingerprint = await addressFingerprint(home?.address);
  const record = {
    coordinate_status: home?.coordinateStatus,
    coordinate_address_fingerprint: home?.coordinateAddressFingerprint,
    latitude: home?.latitude,
    longitude: home?.longitude,
  };
  if (!coordinatesAreCurrent(record, fingerprint)) return null;
  const lat = Number(home.latitude);
  const lng = Number(home.longitude);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Destinations use the same address-provenance contract as homes, so an edited
// address never renders at stale coordinates.
export async function currentDestinationCoordinates(destination) {
  const fingerprint = await addressFingerprint(destination?.address);
  const record = {
    coordinate_status: destination?.coordinateStatus,
    coordinate_address_fingerprint: destination?.coordinateAddressFingerprint,
    latitude: destination?.latitude,
    longitude: destination?.longitude,
  };
  if (!coordinatesAreCurrent(record, fingerprint)) return null;
  const lat = Number(destination.latitude);
  const lng = Number(destination.longitude);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// All thresholded destinations form one boolean Commute criterion. A single
// unknown makes the whole criterion unknown; confirmed failures are never averaged.
export function evaluateCommute(destinations, getResult) {
  const required = (destinations || []).filter((d) => d.maxDriveMinutes != null);
  if (!required.length) return null;
  const results = required.map((destination) => ({ destination, result: getResult(destination) }));
  if (results.some(({ result }) => result?.status !== 'ok')) {
    return { evaluated: false, met: null, detail: 'Commute time not available yet' };
  }
  const failures = results.filter(({ destination, result }) => result.minutes > destination.maxDriveMinutes);
  return failures.length
    ? { evaluated: true, met: false, score: 0, detail: `${failures[0].destination.label} is ${failures[0].result.minutes} min (limit ${failures[0].destination.maxDriveMinutes})` }
    : { evaluated: true, met: true, score: 1, detail: `All ${required.length} required commute${required.length === 1 ? '' : 's'} meet the limit` };
}

// Compare treats calm transient states alike, and all unavailable provider/address
// outcomes alike, because those are the meaningful results presented to a participant.
export function commuteResultSignature(result) {
  if (result?.status === 'ok' && Number.isFinite(result.minutes)) return `ok:${result.minutes}`;
  if (!result || result.status === 'idle' || result.status === 'loading') return 'calculating';
  return 'unavailable';
}

export function uniqueShortestIndex(results) {
  const known = results.map((result, index) => ({ result, index }))
    .filter(({ result }) => result?.status === 'ok' && Number.isFinite(result.minutes));
  if (!known.length) return -1;
  const shortest = Math.min(...known.map(({ result }) => result.minutes));
  const matches = known.filter(({ result }) => result.minutes === shortest);
  return matches.length === 1 ? matches[0].index : -1;
}
