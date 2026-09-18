import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getProfile, getSearch } from '@/lib/supabase/data';
import { getEligibleHomeCount, resolveSearchRelationships } from '@/lib/supabase/collaboration';
import AccountSettings from '@/components/account/AccountSettings';

// Person-level Account Settings. Deliberately does not use resolveActiveSearch
// (which is about "which search is the user currently viewing") — FLH+ and
// Connections here always manage the person's own OWNED search, never a
// search they're merely a co-buyer/Realtor member of elsewhere. That keeps
// dual-role accounts correct: a Realtor membership on someone else's search
// must never be interpreted as this person's own search having FLH+.
//
// profile.onboarding_complete (the real, unmodified value — not (app)/layout's
// virtual Realtor-workspace override) is the signal for "this account has a
// legitimate buyer search to manage here." Every account gets an owned
// `searches` row at signup regardless of role, so its mere existence isn't a
// useful signal; a Realtor-only account's owned row stays an untouched,
// never-onboarded default forever, which is exactly what this excludes.
export default async function AccountSettingsPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const [profile, ownedSearch] = await Promise.all([
      getProfile(supabase, user.id),
      getSearch(supabase, user.id),
    ]);

    const hasBuyerSearch = Boolean(profile?.onboarding_complete && ownedSearch);
    const [homeCount, relationships] = hasBuyerSearch
      ? await Promise.all([
          getEligibleHomeCount(supabase, ownedSearch.id),
          resolveSearchRelationships(supabase, ownedSearch.id),
        ])
      : [0, []];

    return (
      <AccountSettings
        userId={user.id}
        userEmail={user.email}
        firstName={profile?.first_name || ''}
        lastName={profile?.last_name || ''}
        search={hasBuyerSearch ? ownedSearch : null}
        homeCount={homeCount}
        initialRelationships={relationships}
      />
    );
  });
}
