import NativeBootScreen from '@/components/NativeBootScreen';

// Fallback for the Suspense boundary Next.js wraps around the root page
// (src/app/page.js) while its async session/onboarding check resolves.
// Renders nothing outside the native shell — see NativeBootScreen.
export default function Loading() {
  return <NativeBootScreen />;
}
