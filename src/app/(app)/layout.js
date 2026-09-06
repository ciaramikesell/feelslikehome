import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import { resolveActiveSearch, getAccessibleSearches, getSearchParticipantIds } from '@/lib/supabase/collaboration';
import AppShell from '@/components/AppShell';

export default async function AppGroupLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);
  if (!profile?.onboarding_complete) redirect('/onboarding');

  const { search } = await resolveActiveSearch(supabase, user.id);
  const [accessibleSearches, participantIds] = await Promise.all([
    getAccessibleSearches(supabase, user.id),
    getSearchParticipantIds(supabase, search),
  ]);
  const isShared = participantIds.length > 1;

  return (
    <AppShell userEmail={user.email} userId={user.id} accessibleSearches={accessibleSearches} activeSearchId={search.id} isShared={isShared}>
      {children}
    </AppShell>
  );
}
