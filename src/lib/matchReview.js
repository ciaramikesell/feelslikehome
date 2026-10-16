// Check the Match: a reading of the one canonical computeMatch result, plus the
// rules for where each priority's answer lives. Nothing here scores a home or
// changes a weight — the percentage, tiers and Unknown handling all come from
// computeMatch (src/lib/matching.js). This module only decides how each
// selected priority is answered and how the result is explained.

import {
  criterionDisplayLabel, foldLegacyCheckAliases, isExperientialCriterion, TIER_META, tourResponseOptions,
} from './constants.js';
import { SHARED_BOOLEAN_FACT_FIELDS, sharedFactAnswer, sharedFactValue } from './matching.js';

export const TIERS = Object.freeze([
  { key: 'must', title: 'Must-Haves', single: 'Must-Have' },
  { key: 'important', title: 'Important', single: 'Important' },
  { key: 'nice', title: 'Nice-to-Haves', single: 'Nice-to-Have' },
]);
const TIER_RANK = { must: 0, important: 1, nice: 2 };

// Where a priority's answer comes from:
//  - 'facts'    a property fact on Home Facts (budget, beds, garage, layout, …);
//               Match reads it directly, so there is no second answer to store.
//  - 'commute'  calculated from the buyer's saved places.
//  - 'shared'   a shared Yes / No property fact (Pets / Utilities / In-unit laundry).
//  - 'personal' this buyer's own Yes / No / Unknown (home_member_state.checks).
//  - 'tour'     judged in person; this buyer's own tour response (ratings).
//  - 'legacy'   an older 1–5 rating priority no current screen writes.
const FACT_KEYS = new Set([
  'budget', 'sqft', 'lotSize', 'beds', 'baths', 'preferredPropertyTypes',
  'homeLayout', 'homeCondition', 'primaryBedroomLocation', 'secondaryBedroomLocation', 'exterior:Garage',
]);

export function splitKey(key) {
  const separator = key.indexOf(':');
  return separator > 0 ? [key.slice(0, separator), key.slice(separator + 1)] : [null, key];
}

export function answerSource(criterion) {
  const { key } = criterion;
  if (FACT_KEYS.has(key)) return 'facts';
  if (key === 'location:Commute') return 'commute';
  if (SHARED_BOOLEAN_FACT_FIELDS[key]) return 'shared';
  const [categoryKey, label] = splitKey(key);
  if (criterion.objective) return 'personal';
  return categoryKey && isExperientialCriterion(categoryKey, label) ? 'tour' : 'legacy';
}

export function priorityLabel(criterion) {
  const [categoryKey] = splitKey(criterion.key);
  return categoryKey ? criterionDisplayLabel(categoryKey, criterion.label) : criterion.label;
}

// A criterion's state as computeMatch already decided it. Unknown is never a miss.
export function priorityState(criterion) {
  if (!criterion.evaluated) return 'unknown';
  if (criterion.met === null) return 'neutral';
  return criterion.met ? 'match' : 'mismatch';
}

// The stored answer the controls show (true / 'no' / undefined, or a tour value).
export function currentAnswer(home, criterion, searchType) {
  const source = answerSource(criterion);
  if (source === 'shared') return sharedFactAnswer(home, criterion.key);
  if (source === 'personal') return foldLegacyCheckAliases(home?.checks, searchType)[criterion.key];
  if (source === 'tour') {
    const value = home?.ratings?.[criterion.key];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

export function answerOptions(criterion) {
  const source = answerSource(criterion);
  if (source === 'personal' || source === 'shared') {
    return [{ value: true, label: 'Yes' }, { value: 'no', label: 'No' }, { value: undefined, label: 'Unknown' }];
  }
  if (source === 'tour') {
    const [categoryKey, label] = splitKey(criterion.key);
    return [...tourResponseOptions(categoryKey, label), { value: undefined, label: 'Unknown' }];
  }
  return [];
}

// The patch an answer writes, and through which path:
//  - personal / tour → { personal: { checks | ratings } }  (only this buyer's row)
//  - shared          → { shared: { [field]: value } }       (the shared home row)
// Choosing Unknown removes the answer. When an older alias of the same priority
// still holds a value, the canonical key is set to `false`, which Match already
// reads as Unknown, so the old answer cannot reappear.
export function answerPatch(home, criterion, value, searchType) {
  const source = answerSource(criterion);
  if (source === 'shared') return { shared: { [SHARED_BOOLEAN_FACT_FIELDS[criterion.key]]: sharedFactValue(value) } };
  if (source === 'personal') {
    const checks = { ...(home?.checks || {}) };
    if (value === undefined) {
      delete checks[criterion.key];
      if (foldLegacyCheckAliases(checks, searchType)[criterion.key] !== undefined) checks[criterion.key] = false;
    } else checks[criterion.key] = value;
    return { personal: { checks } };
  }
  if (source === 'tour') {
    const ratings = { ...(home?.ratings || {}) };
    if (value === undefined) delete ratings[criterion.key]; else ratings[criterion.key] = value;
    return { personal: { ratings } };
  }
  return null;
}

const byTier = (a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3);

// Everything the overview needs, read from the one match result.
export function matchOverview(match) {
  const all = (match?.allSelected || []).filter((criterion) => TIER_RANK[criterion.tier] !== undefined);
  const confirmed = all.filter((criterion) => criterion.evaluated);
  const unknown = all.filter((criterion) => !criterion.evaluated).sort(byTier);
  const mismatches = confirmed.filter((criterion) => criterion.met === false).sort(byTier);
  return {
    pct: match?.pct ?? null,
    total: all.length,
    confirmedCount: confirmed.length,
    unknownCount: unknown.length,
    unknown,
    matches: confirmed.filter((criterion) => criterion.met === true).sort(byTier),
    mismatches,
    neutral: confirmed.filter((criterion) => criterion.met === null),
    mustMisses: mismatches.filter((criterion) => criterion.tier === 'must'),
    mustUnknown: unknown.filter((criterion) => criterion.tier === 'must'),
    tiers: TIERS.map((tier) => ({ ...tier, items: all.filter((criterion) => criterion.tier === tier.key) })).filter((tier) => tier.items.length),
  };
}

// How the percentage is actually built, in plain words. It never implies that
// Unknown counts, and it says plainly that Nice-to-Haves move the score too.
export function scoreExplanation(overview) {
  const weights = `Must-Haves count ${TIER_META.must.weight}×, Important ${TIER_META.important.weight}×, Nice-to-Haves ${TIER_META.nice.weight}×`;
  if (overview.pct == null) {
    return overview.total
      ? 'There’s no Match yet: none of your priorities has a confirmed answer for this home. Unknown never counts against it.'
      : 'Add priorities in My Search to see how this home lines up.';
  }
  return `A weighted share of the ${overview.confirmedCount} ${overview.confirmedCount === 1 ? 'priority' : 'priorities'} with a confirmed answer (${weights}). The ${overview.unknownCount} still unknown ${overview.unknownCount === 1 ? 'isn’t' : 'aren’t'} counted either way, so the score can move as you learn more.`;
}

export function sourceNote(source) {
  return ({
    facts: 'From Home Facts',
    commute: 'From your saved places',
    shared: 'Shared property fact',
    tour: 'Best answered in person',
    legacy: 'Older rating',
  })[source] || null;
}
