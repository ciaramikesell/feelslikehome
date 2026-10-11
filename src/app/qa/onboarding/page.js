import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { previewQaAllowedHere } from '@/lib/previewQa';
import OnboardingJourneyHarness from '@/components/onboarding/OnboardingJourneyHarness';

// TEMPORARY Preview-only QA journey for the six-step Onboarding V2 (demo data,
// in-memory saves, no database writes). Not reachable on Production;
// requires sign-in. Remove per docs/onboarding-v2-preview-qa.md.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Onboarding V2 demo (Preview)', robots: { index: false, follow: false } };

export default async function OnboardingQaPage() {
  const host = (await headers()).get('host');
  if (!previewQaAllowedHere(host)) notFound();
  // Signed-in visitors only. This confirms the session and reads nothing else.
  // Only local development may skip it, and only when Supabase isn't configured.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect(`/auth/sign-in?redirect=${encodeURIComponent('/qa/onboarding')}`);
  } else if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return <OnboardingJourneyHarness />;
}
