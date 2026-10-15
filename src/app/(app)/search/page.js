import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import MySearchPanel from '@/components/MySearchPanel';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getSearchParticipantIds, getCommuteDestinations, resolveCollaboratorSearchContext, getSearchPeople, listRealtorInvitations } from '@/lib/supabase/collaboration';

// Before 2026-10-15-buyer-realtor-management.sql is applied, get_search_people
// does not exist yet: show the buyers already known to this page (as before)
// rather than hiding Your People.
const isMissingFunction = (err) => err?.code === 'PGRST202' || err?.code === '42883' || /could not find the function|does not exist/i.test(err?.message || '');
function legacyPeople({ search, userId, participantIds, collaboratorContext }) {
  return participantIds.map((id) => ({
    userId: id,
    role: id === search.user_id ? 'owner' : 'co_buyer',
    displayName: id === userId ? 'You' : (collaboratorContext?.displayName || 'Your co-buyer'),
    isYou: id === userId,
  })).sort((a, b) => Number(b.isYou) - Number(a.isYou));
}

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
    // Your People is answered by the database for this exact search: it refuses
    // anyone who isn't a current buyer of it (null hides the section), and the
    // invitation list is empty until the 2026-10-15 migration is applied.
    const [priorities, participantIds, commuteDestinations, collaboratorContext, people, realtorInvitations] = await Promise.all([
      resolvePriorities(supabase, search, user.id),
      getSearchParticipantIds(supabase, search),
      getCommuteDestinations(supabase, search.id, user.id),
      resolveCollaboratorSearchContext(supabase, search),
      getSearchPeople(supabase, search.id).catch((err) => (isMissingFunction(err) ? undefined : null)),
      listRealtorInvitations(supabase, search.id).catch(() => []),
    ]);
    const visiblePeople = people === undefined ? legacyPeople({ search, userId: user.id, participantIds, collaboratorContext }) : people;
    // V1 is one owner + at most one member — the first non-owner participant,
    // if any, is the co-buyer this page's Remove action would target.
    const memberUserId = participantIds.find((id) => id !== search.user_id) || null;

    return (
      <MySearchPanel
        search={search}
        userId={user.id}
        isOwner={isOwner}
        participantCount={participantIds.length}
        memberUserId={memberUserId}
        initialPriorities={normalizePriorities(priorities)}
        initialCommuteDestinations={commuteDestinations}
        collaboratorContext={collaboratorContext}
        people={visiblePeople}
        realtorInvitations={realtorInvitations}
        firstRun={params?.welcome === '1'}
      />
    );
  });
}
