import { createClient } from '@/lib/supabase/server';
import MySearchPanel from '@/components/MySearchPanel';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getSearchParticipantIds } from '@/lib/supabase/collaboration';

export default async function SearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
  const [priorities, participantIds] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getSearchParticipantIds(supabase, search),
  ]);
  // V1 is one owner + at most one member — the first non-owner participant,
  // if any, is the co-buyer this page's Remove action would target.
  const memberUserId = participantIds.find((id) => id !== search.user_id) || null;

  // TEMPORARY DIAGNOSTIC — Phase 7 runtime trace, remove after root cause confirmed.
  console.log('[Phase7 search/page]', {
    userId: user.id,
    searchId: search?.id,
    searchOwnerId: search?.user_id,
    isOwner,
    participantIds,
    participantCount: participantIds?.length,
    memberUserId,
  });

  return (
    <>
      <PageIntro title="My Search" subtitle="Review what you're looking for and what matters most to you." />
      <MySearchPanel
        search={search}
        userId={user.id}
        isOwner={isOwner}
        participantCount={participantIds.length}
        memberUserId={memberUserId}
        initialPriorities={normalizePriorities(priorities)}
      />
    </>
  );
}
