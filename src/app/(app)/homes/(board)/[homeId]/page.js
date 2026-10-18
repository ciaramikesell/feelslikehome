import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import HomeOverlay from '@/components/HomeOverlay';
import {
  getHomesForUser, resolveActiveSearch, resolveCoBuyerComparePerspectives,
  deriveWantToTourState, getParticipantStatusesForHomes, getRealtorContributions,
} from '@/lib/supabase/collaboration';

// The home overlay over My Homes (the (board) layout). A real route, so Back,
// Forward, reload and shared links all reopen it. My Homes' own data
// (priorities, places, collaboration) comes from the layout; this page reads
// only the one home, fresh, plus what belongs to it alone.
//
// Legacy links keep working: ?section=facts and ?section=match open this same
// overlay (match scrolls to Your Match), ?section=tour opens its Tour Feedback
// view, and ?added= (from older builds of Add Home) is ignored.
const SECTIONS = new Set(['facts', 'match', 'tour']);
// Where Close returns when the overlay wasn't opened from the board itself.
const RETURN_PAGES = new Set(['tour', 'favorites', 'archive', 'compare', 'map']);

export default async function HomeOverlayPage({ params, searchParams }) {
  const { homeId } = await params;
  const query = (await searchParams) || {};
  const section = SECTIONS.has(query.section) ? query.section : 'facts';
  const from = RETURN_PAGES.has(query.from) ? query.from : null;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search } = await resolveActiveSearch(supabase, user.id);

    // Constrained to the active search and subject to normal RLS: a guessed id
    // from another search has no overlay.
    const [home] = await getHomesForUser(supabase, user.id, search.id, { homeId });
    if (!home) notFound();

    const [perspectives, participantStates, realtorContributions] = await Promise.all([
      resolveCoBuyerComparePerspectives(supabase, search, [home.id]),
      getParticipantStatusesForHomes(supabase, search, [home]),
      getRealtorContributions(supabase, search.id, home.id),
    ]);
    const signal = participantStates.get(home.id);
    const lifecycleSignals = deriveWantToTourState(home, signal?.coBuyerWantsToTour ? [{ status: 'Want to Tour' }] : []);
    return <HomeOverlay key={home.id} serverHome={{ ...home, ...lifecycleSignals }} coBuyerPerspective={perspectives.get(home.id) || null} realtorContributions={realtorContributions} section={section} returnTo={from ? `/${from}` : '/homes'} />;
  });
}
