import { createClient } from '@/lib/supabase/server';
import CompareBoard from '@/components/CompareBoard';
import { PageIntro } from '@/components/ui';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, getHomesForUser, getCommuteDestinations, resolveCoBuyerComparePerspectives, resolveCollaboratorSearchContext } from '@/lib/supabase/collaboration';

export default async function ComparePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes, commuteDestinations] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
    getCommuteDestinations(supabase, search.id, user.id),
  ]);
  const activeHomes = homes.filter((h) => !isArchivedStatus(h.status));
  const [coBuyerPerspectives, collaboratorContext] = await Promise.all([
    resolveCoBuyerComparePerspectives(supabase, search, activeHomes.map((home) => home.id)),
    resolveCollaboratorSearchContext(supabase, search),
  ]);
  const collaboratorState = new Map((collaboratorContext?.homeStates || []).map((state) => [state.homeId, state]));
  const visiblePerspectives = Object.fromEntries([...coBuyerPerspectives].map(([homeId, perspective]) => [homeId, { ...perspective, state: collaboratorState.get(homeId) || null }]));

  return (
    <>
      <PageIntro title="Compare" subtitle="See how your serious contenders measure up on what matters to you." />
      <CompareBoard
        homes={activeHomes}
        priorities={normalizePriorities(priorities)}
        coBuyerPerspectives={visiblePerspectives}
        commuteDestinations={commuteDestinations}
      />
    </>
  );
}
