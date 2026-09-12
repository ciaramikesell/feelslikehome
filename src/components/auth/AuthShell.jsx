'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal, LayoutGrid, Target } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';
import { isNativeApp } from '@/lib/platform';

const BENEFITS = [
  { icon: SlidersHorizontal, title: 'Set your priorities', desc: 'Decide what matters — and how much.' },
  { icon: LayoutGrid, title: 'Keep your homes together', desc: 'Compare listings from anywhere.' },
  { icon: Target, title: 'Find your best match', desc: 'See how each home measures up to what matters to you.' },
];

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

export default function AuthShell({ children }) {
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
          <div className="afh-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandMark size={36} />
            <Wordmark size={29} className="afh-serif" />
          </div>

          <h2 className="afh-serif afh-headline">
            Compare the homes you like.
            <br />
            Find the one that <span style={{ color: 'var(--brick)' }}>feels like home</span>.
          </h2>
          <p className="afh-description" style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '14px 0 0', maxWidth: 420 }}>
            Organize, rate, and compare the homes you're considering based on what matters most to you.
          </p>

          <div className="afh-benefits">
            {BENEFITS.map(({ icon: Icon, title, desc }) => (
              <div className="afh-benefit" key={title}>
                <div className="afh-benefit-icon"><Icon size={17} color="var(--brick)" /></div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="afh-right">
          <div className="afh-panel">{children}</div>
        </div>
      </div>
    </div>
  );
}
