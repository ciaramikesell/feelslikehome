import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery, withRedirectParam, currentPathForRedirect } from '@/lib/supabase/auth';
import { getProfile } from '@/lib/supabase/data';
import { resolveActiveSearch, getAccessibleSearches, resolvePriorities, getSearchParticipantIds } from '@/lib/supabase/collaboration';
import { normalizeSearchIntent } from '@/lib/searchIntent';
import AppShell from '@/components/AppShell';

export default async function AppGroupLayout({ children }) {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const storedProfile = await getProfile(supabase, user.id);
    const isRealtorEntry = user.user_metadata?.account_entry_intent === 'realtor';
    // Preserve incomplete buyer onboarding so this person can start a personal
    // search later; People/Realtor Home routes bypass that unrelated setup gate.
    const requestedPath = await currentPathForRedirect();
    const isRealtorWorkspace = requestedPath.startsWith('/people') || requestedPath.startsWith('/realtor');
    // Account Settings is person-level (name/email/password/deletion), not
    // buyer-product functionality — it must never depend on onboarding being
    // complete, for any account type (mid-onboarding buyer, Realtor-only,
    // dual-role). See src/app/(app)/account/page.js for how it separately
    // decides whether it has a legitimate owned buyer search to also show
    // FLH+/Connections content for.
    const isAccountSettings = requestedPath.startsWith('/account');
    const profile = isRealtorEntry && isRealtorWorkspace ? { ...storedProfile, onboarding_complete: true } : storedProfile;
    if (!isAccountSettings && !profile?.onboarding_complete) redirect(withRedirectParam('/onboarding', await currentPathForRedirect()));

    const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || null;
    const firstName = storedProfile?.first_name || null;
    const lastName = storedProfile?.last_name || null;

    // People/Realtor Home are a Realtor workspace, not a buyer search. A new
    // Realtor can legitimately have no owned search and no client
    // membership, so these routes must not depend on resolving an active
    // buyer search.
    if (isRealtorWorkspace) {
      return (
        <AppShell userEmail={user.email} userId={user.id} firstName={firstName} lastName={lastName} accessibleSearches={[]} activeSearchId={null} priorities={null} searchIntent={null} isCollaborative={false} appVersion={appVersion} workspace="realtor">
          {children}
        </AppShell>
      );
    }

    // /account also falls through here (it is not a Realtor workspace route),
    // which is intentional: resolveActiveSearch always resolves to the
    // person's own owned search (every account gets one at signup) even when
    // it's still an untouched, pre-onboarding row, so this never throws for
    // a Realtor-only account visiting /account — it just resolves a search
    // that account's Account Settings page won't render FLH+/Connections
    // content for (see isAccountSettings above and profile.onboarding_complete
    // in account/page.js).
    const { search } = await resolveActiveSearch(supabase, user.id);
    const [accessibleSearches, priorities, participantIds] = await Promise.all([
      getAccessibleSearches(supabase, user.id),
      resolvePriorities(supabase, search, user.id),
      getSearchParticipantIds(supabase, search),
    ]);

    return (
      <AppShell userEmail={user.email} userId={user.id} firstName={firstName} lastName={lastName} accessibleSearches={accessibleSearches} activeSearchId={search.id} priorities={priorities} searchIntent={normalizeSearchIntent(priorities?.searchType)} isCollaborative={participantIds.length > 1} appVersion={appVersion}>
        {children}
      </AppShell>
    );
  });
}
