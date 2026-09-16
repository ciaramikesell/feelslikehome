'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandMark, Wordmark } from '@/components/ui';
import { isNativeApp } from '@/lib/platform';

// The public landing page already explains the product (How It Works,
// co-buyer/Realtor sections, philosophy) — repeating that here would make
// Sign In a second landing page. This shell's left panel welcomes someone
// back into the app they already chose, nothing more; each auth page
// supplies its own short headline/description for that welcome (see
// sign-in/sign-up's own copy below), with Sign In's "welcome back" framing
// as the sensible default for the lower-stakes screens (Forgot/Reset
// Password) that don't need their own.
const DEFAULT_HEADLINE = <>Welcome back.<br />Your homes are right where you left them.</>;
const DEFAULT_DESCRIPTION = 'Pick up your search, revisit your Match scores, and keep narrowing in on the place that feels like home.';

// Inside the native Capacitor shell, a signed-out user should never see the
// public marketing site (the two-column pitch below is that site — there is
// no separate marketing route in this app) — they should land on something
// that reads as "sign in to the app you already installed." SSR always
// resolves isNativeApp() to false, so this starts on the ordinary marketing
// layout and only swaps to the simplified one after hydration confirms the
// native shell, the same hydration-gated pattern used elsewhere in this app
// (see CardContextDisclosure, NativeBootScreen). Ordinary web/mobile-Safari
// traffic never sees a flash of this — it never becomes true for them.
function NativeAuthHeader() {
  return (
    <div className="afh-native-header">
      <div className="afh-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <BrandMark size={40} />
        <Wordmark size={27} className="afh-serif" />
      </div>
      <p className="afh-native-tagline">You found the homes. We&apos;ll help you choose.</p>
    </div>
  );
}

export default function AuthShell({ children, headline = DEFAULT_HEADLINE, description = DEFAULT_DESCRIPTION }) {
  const [native, setNative] = useState(false);
  useEffect(() => { if (isNativeApp()) setNative(true); }, []);

  if (native) {
    return (
      <div className="afh-root afh-native-root">
        <NativeAuthHeader />
        <div className="afh-panel">{children}</div>
      </div>
    );
  }

  return (
    <div className="afh-root">
      <div className="afh-grid">
        <div className="afh-left">
          <Link href="/" className="afh-brand" aria-label="Feels Like Home home" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
            <BrandMark size={36} />
            <Wordmark size={29} className="afh-serif" />
          </Link>

          <h2 className="afh-serif afh-headline">{headline}</h2>
          <p className="afh-description">{description}</p>
        </div>

        <div className="afh-right">
          <div className="afh-panel">{children}</div>
        </div>
      </div>
    </div>
  );
}
