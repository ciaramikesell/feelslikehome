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

// Asks whether a Capacitor plugin's native half is compiled into the installed
// binary. The app is remote-hosted, so the live web code can be newer than the
// app a person installed: a plugin added in a later release (e.g. Haptics) is
// absent from older builds, and callers must quietly do nothing there.
export function isNativePluginAvailable(name) {
  return isNativeApp() && Capacitor.isPluginAvailable(name);
}

// ── First-paint native flag ─────────────────────────────────────────────────
// isNativeApp() can only run after hydration, so anything gated on it alone
// shows the web version for a beat first. For the one place where that beat
// is visible — the signed-out root, which must show the native welcome and
// never the public marketing homepage — the root layout inlines this script
// in <head>. It runs synchronously before <body> is parsed and marks <html>
// with NATIVE_SHELL_ATTRIBUTE; CSS then picks the right surface for the
// very first paint.
//
// The check is the same native-bridge check @capacitor/core's getPlatformId()
// makes (window.androidBridge, or the WKScriptMessageHandler named "bridge"
// that Capacitor's iOS shell registers before any page loads). It never reads
// the user agent, the viewport width or the URL. In every ordinary browser
// neither bridge exists, so the attribute is never set and nothing changes.
// It decides presentation only — routing and auth stay server-side.
export const NATIVE_SHELL_ATTRIBUTE = 'data-flh-native';
export const NATIVE_SHELL_FLAG_SCRIPT = `(function(){try{var w=window;if(w.CapacitorCustomPlatform||w.androidBridge||(w.webkit&&w.webkit.messageHandlers&&w.webkit.messageHandlers.bridge)){document.documentElement.setAttribute('${NATIVE_SHELL_ATTRIBUTE}','')}}catch(e){}})();`;
