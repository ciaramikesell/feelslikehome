// Pure compatibility helpers for the transition from legacy search types to the
// canonical V1 intent model. Nothing in this module writes to, or modifies, a
// priorities document.

export const PURCHASE_PROPERTY_TYPE_OPTIONS = Object.freeze(['house', 'condo', 'townhome', 'multifamily']);
export const RENTAL_PROPERTY_TYPE_OPTIONS = Object.freeze(['apartment', 'house', 'townhome', 'condo']);

export const CANONICAL_SEARCH_INTENT_OPTIONS = Object.freeze([
  Object.freeze({ key: 'purchase', label: 'Purchase' }),
  Object.freeze({ key: 'rental', label: 'Rental' }),
  Object.freeze({ key: 'investment', label: 'Investment Property' }),
]);

export const PROPERTY_TYPE_LABELS = Object.freeze({
  apartment: 'Apartment', house: 'House', townhome: 'Townhome',
  condo: 'Condo', multifamily: 'Multifamily', other: 'Other',
});

// The actual type of a home is a universal shared fact. This list is deliberately
// separate from the narrower, intent-specific preference option lists above.
export const HOME_PROPERTY_TYPE_OPTIONS = Object.freeze([
  'apartment', 'house', 'townhome', 'condo', 'multifamily', 'other',
]);

const INTENT_BY_SEARCH_TYPE = Object.freeze({
  buy: 'purchase',
  purchase: 'purchase',
  rent_home: 'rental',
  rent_apartment: 'rental',
  rental: 'rental',
  investment: 'investment',
});

export function normalizeSearchIntent(rawSearchType) {
  if (typeof rawSearchType !== 'string') return null;
  return INTENT_BY_SEARCH_TYPE[rawSearchType] || null;
}

export function canonicalSearchTypeForWrite(rawSearchType) {
  return normalizeSearchIntent(rawSearchType);
}

// Explicit edits canonicalize only the intent field while retaining every
// other key (including unknown legacy keys) in the participant's document.
export function prioritiesForExplicitSave(priorities) {
  if (!priorities || typeof priorities !== 'object' || Array.isArray(priorities)) return priorities;
  const canonical = canonicalSearchTypeForWrite(priorities.searchType);
  return canonical ? { ...priorities, searchType: canonical } : { ...priorities };
}

export function searchIntentCapabilities(rawSearchType) {
  const intent = normalizeSearchIntent(rawSearchType);
  const isPurchase = intent === 'purchase';
  const isRental = intent === 'rental';
  const isInvestment = intent === 'investment';

  return {
    intent,
    isPurchase,
    isRental,
    isInvestment,
    showsRentalFacts: isRental,
    showsPurchaseFinancials: isPurchase || isInvestment,
    preferredPropertyTypeOptions: isPurchase
      ? PURCHASE_PROPERTY_TYPE_OPTIONS
      : isRental
        ? RENTAL_PROPERTY_TYPE_OPTIONS
        : [],
  };
}

// Legacy display and layout predicates remain deliberately raw-value based.
// Pass A consumers use these to preserve today's UI while canonical-aware code
// can use searchIntentCapabilities above in later passes.
export function isLegacyRentalSearchType(searchType) {
  return searchType === 'rent_home' || searchType === 'rent_apartment';
}

export function isLegacySimpleRentalSearchType(searchType) {
  return searchType === 'rent_apartment';
}

export function legacyShowsHomeLayout(searchType) {
  return searchType === 'buy' || searchType === 'rent_home';
}

export function legacySearchTypeLabel(searchType) {
  const labels = {
    buy: 'Buying a home',
    rent_home: 'Renting a home',
    rent_apartment: 'Renting an apartment',
    investment: 'An investment property',
  };
  return labels[searchType] || '';
}

export function legacyTerminology(searchType) {
  const rental = isLegacyRentalSearchType(searchType);
  return {
    budgetLabel: rental ? 'Maximum Monthly Price' : 'Maximum Budget',
    priceFieldLabel: rental ? 'Monthly Rent' : 'Asking price',
    pricePlaceholder: rental ? '2,200' : '450,000',
  };
}
