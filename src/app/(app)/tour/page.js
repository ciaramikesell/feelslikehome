import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import DecisionNav from '@/components/DecisionNav';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getHomesForUser } from '@/lib/supabase/collaboration';

export default async function TourPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
  ]);

  const hasFavorites = homes.some((h) => h.reaction === 'love' && !isArchivedStatus(h.status));
  const hasArchived = homes.some((h) => isArchivedStatus(h.status));

  return (
    <DecisionNav active="tour" hasFavorites={hasFavorites} hasArchived={hasArchived}>
      <PageIntro title="Want to Tour" subtitle="Homes you're interested enough to see in person." />
      <HomesBoard mode="tour" userId={user.id} searchId={search.id} initialHomes={homes} initialPriorities={normalizePriorities(priorities)} />
    </DecisionNav>
  );
}
