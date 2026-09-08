import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import DecisionNav from '@/components/DecisionNav';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import {
  addCoBuyerPersonalSignals, getHomesForUser, getParticipantStatusesForHomes,
  resolveActiveSearch, resolvePriorities, resolveSharedFactPriorityAwareness,
} from '@/lib/supabase/collaboration';

export default async function FavoritesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, sharedFactAwareness, homes] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    resolveSharedFactPriorityAwareness(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
  ]);

  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithSignals = homes.map((home) => addCoBuyerPersonalSignals(
    home, statusesByHome.get(home.id) || [], user.id
  ));

  const hasFavorites = homesWithSignals.some((h) => h.reaction === 'love' && !isArchivedStatus(h.status));
  const hasArchived = homesWithSignals.some((h) => isArchivedStatus(h.status));

  return (
    <DecisionNav active="favorites" hasFavorites={hasFavorites} hasArchived={hasArchived}>
      <PageIntro title="Favorites" subtitle="The homes you toured and loved." />
      <HomesBoard mode="favorites" userId={user.id} searchId={search.id} initialHomes={homesWithSignals} initialPriorities={normalizePriorities(priorities)} sharedFactAwareness={sharedFactAwareness} />
    </DecisionNav>
  );
}
