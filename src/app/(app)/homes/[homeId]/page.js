import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import HomeDetail from '@/components/HomeDetail';
import { normalizePriorities } from '@/lib/constants';
import {
  getCommuteDestinations, getHomesForUser, resolveActiveSearch,
  resolveCoBuyerComparePerspectives, resolvePriorities,
  resolveSharedFactPriorityAwareness, getSearchParticipantIds,
  deriveWantToTourState, getParticipantStatusesForHomes,
  getRealtorContributions,
} from '@/lib/supabase/collaboration';

export default async function HomeDetailPage({ params }) {
  const { homeId } = await params;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search } = await resolveActiveSearch(supabase, user.id);

    // The homes query is constrained to the active search and remains subject to
    // normal RLS. A guessed id from another search therefore has no detail route.
    const [homes, priorities, commuteDestinations, sharedFactAwareness, participantIds] = await Promise.all([
      getHomesForUser(supabase, user.id, search.id),
      resolvePriorities(supabase, search, user.id),
      getCommuteDestinations(supabase, search.id, user.id),
      resolveSharedFactPriorityAwareness(supabase, search),
      getSearchParticipantIds(supabase, search),
    ]);
    const home = homes.find((candidate) => String(candidate.id) === homeId);
    if (!home) notFound();

    const [perspectives, participantStates, realtorContributions] = await Promise.all([
      resolveCoBuyerComparePerspectives(supabase, search, [home.id]),
      getParticipantStatusesForHomes(supabase, search, [home]),
      getRealtorContributions(supabase, search.id, home.id),
    ]);
    const signal = participantStates.get(home.id);
    const lifecycleSignals = deriveWantToTourState(home, signal?.coBuyerWantsToTour ? [{ status: 'Want to Tour' }] : []);
    return <HomeDetail home={{ ...home, ...lifecycleSignals }} priorities={normalizePriorities(priorities)} commuteDestinations={commuteDestinations} coBuyerPerspective={perspectives.get(home.id) || null} sharedFactAwareness={sharedFactAwareness} userId={user.id} searchId={search.id} isCollaborative={participantIds.length > 1} realtorContributions={realtorContributions} />;
  });
}
