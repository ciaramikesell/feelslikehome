// Onboarding V2, Step 4 ("What matters most?") — the approved Figma catalog,
// mapped onto EXISTING canonical priorities. Nothing here is a new identity:
//
//   • criterion chips are the existing `category:label` criteria (the same
//     identities My Search, Step 5 and Match already use);
//   • value chips are options in the existing grouped preferences
//     (preferredPropertyTypes, homeLayout, homeCondition — alternatives with one
//     importance; see src/lib/whatMattersGroups.js).
//
// Chip text is the approved Figma wording; the stored identity is unchanged.
// Every other criterion currently offered for the search stays available under
// "More to consider", so nothing supported is removed.
//
// Figma options with no live canonical criterion are deliberately NOT offered
// (see UNSUPPORTED_FIGMA_OPTIONS) rather than inventing a parallel priority.
//
// Renting (Home to Rent, Apartment to Rent) uses the same six steps and chip
// style with its own sections: a shared "Rental essentials" section first,
// then choices for a rented house or an apartment, with secondary options
// under More to consider. Every rental chip is an existing criterion in the
// rental catalog (or, for Home to Rent, the canonical Home criteria it
// already offered), so Match evaluates each one exactly as before. Things a
// person can only judge in person are marked "after tour".

import { getItemlistCategories, isExperientialCriterion, normalizePriorities } from './constants.js';
import { flatOnboardingSuggestions, ONBOARDING_SUGGESTIONS } from './onboarding.js';
import { chooseSearchType } from './onboardingBasics.js';
import { addCriterion, isCriterionSelected, priorityLevels, searchExperienceKey, selectedPriorityCount } from './searchProfile.js';
import { isGroupValueSelected, priorityLevelsWithGroups, whatMattersGroups } from './whatMattersGroups.js';

const criterion = (categoryKey, label, text, icon) => ({ type: 'criterion', categoryKey, label, text, icon });
const value = (group, valueKey, text, icon) => ({ type: 'value', group, value: valueKey, text, icon });

const SECTIONS = Object.freeze([
  {
    key: 'neighborhood',
    title: 'Neighborhood',
    chips: [
      criterion('location', 'Quiet street', 'Quiet street', 'Route'),
      criterion('location', 'Walkable to Town', 'Walkable to town', 'Store'),
      criterion('location', 'Reputable Schools', 'Great schools', 'School'),
      criterion('location', 'Parks nearby', 'Parks nearby', 'Leaf'),
      criterion('location', 'Near waterfront', 'Near the water', 'Waves'),
    ],
  },
  {
    key: 'home',
    title: 'The home',
    chips: [
      criterion('exterior', 'Large backyard', 'Big backyard', 'Trees'),
      criterion('features', 'Home office', 'Home office', 'Laptop'),
      criterion('features', 'Primary ensuite', 'Primary suite', 'BedDouble'),
      criterion('features', 'Guest Bedroom', 'Guest space', 'Sofa'),
      criterion('features', 'Finished basement', 'Finished basement', 'Layers'),
      value('homeCondition', 'Move-In Ready', 'Move-in ready', 'Sparkles'),
      value('homeCondition', 'Renovation Potential', 'Room to renovate', 'Hammer'),
    ],
  },
  {
    key: 'type',
    title: 'Property type',
    note: 'Any of these can work—a home only needs to be one.',
    chips: [
      value('preferredPropertyTypes', 'house', 'House', 'House'),
      value('preferredPropertyTypes', 'townhome', 'Townhome', 'Building'),
      value('preferredPropertyTypes', 'condo', 'Condo', 'Building2'),
      value('preferredPropertyTypes', 'multifamily', 'Multifamily', 'Hotel'),
    ],
  },
  {
    key: 'layout',
    title: 'Layout',
    note: 'Any of these can work—a home only needs to be one.',
    chips: [
      value('homeLayout', 'Ranch / Single Story', 'Ranch', 'Columns2'),
      value('homeLayout', 'Two Story', 'Two story', 'Rows2'),
      value('homeLayout', 'Other', 'Other', 'Shapes'),
    ],
  },
  {
    key: 'features',
    title: 'Home features',
    chips: [
      criterion('exterior', 'Garage', 'Garage', 'Car'),
      value('homeCondition', 'New Construction', 'New construction', 'HardHat'),
    ],
  },
]);

