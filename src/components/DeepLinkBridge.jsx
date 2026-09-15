'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { isNativeApp } from '@/lib/platform';
import { resolveDeepLinkPath } from '@/lib/deepLink';

// Universal Links land here via the official @capacitor/app `appUrlOpen`
// event. Its native iOS implementation (@capacitor/app's AppPlugin.swift)
// fires that event with `retainUntilConsumed: true` for both the
// capacitorOpenURL and capacitorOpenUniversalLink notifications — meaning a
// cold-start launch URL is queued by Capacitor's own bridge and replayed to
// whichever listener registers first. That's a stronger guarantee than
// App.getLaunchUrl() (a plain one-shot read with no retry/replay), so a
// single listener mounted once here — regardless of whether it happens to
// attach before or after the OS delivered the event — correctly handles both
// cold start (app was terminated) and warm start (app already running),
// with no separate getLaunchUrl() call and no native "pending URL" storage
// of our own needed.
//
// This component is the entire native bridge. It does not parse listing
// URLs, determine provider support, or touch #73's intake logic — it only
// validates the outer FLH URL (see resolveDeepLinkPath, src/lib/deepLink.js)
// and hands the untouched path/query/hash to the existing Next.js router,
// exactly as if the user had clicked a same-shaped link inside the app.
// See docs/universal-links.md.
export default function DeepLinkBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    let handle;

    App.addListener('appUrlOpen', ({ url }) => {
      const path = resolveDeepLinkPath(url);
      if (!path) return;
      // A plain client-side navigation into the existing router — never a
      // second router, never a raw WebView reload. Auth/redirect
      // continuation for a protected destination is whatever that route
      // already does for any other client navigation (see (app)/layout.js's
      // ?redirect= handling, /invite/[token]'s own redirect). replace (not
      // push) so a deep-link open doesn't leave the app's default boot
      // landing sitting in back-button history underneath it.
      router.replace(path);
    }).then((result) => {
      if (cancelled) result.remove();
      else handle = result;
    });

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [router]);

  return null;
}
