import { defaultPriorities } from '../constants.js';
import { beginOnboarding, normalizeOnboardingState, onboardingStepsFor } from '../onboardingFlow.js';

export const DRAFT_TTL = 7 * 86400;
export const DRAFT_KEY = 'flh.guest-onboarding.v1';
export const GUEST_CONTINUE = '/guest/continue';
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const BINDING_COOKIE = '__Host-flh-guest-transfer';

export function freshDraft() {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const progress = beginOnboarding({ context: { searchId: id, role: 'owner' }, now, targetVersion: 4 });
  return { schema: 1, id, expires: Date.now() + DRAFT_TTL * 1000, priorities: defaultPriorities(), progress: progress.state };
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = raw.length <= 80_000 ? JSON.parse(raw) : null;
    const progress = normalizeOnboardingState(draft?.progress);
    if (draft?.schema === 1 && UUID.test(draft.id) && Number.isFinite(draft.expires) &&
        draft.expires > Date.now() && draft.expires <= Date.now() + DRAFT_TTL * 1000 &&
        draft.priorities && draft.progress?.schema === 1 && progress.context?.searchId === draft.id &&
        onboardingStepsFor(4, progress).includes(progress.step)) {
      return { ...draft, progress };
    }
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Unavailable or invalid browser storage is handled by the entry screen.
  }
  return null;
}

export function storeDraft(draft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function removeDraft(id) {
  if (loadDraft()?.id === id) localStorage.removeItem(DRAFT_KEY);
}

export function transferPayload(draft) {
  const { schema, step, completed, answers, skipped, startedAt } = draft.progress;
  const eligible = onboardingStepsFor(4, draft.progress);
  return { draftId: draft.id, priorities: draft.priorities, progress: {
    schema, step, answers, startedAt,
    completed: eligible.filter(key => completed.includes(key)),
    skipped: eligible.filter(key => skipped.includes(key)),
  } };
}
