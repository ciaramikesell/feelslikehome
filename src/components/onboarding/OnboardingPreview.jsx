'use client';

import { useMemo } from 'react';
import Onboarding from '@/components/onboarding/Onboarding';
import { normalizePriorities } from '@/lib/constants';
import { ONBOARDING_SUGGESTIONS, applySearchChoice } from '@/lib/onboarding';
import { beginOnboarding, onboardingStepsFor, CURRENT_ONBOARDING_VERSION } from '@/lib/onboardingFlow';
import { moveCriterion, toggleCriterion } from '@/lib/searchProfile';

// Fixtures for the development-only preview (src/app/dev/onboarding). Fixed ids
// and timestamps keep every render, and every screenshot, identical.
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SEARCH_ID = '00000000-0000-4000-8000-000000000002';
const OWNED_SEARCH_ID = '00000000-0000-4000-8000-000000000003';
const NOW = '2026-01-01T00:00:00.000Z';

function populatedPriorities() {
  let next = applySearchChoice(normalizePriorities({}), 'home_buy');
  next.budget = { ...next.budget, value: '650000' };
  next.bedsMin = { ...next.bedsMin, value: '3' };
  next.bathsMin = { ...next.bathsMin, value: '2' };
  next.sqftTarget = { ...next.sqftTarget, value: '1800' };
  next.lotSizeTarget = { ...next.lotSizeTarget, value: '0.25' };
  // The first two offered criteria of each group, then a deterministic spread
  // across the three levels so the Rank board shows all of them.
  const picked = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.slice(0, 2));
  for (const criterion of picked) next = toggleCriterion(next, criterion);
  picked.forEach((criterion, index) => {
    if (index % 3 === 0) next = moveCriterion(next, criterion.categoryKey, criterion.label, 'must');
    if (index % 3 === 2) next = moveCriterion(next, criterion.categoryKey, criterion.label, 'nice');
  });
  return next;
}

// In-memory stand-ins for every write <Onboarding> makes. state=error makes
// saving fail, so the real save-error path renders after the first change.
function previewServices(fail) {
  const settle = () => (fail ? Promise.reject(new Error('Preview save failure')) : Promise.resolve(true));
  return {
    savePriorities: settle,
    saveProgress: () => Promise.resolve(true),
    completeOnboarding: settle,
    setActiveSearch: settle,
    submitFeedback: () => Promise.resolve(true),
  };
}

export default function OnboardingPreview({ step = 'basics', state = 'empty', mode = 'account' }) {
  const shared = mode === 'shared';
  const fixture = useMemo(() => {
    const context = { searchId: SEARCH_ID, role: shared ? 'co_buyer' : 'owner' };
    const steps = onboardingStepsFor(CURRENT_ONBOARDING_VERSION, { context });
    const target = steps.includes(step) ? step : steps[0];
    const progress = beginOnboarding({
      storedState: { step: target, completed: steps.slice(0, steps.indexOf(target)), startedAt: NOW, context },
      storedVersion: CURRENT_ONBOARDING_VERSION,
      context,
      now: NOW,
    });
    return {
      progress,
      priorities: state === 'populated' || target !== 'basics' ? populatedPriorities() : normalizePriorities({}),
    };
  }, [step, state, shared]);
  const services = useMemo(() => previewServices(state === 'error'), [state]);

  return (
    <Onboarding
      key={`${step}:${state}:${mode}`}
      userId={USER_ID}
      searchId={SEARCH_ID}
      initialPriorities={fixture.priorities}
      initialProgress={fixture.progress}
      mode={shared ? 'shared_search_setup' : 'account'}
      ownerName={shared ? 'Ciara' : null}
      ownedSearchId={shared ? OWNED_SEARCH_ID : null}
      services={services}
    />
  );
}
