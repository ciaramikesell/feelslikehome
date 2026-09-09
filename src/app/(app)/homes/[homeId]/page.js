import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HomeDetail from '@/components/HomeDetail';
import { normalizePriorities } from '@/lib/constants';
import {
  getCommuteDestinations, getHomesForUser, resolveActiveSearch,
  resolveCoBuyerComparePerspectives, resolvePriorities,
  resolveSharedFactPriorityAwareness, getSearchParticipantIds,
  deriveWantToTourState, getParticipantStatusesForHomes,
} from '@/lib/supabase/collaboration';

export default async function HomeDetailPage({ params }) {
  const { homeId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  const [perspectives, participantStates] = await Promise.all([
    resolveCoBuyerComparePerspectives(supabase, search, [home.id]),
    getParticipantStatusesForHomes(supabase, search, [home]),
  ]);
  const otherStates = (participantStates.get(home.id) || []).filter((state) => state.userId !== user.id);
  const lifecycleSignals = deriveWantToTourState(home, otherStates);
  return <HomeDetail home={{ ...home, ...lifecycleSignals }} priorities={normalizePriorities(priorities)} commuteDestinations={commuteDestinations} coBuyerPerspective={perspectives.get(home.id) || null} sharedFactAwareness={sharedFactAwareness} userId={user.id} searchId={search.id} isCollaborative={participantIds.length > 1} />;
}
