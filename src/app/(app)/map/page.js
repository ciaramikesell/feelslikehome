import { createClient } from '@/lib/supabase/server';
import { PageIntro } from '@/components/ui';
import SavedHomesMap from '@/components/SavedHomesMap';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { currentHomeCoordinates } from '@/lib/commute';
import { resolveActiveSearch, resolvePriorities, getHomesForUser } from '@/lib/supabase/collaboration';

export default async function MapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [homes, priorities] = await Promise.all([
    getHomesForUser(supabase, user.id, search.id),
    resolvePriorities(supabase, search, user.id),
  ]);
  const activeHomes = homes.filter((home) => !isArchivedStatus(home.status));
  const mapped = await Promise.all(activeHomes.map(async (home) => ({
    ...home,
    mapPosition: await currentHomeCoordinates(home),
  })));

  return (
    <>
      <PageIntro title="Map" subtitle="See where the homes you're already considering are located." />
      <SavedHomesMap homes={mapped} priorities={normalizePriorities(priorities)} />
    </>
  );
}
