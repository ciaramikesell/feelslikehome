// Keep this file free of React/JSX so it can be imported from both client and
// server code without pulling in any UI dependencies.

export const LAYOUT_OPTIONS = ['Ranch / Single Story', 'Two Story', 'Split Level', 'Other', 'No Preference'];

export const LOCATION_CORE = ['Schools', 'Commute', 'Neighborhood'].map((label) => ({ label, kind: 'rating' }));
export const LOCATION_SUGGESTED = ['Walkability', 'Immediate Street / Surroundings', 'Overall Location', 'Parks Nearby', 'Proximity to Family / Friends', 'Dog Parks Nearby', 'Groceries Nearby', 'Restaurants / Coffee / Shopping Nearby'].map((label) => ({ label, kind: 'rating' }));

export const HOME_FEEL_CORE = ['Overall Condition', 'Layout / Flow'].map((label) => ({ label, kind: 'rating' }));
export const HOME_FEEL_SUGGESTED = ['Natural Light', 'Character / Charm', 'Room Sizes', 'Openness / Ceiling Height', 'Privacy', 'Move-In Ready', 'Renovation Potential'].map((label) => ({ label, kind: 'rating' }));

export const EXTERIOR_CORE = [{ label: 'Yard', kind: 'rating' }, { label: 'Garage', kind: 'check' }, { label: 'Privacy', kind: 'rating' }];
export const EXTERIOR_SUGGESTED = [
  { label: 'Fenced Yard', kind: 'check' }, { label: 'Sidewalks', kind: 'check' },
  { label: 'Exterior Condition', kind: 'rating' }, { label: 'Landscaping', kind: 'rating' },
  { label: 'Patio / Deck / Outdoor Living', kind: 'check' }, { label: 'Attached Garage', kind: 'check' },
  { label: 'Driveway / Off-Street Parking', kind: 'check' },
];

export const FEATURES_CORE = ['Basement', 'Fireplace', 'Primary Ensuite'].map((label) => ({ label, kind: 'check' }));
export const FEATURES_SUGGESTED = ['Central Air', 'Home Office', 'Finished Basement', 'Walkout Basement', 'First-Floor Laundry', 'Mudroom', 'Pantry', 'Storage', 'Updated Kitchen', 'Updated Bathrooms', 'Walk-In Closet', 'Additional Living Space', 'Guest / In-Law Suite', 'Basement Bedroom'].map((label) => ({ label, kind: 'check' }));

// Apartment-specific replacements — structurally different from a house, so it gets its
// own core/suggested sets for Exterior & Property and Home Features rather than reusing
// the house-oriented ones above.
const APARTMENT_EXTERIOR_CORE = [{ label: 'Parking', kind: 'check' }, { label: 'Outdoor Space', kind: 'rating' }, { label: 'Privacy', kind: 'rating' }];
const APARTMENT_EXTERIOR_SUGGESTED = [{ label: 'Noise Level', kind: 'rating' }, { label: 'Elevator', kind: 'check' }];
const APARTMENT_FEATURES_CORE = [{ label: 'In-Unit Laundry', kind: 'check' }, { label: 'Pet Policy', kind: 'check' }, { label: 'Utilities Included', kind: 'check' }];
const APARTMENT_FEATURES_SUGGESTED = ['Pet Rent / Fees', 'Building Amenities', 'Storage', 'Central Air', 'Updated Kitchen', 'Updated Bathrooms', 'Walk-In Closet'].map((label) => ({ label, kind: 'check' }));

export const MULTISELECT_CATEGORIES = [
  { key: 'homeLayout', title: 'Home Layout', options: LAYOUT_OPTIONS },
];

export const SINGLESELECT_CATEGORIES = [
  { key: 'primaryBedroomLocation', title: 'Primary Bedroom Location', options: ['Main Floor', 'Upstairs', 'Either / No Preference'] },
  { key: 'secondaryBedroomLocation', title: 'Secondary Bedroom Placement', options: ['All Upstairs', 'All on Main Floor', 'Split Between Floors', 'Either / No Preference'] },
];

