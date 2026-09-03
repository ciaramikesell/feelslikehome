import { createClient } from '@/lib/supabase/server';
import { getSearch, getHomes } from '@/lib/supabase/data';
import HomesBoard from '@/components/HomesBoard';

export default async function ArchivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);
  const homes = await getHomes(supabase, user.id);

  return <HomesBoard mode="archive" userId={user.id} searchId={search.id} initialHomes={homes} initialPriorities={search.priorities} />;
}
