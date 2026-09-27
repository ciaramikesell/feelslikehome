// Pure, React-free logic for narrowing and ordering My Homes' saved contenders.
// Every Match-derived decision takes an `evaluate(home)` function that returns the
// canonical computeMatch result — the caller supplies the exact same evaluation
// (including the Commute criterion's session route results) the cards render, so
// a filter can never disagree with what a card or Home Detail shows.
//
// These filters narrow SAVED CONTENDERS. They are not listing discovery and they
// are not My Search (which defines what the participant wants).

import { parseNum, trueCheckLabels, hasNoMustHaveMisses } from './matching.js';
import { hasOutstandingWantToTour, isFavoriteHome } from './lifecycle.js';

// The existing sort modes, unchanged; `short` is the compact control label.
export const SORT_OPTIONS = Object.freeze([
  Object.freeze({ key: 'matchDesc', label: 'Best match', short: 'Best match' }),
  Object.freeze({ key: 'newest', label: 'Newest added', short: 'Newest' }),
  Object.freeze({ key: 'oldest', label: 'Oldest added', short: 'Oldest' }),
  Object.freeze({ key: 'priceAsc', label: 'Price: low to high', short: 'Price ↑' }),
  Object.freeze({ key: 'priceDesc', label: 'Price: high to low', short: 'Price ↓' }),
  Object.freeze({ key: 'matchAsc', label: 'Lowest match', short: 'Lowest match' }),
]);

export function sortLabel(sortBy, { short = false } = {}) {
  const option = SORT_OPTIONS.find((candidate) => candidate.key === sortBy);
  return option ? (short ? option.short : option.label) : '';
}

// The only Match threshold the product already supports (the former "90%+
// Matches" quick filter). No new thresholds are invented here.
export const MATCH_THRESHOLDS = Object.freeze([90]);

export const EMPTY_FILTERS = Object.freeze({ minMatch: null, noMustMissing: false, favorites: false, wantToTour: false });

export function normalizeFilters(filters) {
  return { ...EMPTY_FILTERS, ...(filters || {}) };
}

export function activeFilterLabels(filters) {
  const f = normalizeFilters(filters);
  return [
    f.minMatch != null && `${f.minMatch}%+ Match`,
    f.noMustMissing && 'No Must-Haves missing',
    f.favorites && 'Favorites',
    f.wantToTour && 'Want to Tour',
  ].filter(Boolean);
}

export function activeFilterCount(filters) {
  return activeFilterLabels(filters).length;
}

// Free-text search over the fields the collection already searched.
export function matchesQuery(home, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [home.propertyName, home.address, home.selectedFloorPlanName, home.selectedUnitLabel, ...(home.homeLayout || []),
    home.primaryBedroomLocation, home.secondaryBedroomLocation, ...trueCheckLabels(home)].join(' ').toLowerCase();
  return hay.includes(q);
}

// Identical to deriveWantToTourState(home).currentUserWantsToTour (the source the
// Tour list and the previous quick filter used): this participant's own intent.
export function currentUserWantsToTour(home) {
  return hasOutstandingWantToTour(home);
}

// One predicate per filter, all reading canonical sources. Filters combine (AND).
const PREDICATES = {
  // A home with no computable percentage (no evaluated priorities) never meets a
  // threshold — Unknown is not treated as a high match either.
  minMatch: (home, value, evaluate) => { const match = evaluate(home); return !!match && match.pct !== null && match.pct >= value; },
  // Only a CONFIRMED Must Have miss removes a home (see mustHaveStatus). Unknown is
  // never converted to a miss.
  noMustMissing: (home, value, evaluate) => hasNoMustHaveMisses(evaluate(home)),
  favorites: (home) => isFavoriteHome(home),
  wantToTour: (home) => currentUserWantsToTour(home),
};

export function applyContenderFilters(homes, filters, evaluate, query = '') {
  const f = normalizeFilters(filters);
  return homes.filter((home) => matchesQuery(home, query)
    && (f.minMatch == null || PREDICATES.minMatch(home, f.minMatch, evaluate))
    && (!f.noMustMissing || PREDICATES.noMustMissing(home, true, evaluate))
    && (!f.favorites || PREDICATES.favorites(home))
    && (!f.wantToTour || PREDICATES.wantToTour(home)));
}

// How many homes each single filter would leave on its own (the counts the
// desktop chips have always shown).
export function singleFilterCounts(homes, evaluate) {
  return {
    all: homes.length,
    match90: homes.filter((home) => PREDICATES.minMatch(home, 90, evaluate)).length,
    noMustMissing: homes.filter((home) => PREDICATES.noMustMissing(home, true, evaluate)).length,
    wantToTour: homes.filter((home) => PREDICATES.wantToTour(home)).length,
    favorites: homes.filter((home) => PREDICATES.favorites(home)).length,
  };
}

export function sortContenders(homes, sortBy, evaluate) {
  const list = [...homes];
  if (sortBy === 'matchDesc' || sortBy === 'matchAsc') {
    list.sort((a, b) => (evaluate(b)?.pct ?? -1) - (evaluate(a)?.pct ?? -1));
    if (sortBy === 'matchAsc') list.reverse();
  } else if (sortBy === 'priceAsc' || sortBy === 'priceDesc') {
    list.sort((a, b) => (parseNum(a.price) ?? Infinity) - (parseNum(b.price) ?? Infinity));
    if (sortBy === 'priceDesc') list.reverse();
  } else if (sortBy === 'newest' || sortBy === 'oldest') {
    list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    if (sortBy === 'newest') list.reverse();
  }
  return list;
}

export function contenderCountLabel(count, vocabulary) {
  const noun = count === 1 ? vocabulary.singularLower : vocabulary.pluralLower;
  return `${count} ${noun} you’re considering`;
}

export function showMatchingLabel(count, vocabulary) {
  const noun = count === 1 ? vocabulary.singularLower : vocabulary.pluralLower;
  return count ? `Show ${count} matching ${noun}` : `No ${vocabulary.pluralLower} match these filters`;
}
