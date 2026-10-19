import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import HomesBoard from '@/components/HomesBoard';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { floorPlansEnabled } from '@/lib/featureFlags';
import { loadFloorPlanCardState } from '@/lib/homeFloorPlans';
import {
  resolveActiveSearch, resolvePriorities, resolveSharedFactPriorityAwareness, getHomesForUser, getParticipantStatusesForHomes,
  addCoBuyerPersonalSignals, deriveWantToTourState, getSearchParticipantIds, getCommuteDestinations,
} from '@/lib/supabase/collaboration';

export default async function TourPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search } = await resolveActiveSearch(supabase, user.id);
    const [priorities, homes, sharedFactAwareness, commuteDestinations, participantIds] = await Promise.all([
      resolvePriorities(supabase, search, user.id),
      getHomesForUser(supabase, user.id, search.id),
      resolveSharedFactPriorityAwareness(supabase, search),
      getCommuteDestinations(supabase, search.id, user.id),
      getSearchParticipantIds(supabase, search),
    ]);

    const [statusesByHome, floorPlans] = await Promise.all([
      getParticipantStatusesForHomes(supabase, search, homes),
      floorPlansEnabled() ? loadFloorPlanCardState(supabase, { searchId: search.id, userId: user.id, homeIds: homes.map((home) => home.id) }) : null,
    ]);
    const homesWithPersonalSignals = addCoBuyerPersonalSignals(homes, statusesByHome, user.id);
    const homesWithSignal = homesWithPersonalSignals.map((home) => {
      return {
        ...home,
        ...(home.isCollaborative ? deriveWantToTourState(home, home.coBuyerWantsToTour ? [{ status: 'Want to Tour' }] : []) : {}),
      };
    });

    return (
      <main className="hh-collection-page">
        <PageIntro title="Want to Tour" subtitle="Homes that you or your collaborator are thinking about seeing in person." />
        <HomesBoard mode="tour" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} initialCommuteDestinations={commuteDestinations} sharedFactAwareness={sharedFactAwareness} isCollaborative={participantIds.length > 1} floorPlans={floorPlans} />
      </main>
    );
  });
}
