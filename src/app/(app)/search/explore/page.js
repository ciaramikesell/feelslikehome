import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import ExplorePriorities from '@/components/explore/ExplorePriorities';
import { normalizePriorities } from '@/lib/constants';
import { exploreEntryStep } from '@/lib/explorePriorities';
import { onboardingV3Enabled } from '@/lib/featureFlags';
import { resolveActiveSearch, resolvePriorities } from '@/lib/supabase/collaboration';

export const metadata = { title: 'Explore My Priorities' };

// Explore My Priorities (Milestone 2). Part of Mobile Priority Onboarding V3,
// so it exists only while FLH_ONBOARDING_V3 is on; otherwise notFound() (Next's
// not-found page, streamed inside the app shell) and My Search shows no entry to it. Reads the active search and this participant's
// own priorities exactly as My Search does (resolveActiveSearch /
// resolvePriorities); the (app) layout has already required a signed-in,
// onboarded buyer with an active search.
export default async function ExplorePrioritiesPage({ searchParams }) {
  if (!onboardingV3Enabled()) notFound();
  const params = await searchParams;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search } = await resolveActiveSearch(supabase, user.id);
    const priorities = normalizePriorities(await resolvePriorities(supabase, search, user.id));
    return (
      <ExplorePriorities
        key={search.id}
        search={search}
        userId={user.id}
        initialPriorities={priorities}
        initialStep={exploreEntryStep(priorities, params?.category)}
      />
    );
  });
}
