import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import MySearchPanel from '@/components/MySearchPanel';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getSearchParticipantIds, getCommuteDestinations, resolveCollaboratorSearchContext } from '@/lib/supabase/collaboration';

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
    const [priorities, participantIds, commuteDestinations, collaboratorContext] = await Promise.all([
      resolvePriorities(supabase, search, user.id),
      getSearchParticipantIds(supabase, search),
      getCommuteDestinations(supabase, search.id, user.id),
      resolveCollaboratorSearchContext(supabase, search),
    ]);
    // V1 is one owner + at most one member — the first non-owner participant,
    // if any, is the co-buyer this page's Remove action would target.
    const memberUserId = participantIds.find((id) => id !== search.user_id) || null;

    return (
      <>
        <PageIntro title="My Search" subtitle="Describe the home you want and what matters most. Feels Like Home uses the priorities you choose here — along with reliable property information — to calculate your personalized Match." />
        <MySearchPanel
          search={search}
          userId={user.id}
          isOwner={isOwner}
          participantCount={participantIds.length}
          memberUserId={memberUserId}
          initialPriorities={normalizePriorities(priorities)}
          initialCommuteDestinations={commuteDestinations}
          collaboratorContext={collaboratorContext}
          firstRun={params?.welcome === '1'}
        />
      </>
    );
  });
}
