// Which Match Criteria a buyer answers on the home workspace, and their current
// answer. Pure: shared by the MatchCriteria component and tests.
import { foldLegacyCheckAliases, getItemlistCategories, isExperientialCriterion, TOUR_RESPONSE } from './constants.js';
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

// In-person Match criteria ("Things to check in person" in Tour Feedback): the
// selected priorities that can only be judged by being there (Natural Light,
// Layout / Flow, Noise Level …). They are rows of the same computeMatch result
// and their answer is this buyer's own existing tour response in
// home_member_state.ratings[key], which both scorers already read: 'positive'
// scores 1, 'negative' 0, 'neutral' is answered but unscored, absent is Unknown.
// Nothing here scores, and answering never marks a home toured.
const IN_PERSON_ANSWERS = new Set([TOUR_RESPONSE.POSITIVE, TOUR_RESPONSE.NEUTRAL, TOUR_RESPONSE.NEGATIVE]);

export function inPersonCriteria(match) {
  return (match?.allSelected || []).filter((item) => {
    const separator = item.key.indexOf(':');
    return separator > 0 && isExperientialCriterion(item.key.slice(0, separator), item.label);
  });
}

// 'positive' / 'neutral' / 'negative', or undefined (Unknown). An older 1–5
// rating is not one of these; it still counts in Match until it is replaced.
export function inPersonAnswer(home, key) {
  const value = home?.ratings?.[key];
  return IN_PERSON_ANSWERS.has(value) ? value : undefined;
}

// Only this one key of this buyer's ratings changes; the post-tour survey
// (tour-v2:*), overall feeling and every other answer are carried as they are.
export function inPersonAnswerPatch(home, key, value) {
  const ratings = { ...(home?.ratings || {}) };
  if (value === undefined) delete ratings[key];
  else ratings[key] = value;
  return { ratings };
}
