// Participant-owned lifecycle transitions. Keeping these pure makes the board and
// detail views share exactly the same semantics.
export function hasToured(home) {
  return Boolean(home?.touredAt) || home?.status === 'Toured';
}

export function hasOutstandingWantToTour(home) {
  return home?.status === 'Want to Tour' && !hasToured(home);
}

export function toggleFavorite(home) {
  return { ...home, isFavorite: !Boolean(home.isFavorite) };
}

export function isFavoriteHome(home) {
  return Boolean(home?.isFavorite);
}

export function postTourVerdict(home) {
  return ['love', 'considering', 'not_for_me'].includes(home?.reaction) ? home.reaction : null;
}

export function applyPostTourVerdict(home, verdict, patch = {}, recordedAt = new Date().toISOString()) {
  const next = {
    ...home,
    ...patch,
    touredAt: home.touredAt || recordedAt,
    status: 'Saved',
    reaction: verdict,
  };
  if (verdict === 'love') next.isFavorite = true;
  return next;
}

export function archiveHome(home, reason = home.rejectionReason || '') {
  return { ...home, status: 'Archived', rejectionReason: reason };
}

export function restoreHome(home) {
  return { ...home, status: 'Saved', rejectionReason: '' };
}
