'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Check, Heart, MapPin, Menu, MessageSquareText, X } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import LandingAuthPopover from '@/components/auth/LandingAuthPopover';

import PublicFeaturePreviews from '@/components/PublicFeaturePreviews';

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
          <h1><span>You’ve saved a lot</span>{' '}<span>of options.</span>{' '}<span>Now find the one that</span>{' '}<em>Feels Like Home.</em></h1>
          <p className="pl-lede">Import the homes you've already saved. See how they match what matters to you. Then tour, compare, and choose together.</p>
          <div className="pl-actions"><button type="button" className="pl-button pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Create a free account <ArrowRight size={17} aria-hidden="true" /></button><Link className="pl-button pl-mobile-auth" href="/auth/sign-up">Create a free account <ArrowRight size={17} aria-hidden="true" /></Link></div>
        </div>
        <figure className="pl-hero-visual"><Image src="/images/Warm Cottage.png" alt="A welcoming cottage with a front porch at golden hour" fill priority sizes="(max-width: 900px) 100vw, 58vw" /></figure>
      </section>

      <PublicFeaturePreviews />

      <section className="pl-collaboration" aria-labelledby="collaboration-title">
        <header><h2 id="collaboration-title">Choosing a home doesn’t happen alone.</h2></header>
        <div className="pl-collaboration-grid">
          <article className="pl-collaboration-story">
            <h3>Searching with a co-buyer</h3>
            <p>Compare the same homes while keeping your own priorities and Match results.</p>
            <div className="pl-people-card">
              <div className="pl-home-label"><Heart size={17} aria-hidden="true" /> 123 Main Street</div>
              <div className="pl-person">
                <span aria-hidden="true">C</span>
                <div>
                  <h4>Ciara</h4>
                  <ul>
                    <li><Check aria-hidden="true" /><span className="sr-only">Confirmed </span>Fenced yard</li>
                    <li><Check aria-hidden="true" /><span className="sr-only">Confirmed </span>Home office</li>
                    <li><Check aria-hidden="true" /><span className="sr-only">Confirmed </span>Guest bedroom</li>
                    <li className="pl-commute"><MapPin aria-hidden="true" /> Campus Martius — 20 minutes</li>
                  </ul>
                </div>
              </div>
              <div className="pl-person">
                <span aria-hidden="true">A</span>
                <div>
                  <h4>Andrew</h4>
                  <ul>
                    <li><Check aria-hidden="true" /><span className="sr-only">Confirmed </span>Garage</li>
                    <li><Check aria-hidden="true" /><span className="sr-only">Confirmed </span>Fenced yard</li>
                    <li className="pl-mismatch"><X aria-hidden="true" /><span className="sr-only">Mismatch </span>Finished Basement</li>
                    <li className="pl-commute"><MapPin aria-hidden="true" /> Lake St. Clair — 5 minutes</li>
                  </ul>
                </div>
              </div>
            </div>
          </article>
          <article className="pl-collaboration-story">
            <h3>Working with a Realtor</h3>
            <p>Your Realtor can suggest homes and share insights. You choose what to save and tour.</p>
            <div className="pl-realtor-scene">
              <div className="pl-realtor-top"><span>Suggested by Whitney</span><small>Realtor suggestion</small></div>
              <blockquote className="pl-note"><MessageSquareText size={17} aria-hidden="true" /><p>“The listing says 3 beds but there is a flex room that would be perfect for your office space. Only a 5 minute walk from restaurants and shopping!”</p></blockquote>
            </div>
            <Link className="pl-text-link" href={realtorHref}>Learn more for agents <ArrowRight size={14} aria-hidden="true" /></Link>
          </article>
        </div>
        <p className="pl-collaboration-caption">Fictional examples</p>
      </section>
    </main>
    <footer className="pl-footer"><div className="pl-footer-brand"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Homes are personal. Choosing one should be, too.</p></div><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Sign in</button><Link className="pl-mobile-auth" href="/auth/sign-in">Sign in</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Get started</button><Link className="pl-mobile-auth" href="/auth/sign-up">Get started</Link></nav><small>© 2026 Feels Like Home</small></footer>
  </div>;
}
