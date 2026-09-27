import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import PlacesEditor from '@/components/PlacesEditor';
import { resolveActiveSearch, getCommuteDestinations, getSearchParticipantIds } from '@/lib/supabase/collaboration';

// My Search → Places that matter. Only the signed-in participant's own
// commute destinations (RLS additionally enforces user_id = auth.uid()).
export default async function PlacesPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
    const [destinations, participantIds] = await Promise.all([
      getCommuteDestinations(supabase, search.id, user.id),
      getSearchParticipantIds(supabase, search),
    ]);
    return <PlacesEditor searchId={search.id} userId={user.id} initialDestinations={destinations} canInvite={isOwner && participantIds.length < 2} />;
  });
}
