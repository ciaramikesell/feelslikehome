// The optional "Home preferences" section of The Basics: one collapsed
// accordion, one compact row per topic. Pure and framework-free.
//
// Nothing here is a new kind of priority. Each option writes an existing one:
//
//   Home type   preferredPropertyTypes group  — alternatives, one importance
//   Layout      homeLayout group (Ranch / Two-Story / Split Level — alternatives)
//               + features:First-Floor Primary (its own criterion, so it can be
//                 combined with any layout, e.g. Two-Story with a first-floor primary)
//   Condition   homeCondition group — alternatives ("Move-in Ready or Renovation
//               Potential" means either would work)
//   Garage      exterior:Garage + exterior.garagePreference (Any / Attached / Detached)
//   Basement    features:Finished basement, features:Walkout basement — each its
//               own criterion, so "Finished + Walkout" means both
//   Yard        exterior:Fenced yard, exterior:Privacy Fencing (both may apply),
//               exterior:Unfenced Yard (never together with either fenced choice)
//
// Every chosen option starts as Important — the same default as a What Matters
// chip — and is ranked on Rank Priorities with everything else. Nothing starts
// as a Must-Have. An option that isn't chosen stays genuinely unset.

import {
  BUY_HOME_TYPE_LABELS, CONDITION_DISPLAY_LABELS, GARAGE_PREFERENCE_OPTIONS, HOME_PREFERENCE_CRITERIA, LAYOUT_DISPLAY_LABELS,
  criterionDisplayLabel, homePreferenceCriteriaFor, normalizePriorities,
} from './constants.js';
import { PROPERTY_TYPE_LABELS } from './searchIntent.js';
import { addCriterion, basicsFieldsFor, isCriterionSelected, moveCriterion, searchExperienceKey } from './searchProfile.js';
import { toggleGroupValue } from './whatMattersGroups.js';

const NO_PREFERENCE = 'No Preference';
const C = HOME_PREFERENCE_CRITERIA;
const criterionKey = ({ categoryKey, label }) => `${categoryKey}:${label}`;

const groupOption = (group, value, text) => ({ id: `${group}=${value}`, type: 'group', group, value, text });
const criterionOption = (criterion, text = criterionDisplayLabel(criterion.categoryKey, criterion.label)) => ({ id: criterionKey(criterion), type: 'criterion', criterion, text });
const garageOption = (key, text) => ({ id: `garage=${key}`, type: 'garage', value: key, text });

const GARAGE_TEXT = Object.freeze({ any: 'Any Garage', attached: 'Attached', detached: 'Detached' });

// Saved group values no longer offered (e.g. an older 'Townhome' or 'Other')
// stay visible and removable instead of silently disappearing.
function withSavedValues(priorities, group, options, labelFor) {
  const shown = new Set(options.map((option) => option.value));
  const saved = (priorities[group]?.values || []).filter((value) => value && value !== NO_PREFERENCE && !shown.has(value));
  return [...options, ...saved.map((value) => groupOption(group, value, labelFor(value)))];
}

const HOME_TYPE_VALUES = Object.freeze({ home_buy: ['house', 'condo', 'multifamily'], home_rent: ['house', 'townhome', 'condo'] });

// The rows this kind of search asks, in order. Apartment to Rent has none.
export function homePreferenceRows(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  const fields = basicsFieldsFor(experience);
  const typeLabel = (value) => (experience === 'home_buy' && BUY_HOME_TYPE_LABELS[value]) || PROPERTY_TYPE_LABELS[value] || value;
  const rows = [];
  if (HOME_TYPE_VALUES[experience]) {
    rows.push({
      key: 'homeType', label: 'Home type', mode: 'any',
      options: withSavedValues(priorities, 'preferredPropertyTypes', HOME_TYPE_VALUES[experience].map((value) => groupOption('preferredPropertyTypes', value, typeLabel(value))), typeLabel),
    });
  }
  if (fields.layout) {
    rows.push({
      key: 'layout', label: 'Layout', mode: 'any',
      options: [
        ...withSavedValues(priorities, 'homeLayout', ['Ranch / Single Story', 'Two Story', 'Split Level'].map((value) => groupOption('homeLayout', value, LAYOUT_DISPLAY_LABELS[value])), (value) => LAYOUT_DISPLAY_LABELS[value] || value),
        criterionOption(C.firstFloorPrimary, 'First-Floor Primary'),
      ],
    });
  }
  if (fields.condition) {
    rows.push({
      key: 'condition', label: 'Condition', mode: 'any',
      options: withSavedValues(priorities, 'homeCondition', Object.entries(CONDITION_DISPLAY_LABELS).map(([value, text]) => groupOption('homeCondition', value, text)), (value) => CONDITION_DISPLAY_LABELS[value] || value),
    });
  }
  const criteria = new Set(homePreferenceCriteriaFor(experience).map(criterionKey));
  if (criteria.has(criterionKey(C.garage))) {
    rows.push({ key: 'garage', label: 'Garage', mode: 'one', options: GARAGE_PREFERENCE_OPTIONS.map((option) => garageOption(option.key, GARAGE_TEXT[option.key])) });
  }
  if (criteria.has(criterionKey(C.finishedBasement))) {
    rows.push({ key: 'basement', label: 'Basement', mode: 'all', options: [criterionOption(C.finishedBasement, 'Finished'), criterionOption(C.walkoutBasement, 'Walkout')] });
  }
  if (criteria.has(criterionKey(C.fencedYard))) {
    rows.push({ key: 'yard', label: 'Yard', mode: 'all', options: [criterionOption(C.fencedYard, 'Fenced'), criterionOption(C.privacyFence, 'Privacy Fence'), criterionOption(C.unfencedYard, 'Unfenced')] });
  }
  return rows.map((row) => ({ ...row, options: row.options.map((option) => ({ ...option, selected: isHomePreferenceSelected(priorities, option) })) }));
}

