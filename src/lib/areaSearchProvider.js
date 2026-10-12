'use client';

import { loadGoogleMaps } from '@/lib/googleMaps';
import { toAreaResults } from '@/lib/searchAreas';

// Area search for "Where are you looking?", backed by the same Google Places
// (New) Autocomplete the add-home address field already uses. US only.
//
// Requested primary types: cities, neighborhoods, ZIP codes and school
// districts (Autocomplete allows at most five). Whether Google accepts
// school_district as a filter, and whether it returns district places, is
// checked live on a Vercel Preview during Onboarding V2 QA.
// If Google rejects it, the search continues without it and reports
// schoolDistricts: false, so the screen says so instead of pretending.
const AREA_PRIMARY_TYPES = ['locality', 'sublocality', 'neighborhood', 'postal_code', 'school_district'];
// Remembered for the session: once Google rejects school_district as a
// filter, later searches skip it instead of failing first every time.
const sessionState = { schoolDistrictsRejected: false, schoolDistrictsRejection: '' };

export class AreaSearchUnavailable extends Error { name = 'AreaSearchUnavailable'; }

// The request and classification, given the Places library (exported so the
// fallback rules can be tested without Google).
export async function fetchAreaSuggestions(places, query, { sessionToken, state = sessionState } = {}) {
  if (!places?.AutocompleteSuggestion) throw new AreaSearchUnavailable('Area search is not available.');
  const request = (types) => places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: query,
    includedRegionCodes: ['us'],
    includedPrimaryTypes: types,
    sessionToken: sessionToken || undefined,
  });
  const withoutDistricts = AREA_PRIMARY_TYPES.filter((type) => type !== 'school_district');
  let response = null;
  if (!state.schoolDistrictsRejected) {
    try {
      response = await request(AREA_PRIMARY_TYPES);
    } catch (error) {
      // Only treat school_district as unsupported if the same search succeeds
      // without it; any other failure (key, quota, network) is reported as is.
      response = await request(withoutDistricts);
      state.schoolDistrictsRejected = true;
      state.schoolDistrictsRejection = String(error?.message || '').slice(0, 300);
    }
  } else {
    response = await request(withoutDistricts);
  }
  const predictions = (response?.suggestions || []).map((suggestion) => suggestion.placePrediction).filter(Boolean);
  return {
    results: toAreaResults(predictions),
    schoolDistricts: !state.schoolDistrictsRejected,
    // What was asked of and returned by Google, before classification. For
    // QA only; the step shows only classified results.
    schoolDistrictsRejection: state.schoolDistrictsRejection,
    requestedTypes: state.schoolDistrictsRejected ? withoutDistricts : [...AREA_PRIMARY_TYPES],
    provider: predictions.map((prediction) => ({ placeId: prediction.placeId, text: prediction.text?.text || '', types: [...(prediction.types || [])] })),
  };
}

export async function googleAreaSuggestions(query, options = {}) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) throw new AreaSearchUnavailable('Area search is not configured.');
  const maps = await loadGoogleMaps(key);
  return fetchAreaSuggestions(await maps.importLibrary('places'), query, options);
}

export function newAreaSearchSession() {
  const places = window.google?.maps?.places;
  return places?.AutocompleteSessionToken ? new places.AutocompleteSessionToken() : null;
}
