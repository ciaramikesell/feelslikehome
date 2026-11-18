import { redirect, notFound } from 'next/navigation';
import { guestOnboardingEnabled } from '@/lib/guest/config';
import { createClient } from '@/lib/supabase/server';
import GuestOnboarding from '@/components/onboarding/GuestOnboarding';

export default async function GuestPage() {
  if (!guestOnboardingEnabled()) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/');
  return <GuestOnboarding />;
}
