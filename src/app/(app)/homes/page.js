import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getHomesForUser, getParticipantStatusesForHomes, coBuyerArchivedSignal } from '@/lib/supabase/collaboration';

export default async function HomesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
  ]);

  // "Archived by Co-Buyer" — only meaningful once a search actually has a
  // co-buyer; getParticipantStatusesForHomes itself is cheap/no-op otherwise.
  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithSignal = homes.map((home) => {
    const perParticipant = statusesByHome.get(home.id) || [];
    const otherStatuses = perParticipant.filter((p) => p.userId !== user.id).map((p) => p.status);
    return { ...home, coBuyerArchivedCount: coBuyerArchivedSignal(home.status, otherStatuses) };
  });

  return (
    <>
      <PageIntro title="Homes" subtitle="Add homes you're considering and keep everything you know about them in one place." />
      <HomesBoard mode="homes" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} />
    </>
  );
}