// Approved in Figma, but no live canonical criterion exists for a purchase
// search today (reviewed against getItemlistCategories and Match).
export const UNSUPPORTED_FIGMA_OPTIONS = Object.freeze([
  { text: 'Easy commute', reason: 'Commute only counts in Match against a place with a maximum drive time; onboarding Places deliberately set none.' },
  { text: 'Natural light', reason: 'homeFeel:Natural Light is retired for purchase searches (kept for old data, never counted in Match).' },
  { text: 'Open kitchen', reason: 'No canonical criterion exists (features:Updated Kitchen is retired and means something else).' },
]);

// Rental essentials, shared by both rental searches. Pets, laundry and
// utilities are shared facts about a property (homes.pets_allowed, etc.).
const RENTAL_ESSENTIALS = Object.freeze({
  key: 'essentials',
  title: 'Rental essentials',
  chips: [
    criterion('features', 'Pets Allowed', 'Pet-friendly', 'PawPrint'),
    criterion('features', 'In-Unit Laundry', 'In-unit laundry', 'WashingMachine'),
    criterion('features', 'Utilities Included', 'Utilities included', 'PlugZap'),
    criterion('exterior', 'Parking', 'Parking', 'SquareParking'),
    criterion('features', 'Central Air', 'Central air', 'AirVent'),
    criterion('features', 'Dishwasher', 'Dishwasher', 'Utensils'),
  ],
});

const AFTER_TOUR_NOTE = 'You’ll judge these in person—FLH asks about them after you tour.';

const RENTAL_SECTIONS = Object.freeze({
  home_rent: [
    RENTAL_ESSENTIALS,
    {
      key: 'neighborhood',
      title: 'Neighborhood',
      chips: [
        criterion('location', 'Quiet street', 'Quiet street', 'Route'),
        criterion('location', 'Walkable to Town', 'Walkable to town', 'Store'),
        criterion('location', 'Reputable Schools', 'Great schools', 'School'),
        criterion('location', 'Parks nearby', 'Parks nearby', 'Leaf'),
      ],
    },
    {
      key: 'home',
      title: 'The home',
      chips: [
        criterion('features', 'Home office', 'Home office', 'Laptop'),
        criterion('features', 'Primary ensuite', 'Primary suite', 'BedDouble'),
        criterion('exterior', 'Garage', 'Garage', 'Car'),
      ],
    },
    {
      key: 'outdoor',
      title: 'Outdoor space',
      chips: [
        criterion('exterior', 'Large backyard', 'Big backyard', 'Trees'),
        criterion('exterior', 'Fenced yard', 'Fenced yard', 'Fence'),
      ],
    },
    {
      key: 'type',
      title: 'Property type',
      note: 'Any of these can work—a home only needs to be one.',
      chips: [
        value('preferredPropertyTypes', 'house', 'House', 'House'),
        value('preferredPropertyTypes', 'townhome', 'Townhome', 'Building'),
        value('preferredPropertyTypes', 'condo', 'Condo', 'Building2'),
      ],
    },
  ],
  apartment_rent: [
    RENTAL_ESSENTIALS,
    {
      key: 'unit',
      title: 'The unit',
      chips: [
        criterion('exterior', 'Patio / Deck / Outdoor Living', 'Balcony / patio', 'Sun'),
        criterion('features', 'Updated Interior', 'Updated interior', 'PaintRoller'),
        criterion('features', 'Home Office', 'Home office space', 'Laptop'),
      ],
    },
    {
      key: 'building',
      title: 'Building & amenities',
      chips: [
        criterion('exterior', 'Fitness Center', 'Fitness center', 'Dumbbell'),
        criterion('exterior', 'Pool', 'Pool', 'Waves'),
        criterion('exterior', 'Secure Entry', 'Secure entry', 'ShieldCheck'),
        criterion('exterior', 'Elevator', 'Elevator', 'ArrowUpDown'),
      ],
    },
    {
      key: 'type',
      title: 'Building type',
      note: 'Any of these can work—a place only needs to be one.',
      chips: [
        value('preferredPropertyTypes', 'apartment', 'Apartment', 'Building2'),
        value('preferredPropertyTypes', 'condo', 'Condo', 'Building'),
        value('preferredPropertyTypes', 'townhome', 'Townhome', 'House'),
      ],
    },
    {
      key: 'after-tour',
      title: 'After you tour',
      note: AFTER_TOUR_NOTE,
      chips: [
        criterion('exterior', 'Noise Level', 'Quiet community', 'VolumeX'),
        criterion('homeFeel', 'Privacy', 'Privacy', 'EyeOff'),
      ],
    },
  ],
});

