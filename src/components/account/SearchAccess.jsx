'use client';

import { Check, Sparkles } from 'lucide-react';
import Link from 'next/link';

// "Your search access" — the FLH+ card. hasFlhPlus/entitlementSource come
// from resolve_search_entitlement (see account/page.js): a real, persisted
// per-search entitlement row, not a derived heuristic. entitlementSource
// distinguishes how access was granted ('beta' during the current beta
// period, 'purchase' once real $7.99 checkout exists, 'admin'/'promo' for
// future grants) purely for truthful copy — it never changes what unlocks.
// "Unlock FLH+" for a Free search is still an intentional, non-destructive
// placeholder — purchasing isn't wired up yet — but a search that already
// has access (beta or otherwise) never shows that CTA.
export default function SearchAccess({ hasFlhPlus, entitlementSource = null, homeCount, homeLimit = 3 }) {
  const pct = Math.min(100, Math.round((homeCount / homeLimit) * 100));
  return (
    <section className="hh-account-card hh-account-flh" aria-labelledby="search-access-title">
      <span className="hh-account-eyebrow">FLH+</span>
      <h2 id="search-access-title">Your search access</h2>
      <p className="hh-account-card-intro">FLH+ turns your shortlist into a shared home search. Invite your co-buyer and Realtor, add as many homes as you want, and keep all of your decisions in one place.</p>

      {hasFlhPlus ? (
        <div className="hh-account-access-row">
          <div className="hh-account-access-icon is-flh-plus"><Sparkles size={20} /></div>
          <div className="hh-account-access-copy">
            <span className="hh-account-access-label">Current access</span>
            <strong>FLH+</strong>
            <span className="hh-account-access-sub">{entitlementSource === 'beta' ? 'Included during beta' : 'Unlocked for this search'}</span>
          </div>
        </div>
      ) : (
        <div className="hh-account-access-row">
          <div className="hh-account-access-icon"><Sparkles size={20} /></div>
          <div className="hh-account-access-copy">
            <span className="hh-account-access-label">Current access</span>
            <strong>Free</strong>
            <span className="hh-account-access-sub">Compare up to {homeLimit} homes in this search.</span>
          </div>
          <div className="hh-account-progress">
            <span>{homeCount} of {homeLimit} homes</span>
            <div className="hh-account-progress-bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
          <Link href="/homes" className="hh-btn hh-btn-ghost">View My Homes →</Link>
        </div>
      )}

      {hasFlhPlus ? (
        <ul className="hh-account-flh-benefits is-confirmed">
          <li><Check size={15} /> Unlimited homes</li>
          <li><Check size={15} /> Co-buyer collaboration</li>
          <li><Check size={15} /> Realtor collaboration</li>
          <li><Check size={15} /> Individual Match perspectives</li>
          <li><Check size={15} /> Realtor suggestions and professional context</li>
          <li><Check size={15} /> Shared home-search experience</li>
        </ul>
      ) : (
        <div id="unlock-flh-plus" className="hh-account-unlock-card">
          <div className="hh-account-unlock-copy">
            <div className="hh-account-unlock-icon"><Sparkles size={18} /></div>
            <div>
              <h3>Unlock FLH+ for this search</h3>
              <p>Keep your search going and make it a shared experience.</p>
              <ul className="hh-account-flh-benefits">
                <li><Check size={15} /> Unlimited homes</li>
                <li><Check size={15} /> Invite a co-buyer</li>
                <li><Check size={15} /> Connect your Realtor</li>
                <li><Check size={15} /> Individual Match perspectives</li>
                <li><Check size={15} /> Realtor suggestions and professional context</li>
                <li><Check size={15} /> Shared home-search experience</li>
              </ul>
            </div>
          </div>
          <div className="hh-account-unlock-price">
            <strong>$7.99</strong>
            <span>One-time purchase</span>
            {/* No payment/entitlement architecture exists yet — this is an
                intentional, honest placeholder rather than a fake purchase.
                A future pass wires this to real checkout. */}
            <button type="button" className="hh-btn" disabled title="Purchasing isn't available yet">Unlock FLH+</button>
            <small>One purchase. One search. Everyone you invite. Your co-buyer and Realtor don&apos;t purchase separately for this FLH+ search.</small>
          </div>
        </div>
      )}
    </section>
  );
}
