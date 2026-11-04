import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import HomesBoard from '@/components/HomesBoard';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { floorPlansEnabled } from '@/lib/featureFlags';
import { loadFloorPlanCardState } from '@/lib/homeFloorPlans';
import { resolveActiveSearch, resolvePriorities, resolveSharedFactPriorityAwareness, getHomesForUser, getParticipantStatusesForHomes, addCoBuyerPersonalSignals, getSearchParticipantIds, getCommuteDestinations } from '@/lib/supabase/collaboration';

export default async function ArchivePage() {
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
    const homesWithSignal = addCoBuyerPersonalSignals(homes, statusesByHome, user.id);

    return (
      <main className="hh-collection-page">
        <PageIntro title="Archived" subtitle="Homes you've set aside, with your thoughts saved in case you change your mind. Restore one anytime." />
        <HomesBoard mode="archive" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} initialCommuteDestinations={commuteDestinations} sharedFactAwareness={sharedFactAwareness} isCollaborative={participantIds.length > 1} floorPlans={floorPlans} />
      </main>
    );
  });
}