// Secondary rental options, under More to consider.
const RENTAL_MORE = Object.freeze({
  home_rent: [
    criterion('location', 'Near waterfront', 'Near the water', null),
    criterion('features', 'Guest Bedroom', 'Guest space', null),
    criterion('exterior', 'Patio / deck', 'Deck / patio', null),
    criterion('exterior', 'Driveway / Off-Street Parking', 'Off-street parking', null),
  ],
  apartment_rent: [
    criterion('exterior', 'Outdoor Space', 'Outdoor space', null),
    criterion('features', 'Walk-In Closet', 'Walk-in closet', null),
    criterion('features', 'Hardwood Floors', 'Hardwood floors', null),
    criterion('features', 'Updated Kitchen', 'Updated kitchen', null),
    criterion('features', 'Updated Bathrooms', 'Updated bathrooms', null),
    criterion('exterior', 'Driveway / Off-Street Parking', 'Off-street parking', null),
  ],
});

// Earlier Apartment to Rent options that nothing in FLH can answer for a home
// (no listing field, no Yes/No, no after-tour question), so in Match they would
// stay "Not evaluated" forever. Not offered here until they can be answered;
// anyone who already chose one keeps it (it stays visible under "Your own").
export const UNANSWERABLE_RENTAL_OPTIONS = Object.freeze([
  { key: 'homeFeel:Social Community', text: 'Social community' },
  { key: 'homeFeel:On-Site Management', text: 'On-site management' },
  { key: 'location:Neighborhood', text: 'Surrounding neighborhood' },
]);

// Not offered yet: these need new property data and Match design first
// (see docs/onboarding-v2-rental.md).
export const FUTURE_RENTAL_PRIORITIES = Object.freeze(['Move-in date', 'Lease length', 'Furnished', 'Deposits and fees']);

const isRental = (experience) => experience === 'home_rent' || experience === 'apartment_rent';

// A rental chip's kind comes from the catalog it belongs to (the rental
// catalog, or the canonical Home criteria Home to Rent already offered).
function rentalKind(experience, chip) {
  const key = `${chip.categoryKey}:${chip.label}`;
  const offered = flatOnboardingSuggestions(experience).find((item) => `${item.categoryKey}:${item.label}` === key);
  if (offered) return offered.kind;
  const def = getItemlistCategories('rental').find((category) => category.key === chip.categoryKey);
  return [...(def?.coreItems || []), ...(def?.suggestedItems || []), ...(def?.specificItems || [])].find((item) => item.label === chip.label)?.kind || 'check';
}
const withRentalDetails = (experience, chip) => {
  if (chip.type !== 'criterion') return chip;
  const afterTour = isExperientialCriterion(chip.categoryKey, chip.label);
  return { ...chip, kind: rentalKind(experience, chip), ...(afterTour ? { afterTour: true } : {}) };
};

const keyOf = (chip) => (chip.type === 'criterion' ? `${chip.categoryKey}:${chip.label}` : `${chip.group}=${chip.value}`);

