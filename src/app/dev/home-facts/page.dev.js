import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import HomeFactsPreview from '@/components/HomeFactsPreview';

// Development-only Home Facts preview for visual review and screenshots
// (scripts/visual/home-facts-screens.mjs). Renders the real <HomeDetail> and
// Add Home <HomeModal> with deterministic fixtures: no sign-in, no Supabase
// reads or writes. The `.dev.js` extension (next.config.mjs) keeps this route
// and its fixtures out of production builds entirely; the NODE_ENV check and
// the /dev/ middleware 404 remain as further guards.
//
//   /dev/home-facts?state=full|saved|legacy|nophoto|partial|unknown|manual|realtor|cobuyer[&section=facts|match|tour]
//   /dev/home-facts?view=add&state=found|duplicate|error|manual
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function HomeFactsPreviewPage({ searchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  return (
    <Suspense>
      <HomeFactsPreview view={params.view} state={params.state} section={params.section} />
    </Suspense>
  );
}
