import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery, withRedirectParam, currentPathForRedirect } from '@/lib/supabase/auth';
import { getProfile } from '@/lib/supabase/data';
import { resolveActiveSearch, getAccessibleSearches, needsSharedSearchSetup, resolvePriorities, getSearchParticipantIds } from '@/lib/supabase/collaboration';
import { normalizeSearchIntent } from '@/lib/searchIntent';
import AppShell from '@/components/AppShell';

export default async function AppGroupLayout({ children }) {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const storedProfile = await getProfile(supabase, user.id);
    const isRealtorEntry = user.user_metadata?.account_entry_intent === 'realtor';
    // Preserve incomplete buyer onboarding so this person can start a personal
    // search later; only People/Realtor Home routes bypass that unrelated setup gate.
    const requestedPath = await currentPathForRedirect();
    const isRealtorWorkspace = requestedPath.startsWith('/people') || requestedPath.startsWith('/realtor');
    // Account & Settings belongs to the person, not a search: it must open (to
    // sign out, fix a name) even with unfinished onboarding or no buyer search.
    const isAccountRoute = requestedPath === '/account' || requestedPath.startsWith('/account/') || requestedPath.startsWith('/account?');
    const gatedProfile = isRealtorEntry && isRealtorWorkspace ? { ...storedProfile, onboarding_complete: true } : storedProfile;
    const profile = isAccountRoute ? { ...gatedProfile, onboarding_complete: true } : gatedProfile;
    if (!profile?.onboarding_complete) redirect(withRedirectParam('/onboarding', await currentPathForRedirect()));

    const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || null;
    const firstName = storedProfile?.first_name || null;

    if (isAccountRoute) {
      const { search } = storedProfile?.onboarding_complete ? await resolveActiveSearch(supabase, user.id) : { search: null };
      if (!search) {
        return (
          <AppShell userEmail={user.email} userId={user.id} firstName={firstName} accessibleSearches={[]} activeSearchId={null} priorities={null} searchIntent={null} isCollaborative={false} appVersion={appVersion} workspace="account">
            {children}
          </AppShell>
        );
      }
    }

    // People/Realtor Home are a Realtor workspace, not a buyer search. A new
    // Realtor can legitimately have no owned search and no client
    // membership, so these routes must not depend on resolving an active
    // buyer search.
    if (isRealtorWorkspace) {
      return (
        <AppShell userEmail={user.email} userId={user.id} firstName={firstName} accessibleSearches={[]} activeSearchId={null} priorities={null} searchIntent={null} isCollaborative={false} appVersion={appVersion} workspace="realtor">
          {children}
        </AppShell>
      );
    }

    const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
    // A co-buyer who joined this shared search after finishing onboarding on
    // their own account still needs their OWN preferences here before its
    // homes, Match, and My Search mean anything; their other search is untouched.
    if (!isAccountRoute && await needsSharedSearchSetup(supabase, user.id, search, isOwner)) redirect(withRedirectParam('/onboarding', requestedPath));
    const [accessibleSearches, priorities, participantIds] = await Promise.all([
      getAccessibleSearches(supabase, user.id),
      resolvePriorities(supabase, search, user.id),
      getSearchParticipantIds(supabase, search),
    ]);

    return (
      <AppShell userEmail={user.email} userId={user.id} firstName={firstName} accessibleSearches={accessibleSearches} activeSearchId={search.id} priorities={priorities} searchIntent={normalizeSearchIntent(priorities?.searchType)} isCollaborative={participantIds.length > 1} appVersion={appVersion}>
        {children}
      </AppShell>
    );
  });
}
