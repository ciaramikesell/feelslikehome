import { createClient } from '@/lib/supabase/server';
import { getSearch } from '@/lib/supabase/data';
import MySearchPanel from '@/components/MySearchPanel';

export default async function SearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);

  return <MySearchPanel searchId={search.id} initialPriorities={search.priorities} />;
}
