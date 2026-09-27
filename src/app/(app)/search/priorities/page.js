import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import RankPrioritiesEditor from '@/components/RankPrioritiesEditor';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities } from '@/lib/supabase/collaboration';

// My Search → Rank Priorities. Reads and saves only the signed-in participant's
// own priorities for the active search (the same resolvePriorities/savePriorities
// path My Search has always used).
export default async function RankPrioritiesPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search } = await resolveActiveSearch(supabase, user.id);
    const priorities = await resolvePriorities(supabase, search, user.id);
    return <RankPrioritiesEditor search={search} userId={user.id} initialPriorities={normalizePriorities(priorities)} />;
  });
}
