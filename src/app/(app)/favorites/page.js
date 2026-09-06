import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import DecisionNav from '@/components/DecisionNav';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getHomesForUser, getParticipantStatusesForHomes, coBuyerArchivedSignal } from '@/lib/supabase/collaboration';

export default async function FavoritesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
  ]);

  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithSignal = homes.map((home) => {
    const perParticipant = statusesByHome.get(home.id) || [];
    const otherStatuses = perParticipant.filter((p) => p.userId !== user.id).map((p) => p.status);
    return { ...home, coBuyerArchivedCount: coBuyerArchivedSignal(home.status, otherStatuses) };
  });

  const hasFavorites = homes.some((h) => h.reaction === 'love' && !isArchivedStatus(h.status));
  const hasArchived = homes.some((h) => isArchivedStatus(h.status));

  return (
    <DecisionNav active="favorites" hasFavorites={hasFavorites} hasArchived={hasArchived}>
      <PageIntro title="Favorites" subtitle="The homes you toured and loved." />
      <HomesBoard mode="favorites" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} />
    </DecisionNav>
  );
}
