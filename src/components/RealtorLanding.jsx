'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Check, HeartHandshake, Home, Layers3, Mail, Menu, MessageCircleMore, Search, Send, Sparkles, Users } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import LandingAuthPopover from '@/components/auth/LandingAuthPopover';

const steps = [
  [Search, 'Start their search', 'Create a search for a buyer you’re working with — even before they’ve joined Feels Like Home.'],
  [Layers3, 'Define the starting point', 'Add what you’ve learned about the home they want and their priorities. It stays Realtor-entered draft context until the buyer reviews it.'],
  [Home, 'Suggest better-fit homes', 'Suggest real contenders and explain why you think they’re worth considering. Match always belongs to the buyer.'],
  [Mail, 'Invite them in', 'Invite the buyer to review the starting criteria, make changes, and take ownership of their preferences and decisions.'],
];

const values = [
  [Search, 'Know what matters before you send another listing', 'See the priorities your clients have identified instead of reconstructing them from texts, calls, and listing links.'],
  [MessageCircleMore, 'Understand the “why” behind a reaction', 'See the priorities, reactions, Match context, notes, Want to Tour state, and suggestion decisions clients choose to share in their search.'],
  [Send, 'Send homes with context', 'Suggest a listing and explain why you think it may be worth considering.'],
  [HeartHandshake, 'Stay useful without taking over', 'Add professional context and recommend tours while the buyer retains control of their priorities, Match, Favorites, Want to Tour, and decisions.'],
];

