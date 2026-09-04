import { createClient } from '@/lib/supabase/server';
import { getSearch, getHomes } from '@/lib/supabase/data';
import HomesBoard from '@/components/HomesBoard';
import { PageIntro } from '@/components/ui';

export default async function ArchivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);
  const homes = await getHomes(supabase, user.id);

  return (
    <>
      <PageIntro title="Archive" subtitle="Keep homes you've ruled out without losing your notes, ratings, or reasons for passing." />
      <HomesBoard mode="archive" userId={user.id} searchId={search.id} initialHomes={homes} initialPriorities={search.priorities} />
    </>
  );
}
