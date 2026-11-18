import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { guestOnboardingEnabled } from '@/lib/guest/config';
import { createClient } from '@/lib/supabase/server';
import { BINDING_COOKIE } from '@/lib/guest/draft';
import { GuestContinue } from '@/components/onboarding/GuestAccount';

export default async function GuestContinuePage({ searchParams }) {
  if (!guestOnboardingEnabled()) notFound();
  const supabase = await createClient();
  const [{ data: { user } }, jar, params] = await Promise.all([supabase.auth.getUser(), cookies(), searchParams]);
  return <GuestContinue email={user?.email} interrupted={params.verification === 'interrupted'}
    hasBindingCookie={jar.has(BINDING_COOKIE)} />;
}
