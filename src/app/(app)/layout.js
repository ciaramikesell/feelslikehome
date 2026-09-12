import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import { resolveActiveSearch, getAccessibleSearches, resolvePriorities } from '@/lib/supabase/collaboration';
import { normalizeSearchIntent } from '@/lib/searchIntent';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';
import AppShell from '@/components/AppShell';

// A signed-out or not-yet-onboarded visitor to a route like `/homes?url=...`
// (the share-intake entry point) must land back on that exact destination
// once they've signed in / finished onboarding — otherwise a shared listing
// URL is silently lost and has to be re-shared. middleware.js hands the
// current path+query down via this header (layouts don't otherwise get it);
// sanitizeRedirectPath keeps it to a same-origin relative path only, so this
// can never become an open redirect.
async function currentPathForRedirect() {
  const requestHeaders = await headers();
  return sanitizeRedirectPath(requestHeaders.get('x-pathname'));
}

function withRedirectParam(path, destination) {
  return destination ? `${path}?redirect=${encodeURIComponent(destination)}` : path;
}

export default async function AppGroupLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(withRedirectParam('/auth/sign-in', await currentPathForRedirect()));

  const profile = await getProfile(supabase, user.id);
  if (!profile?.onboarding_complete) redirect(withRedirectParam('/onboarding', await currentPathForRedirect()));

  const { search } = await resolveActiveSearch(supabase, user.id);
  const [accessibleSearches, priorities] = await Promise.all([
    getAccessibleSearches(supabase, user.id),
    resolvePriorities(supabase, search, user.id),
  ]);
  const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || null;

  return (
    <AppShell userEmail={user.email} userId={user.id} accessibleSearches={accessibleSearches} activeSearchId={search.id} priorities={priorities} searchIntent={normalizeSearchIntent(priorities?.searchType)} appVersion={appVersion}>
      {children}
    </AppShell>
  );
}
