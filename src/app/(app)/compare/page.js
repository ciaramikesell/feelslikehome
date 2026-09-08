import { createClient } from '@/lib/supabase/server';
import CompareBoard from '@/components/CompareBoard';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getHomesForUser, resolveCoBuyerComparePerspectives } from '@/lib/supabase/collaboration';

export default async function ComparePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
  ]);
  const activeHomes = homes.filter((h) => !isArchivedStatus(h.status));
  const coBuyerPerspectives = await resolveCoBuyerComparePerspectives(supabase, search, activeHomes.map((home) => home.id));

  return (
    <>
      <PageIntro title="Compare" subtitle="Put your top homes side by side and see which one fits you best." />
      <CompareBoard
        homes={activeHomes}
        priorities={normalizePriorities(priorities)}
        coBuyerPerspectives={Object.fromEntries(coBuyerPerspectives)}
      />
    </>
  );
}
