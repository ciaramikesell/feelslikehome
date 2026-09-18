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
  const { noteEntry, ...personalPatch } = patch;
  const notes = appendPostTourNote(home.notes, noteEntry);
  const next = {
    ...home,
    ...personalPatch,
    ...(notes !== home.notes ? { notes } : {}),
    touredAt: home.touredAt || recordedAt,
    reaction: verdict,
  };
  return next;
}

export function appendPostTourNote(existing, entry) {
  const previous = (existing || '').trim();
  const addition = (entry || '').trim();
  if (!addition) return existing || '';
  if (!previous) return addition;
  return `${previous}\n\n${addition}`;
}

export function archiveHome(home, reason = home.rejectionReason || '') {
  return { ...home, status: 'Archived', rejectionReason: reason };
}

export function restoreHome(home) {
  return { ...home, status: 'Saved', rejectionReason: '' };
}
