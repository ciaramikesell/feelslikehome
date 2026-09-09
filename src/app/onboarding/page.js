import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getSearch } from '@/lib/supabase/data';
import { normalizePriorities } from '@/lib/constants';
import { getCommuteDestinations, resolvePriorities } from '@/lib/supabase/collaboration';
import Onboarding from '@/components/onboarding/Onboarding';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);
  if (profile?.onboarding_complete) redirect('/homes');

  const search = await getSearch(supabase, user.id);
  const [priorities, commuteDestinations] = await Promise.all([
    resolvePriorities(supabase, search, user.id),
    getCommuteDestinations(supabase, search.id, user.id),
  ]);

  return <Onboarding userId={user.id} searchId={search.id} initialPriorities={normalizePriorities(priorities)} initialCommuteDestinations={commuteDestinations} />;
}
