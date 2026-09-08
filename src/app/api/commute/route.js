import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveSearch, resolvePriorities } from '@/lib/supabase/collaboration';

// Server-only: GOOGLE_ROUTES_API_KEY never reaches the browser.
//
// SECURITY MODEL: the client sends only home IDs and destination IDs — never
// raw addresses/coordinates as authoritative input. This route resolves both
// server-side:
//   - Homes are fetched using the signed-in user's own Supabase session (the
//     server client reads the request's auth cookies), so RLS's existing
//     can_access_search/can_access_home policies silently exclude any home
//     ID the user doesn't actually have access to — a client cannot use this
//     route to compute a route for an arbitrary home they can't see.
//   - Destinations are read from the current user's OWN resolved priorities
//     (resolvePriorities, keyed to auth.getUser()'s id, never a client-
//     supplied user id) — a client cannot request another user's personal
//     destination by ID, since only the caller's own destination list is
//     ever consulted.
//
// COMPLIANCE MODEL: this route computes and returns durations; it never
// writes duration/distance/route content to the database. See the comment
// on GOOGLE_ROUTES_API_KEY usage below for why.
//
// NOT YET IMPLEMENTED (deliberately): capturing/persisting a placeId from
// the Route Matrix response. I don't have live network access to confirm
// Compute Route Matrix reliably returns place IDs for address-string
// waypoints in this exact response shape, and the instruction here is
// explicit not to add a speculative persistence write without that
// confirmation. The destination shape already tolerates an optional
// `placeId` field (see collaboration/CommuteDestinations), so adding this
// later is a pure addition, not a restructuring.

const ROUTES_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

function parseDurationSeconds(durationStr) {
  // Routes API durations are returned as strings like "1234s".
  if (!durationStr || typeof durationStr !== 'string') return null;
  const match = durationStr.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) : null;
}

function waypointForHome(home) {
  if (home.latitude != null && home.longitude != null) {
    return { waypoint: { location: { latLng: { latitude: home.latitude, longitude: home.longitude } } } };
  }
  return { waypoint: { address: home.address } };
}

function waypointForDestination(dest) {
  if (dest.placeId) {
    return { waypoint: { placeId: dest.placeId } };
  }
  return { waypoint: { address: dest.address } };
}

export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    }

    const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
    if (!apiKey) {
      console.error('GOOGLE_ROUTES_API_KEY is not set.');
      return NextResponse.json({ error: 'Commute calculation is not configured yet.' }, { status: 500 });
    }

    const body = await request.json().catch(() => null);
    const homeIds = Array.isArray(body?.homeIds) ? body.homeIds.filter((id) => typeof id === 'string') : [];
    const destinationIds = Array.isArray(body?.destinationIds) ? body.destinationIds.filter((id) => typeof id === 'string') : [];
    if (!homeIds.length || !destinationIds.length) {
      return NextResponse.json({ results: {} });
    }

    // Resolve the CURRENT USER's own active search and destinations — never
    // client-supplied. A requested destinationId that isn't actually in this
    // user's own list is simply skipped below, never fetched from anyone else.
    const { search } = await resolveActiveSearch(supabase, user.id);
    const priorities = await resolvePriorities(supabase, search, user.id);
    const allDestinations = priorities.location?.commuteDestinations || [];
    const destinations = allDestinations.filter((d) => destinationIds.includes(d.id));
    if (!destinations.length) {
      return NextResponse.json({ results: {} });
    }

    // Homes are fetched through the signed-in user's own Supabase client, so
    // RLS (can_access_search / can_access_home, already in production) is the
    // actual authority here — a requested home ID the user can't access
    // simply won't come back in `data`, regardless of what was requested.
    const { data: homes, error: homesError } = await supabase
      .from('homes')
      .select('id, address, latitude, longitude')
      .in('id', homeIds);
    if (homesError) {
      console.error('Commute: home lookup failed', homesError);
      return NextResponse.json({ error: 'Could not look up homes.' }, { status: 500 });
    }
    if (!homes.length) {
      return NextResponse.json({ results: {} });
    }

    const origins = homes.map(waypointForHome);
    const destinationWaypoints = destinations.map(waypointForDestination);

    // NOTE ON THE REQUEST SHAPE BELOW: based on my best understanding of
    // Google's documented Compute Route Matrix request/response format — I
    // have no live network access in this environment to verify this against
    // a real call. Treat this as the one part of this implementation that
    // needs confirmation against an actual request before being trusted, and
    // adjust field names/response parsing here first if the live QA below
    // shows a mismatch.
    let matrixRows;
    try {
      const res = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          // Compute Route Matrix requires an explicit field mask; asking only
          // for what we use keeps the response minimal.
          'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition,status',
        },
        body: JSON.stringify({
          origins,
          destinations: destinationWaypoints,
          travelMode: 'DRIVE',
        }),
      });
      if (!res.ok) {
        console.error('Commute: Routes API request failed', res.status, await res.text().catch(() => ''));
        matrixRows = [];
      } else {
        matrixRows = await res.json();
      }
    } catch (err) {
      console.error('Commute: Routes API request threw', err);
      matrixRows = [];
    }

    // results[homeId][destinationId] = { minutes: number|null, status: 'ok'|'unavailable' }
    const results = {};
    homes.forEach((h) => { results[h.id] = {}; });
    // Default every requested pair to unavailable, then fill in whatever the
    // Routes response actually confirms — a partial/failed response should
    // never crash the request or silently omit pairs the client is waiting on.
    homes.forEach((h) => {
      destinations.forEach((d) => {
        results[h.id][d.id] = { minutes: null, status: 'unavailable' };
      });
    });

    (Array.isArray(matrixRows) ? matrixRows : []).forEach((row) => {
      const home = homes[row.originIndex];
      const dest = destinations[row.destinationIndex];
      if (!home || !dest) return;
      const seconds = parseDurationSeconds(row.duration);
      const ok = row.condition === 'ROUTE_EXISTS' && seconds !== null;
      results[home.id][dest.id] = ok
        ? { minutes: Math.round(seconds / 60), status: 'ok' }
        : { minutes: null, status: 'unavailable' };
    });

    // Never persisted — this response is the entire lifetime of this data
    // beyond the caller's own session/runtime memory, per the current
    // Routes-content caching restriction.
    return NextResponse.json({ results });
  } catch (err) {
    console.error('Commute route failed', err);
    return NextResponse.json({ error: 'Could not calculate commute times.' }, { status: 500 });
  }
}
