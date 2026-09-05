import { createClient } from '@/lib/supabase/server';
import { getSearch, getHomes } from '@/lib/supabase/data';
import CompareBoard from '@/components/CompareBoard';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';

export default async function ComparePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);
  const homes = await getHomes(supabase, user.id);
  const activeHomes = homes.filter((h) => !isArchivedStatus(h.status));

  return (
    <>
      <PageIntro title="Compare" subtitle="Put your top homes side by side and see which one fits you best." />
      <CompareBoard homes={activeHomes} priorities={normalizePriorities(search.priorities)} />
    </>
  );
}
