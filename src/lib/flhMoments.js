import { hasOutstandingWantToTour } from './lifecycle.js';

// FLH Moments are deliberately presentation-only conclusions. They consume only
// the current participant's state and the narrow booleans returned by the existing
// sanitized lifecycle-signal RPC; collaborator rows never reach this layer.
export function deriveFlhMoment(home, isCollaborative = Boolean(home?.isCollaborative)) {
  if (!home || !isCollaborative) return null;

  const mutualFavorite = Boolean(home.isFavorite && home.coBuyerFavorited);
  const bothWantToTour = Boolean(hasOutstandingWantToTour(home) && home.coBuyerWantsToTour);

  if (mutualFavorite && bothWantToTour) {
    return { kind: 'strong-shared-signal', label: "This one's standing out", hasEyes: true };
  }
  if (mutualFavorite) {
    return { kind: 'mutual-favorite', label: 'Mutual favorite', hasEyes: true };
  }
  if (bothWantToTour) {
    return { kind: 'both-want-to-tour', label: 'You both want to see this one', hasEyes: false };
  }
  return null;
}

