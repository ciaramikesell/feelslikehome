// Add Home V3, phase 6 (docs/add-home-v3-phase6-ux-audit.md): which of this
// buyer's priorities are still open on a home, so Your Match can say so and
// offer one next step. DISPLAY ONLY: it reads the same per-buyer
// computeMatch result (never a second scoring path) and changes no score,
// weight, threshold or answer.
//
// "Can be settled before a tour" is Match Reveal's own definition
// (isCompletenessEligible): objective criteria, minus Commute. A criterion is
// settled when it is evaluated with a real Yes / No (met true or false), the
// same test matchCompleteness uses. Unknown is open; it never counts as No.
//
// Each open criterion says how the buyer can settle it:
//   'answer'  the buyer's own Yes / No (Match Criteria radios);
//   'fact'    a shared Home Fact (price, beds, layout, condition …).
// After-tour criteria (objective: false) are counted separately: they are
// not a to-do before visiting.
//
// `known` is how many priorities the Match % is actually computed from:
// computeMatch's scorable rows (evaluated, with a numeric score), tour and
// Commute included. So "Your 100% is based on 4 known priorities" describes
// the score exactly; it is never a second score.

import { isCompletenessEligible } from './matchReveal.js';

const TIER_ORDER = ['must', 'important', 'nice'];
const isSettled = (item) => item.evaluated && (item.met === true || item.met === false);

/**
 * @param match       computeMatch(...) for THIS buyer
 * @param answerable  Set of criterion keys the buyer answers Yes / No
 * @param factKeys    criterion keys settled by a Home Fact (FACT_LINKS)
 * @returns {{ eligible: number, settled: number, known: number, open: Array, afterTour: number, next: object|null }}
 */
export function matchProgress(match, { answerable = new Set(), factKeys = [] } = {}) {
  const rows = match?.allSelected || [];
  const eligible = rows.filter(isCompletenessEligible);
  const facts = new Set(factKeys);
  const open = eligible
    .filter((item) => !isSettled(item))
    .map((item) => ({ key: item.key, label: item.label, tier: item.tier, how: answerable.has(item.key) ? 'answer' : facts.has(item.key) ? 'fact' : null }))
    .filter((item) => item.how)
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  const afterTour = rows.filter((item) => !item.objective && !item.evaluated).length;
  const known = rows.filter((item) => item.evaluated && typeof item.score === 'number').length;
  return { eligible: eligible.length, settled: eligible.filter(isSettled).length, known, open, afterTour, next: open[0] || null };
}

/** Unanswered criteria per tier, for the tier headers ("1 unanswered"). */
export function openCountByTier(progress) {
  const counts = { must: 0, important: 0, nice: 0 };
  for (const item of progress?.open || []) if (item.tier in counts) counts[item.tier] += 1;
  return counts;
}

const priorities = (n) => `${n} known ${n === 1 ? 'priority' : 'priorities'}`;

/**
 * The one-line status under Your Match, in the buyer's words. It separates
 * the SCORE (what the % is based on) from what is still unanswered. `pct` is
 * computeMatch's own pct, passed through unchanged.
 */
export function matchProgressLine(progress, pct = null) {
  if (!progress || !progress.eligible) return '';
  const open = progress.open.length;
  const score = pct != null && progress.known ? `Your ${pct}% is based on ${priorities(progress.known)}.` : 'Nothing is known yet for your priorities, so there’s no % yet.';
  const rest = open ? ` ${open} ${open === 1 ? 'is' : 'are'} still unanswered.` : ' Everything you can check before a tour is answered.';
  const tour = progress.afterTour ? ` ${progress.afterTour} more ${progress.afterTour === 1 ? 'is' : 'are'} for after a tour.` : '';
  return `${score}${rest}${tour}`;
}

/** The shortcut's two short lines: the score with its basis, then what's unanswered. */
export function matchShortcutLines(progress, pct = null) {
  const known = progress?.known || 0;
  const main = pct != null && known ? `${pct}% on ${priorities(known)}` : 'No % yet';
  const open = progress?.open.length || 0;
  return { main, sub: open ? `${open} unanswered` : 'See breakdown' };
}
