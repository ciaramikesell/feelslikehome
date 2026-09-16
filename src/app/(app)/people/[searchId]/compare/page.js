import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getRealtorSearchContext } from '@/lib/supabase/collaboration';
import { normalizePriorities, TOUR_RATING_KEY } from '@/lib/constants';
import { computeMatch } from '@/lib/matching';
import CompareBoard from '@/components/CompareBoard';

export default async function RealtorComparePage({ params }) {
  const { searchId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const context = await getRealtorSearchContext(supabase, user.id, searchId);
  if (!context) notFound();
  const owner = context.people.find((person) => person.relationship === 'Owner') || context.people[0];
  const coBuyer = context.people.find((person) => person.relationship === 'Co-buyer');
  const priorities = normalizePriorities(context.priorities.find((row) => row.user_id === owner?.user_id)?.priorities);
  const coBuyerPriorities = normalizePriorities(context.priorities.find((row) => row.user_id === coBuyer?.user_id)?.priorities);
  const activeSharedHomes = context.homes.filter((home) => {
    const states = context.states.filter((row) => row.home_id === home.id);
    return !(states.length > 0 && states.every((row) => row.status === 'Archived'));
  });
  const homes = activeSharedHomes.map((home) => {
    const state = context.states.find((row) => row.home_id === home.id && row.user_id === owner?.user_id);
    return { ...home, status: state?.status || 'Saved', isFavorite: Boolean(state?.is_favorite), reaction: state?.reaction || null, ratings: state?.ratings || {}, checks: state?.checks || {} };
  });
  const perspectives = coBuyer ? Object.fromEntries(homes.map((home) => {
    const state = context.states.find((row) => row.home_id === home.id && row.user_id === coBuyer.user_id);
    return [home.id, { match: computeMatch({ ...home, checks: state?.checks || {}, ratings: state?.ratings || {} }, coBuyerPriorities), overallFeeling: state?.ratings?.[TOUR_RATING_KEY] || 0, state: state ? { isFavorite: state.is_favorite, status: state.status, reaction: state.reaction } : null }];
  })) : {};
  return <main className="hh-realtor-workspace"><header className="hh-realtor-client-header"><Link href={`/people/${searchId}`}>← Client overview</Link><div><span>Buyer decision</span><h1>Compare contenders</h1><p>The buyer’s existing Match and known facts—never a Realtor score.</p></div></header><CompareBoard homes={homes} priorities={priorities} coBuyerPerspectives={perspectives} readOnly basePath={`/people/${searchId}/homes`} /></main>;
}
