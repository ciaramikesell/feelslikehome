'use client';

import { useEffect, useState } from 'react';
import { BrandMark, Wordmark } from '@/components/ui';
import { isNativeApp } from '@/lib/platform';

// Boot UI for the native Capacitor shell only — shown as the loading.js
// fallback while the root route or the (app) segment's own async auth/data
// resolution (see src/app/page.js and src/app/(app)/layout.js) is still in
// flight, so the user never sees a blank screen or a flash of the wrong
// destination while their session is being resolved. This introduces no new
// delay of its own: it rides the Suspense boundary Next.js already creates
// around those async Server Components.
//
// SSR always resolves isNativeApp() to false (no Capacitor bridge exists on
// the server), so this renders nothing during the server-rendered pass and
// only appears after hydration confirms it's running inside the native
// shell — the same hydration-gated pattern already used elsewhere in this
// app for platform/viewport-specific presentation (see CardContextDisclosure
// in HomesBoard.jsx and the mobile tour gating in AppShell.jsx), so ordinary
// web/desktop/mobile-Safari traffic is entirely unaffected.
export default function NativeBootScreen() {
  const [native, setNative] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    // Only reveals the secondary line if the real resolution is still going
    // after a beat — never a delay gating the boot screen or the navigation
    // itself, just a threshold for when a bare brand mark starts to feel
    // like it needs a word of reassurance.
    const timer = setTimeout(() => setShowHint(true), 900);
    return () => clearTimeout(timer);
  }, []);

  if (!native) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--paper)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <BrandMark size={54} />
      <Wordmark size={26} />
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0, minHeight: 16, opacity: showHint ? 1 : 0, transition: 'opacity 0.3s ease' }}>
        Finding your way home…
      </p>
    </div>
  );
}
