'use client';

import Onboarding, { SUPABASE_SERVICES } from './Onboarding';
import { createClient } from '@/lib/supabase/client';
import { saveIncompleteOnboardingPriorities } from '@/lib/supabase/collaboration';

const saveProgress = (_userId, progress) => saveIncompleteOnboardingPriorities(
  createClient(), progress.state.context.searchId, null, progress,
);

const guardedServices = {
  ...SUPABASE_SERVICES,
  savePriorities: (searchId, _userId, priorities) => saveIncompleteOnboardingPriorities(createClient(), searchId, priorities),
  saveProgress: (...args) => saveProgress(...args).catch(() => false),
  completeOnboarding: saveProgress,
};

export default function GuardedOwnerOnboarding(props) {
  return <Onboarding {...props} services={guardedServices} />;
}
