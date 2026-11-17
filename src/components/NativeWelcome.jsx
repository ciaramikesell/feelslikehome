'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Share } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';
import ShareTutorial from '@/components/ShareTutorial';

// The signed-out first screen inside the native iOS app only. It replaces the
// long public marketing homepage there with one photo, one sentence and one
// obvious action. It is always server-rendered next to <PublicLanding /> and
// hidden by CSS unless <html data-flh-native> is set (see
// NATIVE_SHELL_FLAG_SCRIPT in src/lib/platform.js), so neither surface flashes
// while the app hydrates, and desktop/mobile Safari never see it.
//
// It owns no routing: Get Started and Sign in are the existing auth pages,
// and nothing here redirects, records a "seen" flag or opens on its own — a
// deep link replaces this route exactly as it replaced the homepage before.
//
// The photograph is the exact desktop homepage hero (PublicLanding's
// .pl-hero-visual), not a new asset.
//
// Same src AND the same `sizes` as the homepage hero, and deliberately no
// `priority`: the homepage's own priority preload already covers this exact
// srcset, so inside the app the welcome reuses it (one download, one
// preload), while in a browser this hidden, lazy image is never fetched — the
// public homepage's network and paint stay byte-for-byte what they were.
export const WELCOME_HERO_SRC = '/images/Warm Cottage.png';
const WELCOME_HERO_SIZES = '(max-width: 900px) 100vw, 58vw';

export default function NativeWelcome() {
  const [tutorialOpen, setTutorialOpen] = useState(false);

  return (
    <main className="flh-welcome" aria-labelledby="flh-welcome-title">
      <figure className="flh-welcome-photo">
        <Image src={WELCOME_HERO_SRC} alt="A welcoming cottage with a front porch at golden hour" fill sizes={WELCOME_HERO_SIZES} />
      </figure>
      <div className="flh-welcome-body">
        <div className="flh-welcome-brand" aria-hidden="true"><BrandMark size={30} /><Wordmark size={23} /></div>
        <h1 id="flh-welcome-title" className="flh-welcome-title">A little closer to home.</h1>
        <p className="flh-welcome-lede"><strong>Already found a few homes you love?</strong> Import their listings, see how they match what matters to you, and decide together.</p>
        <div className="flh-welcome-actions">
          <Link href="/auth/sign-up" className="flh-welcome-primary flh-press">Get Started <ArrowRight size={18} aria-hidden="true" /></Link>
          <Link href="/auth/sign-in" className="flh-welcome-secondary flh-press">Already have an account? <b>Sign in</b></Link>
        </div>
        <button type="button" className="flh-welcome-tour flh-press" onClick={() => setTutorialOpen(true)}>
          <Share size={15} aria-hidden="true" /> Try a listing import · no account needed
        </button>
      </div>
      {tutorialOpen && <ShareTutorial onClose={() => setTutorialOpen(false)} />}
    </main>
  );
}
