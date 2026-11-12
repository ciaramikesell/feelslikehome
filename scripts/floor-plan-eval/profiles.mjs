// Synthetic buyer profiles (My Search priorities) used to exercise the
// deterministic mapper. They live only in this harness and are never sent to
// a provider. A selected suggestion is stored as it is in the app: promoted
// into customItems with a tier.
const pick = (labels, tier = 'important') => ({
  customItems: labels.map((label) => ({ label, kind: 'check' })),
  tiers: Object.fromEntries(labels.map((label) => [label, tier])),
});

// Home to Buy with every layout criterion a plan could bear on.
export const PURCHASE_ALL = Object.freeze({
  searchType: 'purchase',
  features: pick(['Walk-in Pantry', 'Home office', 'First-floor laundry', 'Second-Floor Laundry', 'Primary ensuite',
    'First-Floor Bedroom', 'First-Floor Primary', 'Formal Dining Room', 'Eat-in Kitchen', 'Kitchen Island', 'Double Vanity',
    'Soaking Tub', 'Fireplace', 'Finished basement', 'Guest / In-Law Suite']),
  exterior: pick(['Screened-in Porch', 'Front porch', 'Patio / deck', 'Attached garage', 'Pool']),
});

// Rental search (Home or Apartment to Rent) with layout criteria selected.
export const RENTAL_ALL = Object.freeze({
  searchType: 'rental',
  features: pick(['Walk-In Closet', 'Mudroom', 'Pantry', 'Home Office', 'Primary Ensuite', 'First-Floor Laundry',
    'Additional Living Space', 'Fireplace', 'Finished Basement', 'Basement']),
  exterior: pick(['Patio / Deck / Outdoor Living', 'Attached Garage', 'Pool']),
});

// A buyer who typed their own criteria (custom), to exercise exact-label and
// semantic ("possibly relevant") links.
export const PURCHASE_CUSTOM = Object.freeze({
  searchType: 'purchase',
  features: {
    customItems: [
      { label: 'Room for aging parents', kind: 'check', source: 'custom' },
      { label: 'Work from home space', kind: 'check', source: 'custom' },
      { label: 'Mudroom', kind: 'check', source: 'custom' },
      { label: 'Laundry', kind: 'check', source: 'custom' },
      { label: 'Home gym', kind: 'check', source: 'custom' },
      { label: 'Sauna', kind: 'check', source: 'custom' },
    ],
    tiers: { 'Room for aging parents': 'must', 'Work from home space': 'important', Mudroom: 'nice', Laundry: 'nice', 'Home gym': 'nice', Sauna: 'nice' },
  },
});

export const PROFILES = Object.freeze({ purchase: PURCHASE_ALL, rental: RENTAL_ALL, 'purchase-custom': PURCHASE_CUSTOM });
