import { createClient } from '@/lib/supabase/server';
import { getSearch, getHomes } from '@/lib/supabase/data';
import HomesBoard from '@/components/HomesBoard';
import { PageIntro } from '@/components/ui';

export default async function TourPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);
  const homes = await getHomes(supabase, user.id);

  return (
    <>
      <PageIntro title="Want to Tour" subtitle="Homes you're interested enough to see in person." />
      <HomesBoard mode="tour" userId={user.id} searchId={search.id} initialHomes={homes} initialPriorities={search.priorities} />
    </>
  );
}
