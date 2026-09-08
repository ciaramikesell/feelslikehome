import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import DecisionNav from '@/components/DecisionNav';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import {
  resolveActiveSearch, resolvePriorities, getHomesForUser, getParticipantStatusesForHomes,
  coBuyerArchivedSignal, deriveWantToTourState,
} from '@/lib/supabase/collaboration';
import { getCommuteDestinations } from '@/lib/commute/data';

export default async function TourPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes, commuteDestinations] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
    getCommuteDestinations(supabase, search.id, user.id),
  ]);

  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithSignal = homes.map((home) => {
    const perParticipant = statusesByHome.get(home.id) || [];
    const otherStatuses = perParticipant.filter((p) => p.userId !== user.id).map((p) => p.status);
    const isCollaborative = perParticipant.some((p) => p.userId !== user.id);
    return {
      ...home,
      coBuyerArchivedCount: coBuyerArchivedSignal(home.status, otherStatuses),
      ...(isCollaborative ? deriveWantToTourState(home.status, otherStatuses) : {}),
      isCollaborative,
    };
  });

  const hasFavorites = homes.some((h) => h.reaction === 'love' && !isArchivedStatus(h.status));
  const hasArchived = homes.some((h) => isArchivedStatus(h.status));

  return (
    <DecisionNav active="tour" hasFavorites={hasFavorites} hasArchived={hasArchived}>
      <PageIntro title="Want to Tour" subtitle="Homes you're interested enough to see in person." />
      <HomesBoard mode="tour" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} initialCommuteDestinations={commuteDestinations} />
    </DecisionNav>
  );
}
