import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import AppShell from '@/components/AppShell';

export default async function AppGroupLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);
  if (!profile?.onboarding_complete) redirect('/onboarding');

  return <AppShell userEmail={user.email}>{children}</AppShell>;
}
