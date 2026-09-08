import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveSearch } from '@/lib/supabase/collaboration';
import { addressFingerprint, hasCurrentCoordinates } from '@/lib/commute/address.mjs';
import { computeGoogleRouteMatrix, geocodeWithGoogle } from '@/lib/commute/google.mjs';

// Conservative V1 caps keep every request far below Google's larger non-transit
// matrix limit and bound accidental or abusive quota consumption.
const MAX_HOMES = 20;
const MAX_DESTINATIONS = 5;
const MAX_ELEMENTS = 100;

function idsFrom(body, key, max) {
  if (!Array.isArray(body?.[key])) return [];
  return [...new Set(body[key].filter((id) => typeof id === 'string' && id.length <= 100))].slice(0, max + 1);
}

async function resolveHomeCoordinates(supabase, home) {
  if (hasCurrentCoordinates(home)) return home;
  const currentFingerprint = addressFingerprint(home.address);
  if (home.coordinate_address_fingerprint === currentFingerprint && ['invalid', 'ambiguous'].includes(home.geocode_status)) return home;
  const geocode = await geocodeWithGoogle(home.address);
  const update = {
    latitude: geocode.status === 'resolved' ? geocode.latitude : null,
    longitude: geocode.status === 'resolved' ? geocode.longitude : null,
    coordinate_address_fingerprint: currentFingerprint,
    geocode_status: geocode.status,
    geocode_provider: 'google',
    normalized_address: geocode.status === 'resolved' ? geocode.normalizedAddress : null,
    geocoded_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('homes').update(update).eq('id', home.id).select('*').single();
  if (error) return { ...home, latitude: null, longitude: null, geocode_status: 'unavailable' };
  return data;
}

async function resolveDestinationCoordinates(supabase, destination) {
  const fingerprint = addressFingerprint(destination.address);
  if (destination.address_fingerprint === fingerprint && destination.geocode_status === 'resolved'
      && destination.latitude != null && destination.longitude != null) return destination;
  if (destination.address_fingerprint === fingerprint && ['invalid', 'ambiguous'].includes(destination.geocode_status)) return destination;
  const geocode = await geocodeWithGoogle(destination.address);
  const update = {
    address_fingerprint: fingerprint,
    latitude: geocode.status === 'resolved' ? geocode.latitude : null,
    longitude: geocode.status === 'resolved' ? geocode.longitude : null,
    normalized_address: geocode.status === 'resolved' ? geocode.normalizedAddress : null,
    geocode_status: geocode.status,
    geocode_provider: 'google',
    geocoded_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('commute_destinations').update(update)
    .eq('id', destination.id).eq('user_id', destination.user_id).select('*').single();
  return error ? { ...destination, geocode_status: 'unavailable' } : data;
}

export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    if (!process.env.GOOGLE_ROUTES_API_KEY) {
      return NextResponse.json({ error: "Commute time isn't available right now.", code: 'provider_unavailable' }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const homeIds = idsFrom(body, 'homeIds', MAX_HOMES);
    const destinationIds = idsFrom(body, 'destinationIds', MAX_DESTINATIONS);
    if (!homeIds.length || !destinationIds.length) return NextResponse.json({ results: {} });
    if (homeIds.length > MAX_HOMES || destinationIds.length > MAX_DESTINATIONS || homeIds.length * destinationIds.length > MAX_ELEMENTS) {
      return NextResponse.json({ error: 'Too many commute times requested at once.', code: 'request_too_large' }, { status: 400 });
    }

    const { search } = await resolveActiveSearch(supabase, user.id);
    const [{ data: homes, error: homesError }, { data: destinations, error: destinationsError }] = await Promise.all([
      supabase.from('homes').select('*').eq('search_id', search.id).in('id', homeIds),
      supabase.from('commute_destinations').select('*')
        .eq('search_id', search.id).eq('user_id', user.id).in('id', destinationIds),
    ]);
    if (homesError || destinationsError) {
      return NextResponse.json({ error: "Commute time isn't available right now.", code: 'lookup_failed' }, { status: 500 });
    }

    const [resolvedHomes, resolvedDestinations] = await Promise.all([
      Promise.all((homes || []).map((home) => resolveHomeCoordinates(supabase, home))),
      Promise.all((destinations || []).map((destination) => resolveDestinationCoordinates(supabase, destination))),
    ]);
    const routableHomes = resolvedHomes.filter(hasCurrentCoordinates);
    const routableDestinations = resolvedDestinations.filter((destination) => (
      destination.geocode_status === 'resolved'
      && destination.latitude != null
      && destination.longitude != null
      && destination.address_fingerprint === addressFingerprint(destination.address)
    ));

    const results = {};
    (homes || []).forEach((home) => {
      results[home.id] = {};
      resolvedDestinations.forEach((destination) => {
        results[home.id][destination.id] = {
          minutes: null,
          status: destination.geocode_status === 'invalid' ? 'invalid_destination'
            : destination.geocode_status === 'ambiguous' ? 'ambiguous_destination'
              : 'unavailable',
        };
      });
    });

    if (routableHomes.length && routableDestinations.length) {
      const matrix = await computeGoogleRouteMatrix(routableHomes, routableDestinations);
      matrix.rows.forEach((row) => {
        const home = routableHomes[row.originIndex];
        const destination = routableDestinations[row.destinationIndex];
        if (!home || !destination) return;
        results[home.id][destination.id] = { minutes: row.minutes, status: row.resultStatus };
      });
    }
    return NextResponse.json({ results });
  } catch (error) {
    console.error('Commute route failed', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ error: "Commute time isn't available right now.", code: 'unavailable' }, { status: 500 });
  }
}
