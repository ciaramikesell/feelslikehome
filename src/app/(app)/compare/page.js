import { createClient } from '@/lib/supabase/server';
import { getSearch, getHomes } from '@/lib/supabase/data';
import CompareBoard from '@/components/CompareBoard';

export default async function ComparePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);
  const homes = await getHomes(supabase, user.id);
  const activeHomes = homes.filter((h) => h.status !== 'Passed');

  return <CompareBoard homes={activeHomes} priorities={search.priorities} />;
}