// The sections this person sees: only chips their kind of search supports
// (the same rules as before — e.g. no layout or condition when renting).
export function whatMattersSections(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  const offered = flatOnboardingSuggestions(experience);
  const offeredByKey = new Map(offered.map((item) => [`${item.categoryKey}:${item.label}`, item]));
  const groupChoices = new Map(whatMattersGroups(priorities).map((group) => [group.key, new Set(group.choices.map((choice) => choice.value))]));
  const supported = (chip) => (chip.type === 'criterion' ? offeredByKey.has(keyOf(chip)) : Boolean(groupChoices.get(chip.group)?.has(chip.value)));

  if (isRental(experience)) {
    return appendSavedGroupValues(priorities, RENTAL_SECTIONS[experience].map((section) => ({
      ...section,
      chips: section.chips.filter((chip) => chip.type === 'criterion' || supported(chip)).map((chip) => withRentalDetails(experience, chip)),
    }))).filter((section) => section.chips.length);
  }

  const sections = SECTIONS.map((section) => ({
    ...section,
    chips: section.chips
      .filter(supported)
      .map((chip) => (chip.type === 'criterion' ? { ...chip, kind: offeredByKey.get(keyOf(chip)).kind } : chip)),
  }));
  return appendSavedGroupValues(priorities, sections).filter((section) => section.chips.length);
}

// Saved group values that aren't on the approved list (e.g. an older
// "Townhome" for a buyer) stay visible where they belong.
function appendSavedGroupValues(priorities, sections) {
  for (const section of sections) {
    const group = section.chips.find((chip) => chip.type === 'value')?.group;
    if (!group || !['preferredPropertyTypes', 'homeLayout'].includes(group)) continue;
    const shown = new Set(section.chips.map((chip) => chip.value));
    for (const choice of whatMattersGroups(priorities).find((entry) => entry.key === group)?.choices || []) {
      if (!shown.has(choice.value)) section.chips.push(value(group, choice.value, choice.label, null));
    }
  }
  return sections;
}

// Every other criterion currently offered for this search — kept available,
// never silently removed.
export function moreToConsider(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  const shown = whatMattersSections(priorities).flatMap((section) => section.chips);
  // Case-insensitive, so a canonical "Central air" never sits beside the
  // rental "Central air" chip.
  const inSections = new Set(shown.map((chip) => keyOf(chip).toLowerCase()));
  const unanswerable = new Set(UNANSWERABLE_RENTAL_OPTIONS.map((option) => option.key.toLowerCase()));
  const remaining = (items) => items.filter((item) => {
    const key = `${item.categoryKey}:${item.label}`.toLowerCase();
    if (inSections.has(key) || unanswerable.has(key)) return false;
    inSections.add(key);
    return true;
  });
  if (isRental(experience)) {
    const extra = remaining(RENTAL_MORE[experience]).map((chip) => withRentalDetails(experience, chip));
    // Everything Home to Rent already offered stays available.
    const earlier = experience === 'home_rent' ? remaining(flatOnboardingSuggestions(experience))
      .map((item) => withRentalDetails(experience, criterion(item.categoryKey, item.label, item.displayLabel, null))) : [];
    return [...extra, ...earlier];
  }
  return remaining(flatOnboardingSuggestions(experience))
    .map((item) => ({ ...criterion(item.categoryKey, item.label, item.displayLabel, null), kind: item.kind }));
}

// Every chip this kind of search offers in Step 4 (sections, then More).
export function offeredChips(raw) {
  const priorities = normalizePriorities(raw);
  return [...whatMattersSections(priorities).flatMap((section) => section.chips), ...moreToConsider(priorities)];
}

// The words a person chose a priority by, so Steps 5 and 6 use the same
// labels as Step 4 (e.g. "Great schools", not the stored "Reputable Schools").
// Anything without a chip keeps its existing display label.
export function chipLabels(raw) {
  const labels = new Map();
  for (const chip of offeredChips(raw)) if (chip.type === 'criterion') labels.set(keyOf(chip), chip.text);
  return labels;
}

const AFTER_TOUR = 'After you tour';

