// The development-only onboarding preview (src/app/dev/onboarding) must never be
// reachable in production and must never write to Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the preview route answers 404 in every production build', () => {
  const page = read('src/app/dev/onboarding/page.js');
  assert.match(page, /export default async function OnboardingPreviewPage\(\{ searchParams \}\) \{\n\s+if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});

test('the preview only uses in-memory services and never imports Supabase', () => {
  const preview = read('src/components/onboarding/OnboardingPreview.jsx');
  assert.doesNotMatch(preview, /supabase/i);
  for (const key of ['savePriorities', 'saveProgress', 'completeOnboarding', 'setActiveSearch', 'submitFeedback']) {
    assert.match(preview, new RegExp(`\\n\\s+${key}: `), `${key} is stubbed`);
  }
  assert.match(preview, /services=\{services\}/);
});

test('every onboarding write goes through the injectable services, defaulting to Supabase', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const block = onboarding.slice(onboarding.indexOf('const SUPABASE_SERVICES'), onboarding.indexOf('});', onboarding.indexOf('const SUPABASE_SERVICES')));
  // createClient() appears only inside the default services block.
  assert.equal(onboarding.split('createClient()').length - 1, block.split('createClient()').length - 1);
  assert.match(onboarding, /services = SUPABASE_SERVICES \}\) \{/);
  const feedback = read('src/components/BetaFeedback.jsx');
  assert.match(feedback, /const submitToSupabase = \(payload\) => submitBetaFeedback\(createClient\(\), payload\);/);
  assert.match(feedback, /sendFeedback = submitToSupabase \}\) \{/);
});

test('middleware answers 404 for /dev/ in production and skips only that path in development', () => {
  const middleware = read('src/middleware.js');
  assert.match(middleware, /if \(request\.nextUrl\.pathname\.startsWith\('\/dev\/'\)\) \{\n\s+return process\.env\.NODE_ENV === 'production'\n\s+\? new NextResponse\('Not found', \{ status: 404 \}\)\n\s+: NextResponse\.next\(\);/);
  // Every other route still refreshes the session: the matcher is unchanged.
  assert.doesNotMatch(middleware, /\|dev\/\|/);
});
