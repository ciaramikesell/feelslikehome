import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);
  if (!profile?.onboarding_complete) redirect('/onboarding');

  redirect('/homes');
}
