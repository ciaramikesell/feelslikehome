// Match Reveal (docs/match-reveal.md): once a buyer has gathered 75% of the
// details that matter to them on a home, their real Match % is revealed once.
//
// Completeness is NOT Match. It reads the same per-participant computeMatch
// result (never a second scoring path) and asks only: of the criteria this
// buyer selected that can be settled before a tour, how many are settled?
//
//   eligible   allSelected entries that are `objective` — Home Facts targets
//              (budget, size, beds, baths, lot, property type, layout,
//              condition, bedroom locations) and Yes / No criteria (their own
//              answer, a Home Facts-derived answer, or a shared rental fact).
//              Excluded: in-person / tour criteria and star ratings
//              (objective: false), which cannot be settled before visiting,
//              and Commute, which the app computes from saved destinations and
//              the buyer cannot answer.
//   determined evaluated with a real Yes / No / score (met is true or false).
//              Unknown never counts; a neutral response never counts.
//
// The reveal needs at least MIN_ELIGIBLE eligible criteria, so a home with
// almost nothing selected can never "complete" trivially.

import { mustHaveStatus } from './matching.js';

export const REVEAL_THRESHOLD = 75;
// Confetti follows the buyer's real Match %, not completeness.
export const CONFETTI_ABOVE = 85;
export const MIN_ELIGIBLE = 3;
const EXCLUDED_KEYS = new Set(['location:Commute']);

export function isCompletenessEligible(criterion) {
  return Boolean(criterion?.objective) && !EXCLUDED_KEYS.has(criterion.key);
}

/** @returns {{ eligible: number, determined: number, pct: number, unlocked: boolean }} */
export function matchCompleteness(match) {
  const eligible = (match?.allSelected || []).filter(isCompletenessEligible);
  const determined = eligible.filter((criterion) => criterion.evaluated && (criterion.met === true || criterion.met === false)).length;
  // Floor, so 74.9% is never shown (or treated) as 75%.
  const pct = eligible.length ? Math.floor((determined / eligible.length) * 100) : 0;
  return { eligible: eligible.length, determined, pct, unlocked: eligible.length >= MIN_ELIGIBLE && determined * 100 >= REVEAL_THRESHOLD * eligible.length };
}

// Only a save that takes this buyer's completeness from locked to unlocked.
export function crossedRevealThreshold(before, after) {
  return Boolean(after?.unlocked) && !before?.unlocked;
}

// Copy follows the real Match % (never adjusted to fit a band). Confetti is the
// Match score's alone (above 85%); the words still name a missed Must Have or
// unconfirmed ones, and never call a home perfect or certain.
export function revealCopy(match, completeness) {
  const pct = match?.pct;
  const must = mustHaveStatus(match);
  const missedMust = must.missed > 0;
  const unknownMust = must.unknown > 0;
  const progress = `You’ve gathered ${completeness.pct}% of the details that matter to you${completeness.pct < 100 ? ', and a few are still worth confirming' : ''}.`;
  const celebrate = pct != null && pct > CONFETTI_ABOVE;
  if (pct == null) return { band: 'none', headline: 'Here’s where it stands.', body: 'Open the breakdown to see how it lines up.', progress, celebrate: false };
  if (pct > CONFETTI_ABOVE) {
    if (missedMust) return { band: 'high', headline: 'Well, hello there!', body: 'There’s a lot to love here, though it misses a Must Have, so weigh that carefully.', progress, celebrate };
    if (unknownMust) return { band: 'high', headline: 'Well, hello there!', body: 'There’s a lot to love so far. A few Must Haves still need confirming.', progress, celebrate };
    return { band: 'high', headline: 'Well, hello there!', body: 'It lines up with nearly everything you told us matters.', progress, celebrate };
  }
  if (pct >= 75) {
    if (missedMust) return { band: 'good', headline: 'There’s something here!', body: 'A lot lines up, though it misses a Must Have worth weighing.', progress, celebrate };
    if (unknownMust) return { band: 'good', headline: 'There’s something here!', body: 'A lot lines up so far, with a few Must Haves still to confirm.', progress, celebrate };
    return { band: 'good', headline: 'There’s something here!', body: 'A lot lines up, with a few things to weigh.', progress, celebrate };
  }
  if (pct >= 50) return { band: 'mixed', headline: 'A little give and take.', body: 'Some of what matters lines up and some doesn’t. The breakdown shows which.', progress, celebrate };
  return { band: 'low', headline: 'Not quite your match?', body: 'Fewer of your priorities line up here. The breakdown shows exactly where.', progress, celebrate };
}
