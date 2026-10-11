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

import { normalizePriorities } from './constants.js';
import { flatOnboardingSuggestions, ONBOARDING_SUGGESTIONS } from './onboarding.js';
import { isCriterionSelected, searchExperienceKey, selectedPriorityCount } from './searchProfile.js';
import { isGroupValueSelected, whatMattersGroups } from './whatMattersGroups.js';

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

  if (experience === 'apartment_rent') {
    // Apartments keep their own approved catalog, in the same chip style.
    return (ONBOARDING_SUGGESTIONS.apartment_rent || []).map(([title, items], index) => ({
      key: `apartment-${index}`,
      title,
      chips: items.map((item) => ({ ...criterion(item.categoryKey, item.label, item.displayLabel, null), kind: item.kind })),
    }));
  }

  const sections = SECTIONS.map((section) => ({
    ...section,
    chips: section.chips
      .filter(supported)
      .map((chip) => (chip.type === 'criterion' ? { ...chip, kind: offeredByKey.get(keyOf(chip)).kind } : chip)),
  }));
  // Saved group values that aren't on the approved list (e.g. an older
  // "Townhome" for a buyer) stay visible where they belong.
  for (const section of sections) {
    const group = section.chips.find((chip) => chip.type === 'value')?.group;
    if (!group || !['preferredPropertyTypes', 'homeLayout'].includes(group)) continue;
    const shown = new Set(section.chips.map((chip) => chip.value));
    for (const choice of whatMattersGroups(priorities).find((entry) => entry.key === group)?.choices || []) {
      if (!shown.has(choice.value)) section.chips.push(value(group, choice.value, choice.label, null));
    }
  }
  return sections.filter((section) => section.chips.length);
}

// Every other criterion currently offered for this search — kept available,
// never silently removed.
export function moreToConsider(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  if (experience === 'apartment_rent') return [];
  const inSections = new Set(whatMattersSections(priorities).flatMap((section) => section.chips.map(keyOf)));
  return flatOnboardingSuggestions(experience)
    .filter((item) => !inSections.has(`${item.categoryKey}:${item.label}`))
    .map((item) => ({ ...criterion(item.categoryKey, item.label, item.displayLabel, null), kind: item.kind }));
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
