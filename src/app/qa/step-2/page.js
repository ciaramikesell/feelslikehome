import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { previewQaAllowedHere } from '@/lib/previewQa';
import Step2Harness from '@/components/onboarding/Step2Harness';

// TEMPORARY Preview-only QA harness for Onboarding V2 Step 2: live Google
// Places, in-memory saves, no database writes. Not reachable on Production;
// requires sign-in. Remove per docs/onboarding-step2-preview-qa.md.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Step 2 QA (Preview)', robots: { index: false, follow: false } };

export default async function Step2QaPage() {
  const host = (await headers()).get('host');
  if (!previewQaAllowedHere(host)) notFound();
  // Signed-in visitors only. This confirms the session and reads nothing else.
  // Only local development may skip it, and only when Supabase isn't configured.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect(`/auth/sign-in?redirect=${encodeURIComponent('/qa/step-2')}`);
  } else if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return <Step2Harness />;
}
