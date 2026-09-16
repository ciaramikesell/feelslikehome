import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getRealtorContributions, getRealtorSearchContext } from '@/lib/supabase/collaboration';
import { normalizePriorities, TOUR_RATING_KEY } from '@/lib/constants';
import { computeMatch } from '@/lib/matching';
import HomeDetail from '@/components/HomeDetail';

export default async function RealtorHomePage({ params }) {
  const { searchId, homeId } = await params;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const context = await getRealtorSearchContext(supabase, user.id, searchId);
    if (!context) notFound();
    const home = context.homes.find((candidate) => String(candidate.id) === homeId);
    if (!home) notFound();
    const realtorContributions = await getRealtorContributions(supabase, searchId, home.id);
    const owner = context.people.find((person) => person.relationship === 'Owner') || context.people[0];
    const state = context.states.find((row) => row.home_id === home.id && row.user_id === owner?.user_id);
    const priorities = normalizePriorities(context.priorities.find((row) => row.user_id === owner?.user_id)?.priorities);
    const coBuyer = context.people.find((person) => person.relationship === 'Co-buyer');
    const coState = context.states.find((row) => row.home_id === home.id && row.user_id === coBuyer?.user_id);
    const coPriorities = normalizePriorities(context.priorities.find((row) => row.user_id === coBuyer?.user_id)?.priorities);
    const coBuyerPerspective = coBuyer ? { match: computeMatch({ ...home, checks: coState?.checks || {}, ratings: coState?.ratings || {} }, coPriorities), overallFeeling: coState?.ratings?.[TOUR_RATING_KEY] || 0, differentTakes: [] } : null;
    const participantHome = { ...home, status: state?.status || 'Saved', touredAt: state?.toured_at || null, isFavorite: Boolean(state?.is_favorite), reaction: state?.reaction || null, rejectionReason: state?.rejection_reason || '', ratings: state?.ratings || {}, checks: state?.checks || {} };
    return <HomeDetail home={participantHome} priorities={priorities} userId={user.id} searchId={searchId} coBuyerPerspective={coBuyerPerspective} readOnly backHref={`/people/${searchId}`} isCollaborative={context.people.length > 1} realtorContributions={realtorContributions} />;
  });
}
