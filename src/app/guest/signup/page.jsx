import { notFound, redirect } from 'next/navigation';
import { guestOnboardingEnabled } from '@/lib/guest/config';
import { createClient } from '@/lib/supabase/server';
import { GuestSignup } from '@/components/onboarding/GuestAccount';

export default async function GuestSignupPage() {
  if (!guestOnboardingEnabled()) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/guest/continue');
  return <GuestSignup />;
}
