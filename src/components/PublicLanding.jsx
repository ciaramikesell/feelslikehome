'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Menu } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import LandingAuthPopover from '@/components/auth/LandingAuthPopover';

import PublicHomeFeatures from '@/components/PublicHomeFeatures';

export default function PublicLanding() {
  // This entry preserves explicit Realtor intent and lands a new account in the
  // People workspace; it does not send agents through buyer onboarding.
  const realtorHref = '/for-realtors';
  const [authMode, setAuthMode] = useState(null);
  const authTriggerRef = useRef(null);
  const closeAuth = useCallback(() => setAuthMode(null), []);
  const openAuth = (mode, event) => {
    authTriggerRef.current = event.currentTarget;
    setAuthMode(mode);
  };
  return <div className="pl-root">
    <a className="pl-skip" href="#main">Skip to content</a>
    <header className="pl-header">
      <Link className="pl-brand" href="/" aria-label="Feels Like Home home"><BrandMark size={44} /><span>Feels Like <b>Home</b></span></Link>
      <nav aria-label="Public navigation">
        <div className="pl-nav-surface"><a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><button type="button" className="pl-auth-trigger" onClick={(event) => openAuth('sign-in', event)} aria-expanded={authMode !== null}>Sign in</button></div><button type="button" className="pl-button is-small" onClick={(event) => openAuth('sign-up', event)} aria-expanded={authMode !== null}>Get started</button>
      </nav>
      <details className="pl-mobile-menu">
        <summary aria-label="Open navigation"><Menu size={20} aria-hidden="true" /><span>Menu</span></summary>
        <nav aria-label="Mobile public navigation">
          <a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><Link href="/auth/sign-in">Sign in</Link><Link className="pl-button is-small" href="/auth/sign-up">Get started</Link>
        </nav>
      </details>
      {authMode && <LandingAuthPopover mode={authMode} onModeChange={setAuthMode} onClose={closeAuth} returnFocusRef={authTriggerRef} />}
    </header>

    <main id="main">
      <section className="pl-hero">
        <div className="pl-hero-copy">
          <h1><span className="pl-hero-opening">You’ve saved a lot of options.</span>{' '}<span>Now find the one that</span>{' '}<em>Feels Like Home.</em></h1>
          <div className="pl-actions"><button type="button" className="pl-button pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Create a free account <ArrowRight size={17} aria-hidden="true" /></button><Link className="pl-button pl-mobile-auth" href="/auth/sign-up">Create a free account <ArrowRight size={17} aria-hidden="true" /></Link></div>
        </div>
        <figure className="pl-hero-visual"><Image src="/images/Warm Cottage.png" alt="A welcoming cottage with a front porch at golden hour" fill priority sizes="(max-width: 900px) 100vw, 58vw" /></figure>
      </section>

      <div className="pl-section-divider" aria-hidden="true" />
      <PublicHomeFeatures />

    </main>
    <footer className="pl-footer"><div className="pl-footer-brand"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Homes are personal. Choosing one should be, too.</p></div><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Sign in</button><Link className="pl-mobile-auth" href="/auth/sign-in">Sign in</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Get started</button><Link className="pl-mobile-auth" href="/auth/sign-up">Get started</Link></nav><small>© 2026 Feels Like Home</small></footer>
  </div>;
}
