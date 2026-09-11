import { normalizePriorities } from './constants.js';
import { selectPriorityItem } from './matching.js';

export const NEW_SEARCH_CHOICES = Object.freeze([
  Object.freeze({ key: 'home_buy', label: 'Home to buy', intent: 'purchase', propertyType: 'house' }),
  Object.freeze({ key: 'home_rent', label: 'Home to rent', intent: 'rental', propertyType: 'house' }),
  Object.freeze({ key: 'apartment_rent', label: 'Apartment to rent', intent: 'rental', propertyType: 'apartment' }),
]);

const item = (categoryKey, label, kind = 'rating', displayLabel = label) => Object.freeze({ categoryKey, label, kind, displayLabel });

export const ONBOARDING_SUGGESTIONS = Object.freeze({
  home_buy: Object.freeze([
    ['Location', [item('location', 'Neighborhood'), item('location', 'Walkability'), item('location', 'Parks Nearby'), item('location', 'Immediate Street / Surroundings', 'rating', 'Quiet Street')]],
    ['Home Features', [item('features', 'Basement', 'check'), item('features', 'Fireplace', 'check'), item('features', 'Primary Ensuite', 'check'), item('features', 'Home Office', 'check'), item('features', 'Central Air', 'check'), item('features', 'Guest / In-Law Suite', 'check', 'Guest Suite'), item('features', 'Hardwood Floors', 'check')]],
    ['Exterior & Property', [item('exterior', 'Garage', 'check'), item('exterior', 'Fenced Yard', 'check'), item('exterior', 'Yard', 'rating', 'Yard Space'), item('exterior', 'Patio / Deck / Outdoor Living', 'check', 'Deck / Patio'), item('exterior', 'Privacy', 'rating', 'Yard Privacy'), item('exterior', 'Pool', 'check'), item('exterior', 'Landscaping')]],
    ['Home Feel', [item('homeFeel', 'Overall Condition'), item('homeFeel', 'Layout / Flow', 'rating', 'Layout'), item('homeFeel', 'Natural Light'), item('homeFeel', 'Character / Charm'), item('homeFeel', 'Privacy', 'rating', 'Privacy from Neighbors')]],
  ]),
  home_rent: Object.freeze([
    ['Location', [item('location', 'Neighborhood'), item('location', 'Walkability'), item('location', 'Parks Nearby'), item('location', 'Immediate Street / Surroundings', 'rating', 'Quiet Street')]],
    ['Home Features', [item('features', 'Basement', 'check'), item('features', 'Fireplace', 'check'), item('features', 'Primary Ensuite', 'check'), item('features', 'Home Office', 'check'), item('features', 'Central Air', 'check'), item('features', 'Hardwood Floors', 'check')]],
    ['Exterior & Property', [item('exterior', 'Garage', 'check'), item('exterior', 'Fenced Yard', 'check'), item('exterior', 'Outdoor Space'), item('exterior', 'Patio / Deck / Outdoor Living', 'check', 'Patio / Deck'), item('exterior', 'Privacy', 'rating', 'Yard Privacy')]],
    ['Living There', [item('features', 'Pets Allowed', 'check'), item('features', 'Utilities Included', 'check'), item('homeFeel', 'Overall Condition'), item('homeFeel', 'Layout / Flow', 'rating', 'Layout'), item('homeFeel', 'Natural Light'), item('homeFeel', 'Privacy', 'rating', 'Privacy'), item('exterior', 'Noise Level')]],
  ]),
  apartment_rent: Object.freeze([
    ['The Unit', [item('features', 'In-Unit Laundry', 'check'), item('features', 'Central Air', 'check'), item('features', 'Dishwasher', 'check'), item('features', 'Updated Interior', 'check'), item('exterior', 'Patio / Deck / Outdoor Living', 'check', 'Balcony / Patio'), item('features', 'Home Office', 'check', 'Home Office Space')]],
    ['The Property', [item('exterior', 'Parking', 'check'), item('exterior', 'Fitness Center', 'check'), item('exterior', 'Pool', 'check'), item('exterior', 'Secure Entry', 'check'), item('exterior', 'Outdoor Space'), item('exterior', 'Elevator', 'check'), item('features', 'Pets Allowed', 'check', 'Pet-Friendly')]],
    ['Living There', [item('exterior', 'Noise Level', 'rating', 'Quiet Community'), item('homeFeel', 'Social Community'), item('homeFeel', 'On-Site Management'), item('homeFeel', 'Privacy'), item('location', 'Neighborhood', 'rating', 'Surrounding Neighborhood')]],
  ]),
});

export function applySearchChoice(raw, choiceKey) {
  const choice = NEW_SEARCH_CHOICES.find((candidate) => candidate.key === choiceKey);
  if (!choice) return normalizePriorities(raw);
  const next = normalizePriorities(raw);
  // If someone goes Back and changes the kind of search, do not carry curated
  // suggestions from the abandoned path into the new one. User-authored items and
  // unrelated legacy data remain untouched.
  Object.values(ONBOARDING_SUGGESTIONS).flatMap((groups) => groups.flatMap(([, items]) => items)).forEach((criterion) => {
    if (next[criterion.categoryKey]?.tiers?.[criterion.label]) {
      next[criterion.categoryKey] = { ...next[criterion.categoryKey], tiers: { ...next[criterion.categoryKey].tiers, [criterion.label]: 'dontcare' } };
    }
  });
  next.onboardingSearchType = choice.key;
  next.searchType = choice.intent;
  next.preferredPropertyTypes = { values: [choice.propertyType], tier: 'important' };
  return next;
}

export function flatOnboardingSuggestions(choiceKey) {
  return (ONBOARDING_SUGGESTIONS[choiceKey] || []).flatMap(([, items]) => items);
}

export function applyOnboardingSelections(raw, selectedKeys, dealbreakerKeys = new Set()) {
  const next = normalizePriorities(raw);
  const selected = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys);
  const dealbreakers = dealbreakerKeys instanceof Set ? dealbreakerKeys : new Set(dealbreakerKeys);
  flatOnboardingSuggestions(next.onboardingSearchType).forEach((criterion) => {
    const key = `${criterion.categoryKey}:${criterion.label}`;
    const def = { key: criterion.categoryKey, coreItems: [], suggestedItems: [] };
    next[criterion.categoryKey] = selectPriorityItem(next[criterion.categoryKey], def, { label: criterion.label, kind: criterion.kind }, selected.has(key) ? (dealbreakers.has(key) ? 'must' : 'important') : 'dontcare');
  });
  return next;
}
