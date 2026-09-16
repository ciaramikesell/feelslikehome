import { createClient } from '@/lib/supabase/server';
import { resolveActiveSearch, resolvePriorities, getSuggestions } from '@/lib/supabase/collaboration';
import { normalizePriorities } from '@/lib/constants';
import SuggestionsBoard from '@/components/SuggestionsBoard';

export default async function SuggestionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [suggestions, priorities] = await Promise.all([getSuggestions(supabase, search.id), resolvePriorities(supabase, search, user.id)]);
  return <SuggestionsBoard suggestions={suggestions} userId={user.id} priorities={normalizePriorities(priorities)} />;
}
