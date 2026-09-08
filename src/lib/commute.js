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
