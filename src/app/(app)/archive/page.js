import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import DecisionNav from '@/components/DecisionNav';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, resolveSharedFactPriorityAwareness, getHomesForUser, getParticipantStatusesForHomes, addCoBuyerPersonalSignals, getCommuteDestinations } from '@/lib/supabase/collaboration';

export default async function ArchivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes, sharedFactAwareness, commuteDestinations] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
    resolveSharedFactPriorityAwareness(supabase, search),
    getCommuteDestinations(supabase, search.id, user.id),
  ]);
  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithSignal = addCoBuyerPersonalSignals(homes, statusesByHome, user.id);

  const hasFavorites = homes.some((h) => h.reaction === 'love' && !isArchivedStatus(h.status));
  const hasArchived = homes.some((h) => isArchivedStatus(h.status));

  return (
    <DecisionNav active="archive" hasFavorites={hasFavorites} hasArchived={hasArchived}>
      <PageIntro title="Archived" subtitle="Homes you've ruled out, with your thoughts saved in case you change your mind." />
      <HomesBoard mode="archive" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} initialCommuteDestinations={commuteDestinations} sharedFactAwareness={sharedFactAwareness} />
    </DecisionNav>
  );
}