// Step 5/6 levels in Step 4's words: criteria use their chip text, groups
// their section title ("Property type" / "Building type"), and anything only
// judged in person is marked "After you tour".
export function onboardingPriorityLevels(raw) {
  const labels = chipLabels(raw);
  return priorityLevelsWithGroups(raw).map((level) => ({
    ...level,
    items: level.items.map((item) => ({
      ...item,
      displayLabel: labels.get(item.key) || item.displayLabel,
      qualifier: item.qualifier || (item.experiential ? AFTER_TOUR : null),
    })),
  }));
}

export function isChipSelected(raw, chip) {
  return chip.type === 'criterion' ? isCriterionSelected(raw, chip.categoryKey, chip.label) : isGroupValueSelected(raw, chip.group, chip.value);
}

export function chipKey(chip) {
  return keyOf(chip);
}

// "Picks": every selected criterion plus every chosen grouped option.
export function picksCount(raw) {
  const priorities = normalizePriorities(raw);
  const values = whatMattersGroups(priorities).reduce((sum, group) => sum + priorities[group.key].values.filter((entry) => entry !== 'No Preference').length, 0);
  return selectedPriorityCount(priorities) + values;
}

// Six-step Step 1: changing the kind of search keeps every answer that still
// applies — the Basics, every Step 4 pick the new kind of search also offers
// (at its saved level), compatible property types, and the person's own typed
// priorities. Only what no longer applies is removed, and it is returned so
// Step 1 can say exactly what changed (and offer Undo) instead of discarding
// it silently:
//   • picks the new kind of search doesn't offer (e.g. Garage for an apartment);
//   • group alternatives it doesn't offer (e.g. Ranch when renting);
//   • a lot size, which doesn't apply to an apartment.
export function switchSearchType(raw, choiceKey) {
  const before = normalizePriorities(raw);
  const beforeLabels = chipLabels(before);
  const beforeItems = priorityLevels(before).flatMap((level) => level.items);
  const beforeChips = offeredChips(before);
  let next = chooseSearchType(before, choiceKey, { presetPropertyType: false });

  const offered = new Map(offeredChips(next).filter((chip) => chip.type === 'criterion').map((chip) => [keyOf(chip).toLowerCase(), chip]));
  for (const item of beforeItems) {
    const chip = offered.get(item.key.toLowerCase());
    if (chip && !isCriterionSelected(next, chip.categoryKey, chip.label)) next = addCriterion(next, chip, item.tier);
  }

  const removed = [];
  const kept = new Set(priorityLevels(next).flatMap((level) => level.items).map((item) => item.key.toLowerCase()));
  for (const item of beforeItems) {
    if (!kept.has(item.key.toLowerCase())) removed.push(beforeLabels.get(item.key) || item.displayLabel);
  }

  const groupsBefore = new Map(whatMattersGroups(before).map((group) => [group.key, group]));
  const groupsAfter = new Map(whatMattersGroups(next).map((group) => [group.key, group]));
  for (const key of ['preferredPropertyTypes', 'homeLayout', 'homeCondition']) {
    const offeredValues = new Set((groupsAfter.get(key)?.choices || []).map((choice) => choice.value));
    const values = (next[key]?.values || []).filter((entry) => entry !== 'No Preference');
    const keep = values.filter((entry) => offeredValues.has(entry));
    const dropped = [...new Set([...(before[key]?.values || []), ...values])].filter((entry) => entry !== 'No Preference' && !keep.includes(entry));
    if (keep.length !== values.length) next = { ...next, [key]: { ...next[key], values: keep } };
    const labelOf = (entry) => beforeChips.find((chip) => chip.group === key && chip.value === entry)?.text
      || groupsBefore.get(key)?.choices.find((choice) => choice.value === entry)?.label || entry;
    removed.push(...dropped.map(labelOf));
  }

  if (choiceKey === 'apartment_rent' && String(next.lotSizeTarget?.value ?? '').trim()) {
    next = { ...next, lotSizeTarget: { ...next.lotSizeTarget, value: '' } };
    removed.push('Ideal lot size');
  }
  return { priorities: next, removed: [...new Set(removed)] };
}
