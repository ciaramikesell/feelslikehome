// Which Match Criteria a buyer answers on the home workspace, and their current
// answer. Pure: shared by the MatchCriteria component and tests.
import { foldLegacyCheckAliases, getItemlistCategories, isExperientialCriterion } from './constants.js';
import { SHARED_BOOLEAN_FACT_FIELDS, sharedFactAnswer, sharedFactValue, visibleOrderedItems } from './matching.js';

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

// true (Yes), 'no' (No) or undefined (Unknown). A historical boolean `false`
// is Unknown, exactly as computeMatch scores it.
export function criterionAnswer(home, key, searchType) {
  if (SHARED_BOOLEAN_FACT_FIELDS[key]) return sharedFactAnswer(home, key);
  const value = foldLegacyCheckAliases(home.checks, searchType)[key];
  return value === true || value === 'no' ? value : undefined;
}

// What an answer writes, and through which path:
//  - { shared: { field } }    the shared Pets / Utilities / In-Unit Laundry field
//  - { personal: { checks } } only this buyer's own checks
// Choosing Unknown removes the answer. If an older alias of the same priority
// (e.g. 'features:Home Office' for 'features:Home office') still holds a
// value, the canonical key is set to `false`, which Match reads as Unknown, so
// the old answer can't resurface through alias folding. Nothing is deleted.
export function criterionAnswerPatch(home, key, value, searchType) {
  const sharedField = SHARED_BOOLEAN_FACT_FIELDS[key];
  if (sharedField) return { shared: { [sharedField]: sharedFactValue(value) } };
  const checks = { ...(home.checks || {}) };
  if (value === undefined) {
    delete checks[key];
    if (foldLegacyCheckAliases(checks, searchType)[key] !== undefined) checks[key] = false;
  } else checks[key] = value;
  return { personal: { checks } };
}