// Category order per product spec: Location, Home Features, Exterior & Property, Home Feel (last).
// Content is tailored per search type — apartment gets a structurally different Exterior/Features
// set, and rent/investment types get a few extra suggestion chips layered onto the shared sets.
export function getItemlistCategories(searchType) {
  const isApartment = searchType === 'rent_apartment';
  const isInvestment = searchType === 'investment';
  const isRentHome = searchType === 'rent_home';

  const location = {
    key: 'location', title: 'Location',
    blurb: "How you feel about where the home sits and what's nearby. You'll rate each per home with stars.",
    coreItems: LOCATION_CORE,
    suggestedItems: [
      ...LOCATION_SUGGESTED,
      ...(isApartment ? [{ label: 'Floor / Location in Building', kind: 'check' }] : []),
      ...(isInvestment ? [{ label: 'Tenant Appeal', kind: 'rating' }] : []),
    ],
    defaultCustomKind: 'rating',
  };

  const features = isApartment
    ? {
        key: 'features', title: 'Home Features', blurb: "Specific things the apartment either has or doesn't.",
        coreItems: APARTMENT_FEATURES_CORE, suggestedItems: APARTMENT_FEATURES_SUGGESTED, defaultCustomKind: 'check',
      }
    : {
        key: 'features', title: 'Home Features', blurb: "Specific things the home either has or doesn't.",
        coreItems: FEATURES_CORE,
        suggestedItems: [
          ...FEATURES_SUGGESTED,
          ...(isRentHome ? [{ label: 'Pet Policy', kind: 'check' }, { label: 'In-Unit Laundry', kind: 'check' }] : []),
          ...(isInvestment ? [{ label: 'Separate Utilities', kind: 'check' }, { label: 'Unit Configuration', kind: 'check' }] : []),
        ],
        defaultCustomKind: 'check',
      };

  const exterior = isApartment
    ? {
        key: 'exterior', title: 'Exterior & Property', blurb: 'Parking, outdoor space, and how the unit feels.',
        coreItems: APARTMENT_EXTERIOR_CORE, suggestedItems: APARTMENT_EXTERIOR_SUGGESTED, defaultCustomKind: 'check',
      }
    : {
        key: 'exterior', title: 'Exterior & Property', blurb: 'The yard, parking, and outdoor spaces.',
        coreItems: EXTERIOR_CORE,
        suggestedItems: [
          ...EXTERIOR_SUGGESTED,
          ...(isRentHome || isInvestment ? [{ label: 'Parking', kind: 'check' }] : []),
        ],
        defaultCustomKind: 'check',
      };

  const homeFeel = {
    key: 'homeFeel', title: 'Home Feel',
    blurb: "Subjective qualities about what it's actually like to live there.",
    coreItems: HOME_FEEL_CORE,
    suggestedItems: [
      ...HOME_FEEL_SUGGESTED,
      ...(isInvestment ? [{ label: 'Rental Income Potential', kind: 'rating' }, { label: 'Property Condition', kind: 'rating' }, { label: 'Owner-Occupancy Suitability', kind: 'rating' }] : []),
      ...(isRentHome ? [{ label: 'Maintenance Responsibility', kind: 'rating' }, { label: 'Lease Terms', kind: 'rating' }] : []),
    ],
    defaultCustomKind: 'rating',
  };

  return [location, features, exterior, homeFeel];
}

export const STATUS_OPTIONS = ['Considering', 'Touring', 'Offer made', 'Under contract', 'Passed'];
export const STATUS_COLOR = { 'Considering': '#A08868', 'Touring': '#3E6B6F', 'Offer made': '#C1592F', 'Under contract': '#74804F', 'Passed': '#B3A696' };

export const TIER_ORDER = ['must', 'important', 'nice', 'dontcare'];
export const TIER_META = {
  must: { label: 'Must have', weight: 4, color: '#C1592F' },
  important: { label: 'Important', weight: 2, color: '#C69245' },
  nice: { label: 'Nice to have', weight: 1, color: '#3E6B6F' },
  dontcare: { label: "Don't care", weight: 0, color: '#9C8F80' },
};
// Only these three are offered once a criterion is selected — "don't care" is simply
// what a criterion is when it's never been selected in the first place.
export const SELECTABLE_TIERS = ['nice', 'important', 'must'];
export const DEFAULT_SELECTED_TIER = 'important';

