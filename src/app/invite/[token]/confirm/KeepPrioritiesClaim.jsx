'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { claimProspectiveSearch } from '@/lib/supabase/collaboration';

const FAILURE = {
  search_changed: 'The search you’re using changed since this page opened. Open the link again to see which search it will connect.',
  active_search_unavailable: 'We couldn’t tell which home search you’re using, so nothing was shared. Open the link again to choose.',
  wrong_account: 'This invitation was sent to a different email address. Sign in with the invited email and try again.',
};

// The buyer already has priorities in the search they're using. Connecting
// keeps them exactly as they are; the Realtor's proposed criteria are not
// applied (the claim passes no priorities, and the database refuses to
// replace existing ones).
export default function KeepPrioritiesClaim({ token, searchId, inviterName, searchLabel }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async () => {
    setBusy(true); setError('');
    try {
      const result = await claimProspectiveSearch(createClient(), token, null, searchId);
      if (!result.success) { setError(FAILURE[result.reason] || 'We couldn’t connect your Realtor. Please try again.'); setBusy(false); return; }
      router.push('/search'); router.refresh();
    } catch {
      setError('We couldn’t connect your Realtor. Please try again.'); setBusy(false);
    }
  };
  return <div className="hh-root"><div className="hh-onboarding-shell"><div className="hh-corner hh-onboarding-card">
    <div className="hh-onboarding-brand"><BrandMark size={30} /><span className="hh-serif"><span>Feels Like </span><b>Home</b></span></div>
    <section className="hh-onboarding-step">
      <header><h1 className="hh-serif">Keep your priorities and connect {inviterName}</h1>
        <p>You already have priorities in {searchLabel}. Connecting keeps them exactly as they are — {inviterName}&apos;s suggested starting criteria won&apos;t replace anything. You can change your priorities yourself anytime in My Search.</p></header>
      <p className="hh-collaboration-consent">{inviterName} will be able to see your search, priorities and homes to help. You can remove them anytime from My Search → Your People.</p>
      {error && <p className="hh-save-error" role="alert">{error}</p>}
      <nav className="hh-onboarding-actions"><a className="hh-btn hh-btn-ghost" href="/search">Not now</a><button type="button" className="hh-btn" disabled={busy} onClick={connect}>{busy ? 'Connecting…' : `Connect ${inviterName}`}</button></nav>
    </section>
  </div></div></div>;
}
