import NativeBootScreen from '@/components/NativeBootScreen';

// Fallback for the Suspense boundary Next.js wraps around this route group's
// layout (src/app/(app)/layout.js) while it resolves auth, onboarding status,
// and the active search — covers a direct/deep-link entry into the app, not
// just the root redirect. Renders nothing outside the native shell — see
// NativeBootScreen.
export default function Loading() {
  return <NativeBootScreen />;
}
