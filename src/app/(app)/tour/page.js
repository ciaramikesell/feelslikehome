import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import DecisionNav from '@/components/DecisionNav';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import {
  resolveActiveSearch, resolvePriorities, resolveSharedFactPriorityAwareness, getHomesForUser, getParticipantStatusesForHomes,
  addCoBuyerPersonalSignals, deriveWantToTourState, getSearchParticipantIds, getCommuteDestinations,
} from '@/lib/supabase/collaboration';

export default async function TourPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes, sharedFactAwareness, commuteDestinations, participantIds] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
    resolveSharedFactPriorityAwareness(supabase, search),
    getCommuteDestinations(supabase, search.id, user.id),
    getSearchParticipantIds(supabase, search),
  ]);

  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithPersonalSignals = addCoBuyerPersonalSignals(homes, statusesByHome, user.id);
  const homesWithSignal = homesWithPersonalSignals.map((home) => {
    const perParticipant = statusesByHome.get(home.id) || [];
    const otherStates = perParticipant.filter((p) => p.userId !== user.id);
    const isCollaborative = perParticipant.some((p) => p.userId !== user.id);
    return {
      ...home,
      ...(isCollaborative ? deriveWantToTourState(home, otherStates) : {}),
      isCollaborative,
    };
  });

  const hasFavorites = homes.some((h) => h.isFavorite && !isArchivedStatus(h.status));
  const hasArchived = homes.some((h) => isArchivedStatus(h.status));

  return (
    <DecisionNav active="tour" hasFavorites={hasFavorites} hasArchived={hasArchived}>
      <PageIntro title="Want to Tour" subtitle="Homes that you or your co-buyer are thinking about seeing in person." />
      <HomesBoard mode="tour" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} initialCommuteDestinations={commuteDestinations} sharedFactAwareness={sharedFactAwareness} isCollaborative={participantIds.length > 1} />
    </DecisionNav>
  );
}
