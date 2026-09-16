import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { resolveActiveSearch, resolvePriorities, getSuggestions } from '@/lib/supabase/collaboration';
import { normalizePriorities } from '@/lib/constants';
import SuggestionsBoard from '@/components/SuggestionsBoard';

export default async function SuggestionsPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search } = await resolveActiveSearch(supabase, user.id);
    const [suggestions, priorities] = await Promise.all([getSuggestions(supabase, search.id), resolvePriorities(supabase, search, user.id)]);
    return <SuggestionsBoard suggestions={suggestions} userId={user.id} priorities={normalizePriorities(priorities)} />;
  });
}
