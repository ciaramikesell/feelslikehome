import { normalizePriorities, getItemlistCategories, criterionDisplayLabel } from './constants.js';
import { selectPriorityItem } from './matching.js';

export const NEW_SEARCH_CHOICES = Object.freeze([
  Object.freeze({ key: 'home_buy', label: 'Home to buy', intent: 'purchase', propertyType: 'house' }),
  Object.freeze({ key: 'home_rent', label: 'Home to rent', intent: 'rental', propertyType: 'house' }),
  Object.freeze({ key: 'apartment_rent', label: 'Apartment to rent', intent: 'rental', propertyType: 'apartment' }),
]);

const item = (categoryKey, label, kind = 'rating', displayLabel = label) => Object.freeze({ categoryKey, label, kind, displayLabel });

// Home to Buy's, Home to Rent's, and Apartment to Rent's suggestions are all derived
// directly from the same canonical catalog My Search itself reads (getItemlistCategories)
// — one shared taxonomy per search type, never a second hand-authored list that can
// silently drift out of sync with it (see PURCHASE_LEGACY_LABEL_ALIASES/
// RENTAL_HOME_LEGACY_LABEL_ALIASES in constants.js for the history of what that drift
// already caused: duplicate Home Office/Fenced Yard selections, and onboarding offering
// several built-ins that had been retired from Match entirely, so picking them in
// onboarding silently did nothing). Home Feel is intentionally absent for all three: it
// is not part of any of their pre-tour catalogs (Post-Tour owns those experiential
// dimensions instead).
function onboardingGroup(intentSearchType, isApartment, categoryKey, groupTitle) {
  const def = getItemlistCategories(intentSearchType, { isApartment }).find((category) => category.key === categoryKey);
  const items = [...def.coreItems, ...def.suggestedItems]
    .map((entry) => item(categoryKey, entry.label, entry.kind, criterionDisplayLabel(categoryKey, entry.label)));
  return [groupTitle, items];
}

export const ONBOARDING_SUGGESTIONS = Object.freeze({
  home_buy: Object.freeze([
    onboardingGroup('purchase', false, 'location', 'Location'),
    onboardingGroup('purchase', false, 'features', 'Home Features'),
    onboardingGroup('purchase', false, 'exterior', 'Exterior & Property'),
  ]),
  // 2026 Home-to-Rent parity pass: a rented HOUSE now shares Home to Buy's exact
  // canonical catalog (minus No HOA — see LOCATION_SUGGESTED_HOME_RENTAL), rather than
  // a separately hand-authored rental list.
  home_rent: Object.freeze([
    onboardingGroup('rental', false, 'location', 'Location'),
    onboardingGroup('rental', false, 'features', 'Home Features'),
    onboardingGroup('rental', false, 'exterior', 'Exterior & Property'),
  ]),
  // 2026 apartment taxonomy replacement: Apartment to Rent has its own dedicated
  // catalog — apartment evaluation spans the unit, the building/property,
  // apartment-specific amenities, and the day-to-day living experience, so it is
  // deliberately never forced into the house taxonomy above.
  apartment_rent: Object.freeze([
    onboardingGroup('rental', true, 'location', 'Living There'),
    onboardingGroup('rental', true, 'features', 'Apartment Features'),
    onboardingGroup('rental', true, 'exterior', 'Amenities'),
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
