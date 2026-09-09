import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import { resolveActiveSearch, getAccessibleSearches, resolvePriorities } from '@/lib/supabase/collaboration';
import { normalizeSearchIntent } from '@/lib/searchIntent';
import AppShell from '@/components/AppShell';

export default async function AppGroupLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);
  if (!profile?.onboarding_complete) redirect('/onboarding');

  const { search } = await resolveActiveSearch(supabase, user.id);
  const [accessibleSearches, priorities] = await Promise.all([
    getAccessibleSearches(supabase, user.id),
    resolvePriorities(supabase, search, user.id),
  ]);
  const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || null;

  return (
    <AppShell userEmail={user.email} userId={user.id} accessibleSearches={accessibleSearches} activeSearchId={search.id} searchIntent={normalizeSearchIntent(priorities?.searchType)} appVersion={appVersion}>
      {children}
    </AppShell>
  );
}
