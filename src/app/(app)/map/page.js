import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { PageIntro } from '@/components/ui';
import SavedHomesMap from '@/components/SavedHomesMap';
import { isArchivedStatus, normalizePriorities } from '@/lib/constants';
import { currentDestinationCoordinates, currentHomeCoordinates } from '@/lib/commute';
import { resolveActiveSearch, resolvePriorities, getHomesForUser, getCommuteDestinations, resolveCollaboratorSearchContext } from '@/lib/supabase/collaboration';

export default async function MapPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search } = await resolveActiveSearch(supabase, user.id);
    const [homes, priorities, destinations, collaboratorContext] = await Promise.all([
      getHomesForUser(supabase, user.id, search.id),
      resolvePriorities(supabase, search, user.id),
      getCommuteDestinations(supabase, search.id, user.id),
      resolveCollaboratorSearchContext(supabase, search),
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
    // Read-only on Map: this is the same collaborator relationship Search and
    // Compare already resolve through resolveCollaboratorSearchContext, not a
    // second identity/authorization path. Places stay attributed to their
    // owner and are never merged into the current user's editable list (see
    // CommuteDestinations, still scoped to searchId+userId for all writes).
    const mappedCollaboratorDestinations = await Promise.all(
      (collaboratorContext?.commuteDestinations || []).map(async (destination) => ({
        ...destination,
        mapPosition: await currentDestinationCoordinates(destination),
      }))
    );

    return (
      <>
        <div className="hh-map-page-intro">
          <PageIntro title="Neighborhood Map" subtitle="See your homes and the places that matter to this search." />
        </div>
        <SavedHomesMap
          homes={mapped}
          destinations={mappedDestinations}
          collaboratorDestinations={mappedCollaboratorDestinations}
          collaboratorName={collaboratorContext?.displayName || null}
          priorities={normalizePriorities(priorities)}
        />
      </>
    );
  });
}
