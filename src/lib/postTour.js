// The one canonical reading of a participant's post-tour take: the Home "Big 4"
// in-person impressions, the overall reaction, and whether the home has been
// toured. Every surface (Tour, Home Detail, Compare, My Homes) reads it from
// here, from the participant's own personal state — never from Match.
//
// Post-tour answers are stored in the participant's `ratings` under tour-v2:*
// keys (strings 'positive' | 'neutral' | 'negative'). They are deliberately not
// Match criteria: computeMatch only walks the participant's ranked priorities.

import { hasToured, postTourVerdict } from './lifecycle.js';

export const POST_TOUR_EVALUATIONS = Object.freeze([
  Object.freeze({ key: 'tour-v2:curb_appeal', label: 'Curb Appeal' }),
  Object.freeze({ key: 'tour-v2:layout', label: 'Layout' }),
  Object.freeze({ key: 'tour-v2:privacy', label: 'Privacy' }),
  Object.freeze({ key: 'tour-v2:neighborhood', label: 'Neighborhood' }),
]);

export const TOUR_RESPONSES = Object.freeze([
  Object.freeze({ value: 'negative', label: 'Didn’t like it' }),
  Object.freeze({ value: 'neutral', label: 'Neutral' }),
  Object.freeze({ value: 'positive', label: 'Loved it' }),
]);

export const REACTION_LABELS = Object.freeze({
  love: 'Love it',
  considering: 'Still considering',
  not_for_me: 'Rule this one out',
});

export function reactionLabel(reaction) {
  return REACTION_LABELS[reaction] || null;
}

export function postTourEvaluationLabel(key) {
  return POST_TOUR_EVALUATIONS.find((item) => item.key === key)?.label || null;
}

export function postTourSummary(home) {
  const ratings = home?.ratings || {};
  const impressions = POST_TOUR_EVALUATIONS
    .map((item) => ({ ...item, response: ['positive', 'neutral', 'negative'].includes(ratings[item.key]) ? ratings[item.key] : null }))
    .filter((item) => item.response);
  const verdict = postTourVerdict(home);
  const toured = hasToured(home);
  return {
    toured,
    touredAt: home?.touredAt || null,
    verdict,
    verdictLabel: reactionLabel(verdict),
    impressions,
    liked: impressions.filter((item) => item.response === 'positive'),
    neutral: impressions.filter((item) => item.response === 'neutral'),
    disliked: impressions.filter((item) => item.response === 'negative'),
    // Toured, but this participant hasn't recorded how it felt yet.
    needsTake: toured && !verdict,
  };
}
