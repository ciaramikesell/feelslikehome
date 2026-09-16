import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import CoBuyerHomesLine from '@/components/CoBuyerHomesLine';
import { normalizePriorities } from '@/lib/constants';
import { homeVocabulary } from '@/lib/homePresentation';
import { resolveActiveSearch, resolvePriorities, resolveSharedFactPriorityAwareness, getHomesForUser, getParticipantStatusesForHomes, addCoBuyerPersonalSignals, getSearchParticipantIds, getCommuteDestinations, getSuggestions } from '@/lib/supabase/collaboration';

export default async function HomesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
  const statusesByHome = await getParticipantStatusesForHomes(supabase, search, homes);
  const homesWithSignal = addCoBuyerPersonalSignals(homes, statusesByHome, user.id);
  const normalizedPriorities = normalizePriorities(priorities);
  const vocabulary = homeVocabulary(normalizedPriorities);

  return (
    <main className="hh-homes-page">
      <div className="hh-homes-intro">
        <h1 className="hh-homes-purpose">Keep the homes you&apos;re considering in one place.</h1><p className="hh-homes-instructions">
          {vocabulary.apartment
            ? "Keep the properties you're considering in one place. Add them as you find them, then compare the property, the option you're considering, and how well each one fits what matters to you."
            : "Keep the homes you're considering in one place. Add them as you find them, then compare how each one lines up with what matters to you."}
        </p>
        <CoBuyerHomesLine searchId={search.id} userId={user.id} isOwner={isOwner} isCollaborative={isCollaborative} />
      </div>
      {suggestions.some((item) => item.status === 'pending' && !item.dispositions.some((row) => row.userId === user.id)) && <a className="hh-suggestions-entry" href="/homes/suggestions"><strong>{suggestions.find((item) => item.status === 'pending')?.suggestedByName} suggested {suggestions.filter((item) => item.status === 'pending' && !item.dispositions.some((row) => row.userId === user.id)).length} new {suggestions.filter((item) => item.status === 'pending' && !item.dispositions.some((row) => row.userId === user.id)).length === 1 ? 'home' : 'homes'} →</strong></a>}
      <HomesBoard mode="homes" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizedPriorities} initialCommuteDestinations={commuteDestinations} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} />
    </main>
  );
}
