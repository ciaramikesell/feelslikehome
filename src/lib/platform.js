import { Capacitor } from '@capacitor/core';

// Detects whether the app is currently running inside the Capacitor native
// iOS shell, as opposed to any ordinary web session (desktop browser, mobile
// browser, or the app installed as a PWA). @capacitor/core's own platform
// check resolves against globalThis/global with optional chaining and falls
// back to "web" when no native bridge is present, so this is safe to import
// and call anywhere — including Server Components during SSR, where it
// always resolves to false — with no risk of a hydration mismatch.
//
// Deliberately narrow: this exists to gate a handful of small presentation
// details that only make sense one way or the other (e.g. the PWA install
// prompt makes no sense inside a shell that's already installed natively —
// see InstallPrompt.jsx). It is not a general-purpose device/viewport check
// (narrow-viewport mobile web already has its own CSS-driven presentation
// throughout the app, independent of this) and must never gate routing,
// data fetching, or business logic — the whole point of the remote-hosted
// Capacitor shell is that native and web run the exact same application.
// See docs/capacitor-ios-foundation.md for the full rationale.
export function isNativeApp() {
  return Capacitor.isNativePlatform();
}
