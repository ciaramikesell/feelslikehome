'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Heart, Menu } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import LandingAuthPopover from '@/components/auth/LandingAuthPopover';
import PublicHomeFeatures from '@/components/PublicHomeFeatures';
import { SourcePhoto } from '@/components/PublicFeatureArtwork';

// Illustrative only: two priorities visible in the photo are met; the garage
// isn't in the listing yet, so it stays unknown rather than counting against it.
const heroNote = [
  { label: 'Front porch', state: 'Yes', met: true },
  { label: 'Mature trees', state: 'Yes', met: true },
  { label: 'Garage', state: 'Not listed yet', met: false },
];
const closingHomes = [[70, 227, 409, 425], [533, 227, 389, 425], [979, 227, 400, 425]];

export default function PublicLanding() {
  // This entry preserves explicit Realtor intent and lands a new account in the
  // People workspace; it does not send agents through buyer onboarding.
  const realtorHref = '/for-realtors';
  const [authMode, setAuthMode] = useState(null);
  const authTriggerRef = useRef(null);
  const headerRef = useRef(null);
  const closeAuth = useCallback(() => setAuthMode(null), []);
  const openAuth = (mode, event) => {
    authTriggerRef.current = event.currentTarget;
    setAuthMode(mode);
    // The account panel lives in the masthead. When it is opened from further
    // down the page, bring it into view and move focus into its first field.
    if (!headerRef.current?.contains(event.currentTarget)) {
      requestAnimationFrame(() => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        headerRef.current?.querySelector('.pl-auth-popover input')?.focus({ preventScroll: true });
      });
    }
  };
  return <div className="pl-root">
    <a className="pl-skip" href="#main">Skip to content</a>
    <header className="pl-header" ref={headerRef}>
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
      <section className="pl-hero" aria-labelledby="hero-title">
        <div className="pl-hero-copy">
          <h1 id="hero-title"><span className="pl-hero-opening">You’ve saved a lot of options.</span>{' '}<span>Now find the one that</span>{' '}<em>Feels Like Home.</em></h1>
          <p className="pl-hero-sub">Save the homes you love, see how they match what matters, and decide together.</p>
          <div className="pl-actions"><button type="button" className="pl-button pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Create a free account <ArrowRight size={18} aria-hidden="true" /></button><Link className="pl-button pl-mobile-auth" href="/auth/sign-up">Create a free account <ArrowRight size={18} aria-hidden="true" /></Link></div>
        </div>
        <figure className="pl-hero-visual"><Image src="/images/Warm Cottage.png" alt="A welcoming cottage with a front porch at golden hour" fill priority sizes="(max-width: 900px) 100vw, 58vw" />
          <figcaption className="pl-hero-note">
            <span className="sr-only">Illustrative example: the front porch and mature trees match your priorities. The garage isn’t listed yet, and unknown isn’t no.</span>
            <span className="pl-hero-note-head" aria-hidden="true"><span className="pl-hero-note-kicker">How this one fits you</span><span className="pl-hero-note-tag">Example</span></span>
            <ul aria-hidden="true">{heroNote.map(({ label, state, met }) => <li key={label} className={met ? 'is-met' : 'is-unknown'}>
              <Heart size={16} fill={met ? 'currentColor' : 'none'} strokeWidth={met ? 0 : 2} /><span>{label}</span><small>{state}</small>
            </li>)}</ul>
            <span className="pl-hero-note-foot" aria-hidden="true">Unknown isn’t no.</span>
          </figcaption>
        </figure>
      </section>

      <PublicHomeFeatures />

      <section className="pl-closing" aria-labelledby="closing-title">
        <div className="pl-closing-card">
          <div className="pl-closing-copy">
            <h2 id="closing-title">Your shortlist deserves <em>a closer look.</em></h2>
            <p>Free to start. Bring the homes you’ve already found, and make the choice feel like yours.</p>
            <div className="pl-closing-actions">
              <button type="button" className="pl-button is-light pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Create a free account <ArrowRight size={18} aria-hidden="true" /></button>
              <Link className="pl-button is-light pl-mobile-auth" href="/auth/sign-up">Create a free account <ArrowRight size={18} aria-hidden="true" /></Link>
              <Link className="pl-closing-link" href={realtorHref}>Helping buyers? See FLH for Realtors</Link>
            </div>
          </div>
          <div className="pl-closing-art" aria-hidden="true">
            {closingHomes.map((crop, index) => <div className="pl-closing-photo" key={index}><SourcePhoto source="compare" crop={crop} /></div>)}
          </div>
        </div>
      </section>
    </main>
    <footer className="pl-footer"><div className="pl-footer-brand"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Homes are personal. Choosing one should be, too.</p></div><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Sign in</button><Link className="pl-mobile-auth" href="/auth/sign-in">Sign in</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Get started</button><Link className="pl-mobile-auth" href="/auth/sign-up">Get started</Link></nav><small>© 2026 Feels Like Home</small></footer>
  </div>;
}
