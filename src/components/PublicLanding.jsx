import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Heart, MapPin, MessageSquareText } from 'lucide-react';
import { BrandMark } from '@/components/ui';

const values = [
  ['01', 'Bring Homes From Anywhere', 'Found a listing somewhere else? Bring that real contender into FLH and keep every option in one thoughtful place.'],
  ['02', 'Compare What Matters', 'Name your Must Haves, Important features, and Nice to Haves. Your Match reflects your priorities—not someone else’s checklist.'],
  ['03', 'Search Together', 'Co-buyers consider the same homes while each person’s priorities and perspective stay distinct.'],
  ['04', 'See the Bigger Picture', 'Understand where each home sits in relation to the places that matter to your life.'],
];

export default function PublicLanding() {
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
          <h1><span>You’ve saved a lot of options.</span><span>Now find the one that</span><em>Feels Like Home.</em></h1>
          <p className="pl-lede">Bring the homes you’re already considering into one place, compare them against what matters to you, and make your decision with confidence.</p>
          <div className="pl-actions"><Link className="pl-button" href="/auth/sign-up">Create a free account <ArrowRight size={17} aria-hidden="true" /></Link><a className="pl-button is-quiet" href="#how-it-works">See how it works</a></div>
          <p className="pl-renter-note">House, condo, or apartment — compare the places you’re actually considering.</p>
        </div>
        <figure className="pl-hero-visual"><Image src="/images/landing-hero-home.svg" alt="A welcoming cottage with a front porch at golden hour" fill priority sizes="(max-width: 900px) calc(100vw - 32px), 43vw" /></figure>
      </section>

      <section className="pl-values" id="how-it-works" aria-labelledby="values-title">
        <header><p className="pl-eyebrow">How it works</p><h2 id="values-title">Your homes. Your priorities.<br />A decision that feels like yours.</h2></header>
        <div className="pl-value-grid">{values.map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="pl-demo" aria-labelledby="demo-title">
        <figure className="pl-demo-art"><Image src="/images/landing-product-demo.svg" alt="Representative Feels Like Home comparison showing three distinct homes, their personalized Match scores, Match Breakdown, and Want to Tour controls" width={1400} height={980} sizes="(max-width: 900px) calc(100vw - 32px), 58vw" /></figure>
        <div className="pl-section-copy"><p className="pl-eyebrow">A smarter way to choose</p><h2 id="demo-title">Real homes.<br />Real priorities.</h2><p>Bring in the homes you’re genuinely considering. Feels Like Home evaluates each one against the priorities you chose, so the tradeoffs become easier to understand.</p><ul><li>Personalized Match</li><li>Side-by-side comparison</li><li>Places that matter and commute context</li><li>Search Together</li></ul><small>Representative product illustration — not live listing data.</small></div>
      </section>

      <section className="pl-together" aria-labelledby="together-title"><div className="pl-section-copy"><p className="pl-eyebrow">Search together</p><h2 id="together-title">Same home.<br />Different priorities.<br /><em>See both.</em></h2><p>FLH preserves each person’s perspective. There is no blended household Match score, and unknown information stays Unknown.</p></div><div className="pl-people-card"><div className="pl-home-label"><Heart size={18} fill="currentColor" aria-hidden="true" /> 123 Main Street</div><article><span>C</span><div><h3>Ciara <b>92% Match</b></h3><p>✓ Character &amp; charm · ✓ Fenced yard<br />? Commute at rush hour — Unknown</p></div></article><article><span>A</span><div><h3>Andrew <b>84% Match</b></h3><p>✓ Home office · ✓ Garage<br />✕ Main-floor bedroom</p></div></article></div></section>

      <section className="pl-realtor" aria-labelledby="realtor-title"><div className="pl-realtor-scene"><div className="pl-realtor-top"><span>Suggested by Whitney</span><small>Realtor contribution</small></div><div className="pl-note"><MessageSquareText size={20} aria-hidden="true" /><div><b>From Whitney</b><p>“The layout could work well for the way you described your weekdays.”</p></div></div><div className="pl-tour"><MapPin size={18} aria-hidden="true" /><b>Whitney suggests touring this home</b></div></div><div className="pl-section-copy"><p className="pl-eyebrow">Thoughtful collaboration</p><h2 id="realtor-title">Bring your Realtor into the search.</h2><p>Your Realtor can understand what matters, suggest homes, add professional context, and recommend tours. You stay in control of your priorities, Match, Want to Tour, and decisions.</p><div className="pl-actions"><Link className="pl-button" href="/auth/sign-up">Get started</Link><Link className="pl-text-link" href={realtorHref}>For Realtors <ArrowRight size={16} aria-hidden="true" /></Link></div></div></section>

      <section className="pl-philosophy"><p>THE FEELS LIKE HOME PHILOSOPHY</p><blockquote>“The right home isn’t the one that checks the most boxes. It’s the one that checks the boxes that matter to you.”</blockquote></section>
      <section className="pl-final"><h2>Ready to understand your shortlist?</h2><p>Bring the homes you’ve found. We’ll help you see which one fits.</p><Link className="pl-button" href="/auth/sign-up">Create a free account <ArrowRight size={17} aria-hidden="true" /></Link></section>
    </main>
    <footer className="pl-footer"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Homes are personal. Choosing one should be, too.</p><div><a href="#how-it-works">How it works</a><Link href={realtorHref}>For Realtors</Link><Link href="/auth/sign-in">Sign in</Link></div></footer>
  </div>;
}
