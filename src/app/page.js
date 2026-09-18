import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import PublicLanding from '@/components/PublicLanding';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <PublicLanding />;

  const profile = await getProfile(supabase, user.id);
  // Signup intent is only an entry-routing hint. Every Realtor Home/People
  // query remains relationship/draft-owner scoped by RLS; this metadata
  // grants no access.
  if (!profile?.onboarding_complete && user.user_metadata?.account_entry_intent === 'realtor') redirect('/realtor');
  if (!profile?.onboarding_complete) redirect('/onboarding');

  redirect('/homes');
}
