import { createClient } from '@/lib/supabase/server';
import { getSearch, getHomes } from '@/lib/supabase/data';
import HomesBoard from '@/components/HomesBoard';
import { PageIntro } from '@/components/ui';

export default async function HomesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);
  const homes = await getHomes(supabase, user.id);

  return (
    <>
      <PageIntro title="Homes" subtitle="Add homes you're considering and keep everything you know about them in one place." />
      <HomesBoard mode="homes" userId={user.id} searchId={search.id} initialHomes={homes} initialPriorities={search.priorities} />
    </>
  );
}
