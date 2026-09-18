'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Heart, HousePlus, ListChecks, MapPin, Menu, MessageSquareText, Users } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import LandingAuthPopover from '@/components/auth/LandingAuthPopover';
import FlhPlusCards from '@/components/FlhPlusCards';

const steps = [
  [ListChecks, 'Set Your Preferences', 'Tell FLH what matters to you — and how much each priority matters in your decision.'],
  [HousePlus, 'Bring Homes From Anywhere', 'Add the listings you’re actually considering and keep every contender in one place.'],
  [Heart, 'Compare What Matters', 'See how each home fits your Must Haves, Nice to Haves, and everything in between.'],
  [Users, 'Search Together', 'Bring your co-buyer and Realtor into the same search while everyone keeps their own perspective.', 'FLH+'],
];

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
        <div className="pl-nav-surface"><a href="#how-it-works">How it works</a><Link href="/flh-plus">FLH+</Link><Link href={realtorHref}>For Realtors</Link><button type="button" className="pl-auth-trigger" onClick={(event) => openAuth('sign-in', event)} aria-expanded={authMode !== null}>Sign in</button></div><button type="button" className="pl-button is-small" onClick={(event) => openAuth('sign-up', event)} aria-expanded={authMode !== null}>Get started</button>
      </nav>
      <details className="pl-mobile-menu">
        <summary aria-label="Open navigation"><Menu size={20} aria-hidden="true" /><span>Menu</span></summary>
        <nav aria-label="Mobile public navigation">
          <a href="#how-it-works">How it works</a><Link href="/flh-plus">FLH+</Link><Link href={realtorHref}>For Realtors</Link><Link href="/auth/sign-in">Sign in</Link><Link className="pl-button is-small" href="/auth/sign-up">Get started</Link>
        </nav>
      </details>
      {authMode && <LandingAuthPopover mode={authMode} onModeChange={setAuthMode} onClose={closeAuth} returnFocusRef={authTriggerRef} />}
    </header>

    <main id="main">
      <section className="pl-hero">
        <div className="pl-hero-copy">
          <p className="pl-eyebrow">Real estate, reimagined</p>
          <h1><span>You’ve saved a lot of options.</span><span>Now find the one that</span><em>Feels Like Home.</em></h1>
          <p className="pl-lede">Bring the homes you’re already considering into one place, compare them against what matters to you, and make your decision with confidence.</p>
          <div className="pl-actions"><button type="button" className="pl-button pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Create a free account <ArrowRight size={17} aria-hidden="true" /></button><Link className="pl-button pl-mobile-auth" href="/auth/sign-up">Create a free account <ArrowRight size={17} aria-hidden="true" /></Link><a className="pl-button is-quiet" href="#how-it-works">See how it works</a></div>
          <p className="pl-renter-note">House, condo, or apartment — compare the places you’re actually considering.</p>
        </div>
        <figure className="pl-hero-visual"><Image src="/images/Warm Cottage.png" alt="A welcoming cottage with a front porch at golden hour" fill priority sizes="(max-width: 900px) 100vw, 58vw" /></figure>
      </section>

      <section className="pl-values" id="how-it-works" aria-labelledby="values-title">
        <h2 className="pl-eyebrow" id="values-title">How it works</h2>
        <div className="pl-value-grid">{steps.map(([Icon, title, copy, badge]) => <article key={title}><span className="pl-step-icon"><Icon size={30} strokeWidth={1.7} aria-hidden="true" /></span><h3>{title}{badge && <span className="pl-step-badge">{badge}</span>}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="pl-demo" aria-labelledby="demo-title">
        <figure className="pl-demo-art"><Image src="/images/FLH Example.png" alt="Feels Like Home comparison of three homes with personalized Match scores and Match details" width={1536} height={1024} sizes="(max-width: 900px) calc(100vw - 32px), 55vw" /></figure>
        <div className="pl-section-copy"><p className="pl-eyebrow">Real homes. Your priorities.</p><h2 id="demo-title">The right home isn’t the one that checks the most boxes. It’s the one that checks the boxes that matter to you.</h2><ul className="pl-benefits"><li>Personalized Match Scores</li><li>Side-by-side comparison</li><li>Commute times from places that matter most</li><li>Built for buyers, co-buyers, and Realtors</li></ul><small>Representative product illustration — not live listing data.</small></div>
      </section>

      <section className="pl-flh-bridge" aria-labelledby="flh-bridge-title">
        <div className="pl-flh-bridge-intro">
          <p className="pl-eyebrow">Start for free</p>
          <h2 id="flh-bridge-title">Start with three homes.<br />Keep going for <em>$7.99 once.</em></h2>
          <p>Feels Like Home is free for your first three contenders. When your shortlist grows — or you&apos;re ready to bring someone else into the search — FLH+ unlocks the whole experience.</p>
          <Link className="pl-text-link" href="/flh-plus">Learn more about FLH+ <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <FlhPlusCards />
      </section>

      <section className="pl-collaboration" aria-labelledby="collaboration-title">
        <header><p className="pl-eyebrow">Thoughtful collaboration · FLH+</p><h2 id="collaboration-title">Choosing a home doesn’t happen alone.</h2><p className="pl-collaboration-intro">FLH+ turns your search into a shared workspace — while keeping each person’s Match, priorities, and decisions their own.</p></header>
        <div className="pl-collaboration-grid">
          <article className="pl-collaboration-story"><p className="pl-role">Co-buyer</p><h3>Searching with a co-buyer</h3><p>Compare the same homes without pretending you have the same priorities. Each person keeps their own Match, preferences, and perspective. Unknown information stays Unknown.</p><div className="pl-people-card"><div className="pl-home-label"><Heart size={17} fill="currentColor" aria-hidden="true" /> 123 Main Street</div><div className="pl-person"><span>C</span><div><h4>Ciara <b>92% Match</b></h4><p>✓ Character &amp; charm · ✓ Fenced yard<br />? Commute at rush hour — Unknown</p></div></div><div className="pl-person"><span>A</span><div><h4>Andrew <b>84% Match</b></h4><p>✓ Home office · ✓ Garage<br />✕ Main-floor bedroom</p></div></div></div></article>
          <article className="pl-collaboration-story"><p className="pl-role">Realtor</p><h3>Working with a Realtor</h3><p>Invite your Realtor to understand what matters, suggest homes, add professional context, and recommend tours — while your decisions stay yours.</p><div className="pl-realtor-scene"><div className="pl-realtor-top"><span>Suggested by Whitney</span><small>Realtor contribution</small></div><div className="pl-note"><MessageSquareText size={19} aria-hidden="true" /><div><b>From Whitney</b><p>“The layout could work well for the way you described your weekdays.”</p></div></div><div className="pl-tour"><MapPin size={17} aria-hidden="true" /><b>Whitney suggests touring this home</b></div></div><Link className="pl-text-link" href={realtorHref}>Learn more for agents <ArrowRight size={16} aria-hidden="true" /></Link></article>
        </div>
        <p className="pl-collaboration-footnote">Both are included with FLH+. Your co-buyer and Realtor don&apos;t pay separately. <Link href="/flh-plus">Explore FLH+ <ArrowRight size={15} aria-hidden="true" /></Link></p>
      </section>
    </main>
    <footer className="pl-footer"><div className="pl-footer-brand"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Homes are personal. Choosing one should be, too.</p></div><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><Link href="/flh-plus">FLH+</Link><Link href={realtorHref}>For Realtors</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Sign in</button><Link className="pl-mobile-auth" href="/auth/sign-in">Sign in</Link><button type="button" className="pl-footer-auth pl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Get started</button><Link className="pl-mobile-auth" href="/auth/sign-up">Get started</Link></nav><small>© 2026 Feels Like Home</small></footer>
  </div>;
}