export const SEARCH_TYPE_OPTIONS = [
  { key: 'buy', label: 'Home to buy' },
  { key: 'rent_home', label: 'Home to rent' },
  { key: 'rent_apartment', label: 'Apartment to rent' },
  { key: 'investment', label: 'Investment property' },
];

export const INVESTMENT_LIVING_PLAN_OPTIONS = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
  { key: 'not_sure', label: 'Not sure yet' },
];

export function isRentalType(searchType) {
  return searchType === 'rent_home' || searchType === 'rent_apartment';
}

// Apartment renters get a simpler basics set — no layout or lot size questions.
export function isSimpleRentalType(searchType) {
  return searchType === 'rent_apartment';
}

// Home layout only makes sense for standalone homes — not apartments, not investment
// properties (which may span several layouts/unit types).
export function showsHomeLayout(searchType) {
  return searchType === 'buy' || searchType === 'rent_home';
}

export const INVESTMENT_PROPERTY_TYPES = ['Single-Family', 'Duplex', 'Triplex', 'Fourplex', '5+ Units', 'No Preference'];

export function nextInvestmentTypes(cur, opt) {
  if (opt === 'No Preference') return cur.includes('No Preference') && cur.length === 1 ? [] : ['No Preference'];
  const withoutNoPref = cur.filter((x) => x !== 'No Preference');
  return withoutNoPref.includes(opt) ? withoutNoPref.filter((x) => x !== opt) : [...withoutNoPref, opt];
}

export function searchTypeLabel(searchType) {
  const map = { buy: 'Buying a home', rent_home: 'Renting a home', rent_apartment: 'Renting an apartment', investment: 'An investment property' };
  return map[searchType] || '';
}

export function terminology(searchType) {
  const rental = isRentalType(searchType);
  return {
    budgetLabel: rental ? 'Maximum Monthly Rent' : 'Maximum Budget',
    priceFieldLabel: rental ? 'Monthly rent' : 'Asking price',
    pricePlaceholder: rental ? '2,200' : '450,000',
  };
}

export const TABS = [
  { key: 'search', label: 'My Search', href: '/search' },
  { key: 'homes', label: 'Homes', href: '/homes' },
  { key: 'favorites', label: 'Favorites', href: '/favorites' },
  { key: 'archive', label: 'Archive', href: '/archive' },
  { key: 'compare', label: 'Compare', href: '/compare' },
];

export function emptyHome() {
  return {
    id: null,
    address: '', crossroads: '', listingUrl: '', photoUrl: '',
    price: '', estMonthly: '', sqft: '', beds: '', baths: '', lotSize: '', garageSpaces: '', yearBuilt: '', daysOnMarket: '',
    homeLayout: [], primaryBedroomLocation: '', secondaryBedroomLocation: '',
    status: 'Considering', reaction: null, rejectionReason: '',
    ratings: {}, checks: {},
    notes: '', pros: '', cons: '',
  };
}

export function defaultPriorities() {
  return {
    searchType: '',
    investmentPropertyTypes: [],
    planningToLiveIn: '',
    budget: { value: '', tier: 'important' },
    sqftTarget: { value: '', tier: 'nice' },
    lotSizeTarget: { value: '', tier: 'dontcare' },
    bedsMin: { value: '', tier: 'important' },
    bathsMin: { value: '', tier: 'nice' },
    homeLayout: { values: [], tier: 'dontcare' },
    primaryBedroomLocation: { value: '', tier: 'dontcare' },
    secondaryBedroomLocation: { value: '', tier: 'dontcare' },
    location: { customItems: [], tiers: {}, order: [], hiddenCore: [] },
    homeFeel: { customItems: [], tiers: {}, order: [], hiddenCore: [] },
    exterior: { customItems: [], tiers: {}, order: [], hiddenCore: [] },
    features: { customItems: [], tiers: {}, order: [], hiddenCore: [] },
  };
}
