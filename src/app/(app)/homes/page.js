import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getHomesForUser } from '@/lib/supabase/collaboration';

export default async function HomesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
  ]);

  return (
    <>
      <PageIntro title="Homes" subtitle="Add homes you're considering and keep everything you know about them in one place." />
      <HomesBoard mode="homes" userId={user.id} searchId={search.id} initialHomes={homes} initialPriorities={normalizePriorities(priorities)} />
    </>
  );
}
