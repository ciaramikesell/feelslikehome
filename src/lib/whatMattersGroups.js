// Onboarding V2, Steps 4–5: home style, condition and property type as
// "What Matters" choices. Not a new priority system — each is one of the
// existing grouped preferences on the participant's priorities document:
//
//   homeLayout             { values: [...], tier }   (Ranch / Two Story / Other)
//   homeCondition          { values: [...], tier }   (New Construction / Move-In Ready / Renovation Potential)
//   preferredPropertyTypes { values: [...], tier }   (house / condo / multifamily;
//                                                     apartment / condo / townhome as
//                                                     an apartment's Building type)
//
// A group's values are ALTERNATIVES: computeMatch counts it as met when the
// home matches ANY chosen value, and Not evaluated (never a miss) when the
// home's value is unknown. The whole group has ONE importance level, so
// choosing House and Condo means "either works", never "must be both".
// Garage is not here: it is the existing exterior:Garage criterion, offered
// with the other Exterior & Property chips.

import { normalizePriorities } from './constants.js';
import { LAYOUT_DISPLAY_LABELS } from './constants.js';
import { CONDITION_CHOICES, LAYOUT_CHOICES, PRIORITY_LEVELS, basicsFieldsFor, homeTypeLabel, priorityLevels, propertyTypeChoicesFor, searchExperienceKey } from './searchProfile.js';

const NO_PREFERENCE = 'No Preference';

const GROUP_DEFS = Object.freeze({
  preferredPropertyTypes: { title: 'Home type', rankLabel: 'Home type', hint: 'Choose any that would work. A home only needs to be one of them.' },
  homeLayout: { title: 'Layout', rankLabel: 'Layout', hint: 'Choose any that would work. A home only needs to be one of them.' },
  homeCondition: { title: 'Condition', rankLabel: 'Condition', hint: 'Choose any that would work. A home only needs to match one.' },
});

// Apartment to Rent words the same group as the building.
const BUILDING_TYPE = Object.freeze({ title: 'Building type', rankLabel: 'Building type' });

export const groupValueLabel = (key, value, experience = null) => {
  if (key === 'preferredPropertyTypes') return homeTypeLabel(value, experience);
  return LAYOUT_DISPLAY_LABELS[value] || CONDITION_CHOICES.find((choice) => choice.value === value)?.label || value;
};
const labelFor = groupValueLabel;

// The groups offered for this kind of search (same rules as the Basics had).
// Values someone already saved that are no longer offered stay visible, so
// nothing they chose disappears.
export function whatMattersGroups(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  const fields = basicsFieldsFor(experience);
  const offered = {
    preferredPropertyTypes: propertyTypeChoicesFor(experience),
    homeLayout: fields.layout ? LAYOUT_CHOICES.map((choice) => choice.value) : [],
    homeCondition: fields.condition ? CONDITION_CHOICES.map((choice) => choice.value) : [],
  };
  return Object.entries(offered)
    .filter(([, values]) => values.length)
    .map(([key, values]) => {
      const saved = (priorities[key].values || []).filter((value) => value !== NO_PREFERENCE && !values.includes(value));
      return {
        key,
        ...GROUP_DEFS[key],
        ...(key === 'preferredPropertyTypes' && experience === 'apartment_rent' ? BUILDING_TYPE : {}),
        choices: [...values, ...saved].map((value) => ({ value, label: labelFor(key, value, experience) })),
      };
    });
}

export function isGroupValueSelected(raw, key, value) {
  return normalizePriorities(raw)[key].values.includes(value);
}

// Choosing a value adds it to the group's alternatives. A group that had no
// importance yet starts as Important, exactly like every other chip; one that
// already has an importance keeps it. Removing the last value leaves the
// group empty (Match ignores an empty group) without touching its importance.
export function toggleGroupValue(raw, key, value) {
  const priorities = normalizePriorities(raw);
  const group = priorities[key];
  const values = (group.values || []).filter((entry) => entry !== NO_PREFERENCE);
  const adding = !values.includes(value);
  const nextValues = adding ? [...values, value] : values.filter((entry) => entry !== value);
  const tier = adding && !PRIORITY_LEVELS.includes(group.tier) ? 'important' : group.tier;
  return { ...priorities, [key]: { ...group, values: nextValues, tier } };
}

// The groups as Step 5 ranking items: one item per group, labelled with its
// alternatives ("House or Condo"). Only groups with chosen values and an
// importance appear; a saved value with no importance is listed by
// unrankedGroups instead of being ranked for the person.
export function groupPriorityItems(raw) {
  const priorities = normalizePriorities(raw);
  return whatMattersGroups(priorities)
    .map((group) => {
      const values = priorities[group.key].values.filter((value) => value !== NO_PREFERENCE);
      return { group, values, tier: priorities[group.key].tier };
    })
    .filter(({ values, tier }) => values.length && PRIORITY_LEVELS.includes(tier))
    .map(({ group, values, tier }) => ({
      key: `group:${group.key}`,
      categoryKey: group.key,
      label: group.rankLabel,
      kind: 'group',
      group: true,
      displayLabel: group.rankLabel,
      qualifier: values.map((value) => labelFor(group.key, value, searchExperienceKey(priorities))).join(' or '),
      legacy: false,
      experiential: false,
      tier,
    }));
}

export function unrankedGroups(raw) {
  const priorities = normalizePriorities(raw);
  return whatMattersGroups(priorities)
    .filter((group) => priorities[group.key].values.some((value) => value !== NO_PREFERENCE) && !PRIORITY_LEVELS.includes(priorities[group.key].tier))
    .map((group) => group.key);
}

// Step 5 levels for the six-step flow: the existing criteria plus the groups.
export function priorityLevelsWithGroups(raw) {
  const groups = groupPriorityItems(raw);
  return priorityLevels(raw).map((level) => ({ ...level, items: [...level.items, ...groups.filter((item) => item.tier === level.tier)] }));
}

export function moveGroup(raw, key, tier) {
  const priorities = normalizePriorities(raw);
  return { ...priorities, [key]: { ...priorities[key], tier } };
}

export function selectedGroupCount(raw) {
  return groupPriorityItems(raw).length;
}