export default function RealtorLanding({ isAuthenticated = false }) {
  const startHref = isAuthenticated ? '/people' : '/auth/sign-up?intent=realtor';
  const [authMode, setAuthMode] = useState(null);
  const authTriggerRef = useRef(null);
  const closeAuth = useCallback(() => setAuthMode(null), []);
  const openAuth = (mode, event) => {
    authTriggerRef.current = event.currentTarget;
    setAuthMode(mode);
  };
  return <div className="rl-root">
    <a className="pl-skip" href="#main">Skip to content</a>
    <header className="rl-header">
      <Link className="pl-brand" href="/" aria-label="Feels Like Home home"><BrandMark size={32} /><span>Feels Like <b>Home</b></span></Link>
      <nav aria-label="Realtor page navigation"><Link href="/#how-it-works">For buyers</Link><a href="#how-it-works">How it works</a><button type="button" className="rl-auth-trigger" onClick={(event) => openAuth('sign-in', event)} aria-expanded={authMode !== null}>Sign in</button>{isAuthenticated ? <Link className="rl-button is-small" href={startHref}>Open workspace</Link> : <button type="button" className="rl-button is-small" onClick={(event) => openAuth('sign-up', event)} aria-expanded={authMode !== null}>Get started</button>}</nav>
      <details className="rl-mobile-menu"><summary aria-label="Open navigation"><Menu size={20} /><span>Menu</span></summary><nav aria-label="Mobile Realtor page navigation"><Link href="/">For buyers</Link><a href="#how-it-works">How it works</a><Link href="/auth/sign-in?redirect=/people">Sign in</Link><Link className="rl-button is-small" href={startHref}>{isAuthenticated ? 'Open workspace' : 'Get started'}</Link></nav></details>
      {authMode && <LandingAuthPopover mode={authMode} onModeChange={setAuthMode} onClose={closeAuth} returnFocusRef={authTriggerRef} isRealtorEntry redirectTo="/people" />}
    </header>

    <main id="main">
      <section className="rl-hero">
        <div className="rl-hero-copy"><p className="rl-eyebrow">For real estate professionals</p><h1>Know what your buyers mean when they say, <em>“It just doesn’t feel right.”</em></h1><p className="rl-lede">Feels Like Home gives you a clearer view of what each client actually values — so you can suggest better-fit homes, understand their tradeoffs, and keep the search moving.</p><div className="rl-actions">{isAuthenticated ? <Link className="rl-button" href={startHref}>Start helping a buyer <ArrowRight size={17} /></Link> : <><button type="button" className="rl-button rl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Start helping a buyer <ArrowRight size={17} /></button><Link className="rl-button rl-mobile-auth" href={startHref}>Start helping a buyer <ArrowRight size={17} /></Link></>}<button type="button" className="rl-text-link rl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Already use FLH? Sign in</button><Link className="rl-text-link rl-mobile-auth" href="/auth/sign-in?redirect=/people">Already use FLH? Sign in</Link></div></div>
        {/* Replace this local placeholder with /images/realtor-client-home-tour.jpg when the approved photo is delivered. */}
        <figure className="rl-hero-visual"><Image src="/images/Warm Cottage.png" alt="A welcoming home ready to be evaluated with a Realtor" fill priority sizes="(max-width: 900px) 100vw, 52vw" /><figcaption>Illustrative workspace preview</figcaption><div className="rl-product-card"><header><span><Users size={15} aria-hidden="true" /> Realtor workspace</span><h2>People I’m Helping</h2></header><article><span className="rl-avatar">M+C</span><div><h3>Marcus + Claire</h3><p>4 active homes <b>·</b> 2 Want to Tour</p></div></article><article><span className="rl-avatar is-sage">CF</span><div><h3>The Chen Family</h3><p>Starting criteria to review</p></div></article><footer><Check size={15} aria-hidden="true" /> Buyers keep their own priorities and Match.</footer></div></figure>
      </section>

      <section className="rl-steps" id="how-it-works" aria-labelledby="rl-steps-title"><header><p className="rl-eyebrow">How it works</p><h2 id="rl-steps-title">Help start the search.<br /> Stay connected to what matters.</h2></header><div>{steps.map(([Icon, title, copy], index) => <article key={title}><div className="rl-step-top"><span className="rl-step-icon"><Icon size={22} aria-hidden="true" /></span><span className="rl-step-number">0{index + 1}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

      <section className="rl-value" aria-labelledby="rl-value-title"><div className="rl-value-intro"><p className="rl-eyebrow">Built for better collaboration</p><h2 id="rl-value-title">Less guessing.<br /> Better conversations.</h2><p>You bring the professional context. Feels Like Home keeps the buyer’s perspective at the center.</p><span className="rl-collaboration-mark"><Sparkles size={23} aria-hidden="true" /><HeartHandshake size={35} aria-hidden="true" /></span></div><div className="rl-value-list">{values.map(([Icon, title, copy]) => <article key={title}><span><Icon size={19} aria-hidden="true" /></span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></section>

      <section className="rl-cta" aria-labelledby="rl-cta-title"><div><p className="rl-eyebrow">Start with one buyer</p><h2 id="rl-cta-title">Ready to start a client’s search?</h2><p>Create your Realtor account and set up your first client.</p></div><div className="rl-actions">{isAuthenticated ? <Link className="rl-button is-cream" href={startHref}>Go to People I’m Helping <ArrowRight size={17} /></Link> : <><button type="button" className="rl-button is-cream rl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Create Realtor account <ArrowRight size={17} /></button><Link className="rl-button is-cream rl-mobile-auth" href={startHref}>Create Realtor account <ArrowRight size={17} /></Link></>}<button type="button" className="rl-text-link is-cream rl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Already have an account? Sign in</button><Link className="rl-text-link is-cream rl-mobile-auth" href="/auth/sign-in?redirect=/people">Already have an account? Sign in</Link></div></section>
    </main>
    <footer className="rl-footer"><div className="rl-footer-brand"><Link className="pl-brand" href="/"><BrandMark size={29} /><span>Feels Like <b>Home</b></span></Link><p>Helping buyers make clearer home decisions.</p></div><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><Link href="/">For buyers</Link><button type="button" className="rl-footer-auth rl-desktop-auth" onClick={(event) => openAuth('sign-in', event)}>Sign in</button><Link className="rl-mobile-auth" href="/auth/sign-in?redirect=/people">Sign in</Link><button type="button" className="rl-footer-auth rl-desktop-auth" onClick={(event) => openAuth('sign-up', event)}>Get started</button><Link className="rl-mobile-auth" href={startHref}>Get started</Link></nav><small>© 2026 Feels Like Home</small></footer>
  </div>;
}
