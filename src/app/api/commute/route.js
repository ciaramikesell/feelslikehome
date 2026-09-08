import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveSearch } from '@/lib/supabase/collaboration';
import { addressFingerprint, coordinatesAreCurrent } from '@/lib/commute';

const ROUTES_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const MAX_IDS = 25;

function durationSeconds(value) {
  const match = typeof value === 'string' && value.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) : null;
}

async function geocode(address, apiKey) {
  try {
    const response = await fetch(`${GEOCODING_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`, { cache: 'no-store' });
    if (!response.ok) return { status: 'unavailable' };
    const body = await response.json();
    if (body.status === 'ZERO_RESULTS') return { status: 'invalid' };
    if (body.status !== 'OK') return { status: 'unavailable' };
    if (body.results.length !== 1 || body.results[0]?.partial_match) return { status: 'ambiguous' };
    const location = body.results[0]?.geometry?.location;
    if (!Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) return { status: 'unavailable' };
    return { status: 'resolved', latitude: location.lat, longitude: location.lng };
  } catch (error) {
    console.error('Commute geocoding failed', error);
    return { status: 'unavailable' };
  }
}

async function resolveCoordinates(supabase, table, record, geocodingKey) {
  const fingerprint = await addressFingerprint(record.address);
  if (coordinatesAreCurrent(record, fingerprint)) {
    return { status: 'resolved', latitude: Number(record.latitude), longitude: Number(record.longitude) };
  }
  const result = await geocode(record.address, geocodingKey);
  const update = {
    latitude: result.status === 'resolved' ? result.latitude : null,
    longitude: result.status === 'resolved' ? result.longitude : null,
    coordinate_address_fingerprint: fingerprint,
    coordinate_status: result.status,
    coordinate_source: result.status === 'resolved' ? 'google_geocoding' : null,
  };
  // This uses the caller's authenticated Supabase client. Homes remain guarded
  // by can_access_home; destinations remain guarded by owner-only RLS.
  const { error } = await supabase.from(table).update(update).eq('id', record.id);
  if (error) console.error(`Could not save ${table} coordinate provenance`, error);
  return result;
}

function unavailableResults(homes, destinations, status = 'unavailable') {
  return Object.fromEntries(homes.map((home) => [home.id,
    Object.fromEntries(destinations.map((destination) => [destination.id, { minutes: null, status }]))]));
}

export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const homeIds = [...new Set(Array.isArray(body.homeIds) ? body.homeIds.filter((id) => typeof id === 'string') : [])].slice(0, MAX_IDS);
    const destinationIds = [...new Set(Array.isArray(body.destinationIds) ? body.destinationIds.filter((id) => typeof id === 'string') : [])].slice(0, MAX_IDS);
    if (!homeIds.length || !destinationIds.length) return NextResponse.json({ results: {} });

    const { search } = await resolveActiveSearch(supabase, user.id);
    const [{ data: homes, error: homesError }, { data: destinations, error: destinationsError }] = await Promise.all([
      supabase.from('homes').select('id,address,latitude,longitude,coordinate_address_fingerprint,coordinate_status')
        .eq('search_id', search.id).in('id', homeIds),
      supabase.from('commute_destinations').select('*').eq('search_id', search.id)
        .eq('user_id', user.id).in('id', destinationIds),
    ]);
    if (homesError || destinationsError) throw homesError || destinationsError;
    if (!homes?.length || !destinations?.length) return NextResponse.json({ results: {} });

    const routesKey = process.env.GOOGLE_ROUTES_API_KEY;
    const geocodingKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!routesKey || !geocodingKey) {
      return NextResponse.json({ results: unavailableResults(homes, destinations), providerStatus: 'unavailable' });
    }

    const [homeLocations, destinationLocations] = await Promise.all([
      Promise.all(homes.map((home) => resolveCoordinates(supabase, 'homes', home, geocodingKey))),
      Promise.all(destinations.map((destination) => resolveCoordinates(supabase, 'commute_destinations', destination, geocodingKey))),
    ]);
    const results = unavailableResults(homes, destinations);
    homeLocations.forEach((location, homeIndex) => destinationLocations.forEach((destinationLocation, destinationIndex) => {
      if (location.status !== 'resolved') results[homes[homeIndex].id][destinations[destinationIndex].id].status = `home_${location.status}`;
      else if (destinationLocation.status !== 'resolved') results[homes[homeIndex].id][destinations[destinationIndex].id].status = `destination_${destinationLocation.status}`;
    }));

    const validHomeIndexes = homeLocations.map((x, i) => x.status === 'resolved' ? i : -1).filter((i) => i >= 0);
    const validDestinationIndexes = destinationLocations.map((x, i) => x.status === 'resolved' ? i : -1).filter((i) => i >= 0);
    if (!validHomeIndexes.length || !validDestinationIndexes.length) return NextResponse.json({ results });

    const response = await fetch(ROUTES_URL, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': routesKey, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition,status' },
      body: JSON.stringify({
        origins: validHomeIndexes.map((i) => ({ waypoint: { location: { latLng: { latitude: homeLocations[i].latitude, longitude: homeLocations[i].longitude } } } })),
        destinations: validDestinationIndexes.map((i) => ({ waypoint: { location: { latLng: { latitude: destinationLocations[i].latitude, longitude: destinationLocations[i].longitude } } } })),
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE',
      }),
    });
    if (!response.ok) {
      console.error('Google Routes request failed', response.status, await response.text().catch(() => ''));
      return NextResponse.json({ results, providerStatus: 'unavailable' });
    }
    const rows = await response.json();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const home = homes[validHomeIndexes[row.originIndex]];
      const destination = destinations[validDestinationIndexes[row.destinationIndex]];
      if (!home || !destination) return;
      const seconds = durationSeconds(row.duration);
      results[home.id][destination.id] = row.condition === 'ROUTE_EXISTS' && seconds !== null
        ? { status: 'ok', minutes: Math.round(seconds / 60) }
        : { status: row.condition === 'ROUTE_NOT_FOUND' ? 'no_route' : 'unavailable', minutes: null };
    });
    // Durations, distances, and route content are returned only; no route cache/table exists.
    return NextResponse.json({ results });
  } catch (error) {
    console.error('Commute route failed', error);
    return NextResponse.json({ error: 'Commute time isn’t available right now.' }, { status: 500 });
  }
}
