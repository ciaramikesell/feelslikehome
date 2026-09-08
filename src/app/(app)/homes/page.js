import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import CoBuyerHomesLine from '@/components/CoBuyerHomesLine';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getHomesForUser, getParticipantStatusesForHomes, addCoBuyerPersonalSignals, getSearchParticipantIds } from '@/lib/supabase/collaboration';

export default async function HomesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes, participantIds] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
    getSearchParticipantIds(supabase, search),
  ]);
  const isCollaborative = participantIds.length > 1;

  // "Archived by Co-Buyer" — only meaningful once a search actually has a
  // co-buyer; getParticipantStatusesForHomes itself is cheap/no-op otherwise.
  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithSignal = addCoBuyerPersonalSignals(homes, statusesByHome, user.id);

  return (
    <>
      <PageIntro title="Homes" subtitle="Add homes you're considering and keep everything you know about them in one place." />
      <CoBuyerHomesLine searchId={search.id} userId={user.id} isOwner={isOwner} isCollaborative={isCollaborative} />
      <HomesBoard mode="homes" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizePriorities(priorities)} />
    </>
  );
}
