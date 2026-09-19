import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getProfile, getSearch } from '@/lib/supabase/data';
import { getEligibleHomeCount, resolveSearchRelationships, resolveSearchEntitlement } from '@/lib/supabase/collaboration';
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
    // Profile/Password/Delete Account never depend on either of these reads.
    // homeCount and relationships are fetched independently — a home-count
    // hiccup (purely a Free-tier progress display) must never hide real,
    // already-loadable relationship data, and vice versa. hasFlhPlus is
    // derived from relationships (see AccountSettings), so only a
    // relationships failure needs to surface as an honest "couldn't load"
    // notice rather than a fabricated Free/no-relationships state; a
    // homeCount failure alone just falls back to 0 silently.
    let homeCount = 0;
    let relationships = [];
    let searchDataError = false;
    let hasFlhPlus = false;
    let entitlementSource = null;
    if (hasBuyerSearch) {
      try {
        homeCount = await getEligibleHomeCount(supabase, ownedSearch.id);
      } catch (error) {
        console.error('Account Settings: could not load eligible home count', error);
      }
      try {
        relationships = await resolveSearchRelationships(supabase, ownedSearch.id);
      } catch (error) {
        console.error('Account Settings: could not load search relationships', error);
        searchDataError = true;
      }
      // A failure here also surfaces the shared error notice, rather than
      // silently defaulting to Free — misrepresenting a beta/purchased
      // search as needing to "unlock FLH+" is a worse mistake than an
      // honest "couldn't load".
      try {
        const entitlement = await resolveSearchEntitlement(supabase, ownedSearch.id);
        hasFlhPlus = entitlement.hasFlhPlus;
        entitlementSource = entitlement.source;
      } catch (error) {
        console.error('Account Settings: could not load FLH+ entitlement', error);
        searchDataError = true;
      }
    }

    return (
      <AccountSettings
        userId={user.id}
        userEmail={user.email}
        firstName={profile?.first_name || ''}
        lastName={profile?.last_name || ''}
        search={hasBuyerSearch ? ownedSearch : null}
        homeCount={homeCount}
        initialRelationships={relationships}
        hasFlhPlus={hasFlhPlus}
        entitlementSource={entitlementSource}
        searchDataError={searchDataError}
      />
    );
  });
}
