'use client';

import { useEffect } from 'react';
import { ensureNativeShellFlag } from '@/lib/platform';

// Confirms, once per page load inside the native shell, that the first-paint
// native flag (NATIVE_SHELL_FLAG_SCRIPT) was really set before first paint,
// and repairs it if not. Renders nothing; does nothing in a browser.
// The two console lines are what Simulator/device QA looks for in Xcode
// (docs/native-welcome-share-tutorial.md §6).
export default function NativeShellFlagCheck() {
  useEffect(() => {
    const result = ensureNativeShellFlag();
    if (result === 'confirmed') console.info('[FLH Native QA] first-paint native flag confirmed');
    if (result === 'corrected') console.warn('[FLH Native QA] first-paint native flag was MISSING; set after hydration');
  }, []);
  return null;
}
