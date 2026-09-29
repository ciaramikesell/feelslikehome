'use client';

import { useState } from 'react';
import { Home as HomeIcon, Receipt, Users } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { createClient } from '@/lib/supabase/client';
import { SEARCH_UNLOCK_PRODUCT, getSearchEntitlement } from '@/lib/entitlements';
import { getPurchaseProvider, PURCHASE_UNAVAILABLE } from '@/lib/purchases';

const BENEFITS = [
  { icon: HomeIcon, title: 'Unlimited homes', body: 'Keep comparing every serious contender.' },
  { icon: Users, title: 'Search together', body: 'Your co-buyer stays included.' },
  { icon: Receipt, title: 'One purchase. No subscription.', body: `${SEARCH_UNLOCK_PRODUCT.displayPrice} once. That’s it.` },
];

// Shown only after the server refused to admit another unique home. Neither
// button can grant access: Unlock asks the purchase provider (unconfigured in
// Phase 1, so it always reports "unavailable"), and Restore only re-reads the
// server's entitlement. onUnlocked fires solely when the server says so.
export default function Paywall({ open, searchId, onClose, onUnlocked }) {
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');

  const close = () => { if (busy) return; setMessage(''); onClose?.(); };

  const unlock = async () => {
    setBusy('unlock'); setMessage('');
    try {
      const result = await getPurchaseProvider().purchaseSearchUnlock({ searchId, productId: SEARCH_UNLOCK_PRODUCT.id });
      if (result?.status === PURCHASE_UNAVAILABLE) { setMessage(result.message || 'Unlocking isn’t available yet. Nothing was charged.'); return; }
      const entitlement = await getSearchEntitlement(createClient(), searchId);
      if (entitlement?.unlocked) { setMessage(''); onUnlocked?.(entitlement); return; }
      setMessage('We couldn’t confirm an unlock for this search. Nothing was charged.');
    } catch {
      setMessage('Something went wrong. Nothing was charged — please try again.');
    } finally { setBusy(null); }
  };

  const restore = async () => {
    setBusy('restore'); setMessage('');
    try {
      await getPurchaseProvider().restorePurchases({ searchId });
      const entitlement = await getSearchEntitlement(createClient(), searchId);
      if (entitlement?.unlocked) { onUnlocked?.(entitlement); return; }
      setMessage(entitlement ? 'We didn’t find a purchase for this search.' : 'We couldn’t check your purchase right now. Try again in a moment.');
    } catch {
      setMessage('We couldn’t check your purchase right now. Try again in a moment.');
    } finally { setBusy(null); }
  };

  return <Sheet open={open} onClose={close} ariaLabel="Unlock Feels Like Home" className="flh-paywall" dismissOnBackdrop={!busy}>
    <div className="flh-paywall-body">
      <p className="flh-paywall-eyebrow">Feels Like Home</p>
      <h2 className="hh-serif flh-paywall-title">You’ve found more than three worth considering.</h2>
      <p className="flh-paywall-lead">Keep comparing without limits. Unlock Feels Like Home once and use it for the rest of your home search.</p>
      <ul className="flh-paywall-benefits">
        {BENEFITS.map(({ icon: Icon, title, body }) => <li key={title}>
          <span className="flh-paywall-icon" aria-hidden="true"><Icon size={18} /></span>
          <span><strong>{title}</strong><small>{body}</small></span>
        </li>)}
      </ul>
      <div className="flh-paywall-actions">
        <button type="button" className="hh-btn flh-paywall-primary" onClick={unlock} disabled={Boolean(busy)} aria-busy={busy === 'unlock'}>
          {busy === 'unlock' ? 'One moment…' : `Unlock Feels Like Home — ${SEARCH_UNLOCK_PRODUCT.displayPrice}`}
        </button>
        <button type="button" className="flh-text-action flh-paywall-restore" onClick={restore} disabled={Boolean(busy)} aria-busy={busy === 'restore'}>
          {busy === 'restore' ? 'Checking…' : 'Restore purchase'}
        </button>
      </div>
      {message && <p className="flh-paywall-message" role="status">{message}</p>}
      <p className="flh-paywall-footer">Your first three homes are always free.</p>
    </div>
  </Sheet>;
}
