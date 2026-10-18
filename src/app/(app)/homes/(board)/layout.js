import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import HomesBoard from '@/components/HomesBoard';
import HomesWorkspace from '@/components/HomesWorkspace';
import CoBuyerHomesLine from '@/components/CoBuyerHomesLine';
import { homeVocabulary } from '@/lib/homePresentation';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities, resolveSharedFactPriorityAwareness, getHomesForUser, getParticipantStatusesForHomes, addCoBuyerPersonalSignals, getSearchParticipantIds, getCommuteDestinations, getSuggestions, resolveCollaboratorSearchContext } from '@/lib/supabase/collaboration';

// My Homes is a layout so it stays mounted under the home overlay
// (/homes/[homeId]): opening and closing a home never rebuilds the board, and
// a direct link or reload of a home URL shows My Homes behind it.
export default async function HomesLayout({ children }) {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
    const [priorities, homes, participantIds, sharedFactAwareness, commuteDestinations, suggestions] = await Promise.all([
      resolvePriorities(supabase, search, user.id),
      getHomesForUser(supabase, user.id, search.id),
      getSearchParticipantIds(supabase, search),
      resolveSharedFactPriorityAwareness(supabase, search),
      getCommuteDestinations(supabase, search.id, user.id),
      getSuggestions(supabase, search.id),
    ]);
    const isCollaborative = participantIds.length > 1;

    // "Archived by Co-Buyer" — only meaningful once a search actually has a
    // co-buyer; getParticipantStatusesForHomes itself is cheap/no-op otherwise.
    // The collaborator's display name only labels the toolbar's "Searching
    // together" avatars (the same read-only context My Search uses). It is never
    // needed to render homes, so a failure here degrades to a generic label.
    const [statusesByHome, collaboratorContext] = await Promise.all([
      getParticipantStatusesForHomes(supabase, search, homes),
      isCollaborative ? resolveCollaboratorSearchContext(supabase, search).catch(() => null) : null,
    ]);
    const homesWithSignal = addCoBuyerPersonalSignals(homes, statusesByHome, user.id);
    const normalizedPriorities = normalizePriorities(priorities);
    const outstandingSuggestions = suggestions.filter((item) => item.status === 'pending' && !item.dispositions.some((row) => row.userId === user.id));

    return (
      <HomesWorkspace initialHomes={homesWithSignal} priorities={normalizedPriorities} commuteDestinations={commuteDestinations} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} userId={user.id} searchId={search.id}>
        <main className="hh-homes-page">
          {/* The page title is the primary navigation's selected tab; this keeps a
              real heading for assistive technology without a visible page header. */}
          <h1 className="sr-only">My {homeVocabulary(normalizedPriorities).plural}</h1>
          {outstandingSuggestions.length > 0 && <a className="hh-suggestions-entry" href="/homes/suggestions"><strong>{outstandingSuggestions[0].suggestedByName} suggested {outstandingSuggestions.length} {outstandingSuggestions.length === 1 ? 'home' : 'homes'} →</strong></a>}
          <HomesBoard
            mode="homes" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizedPriorities} initialCommuteDestinations={commuteDestinations}
            sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative}
            collaborationSlot={<CoBuyerHomesLine searchId={search.id} userId={user.id} isOwner={isOwner} isCollaborative={isCollaborative} collaboratorName={collaboratorContext?.displayName || null} />}
          />
          <section className="hh-match-editorial">
            <div>
              <h2>How Match Scores Work</h2>
              <p>Each home is measured against your own Must Haves, Important features, Nice to Haves, and places that matter. When you&apos;re searching together, each person keeps their own Match — so you can see where your priorities line up and where they don&apos;t.</p>
            </div>
            <a className="hh-btn hh-btn-ghost" href="/search">Review My Search</a>
          </section>
        </main>
        {/* /homes renders nothing here; /homes/[homeId] renders the overlay. */}
        {children}
      </HomesWorkspace>
    );
  });
}
