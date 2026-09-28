import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getProfile } from '@/lib/supabase/data';
import { resolveActiveSearch, getSearchParticipantIds } from '@/lib/supabase/collaboration';
import AccountSettings from '@/components/AccountSettings';

export const metadata = { title: 'Account' };

// Account is about the person, not a search: it renders whether or not this
// person has an active buyer search (see the /account bypass in (app)/layout.js).
export default async function AccountPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const profile = await getProfile(supabase, user.id);
    let searchSummary = null;
    if (profile?.onboarding_complete) {
      const { search, isOwner } = await resolveActiveSearch(supabase, user.id);
      if (search) {
        const participantIds = await getSearchParticipantIds(supabase, search);
        searchSummary = { isOwner, participantCount: participantIds.length };
      }
    }
    return (
      <AccountSettings
        userId={user.id}
        email={user.email || ''}
        firstName={profile?.first_name || ''}
        lastName={profile?.last_name || ''}
        searchSummary={searchSummary}
      />
    );
  });
}
