'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Menu, Users, HeartHandshake } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import LandingAuthPopover from '@/components/auth/LandingAuthPopover';
import FlhPlusCards from '@/components/FlhPlusCards';

// The dedicated FLH+ informational page — what the homepage's "Learn more
// about FLH+" / "Explore FLH+" links and the public nav's FLH+ item route
// to. Purely informational: no checkout exists yet (see the Free/FLH+ cards'
// $7.99 price, which is a static display value, not a working purchase).
export default function FlhPlusLanding({ isAuthenticated = false }) {
  const startHref = isAuthenticated ? '/search' : '/auth/sign-up';
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
        <div className="pl-nav-surface"><Link href="/#how-it-works">How it works</Link><Link href="/for-realtors">For Realtors</Link><button type="button" className="pl-auth-trigger" onClick={(event) => openAuth('sign-in', event)} aria-expanded={authMode !== null}>Sign in</button></div><button type="button" className="pl-button is-small" onClick={(event) => openAuth('sign-up', event)} aria-expanded={authMode !== null}>Get started</button>
      </nav>
      <details className="pl-mobile-menu">
        <summary aria-label="Open navigation"><Menu size={20} aria-hidden="true" /><span>Menu</span></summary>
        <nav aria-label="Mobile public navigation">
          <Link href="/#how-it-works">How it works</Link><Link href="/for-realtors">For Realtors</Link><Link href="/auth/sign-in">Sign in</Link><Link className="pl-button is-small" href="/auth/sign-up">Get started</Link>
        </nav>
      </details>
      {authMode && <LandingAuthPopover mode={authMode} onModeChange={setAuthMode} onClose={closeAuth} returnFocusRef={authTriggerRef} />}
    </header>

    <main id="main" className="flh-page">
      <section className="flh-page-hero">
        <p className="pl-eyebrow">FLH+</p>
        <h1>The same search. Now shared.</h1>
        <p className="pl-lede">Feels Like Home is free to start — build your search, get personalized Match Scores, and compare your first few contenders. FLH+ is a one-time, $7.99 purchase that unlocks the rest for that search: unlimited homes, a co-buyer, and your Realtor, all in one place.</p>
      </section>

      <section className="flh-page-cards" aria-labelledby="flh-page-cards-title">
        <h2 id="flh-page-cards-title" className="pl-eyebrow">Free vs. FLH+</h2>
        <FlhPlusCards className="flh-page-cards-grid" />
      </section>

      <section className="flh-page-model" aria-labelledby="flh-page-model-title">
        <h2 id="flh-page-model-title">One purchase. One search.</h2>
        <div className="flh-page-model-grid">
          <article><Users size={20} aria-hidden="true" /><h3>It belongs to the search, not to you</h3><p>FLH+ unlocks the search it was purchased for. Anyone you invite into that search — a co-buyer or your Realtor — gets the collaborative functionality too, without paying separately or needing their own FLH+.</p></article>
          <article><HeartHandshake size={20} aria-hidden="true" /><h3>Perspectives stay separate</h3><p>Unlocking a search never blends anyone&apos;s Match, priorities, or ratings together. Each person keeps their own — FLH+ just lets you see each other&apos;s.</p></article>
        </div>
        <p className="flh-page-model-note">It&apos;s not a subscription — there&apos;s nothing to renew or cancel. A search you unlock stays unlocked.</p>
      </section>

      <section className="flh-page-cta">
        <Link className="pl-button" href={startHref}>{isAuthenticated ? 'Go to My Search' : 'Create a free account'} <ArrowRight size={17} aria-hidden="true" /></Link>
        <Link className="pl-text-link" href="/auth/sign-in">Already use FLH? Sign in</Link>
      </section>
    </main>
    <footer className="pl-footer"><div className="pl-footer-brand"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Homes are personal. Choosing one should be, too.</p></div><nav aria-label="Footer navigation"><Link href="/#how-it-works">How it works</Link><Link href="/for-realtors">For Realtors</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Sign in</button><Link className="pl-mobile-auth" href="/auth/sign-in">Sign in</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Get started</button><Link className="pl-mobile-auth" href="/auth/sign-up">Get started</Link></nav><small>© 2026 Feels Like Home</small></footer>
  </div>;
}
