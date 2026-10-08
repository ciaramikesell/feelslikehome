import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import { normalizePriorities } from '@/lib/constants';
import { needsSharedSearchSetup, resolveOnboardingSearch, resolvePriorities } from '@/lib/supabase/collaboration';
import { beginOnboarding } from '@/lib/onboardingFlow';
import Onboarding from '@/components/onboarding/Onboarding';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);

  // The active decision-making search, not the account's owned search: an
  // invited co-buyer onboards into the shared search they just joined.
  const { search, role } = await resolveOnboardingSearch(supabase, user.id);
  // Finished accounts only come back here to set up their own preferences for
  // a shared search they joined as a co-buyer (same predicate as the (app)
  // layout gate, so the two can never disagree).
  if (profile?.onboarding_complete && !(await needsSharedSearchSetup(supabase, user.id, search, role === 'owner'))) redirect('/homes');
  const priorities = await resolvePriorities(supabase, search, user.id);

  // Resume where this person left off, against this search. Missing columns
  // (migration not yet applied) read as a fresh start, exactly as before.
  const progress = beginOnboarding({
    storedVersion: profile?.onboarding_version ?? null,
    storedState: profile?.onboarding_state ?? null,
    context: { searchId: search.id, role },
  });

  const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || null;
  return <Onboarding userId={user.id} searchId={search.id} initialPriorities={normalizePriorities(priorities)} initialProgress={progress} appVersion={appVersion} />;
}
