'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Heart, HelpCircle, MapPin, MessageSquareText, Users, X } from 'lucide-react';
import { BrandMark } from '@/components/ui';

const homes = [
  { address: '123 Main Street', match: 92, criteria: [['check', 'Three bedrooms'], ['check', 'A welcoming outdoor space'], ['unknown', 'Morning light in the kitchen']] },
  { address: '789 Prairie Lane', match: 84, criteria: [['check', 'Dedicated home office'], ['miss', 'Under 30 minutes to work'], ['unknown', 'Quiet after dark']] },
  { address: '545 Cannon Drive', match: 76, criteria: [['check', 'Near the people who matter'], ['miss', 'Main-floor bedroom'], ['unknown', 'Room for a garden']] },
];

const values = [
  ['01', 'Bring Homes From Anywhere', 'Found a listing somewhere else? Bring that real contender into FLH and keep every option in one thoughtful place.'],
  ['02', 'Compare What Matters', 'Name your Must Haves, Important features, and Nice to Haves. Your Match reflects your priorities—not someone else’s checklist.'],
  ['03', 'Search Together', 'Co-buyers consider the same homes while each person’s priorities and perspective stay distinct.'],
  ['04', 'See the Bigger Picture', 'Understand where each home sits in relation to the places that matter to your life.'],
];

function Status({ kind, children }) {
  const Icon = kind === 'check' ? Check : kind === 'miss' ? X : HelpCircle;
  return <li className={`pl-status is-${kind}`}><Icon size={16} aria-hidden="true" /><span>{children}</span><small>{kind === 'check' ? 'matched' : kind === 'miss' ? 'does not match' : 'Unknown'}</small></li>;
}

export default function PublicLanding() {
  const [selected, setSelected] = useState(0);
  const home = homes[selected];
  const realtorHref = '/auth/sign-up?intent=realtor';
  return <div className="pl-root">
    <a className="pl-skip" href="#main">Skip to content</a>
    <header className="pl-header">
      <Link className="pl-brand" href="/" aria-label="Feels Like Home home"><BrandMark size={32} /><span>Feels Like <b>Home</b></span></Link>
      <nav aria-label="Public navigation">
        <a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><Link href="/auth/sign-in">Sign in</Link><Link className="pl-button is-small" href="/auth/sign-up">Get started</Link>
      </nav>
    </header>

    <main id="main">
      <section className="pl-hero">
        <div className="pl-hero-copy">
          <p className="pl-eyebrow">A clearer way to choose a home</p>
          <h1><span>You’ve saved a lot of options.</span> Now find the one that <em>Feels Like Home.</em></h1>
          <p className="pl-lede">Bring the homes you’re already considering into one place, compare them against what matters to you, and make your decision with confidence.</p>
          <div className="pl-actions"><Link className="pl-button" href="/auth/sign-up">Create a free account <ArrowRight size={17} /></Link><a className="pl-button is-quiet" href="#how-it-works">See how it works</a></div>
          <p className="pl-renter-note">House, condo, or apartment — compare the places you’re actually considering.</p>
        </div>
        <figure className="pl-hero-visual"><img src="/images/landing-home.svg" alt="A welcoming bungalow with a front porch on a tree-lined residential street" /><figcaption><span>Not more listings.</span> A better way to understand your shortlist.</figcaption></figure>
      </section>

      <section className="pl-values" id="how-it-works" aria-labelledby="values-title">
        <header><p className="pl-eyebrow">How it works</p><h2 id="values-title">Your homes. Your priorities.<br />A decision that feels like yours.</h2></header>
        <div className="pl-value-grid">{values.map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="pl-demo" aria-labelledby="demo-title">
        <div className="pl-section-copy"><p className="pl-eyebrow">A representative example</p><h2 id="demo-title">See the tradeoffs,<br />not just a score.</h2><p>Every Match belongs to one person and the priorities they chose. Unknown information stays unknown—it is never treated as a mismatch.</p></div>
        <div className="pl-demo-frame">
          <div className="pl-demo-tabs" role="tablist" aria-label="Sample homes">{homes.map((item, index) => <button key={item.address} type="button" role="tab" aria-selected={selected === index} aria-controls="sample-match" onClick={() => setSelected(index)}><span>{item.address}</span><b>{item.match}%</b></button>)}</div>
          <div className="pl-match-card" id="sample-match" role="tabpanel"><div className="pl-match-heading"><div><small>YOUR PERSONAL MATCH</small><h3>{home.address}</h3></div><strong>{home.match}<span>% Match</span></strong></div><div className="pl-must"><span>Must Haves</span><b>{home.criteria.filter(([kind]) => kind === 'check').length} matched</b></div><ul>{home.criteria.map(([kind, label]) => <Status key={label} kind={kind}>{label}</Status>)}</ul><p className="pl-example-label">Illustrative sample data — not a live listing</p></div>
        </div>
      </section>

      <section className="pl-together" aria-labelledby="together-title"><div className="pl-section-copy"><p className="pl-eyebrow">Search together</p><h2 id="together-title">Same home. Different priorities. See both.</h2><p>FLH preserves each person’s perspective, making agreement—and disagreement—easier to understand. There is no blended household score.</p></div><div className="pl-people-card"><div className="pl-home-label"><Heart size={18} fill="currentColor" /> 123 Main Street</div><article><span>C</span><div><h3>Ciara <b>92% Match</b></h3><p>✓ Character &amp; charm · ✓ Fenced yard<br />? Commute at rush hour</p></div></article><article><span>A</span><div><h3>Andrew <b>84% Match</b></h3><p>✓ Home office · ✓ Garage<br />✕ Main-floor bedroom</p></div></article></div></section>

      <section className="pl-realtor" aria-labelledby="realtor-title"><div className="pl-realtor-scene"><div className="pl-realtor-top"><span>Suggested by Whitney</span><small>Realtor contribution</small></div><div className="pl-note"><MessageSquareText size={20} /><div><b>From Whitney</b><p>“The layout could work well for the way you described your weekdays.”</p></div></div><div className="pl-tour"><MapPin size={18} /><b>Whitney suggests touring this home</b></div></div><div className="pl-section-copy"><p className="pl-eyebrow">Thoughtful collaboration</p><h2 id="realtor-title">Bring your Realtor into the search.</h2><p>Your Realtor can understand what matters, suggest homes, add professional context, and recommend tours. You stay in control of your priorities, Match, and decisions.</p><div className="pl-actions"><Link className="pl-button" href="/auth/sign-up">Get started</Link><Link className="pl-text-link" href={realtorHref}>For Realtors <ArrowRight size={16} /></Link></div></div></section>

      <section className="pl-philosophy"><p>THE FEELS LIKE HOME PHILOSOPHY</p><blockquote>“The right home isn’t the one that checks the most boxes. It’s the one that checks the boxes that matter to you.”</blockquote></section>
      <section className="pl-final"><Users size={28} /><h2>Ready to understand your shortlist?</h2><p>Bring the homes you’ve found. We’ll help you see which one fits.</p><Link className="pl-button" href="/auth/sign-up">Create a free account <ArrowRight size={17} /></Link></section>
    </main>
    <footer className="pl-footer"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Homes are personal. Choosing one should be, too.</p><div><a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><Link href="/auth/sign-in">Sign in</Link></div></footer>
  </div>;
}
