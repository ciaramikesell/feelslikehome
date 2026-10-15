import { normalizePriorities, getItemlistCategories, criterionDisplayLabel, BUY_WHAT_MATTERS_GROUPS, HOME_RENT_CATALOG, homePreferenceCriteriaFor } from './constants.js';
import { selectPriorityItem } from './matching.js';

export const NEW_SEARCH_CHOICES = Object.freeze([
  Object.freeze({ key: 'home_buy', label: 'Home to buy', intent: 'purchase', propertyType: 'house' }),
  Object.freeze({ key: 'home_rent', label: 'Home to rent', intent: 'rental', propertyType: 'house' }),
  Object.freeze({ key: 'apartment_rent', label: 'Apartment to rent', intent: 'rental', propertyType: 'apartment' }),
]);

const item = (categoryKey, label, kind = 'rating', displayLabel = label) => Object.freeze({ categoryKey, label, kind, displayLabel });

// Home to Buy's suggestions are derived directly from the same canonical purchase
// catalog My Search itself reads (getItemlistCategories) — one shared taxonomy, not a
// second hand-authored list that can silently drift out of sync with it (see
// PURCHASE_LEGACY_LABEL_ALIASES in constants.js for the history of what that drift
// already caused: duplicate Home Office/Fenced Yard selections, and onboarding
// offering several built-ins — Neighborhood, Walkability, Garage, Immediate Street/
// Surroundings, generic Basement/Yard, the old Guest / In-Law Suite — that had been
// retired from purchase Match entirely, so picking them in onboarding silently did
// nothing). Home Feel is intentionally absent: it is not part of the purchase pre-tour
// catalog at all (Post-Tour owns those experiential dimensions instead).
//
// 2026 Home to Buy refresh: the four approved groups (BUY_WHAT_MATTERS_GROUPS).
// Every entry is still a canonical purchase identity (checked below against
// getItemlistCategories, so the two can never drift apart).
function purchaseOnboardingGroup([groupTitle, entries]) {
  const catalog = new Map(getItemlistCategories('purchase').flatMap((def) => [...def.coreItems, ...def.suggestedItems].map((entry) => [`${def.key}:${entry.label}`, entry])));
  return [groupTitle, entries.map((entry) => {
    const canonical = catalog.get(`${entry.categoryKey}:${entry.label}`);
    if (!canonical) throw new Error(`Not a purchase catalog criterion: ${entry.categoryKey}:${entry.label}`);
    return item(entry.categoryKey, entry.label, canonical.kind, criterionDisplayLabel(entry.categoryKey, entry.label));
  })];
}

// Home to Rent keeps the canonical Home criteria it offered before the Home to
// Buy refresh (HOME_RENT_CATALOG: the earlier purchase lists minus No HOA, since
// an HOA is the landlord's concern). Selected items are promoted into the
// participant's own customItems exactly like a purchase selection
// (selectPriorityItem), so the rental intent's Match reads them without any
// catalog or schema change. Garage is asked with Home Preferences on The Basics.
function homeRentGroup(categoryKey, groupTitle) {
  return [groupTitle, HOME_RENT_CATALOG[categoryKey].map((label) => item(categoryKey, label, 'check', criterionDisplayLabel(categoryKey, label)))];
}

export const ONBOARDING_SUGGESTIONS = Object.freeze({
  home_buy: Object.freeze(BUY_WHAT_MATTERS_GROUPS.map(purchaseOnboardingGroup)),
  home_rent: Object.freeze([
    homeRentGroup('location', 'Location'),
    homeRentGroup('features', 'Home Features'),
    homeRentGroup('exterior', 'Exterior & Property'),
  ]),
  apartment_rent: Object.freeze([
    ['The Unit', [item('features', 'In-Unit Laundry', 'check'), item('features', 'Central Air', 'check'), item('features', 'Dishwasher', 'check'), item('features', 'Updated Interior', 'check'), item('exterior', 'Patio / Deck / Outdoor Living', 'check', 'Balcony / Patio'), item('features', 'Home Office', 'check', 'Home Office Space')]],
    ['The Property', [item('exterior', 'Parking', 'check'), item('exterior', 'Fitness Center', 'check'), item('exterior', 'Pool', 'check'), item('exterior', 'Secure Entry', 'check'), item('exterior', 'Outdoor Space'), item('exterior', 'Elevator', 'check'), item('features', 'Pets Allowed', 'check', 'Pet-Friendly')]],
    // Social Community, On-Site Management and Surrounding Neighborhood are retired
    // here (see DISCONTINUED_RENTAL_OFFERINGS): nothing can answer them for a home.
    // Anyone who already chose one keeps it.
    ['Living There', [item('exterior', 'Noise Level', 'rating', 'Quiet Community'), item('homeFeel', 'Privacy')]],
  ]),
});

export function applySearchChoice(raw, choiceKey) {
  const choice = NEW_SEARCH_CHOICES.find((candidate) => candidate.key === choiceKey);
  if (!choice) return normalizePriorities(raw);
  const next = normalizePriorities(raw);
  // If someone goes Back and changes the kind of search, do not carry curated
  // suggestions (or Home Preferences) from the abandoned path into the new one.
  // User-authored items and unrelated legacy data remain untouched; callers that
  // keep what still applies re-add it (chooseSearchType, switchSearchType).
  [...Object.values(ONBOARDING_SUGGESTIONS).flatMap((groups) => groups.flatMap(([, items]) => items)), ...homePreferenceCriteriaFor('home_buy')].forEach((criterion) => {
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

export function onboardingPriorityCounts(raw) {
  const priorities = normalizePriorities(raw);
  const counts = { must: 0, important: 0, nice: 0 };
  ['location', 'features', 'exterior', 'homeFeel'].forEach((categoryKey) => {
    Object.values(priorities[categoryKey].tiers || {}).forEach((tier) => {
      if (Object.hasOwn(counts, tier)) counts[tier] += 1;
    });
  });
  return counts;
}

export function onboardingOverview(raw) {
  const priorities = normalizePriorities(raw);
  const lines = [];
  if (priorities.onboardingSearchType) {
    lines.push(NEW_SEARCH_CHOICES.find(({ key }) => key === priorities.onboardingSearchType)?.label);
  }
  const values = [
    [priorities.budget.value, (value) => `$${value} max`],
    [priorities.bedsMin.value, (value) => `${value}+ bedrooms`],
    [priorities.bathsMin.value, (value) => `${value}+ bathrooms`],
    [priorities.sqftTarget.value, (value) => `${value}+ sq ft`],
  ];
  values.forEach(([value, format]) => {
    const entered = String(value ?? '').trim();
    if (entered) lines.push(format(entered));
  });
  return lines.filter(Boolean);
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
