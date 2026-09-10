import { createClient } from '@/lib/supabase/server';
import { PageIntro } from '@/components/ui';
import SavedHomesMap from '@/components/SavedHomesMap';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { currentDestinationCoordinates, currentHomeCoordinates } from '@/lib/commute';
import { resolveActiveSearch, resolvePriorities, getHomesForUser, getCommuteDestinations } from '@/lib/supabase/collaboration';

export default async function MapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const [homes, priorities, destinations] = await Promise.all([
    getHomesForUser(supabase, user.id, search.id),
    resolvePriorities(supabase, search, user.id),
    getCommuteDestinations(supabase, search.id, user.id),
  ]);
  const activeHomes = homes.filter((home) => !isArchivedStatus(home.status));
  const mapped = await Promise.all(activeHomes.map(async (home) => ({
    ...home,
    mapPosition: await currentHomeCoordinates(home),
  })));
  const mappedDestinations = await Promise.all(destinations.map(async (destination) => ({
    ...destination,
    mapPosition: await currentDestinationCoordinates(destination),
  })));

  return (
    <>
      <PageIntro title="Map" subtitle="See your homes and the places that matter to this search." />
      <SavedHomesMap homes={mapped} destinations={mappedDestinations} priorities={normalizePriorities(priorities)} />
    </>
  );
}
