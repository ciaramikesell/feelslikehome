import { createClient } from '@/lib/supabase/server';
import { PageIntro } from '@/components/ui';
import SavedHomesMap from '@/components/SavedHomesMap';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import {
  resolveActiveSearch, resolvePriorities, getHomesForUser,
  getParticipantStatusesForHomes, coBuyerArchivedSignal, isGloballyArchived,
} from '@/lib/supabase/collaboration';

export default async function MapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [priorities, homes] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getHomesForUser(supabase, user.id, search.id),
  ]);
  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);

  const activeHomes = homes.filter((home) => {
    if (isArchivedStatus(home.status)) return false;
    const statuses = (statusesByHome.get(home.id) || []).map((entry) => entry.status);
    return !isGloballyArchived(statuses);
  }).map((home) => {
    const participantStatuses = statusesByHome.get(home.id) || [];
    const otherStatuses = participantStatuses
      .filter((entry) => entry.userId !== user.id)
      .map((entry) => entry.status);
    return { ...home, coBuyerArchivedCount: coBuyerArchivedSignal(home.status, otherStatuses) };
  });

  return (
    <>
      <PageIntro title="Map" subtitle="See where the homes you're already considering are located." />
      <SavedHomesMap homes={activeHomes} priorities={normalizePriorities(priorities)} />
    </>
  );
}

