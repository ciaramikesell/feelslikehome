import Link from 'next/link';
import { UsersRound, Send, ClipboardList, SlidersHorizontal, Home as HomeIcon, MessageCircleMore, Scale, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getProfile } from '@/lib/supabase/data';
import ConnectBuyer from '@/components/ConnectBuyer';
import InviteBuyer from '@/components/InviteBuyer';

// The launchpad, not a CRM dashboard — three entry points into the existing
// connect/invite/start-a-search workflows, plus a plain-language explanation
// of what happens once a Realtor is connected to a buyer. People I'm Helping
// (the client roster) stays a separate page; this never grows into it.
export default async function RealtorHomePage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const profile = await getProfile(supabase, user.id);
    // Never derived from email — a legitimately nameless legacy account gets
    // the graceful, non-personalized greeting instead of a fabricated name.
    const firstName = profile?.first_name || null;

    return (
      <main className="hh-realtor-home">
        <header className="hh-realtor-home-hero">
          <span className="hh-realtor-home-eyebrow">Realtor workspace</span>
          <h1>Welcome to Feels Like Home{firstName ? `, ${firstName}` : ''}.</h1>
          <p>Help your buyers find a home that truly fits by collaborating in a way that puts their priorities first. Choose a path below to get started, or visit <Link href="/people">People I&apos;m Helping</Link> to see your active clients.</p>
        </header>

        <section aria-labelledby="realtor-home-paths-title">
          <span className="hh-realtor-home-eyebrow hh-realtor-home-section-eyebrow" id="realtor-home-paths-title">Choose a path to get started</span>
          <div className="hh-realtor-home-cards">
            <article className="hh-realtor-home-card">
              <div className="hh-realtor-home-card-top"><span className="hh-realtor-home-card-icon"><UsersRound size={22} /></span><span className="hh-realtor-home-card-option">Option 01</span></div>
              <h2>Connect with a buyer who already uses FLH</h2>
              <p>They&apos;ve already created their search and chosen what matters to them. Send a connection request so they can choose to give you access to their search.</p>
              <ConnectBuyer />
              <small><UsersRound size={13} aria-hidden="true" /> Requires buyer approval. You&apos;ll never access their search without their consent.</small>
            </article>

            <article className="hh-realtor-home-card">
              <div className="hh-realtor-home-card-top"><span className="hh-realtor-home-card-icon"><Send size={22} /></span><span className="hh-realtor-home-card-option">Option 02</span></div>
              <h2>Invite a buyer to Feels Like Home</h2>
              <p>Let them start their search themselves. Send an invitation and they&apos;ll create their account, choose their priorities, and can connect their search with you.</p>
              <InviteBuyer />
              <small><Send size={13} aria-hidden="true" /> They&apos;ll keep ownership of their search, criteria, and decisions.</small>
            </article>

            <article className="hh-realtor-home-card">
              <div className="hh-realtor-home-card-top"><span className="hh-realtor-home-card-icon"><ClipboardList size={22} /></span><span className="hh-realtor-home-card-option">Option 03</span></div>
              <h2>Start a buyer&apos;s search</h2>
              <p>Already know what they&apos;re looking for? Add the starting criteria you&apos;ve learned from your buyer, then invite them to review, change, and take ownership of their search.</p>
              <Link className="hh-btn" href="/people/start"><SlidersHorizontal size={16} /> Start their search</Link>
              <small><ClipboardList size={13} aria-hidden="true" /> This becomes a draft until your buyer reviews and accepts it.</small>
            </article>
          </div>
        </section>

        <section className="hh-realtor-home-editorial" aria-labelledby="realtor-home-how-title">
          <span className="hh-realtor-home-eyebrow">Once you&apos;re connected</span>
          <h2 id="realtor-home-how-title">Here&apos;s how it works</h2>
          <p className="hh-realtor-home-editorial-intro">This is what full collaboration looks like once a buyer brings you into their FLH+ search.</p>
          <div className="hh-realtor-home-steps">
            <article><span className="hh-realtor-home-step-number">01</span><span className="hh-realtor-home-step-icon"><SlidersHorizontal size={19} /></span><h3>Understand what matters</h3><p>See the priorities your buyer has chosen and how each contender fits them.</p></article>
            <article><span className="hh-realtor-home-step-number">02</span><span className="hh-realtor-home-step-icon"><HomeIcon size={19} /></span><h3>Suggest homes with context</h3><p>Bring a home into their consideration and explain why you think it&apos;s worth a look.</p></article>
            <article><span className="hh-realtor-home-step-number">03</span><span className="hh-realtor-home-step-icon"><MessageCircleMore size={19} /></span><h3>Follow their reactions</h3><p>See the decision context they choose to share as homes move through their search.</p></article>
            <article><span className="hh-realtor-home-step-number">04</span><span className="hh-realtor-home-step-icon"><Scale size={19} /></span><h3>Help them compare</h3><p>Review contenders alongside the buyer without taking over their ratings, priorities, or Match.</p></article>
          </div>

          <div className="hh-realtor-home-callout">
            <span className="hh-realtor-home-callout-icon" aria-hidden="true">🌱</span>
            <div>
              <h3>Better conversations start here.</h3>
              <p>When buyers feel informed and in control, everyone gets to a place that feels like home.</p>
            </div>
            <Link className="hh-btn hh-btn-ghost hh-realtor-home-callout-cta" href="/for-realtors#how-it-works">Learn how it works <ArrowRight size={15} /></Link>
          </div>
        </section>
      </main>
    );
  });
}
