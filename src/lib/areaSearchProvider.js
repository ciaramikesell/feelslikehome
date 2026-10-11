'use client';

import { loadGoogleMaps } from '@/lib/googleMaps';
import { toAreaResults } from '@/lib/searchAreas';

// Area search for "Where are you looking?", backed by the same Google Places
// (New) Autocomplete the add-home address field already uses. US only.
//
// Requested primary types: cities, neighborhoods, ZIP codes and school
// districts. Google documents school districts as a place type, but whether
// Autocomplete accepts it as a primary-type filter has not been verified
// against the live API from this repository. If Google rejects it, the search
// continues without it and reports schoolDistricts: false, so the screen can
// say so instead of pretending.
const AREA_PRIMARY_TYPES = ['locality', 'sublocality', 'neighborhood', 'postal_code', 'school_district'];
let schoolDistrictsRejected = false;

export class AreaSearchUnavailable extends Error {}

export async function googleAreaSuggestions(query, { sessionToken } = {}) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) throw new AreaSearchUnavailable('Area search is not configured.');
  const maps = await loadGoogleMaps(key);
  const places = await maps.importLibrary('places');
  if (!places?.AutocompleteSuggestion) throw new AreaSearchUnavailable('Area search is not available.');
  const request = (types) => places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: query,
    includedRegionCodes: ['us'],
    includedPrimaryTypes: types,
    sessionToken: sessionToken || undefined,
  });
  let response = null;
  if (!schoolDistrictsRejected) {
    try {
      response = await request(AREA_PRIMARY_TYPES);
    } catch (error) {
      if (!/school_district|primary ?type|invalid/i.test(String(error?.message || ''))) throw error;
      schoolDistrictsRejected = true;
    }
  }
  if (!response) response = await request(AREA_PRIMARY_TYPES.filter((type) => type !== 'school_district'));
  const predictions = (response?.suggestions || []).map((suggestion) => suggestion.placePrediction).filter(Boolean);
  return { results: toAreaResults(predictions), schoolDistricts: !schoolDistrictsRejected };
}

export function newAreaSearchSession() {
  const places = window.google?.maps?.places;
  return places?.AutocompleteSessionToken ? new places.AutocompleteSessionToken() : null;
}
