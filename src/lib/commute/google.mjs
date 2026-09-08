const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const ROUTES_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

function parseDurationSeconds(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) : null;
}

export async function geocodeWithGoogle(address, { fetchImpl = fetch, apiKey = process.env.GOOGLE_GEOCODING_API_KEY } = {}) {
  if (!apiKey) return { status: 'unavailable' };
  try {
    const url = `${GEOCODING_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`;
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) return { status: 'unavailable' };
    const payload = await response.json();
    if (payload.status === 'ZERO_RESULTS') return { status: 'invalid' };
    if (payload.status !== 'OK' || !Array.isArray(payload.results) || !payload.results.length) return { status: 'unavailable' };

    const result = payload.results[0];
    const location = result.geometry?.location;
    if (result.partial_match || typeof location?.lat !== 'number' || typeof location?.lng !== 'number') {
      return { status: 'ambiguous' };
    }
    return {
      status: 'resolved',
      latitude: location.lat,
      longitude: location.lng,
      normalizedAddress: result.formatted_address || address,
      provider: 'google',
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function computeGoogleRouteMatrix(origins, destinations, { fetchImpl = fetch, apiKey = process.env.GOOGLE_ROUTES_API_KEY } = {}) {
  if (!apiKey) return { status: 'unavailable', rows: [] };
  try {
    const response = await fetchImpl(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition,status',
      },
      cache: 'no-store',
      body: JSON.stringify({
        origins: origins.map(({ latitude, longitude }) => ({ waypoint: { location: { latLng: { latitude, longitude } } } })),
        destinations: destinations.map(({ latitude, longitude }) => ({ waypoint: { location: { latLng: { latitude, longitude } } } })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
    });
    if (!response.ok) return { status: 'unavailable', rows: [] };
    const payload = await response.json();
    if (!Array.isArray(payload)) return { status: 'unavailable', rows: [] };
    return {
      status: 'ok',
      rows: payload.map((row) => {
        const seconds = parseDurationSeconds(row.duration);
        if (row.condition === 'ROUTE_NOT_FOUND') return { ...row, resultStatus: 'no_route', minutes: null };
        if (row.condition !== 'ROUTE_EXISTS' || seconds === null || Number(row.status?.code || 0) !== 0) {
          return { ...row, resultStatus: 'unavailable', minutes: null };
        }
        return { ...row, resultStatus: 'ok', minutes: Math.round(seconds / 60) };
      }),
    };
  } catch {
    return { status: 'unavailable', rows: [] };
  }
}

export const googleRoutesInternals = { parseDurationSeconds };
