import Link from 'next/link';
import { ArrowRight, Check, HeartHandshake, Home, Lightbulb, Menu, MessageSquareText, Search, Send, Users } from 'lucide-react';
import { BrandMark } from '@/components/ui';

const steps = [
  [Search, 'Start their search', 'Create a search for a buyer you’re working with — even before they’ve joined Feels Like Home.'],
  [Lightbulb, 'Define the starting point', 'Add what you’ve learned about the home they want and their priorities. It stays Realtor-entered draft context until the buyer reviews it.'],
  [Home, 'Suggest better-fit homes', 'Suggest real contenders and explain why you think they’re worth considering. Match always belongs to the buyer.'],
  [Send, 'Invite them in', 'Invite the buyer to review the starting criteria, make changes, and take ownership of their preferences and decisions.'],
];

const values = [
  ['Know what matters before you send another listing', 'See the priorities your clients have identified instead of reconstructing them from texts, calls, and listing links.'],
  ['Understand the “why” behind a reaction', 'See the priorities, reactions, Match context, notes, Want to Tour state, and suggestion decisions clients choose to share in their search.'],
  ['Send homes with context', 'Suggest a listing and explain why you think it may be worth considering.'],
  ['Stay useful without taking over', 'Add professional context and recommend tours while the buyer retains control of their priorities, Match, Favorites, Want to Tour, and decisions.'],
];

export default function RealtorLanding({ isAuthenticated = false }) {
  const startHref = isAuthenticated ? '/people' : '/auth/sign-up?intent=realtor';
  return <div className="rl-root">
    <a className="pl-skip" href="#main">Skip to content</a>
    <header className="rl-header">
      <Link className="pl-brand" href="/" aria-label="Feels Like Home home"><BrandMark size={32} /><span>Feels Like <b>Home</b></span></Link>
      <nav aria-label="Realtor page navigation"><Link href="/#how-it-works">For buyers</Link><a href="#how-it-works">How it works</a><Link href="/auth/sign-in?redirect=/people">Sign in</Link><Link className="rl-button is-small" href={startHref}>{isAuthenticated ? 'Open workspace' : 'Get started'}</Link></nav>
      <details className="rl-mobile-menu"><summary aria-label="Open navigation"><Menu size={20} /><span>Menu</span></summary><nav aria-label="Mobile Realtor page navigation"><Link href="/">For buyers</Link><a href="#how-it-works">How it works</a><Link href="/auth/sign-in?redirect=/people">Sign in</Link><Link className="rl-button is-small" href={startHref}>{isAuthenticated ? 'Open workspace' : 'Get started'}</Link></nav></details>
    </header>

    <main id="main">
      <section className="rl-hero">
        <div className="rl-hero-copy"><p className="rl-eyebrow">For real estate professionals</p><h1>Know what your buyers mean when they say, <em>“It just doesn’t feel right.”</em></h1><p className="rl-lede">Feels Like Home gives you a clearer view of what each client actually values — so you can suggest better-fit homes, understand their tradeoffs, and keep the search moving.</p><div className="rl-actions"><Link className="rl-button" href={startHref}>Start helping a buyer <ArrowRight size={17} /></Link><Link className="rl-text-link" href="/auth/sign-in?redirect=/people">Already use FLH? Sign in</Link></div></div>
        <div className="rl-product-wrap"><p>Illustrative workspace preview</p><div className="rl-product-card"><header><span><Users size={17} /> Realtor workspace</span><h2>People I’m Helping</h2></header><article><span className="rl-avatar">CC</span><div><h3>Ciara Cannon</h3><p>3 active homes <b>·</b> 2 Want to Tour</p></div><span>View search <ArrowRight size={14} /></span></article><article><span className="rl-avatar is-sage">A+C</span><div><h3>Andrew + Ciara</h3><p>Search priorities confirmed</p></div><span>View search <ArrowRight size={14} /></span></article><footer><Check size={15} /> Buyers keep their own priorities and Match.</footer></div></div>
      </section>

      <section className="rl-steps" id="how-it-works" aria-labelledby="rl-steps-title"><header><p className="rl-eyebrow">How it works</p><h2 id="rl-steps-title">Help start the search. Stay useful throughout it.</h2></header><div>{steps.map(([Icon, title, copy], index) => <article key={title}><span className="rl-step-number">0{index + 1}</span><Icon size={22} /><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

      <section className="rl-value" aria-labelledby="rl-value-title"><div className="rl-value-intro"><p className="rl-eyebrow">Built for better collaboration</p><h2 id="rl-value-title">Less guessing. Better conversations.</h2><p>You bring the professional context. Feels Like Home keeps the buyer’s perspective at the center.</p><HeartHandshake size={44} /></div><div className="rl-value-list">{values.map(([title, copy]) => <article key={title}><MessageSquareText size={18} /><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></section>

      <section className="rl-cta" aria-labelledby="rl-cta-title"><div><p className="rl-eyebrow">Start with one buyer</p><h2 id="rl-cta-title">Ready to start a client’s search?</h2><p>Create your Realtor account and set up your first client.</p></div><div className="rl-actions"><Link className="rl-button is-cream" href={startHref}>{isAuthenticated ? 'Go to People I’m Helping' : 'Create Realtor account'} <ArrowRight size={17} /></Link><Link className="rl-text-link is-cream" href="/auth/sign-in?redirect=/people">Already have an account? Sign in</Link></div></section>
    </main>
    <footer className="rl-footer"><Link className="pl-brand" href="/"><BrandMark size={27} /><span>Feels Like <b>Home</b></span></Link><p>Realtors can help start the search. Buyers own their decision.</p><small>© 2026 Feels Like Home</small></footer>
  </div>;
}
