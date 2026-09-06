import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import { resolveActiveSearch, getAccessibleSearches } from '@/lib/supabase/collaboration';
import AppShell from '@/components/AppShell';

export default async function AppGroupLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);
  if (!profile?.onboarding_complete) redirect('/onboarding');

  const { search } = await resolveActiveSearch(supabase, user.id);
  const accessibleSearches = await getAccessibleSearches(supabase, user.id);

  return (
    <AppShell userEmail={user.email} userId={user.id} accessibleSearches={accessibleSearches} activeSearchId={search.id}>
      {children}
    </AppShell>
  );
}
