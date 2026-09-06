import { createClient } from '@/lib/supabase/server';
import MySearchPanel from '@/components/MySearchPanel';
import InviteCoBuyer from '@/components/InviteCoBuyer';
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
  const canInvite = isOwner && participantIds.length <= 1;

  return (
    <>
      <PageIntro title="My Search" subtitle="Review what you're looking for and what matters most to you." />
      {canInvite && <InviteCoBuyer searchId={search.id} userId={user.id} />}
      <div style={{ marginTop: 16 }}>
        <MySearchPanel search={search} userId={user.id} initialPriorities={normalizePriorities(priorities)} />
      </div>
    </>
  );
}
