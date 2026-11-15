// One helpful sentence per onboarding feature, shown in the desktop priority
// board's hover / focus preview (src/components/onboarding/priority/PriorityBoard.jsx)
// and given to assistive technology as the chip's description.
//
// Keyed by the feature's DISPLAY text, normalised (normalizeFeatureKey), not
// by its stored identity: a house "Garage" and an apartment "Garage Parking"
// share the identity exterior:Garage but are different preferences, and read
// differently here. Descriptions are supplementary: every chip is fully named
// by its own text, so nothing here is required to use the board.
//
// Pure, framework-free; no new priority, catalog entry or Match input.

import { normalizeFeatureKey } from './priorityCategories.js';

const DESCRIPTIONS = Object.freeze({
  // Layout & living spaces
  'First-Floor Bedroom': 'A bedroom on the main level, so stairs are optional.',
  'Home Office': 'A separate room you can close the door on for work.',
  'Home Office Space': 'Room in the unit for a desk you can actually work at.',
  'Finished Basement': 'A lower level that’s finished as real living space.',
  'Primary Ensuite': 'A primary bedroom with its own attached bathroom.',
  'Primary Ensuite Bathroom': 'A primary bedroom with its own attached bathroom.',
  'First-Floor Laundry': 'Washer and dryer on the main level, not down in the basement.',
  'Walkout Basement': 'A lower level with a door straight out to the yard.',
  'Front Porch': 'A covered spot at the front door to sit and say hello.',
  'Extra Bedroom': 'One more bedroom than the minimum you entered in Basics.',
  // Kitchen
  'Countertop Seating': 'Stools at the counter for quick meals and company while you cook.',
  'Kitchen Countertop Seating': 'Stools at the counter for quick meals and company while you cook.',
  'Stainless Steel Appliances': 'A matching set of stainless fridge, range and dishwasher.',
  'Walk-in Pantry': 'A pantry you can step into, with room for bulk and small appliances.',
  'Eat-in Kitchen': 'Space for a table right in the kitchen.',
  'Kitchen Island': 'A freestanding counter for prep, storage and gathering.',
  'Formal Dining Room': 'A separate room set aside for sit-down meals.',
  // Living room
  Fireplace: 'A working fireplace to gather around.',
  'High Ceilings': 'Ceilings taller than standard, for an open, airy feel.',
  'Built-in Shelving': 'Shelves built into the walls for books and display.',
  'Large Windows': 'Big windows that bring in plenty of daylight.',
  // Bathroom
  'Double Vanity': 'Two sinks, so mornings don’t mean taking turns.',
  'Soaking Tub': 'A deep tub made for a long, proper soak.',
  'Separate Shower / Tub': 'A walk-in shower and a separate bathtub.',
  'Private Toilet': 'A toilet behind its own door within the bathroom.',
  'Linen Closet': 'A closet for towels and sheets near the bathrooms.',
  // Garage
  Garage: 'A garage that comes with the home.',
  'Garage Parking': 'Covered parking in the building’s garage.',
  Workbench: 'Room in the garage for a workbench and tools.',
  'Garage Extension': 'Extra garage depth or bays for storage, a workshop or a bigger vehicle.',
  'Door to Backyard': 'A door from the garage straight to the yard.',
  'Private Garage': 'A garage for your unit only, not shared parking.',
  // Exterior & property
  'Deck / Patio': 'An outdoor deck or patio for meals and lounging.',
  'Fenced Yard': 'A yard enclosed by a fence, for kids, pets or privacy.',
  'Mature Trees': 'Established trees for shade and character.',
  'Garden Space': 'A sunny patch of ground ready for planting.',
  Pool: 'A swimming pool on the property.',
  Landscaping: 'A well-kept, landscaped yard.',
  'Private Outdoor Space': 'A balcony or patio that’s yours alone.',
  'Ideal lot size': 'Homes on at least this much land count; an unknown lot size never counts against one.',
  // Rental features
  'Central Air': 'Air conditioning throughout, not window units.',
  'In-Unit Laundry': 'A washer and dryer inside your own home.',
  Dishwasher: 'A built-in dishwasher.',
  'Utilities Included': 'Some or all utilities are covered by the rent.',
  'Off-Street Parking': 'A driveway or dedicated spot, so no hunting for street parking.',
  // Apartment property
  'Fitness Center': 'A gym in the building for residents.',
  Elevator: 'An elevator, so stairs aren’t the only way up.',
  'Sufficient Parking': 'Enough parking for residents and guests.',
  'Secure Entry': 'Locked or controlled entry to the building.',
  // Location & neighborhood
  'Low-Traffic Street': 'A quiet street without much through traffic.',
  Sidewalks: 'Sidewalks for walks, strollers and kids on bikes.',
  'Tree-Lined Street': 'A street shaded by rows of trees.',
  'No HOA': 'No homeowners association rules or monthly HOA fees.',
  'Cul-de-Sac': 'A dead-end circle with little traffic.',
  'Walkable to Schools': 'Schools within an easy walk.',
  'Walkable Neighborhood': 'Shops and everyday errands within walking distance.',
  'Parks Nearby': 'A park within a short walk or drive.',
  'Reputable Schools': 'Schools with a strong reputation nearby.',
  // Rental Essentials (shown in a column when the pets answer chose it)
  'Pet-Friendly': 'Pets are welcome; set from your answer to the pets question.',
});

const BY_KEY = new Map(Object.entries(DESCRIPTIONS).map(([text, sentence]) => [normalizeFeatureKey(text), sentence]));

export const FEATURE_DESCRIPTION_TEXTS = Object.freeze(Object.keys(DESCRIPTIONS));

// The sentence for a board feature. A person's own feature, or a priority
// chosen earlier that the board doesn't describe, gets a truthful generic line
// instead of an invented one.
export function featureDescription(feature) {
  if (!feature) return '';
  const known = BY_KEY.get(normalizeFeatureKey(feature.text)) || BY_KEY.get(normalizeFeatureKey(feature.label));
  if (known) return known;
  if (feature.custom) return 'Your own priority. You’ll answer Yes or No for each home; unknown never counts against it.';
  return 'A priority you chose earlier. It counts in your Match exactly as before.';
}
