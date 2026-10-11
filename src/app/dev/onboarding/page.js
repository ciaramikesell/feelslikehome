import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import OnboardingPreview from '@/components/onboarding/OnboardingPreview';

// Development-only onboarding preview for visual review and screenshots
// (scripts/visual/onboarding-screens.mjs). Renders the real <Onboarding> with
// deterministic fixtures and in-memory services: no sign-in, no Supabase
// reads or writes, no invitations or imports. Production builds (including
// Vercel previews, which run NODE_ENV=production) always answer 404.
//
//   /dev/onboarding?step=basics|what_matters|rank&state=empty|populated|error&mode=account|shared
//   /dev/onboarding?flow=v2&step=basics|locations&…   (the approved six-step flow, not live)
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function OnboardingPreviewPage({ searchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  return (
    <Suspense>
      <OnboardingPreview step={params.step} state={params.state} mode={params.mode} flow={params.flow} />
    </Suspense>
  );
}
