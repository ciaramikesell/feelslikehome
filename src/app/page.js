import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import { hasRealtorRelationship } from '@/lib/supabase/collaboration';
import { REALTOR_WORKSPACE_PATH, entersAsRealtor } from '@/lib/realtorEntry';
import PublicLanding from '@/components/PublicLanding';
import { guestOnboardingEnabled } from '@/lib/guest/config';
import NativeWelcome from '@/components/NativeWelcome';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Signed out: both entries are server-rendered and CSS shows exactly one
  // before first paint — the short native welcome inside the iOS app (the
  // <html data-flh-native> flag, see src/lib/platform.js), the unchanged
  // public homepage everywhere else. No redirect is involved, so deep links,
  // invitations and shared-listing URLs never pass through the welcome.
  if (!user && guestOnboardingEnabled()) return <><NativeWelcome guest /><div className="flh-web-entry"><PublicLanding guest /></div></>;
  if (!user) return <><NativeWelcome /><div className="flh-web-entry"><PublicLanding /></div></>;

  const profile = await getProfile(supabase, user.id);
  // A Realtor (by sign-up intent, or by a Realtor membership for someone who
  // signed up from a buyer's invitation) starts in the client workspace, not
  // buyer onboarding. Both are entry-routing hints only: every People query
  // remains relationship/draft-owner scoped by RLS.
  if (!profile?.onboarding_complete) {
    const realtor = entersAsRealtor({
      onboardingComplete: false,
      entryIntent: user.user_metadata?.account_entry_intent,
      hasRealtorMembership: user.user_metadata?.account_entry_intent !== 'realtor'
        && await hasRealtorRelationship(supabase, user.id).catch(() => false),
    });
    redirect(realtor ? REALTOR_WORKSPACE_PATH : '/onboarding');
  }

  redirect('/homes');
}