export function isHomePreferenceSelected(raw, option) {
  const priorities = normalizePriorities(raw);
  if (option.type === 'group') return (priorities[option.group]?.values || []).includes(option.value);
  if (option.type === 'criterion') return isCriterionSelected(priorities, option.criterion.categoryKey, option.criterion.label);
  if (option.type === 'garage') return isCriterionSelected(priorities, 'exterior', 'Garage') && (priorities.exterior?.garagePreference || 'any') === option.value;
  return false;
}

const removeCriterion = (priorities, criterion) => (isCriterionSelected(priorities, criterion.categoryKey, criterion.label)
  ? moveCriterion(priorities, criterion.categoryKey, criterion.label, 'dontcare')
  : priorities);

// Chooses or clears one option. A newly chosen criterion starts as Important; an
// already-chosen one keeps its level. The only options that replace another are
// ones that genuinely can't both be true, and they sit in the same row:
//   • Garage is one choice — Any, Attached or Detached;
//   • Unfenced replaces Fenced / Privacy Fence, and either fenced choice
//     replaces Unfenced.
export function toggleHomePreference(raw, option) {
  let priorities = normalizePriorities(raw);
  const selected = isHomePreferenceSelected(priorities, option);
  if (option.type === 'group') return toggleGroupValue(priorities, option.group, option.value);

  if (option.type === 'garage') {
    if (selected) {
      priorities = moveCriterion(priorities, 'exterior', 'Garage', 'dontcare');
      return { ...priorities, exterior: { ...priorities.exterior, garagePreference: 'any' } };
    }
    if (!isCriterionSelected(priorities, 'exterior', 'Garage')) priorities = addCriterion(priorities, C.garage);
    return { ...priorities, exterior: { ...priorities.exterior, garagePreference: option.value } };
  }

  const { criterion } = option;
  if (selected) return moveCriterion(priorities, criterion.categoryKey, criterion.label, 'dontcare');
  if (criterionKey(criterion) === criterionKey(C.unfencedYard)) {
    priorities = removeCriterion(removeCriterion(priorities, C.fencedYard), C.privacyFence);
  } else if (criterionKey(criterion) === criterionKey(C.fencedYard) || criterionKey(criterion) === criterionKey(C.privacyFence)) {
    priorities = removeCriterion(priorities, C.unfencedYard);
  }
  return addCriterion(priorities, criterion);
}

// The collapsed accordion's summary: what's chosen, in each row's words.
// Alternatives read "Ranch or Two-Story"; combinations read "Finished + Walkout".
export function homePreferencesSummary(raw) {
  const rows = homePreferenceRows(raw);
  const parts = [];
  let count = 0;
  for (const row of rows) {
    const chosen = row.options.filter((option) => option.selected);
    if (!chosen.length) continue;
    count += chosen.length;
    if (row.key === 'garage') { parts.push(chosen[0].value === 'any' ? 'Garage' : `${chosen[0].text} garage`); continue; }
    const alternatives = chosen.filter((option) => option.type === 'group').map((option) => option.text);
    const combined = chosen.filter((option) => option.type === 'criterion')
      .map((option) => (row.key === 'yard' ? criterionDisplayLabel(option.criterion.categoryKey, option.criterion.label) : option.text));
    const text = [alternatives.join(' or '), ...combined].filter(Boolean).join(' + ');
    parts.push(row.key === 'basement' ? `${text} basement` : text);
  }
  return { count, parts, text: parts.join(' · ') };
}

// Criteria Home Preferences asks for this search, so What Matters doesn't list
// them a second time (e.g. under "Your own").
export function homePreferenceCriterionKeys(raw) {
  return new Set(homePreferenceCriteriaFor(searchExperienceKey(normalizePriorities(raw))).map(criterionKey));
}
