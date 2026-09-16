import { createClient } from '@/lib/supabase/server';
import HomesBoard from '@/components/HomesBoard';
import CoBuyerHomesLine from '@/components/CoBuyerHomesLine';
import { normalizePriorities } from '@/lib/constants';
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
  const outstandingSuggestions = suggestions.filter((item) => item.status === 'pending' && !item.dispositions.some((row) => row.userId === user.id));

  return (
    <main className="hh-homes-page">
      <div className="hh-homes-intro">
        <h1 className="hh-homes-purpose">My Homes</h1>
        <p className="hh-homes-instructions">Paste Zillow, Realtor.com, Trulia, or other listings to score them against what matters to you.</p>
        <CoBuyerHomesLine searchId={search.id} userId={user.id} isOwner={isOwner} isCollaborative={isCollaborative} />
      </div>
      {outstandingSuggestions.length > 0 && <a className="hh-suggestions-entry" href="/homes/suggestions"><strong>{outstandingSuggestions[0].suggestedByName} suggested {outstandingSuggestions.length} {outstandingSuggestions.length === 1 ? 'home' : 'homes'} →</strong></a>}
      <HomesBoard mode="homes" userId={user.id} searchId={search.id} initialHomes={homesWithSignal} initialPriorities={normalizedPriorities} initialCommuteDestinations={commuteDestinations} sharedFactAwareness={sharedFactAwareness} isCollaborative={isCollaborative} />
      <section className="hh-match-editorial">
        <div>
          <h2>How Match Scores Work</h2>
          <p>Each home is measured against your own Must Haves, Important features, Nice to Haves, and places that matter. When you&apos;re searching together, each person keeps their own Match — so you can see where your priorities line up and where they don&apos;t.</p>
        </div>
        <a className="hh-btn hh-btn-ghost" href="/search">Review My Criteria</a>
      </section>
    </main>
  );
}
