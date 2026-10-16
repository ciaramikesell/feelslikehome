// Which Match Criteria a buyer answers on the home workspace, and their current
// answer. Pure: shared by the MatchCriteria component and tests.
import { foldLegacyCheckAliases, getItemlistCategories, isExperientialCriterion } from './constants.js';
import { SHARED_BOOLEAN_FACT_FIELDS, sharedFactAnswer, visibleOrderedItems } from './matching.js';

// The criteria a buyer can answer here: check-kind priorities whose Match state
// comes from an answer. Garage is scored from Home Facts' garage spaces and
// Commute from saved places, so both stay read-only here.
export function answerableCriteriaKeys(priorities) {
  const keys = new Set();
  getItemlistCategories(priorities.searchType).forEach((category) => {
    visibleOrderedItems(category, priorities).forEach((item) => {
      if (item.kind !== 'check' || isExperientialCriterion(category.key, item.label)) return;
      const key = `${category.key}:${item.label}`;
      if (key === 'exterior:Garage' || key === 'location:Commute') return;
      keys.add(key);
    });
  });
  return keys;
}

export function criterionAnswer(home, key, searchType) {
  if (SHARED_BOOLEAN_FACT_FIELDS[key]) return sharedFactAnswer(home, key);
  return foldLegacyCheckAliases(home.checks, searchType)[key];
}
