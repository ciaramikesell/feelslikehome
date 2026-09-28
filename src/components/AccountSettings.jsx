'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, SlidersHorizontal, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { updateProfileName } from '@/lib/supabase/data';

// Account & Settings: profile, access, and session. It never needs an active
// buyer search. Access is described only from what the product actually has:
// there is no paid-access entitlement in the app or database today, so none is
// claimed here.
export default function AccountSettings({ userId, email, firstName, lastName, searchSummary }) {
  const router = useRouter();
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [state, setState] = useState('idle');
  const dirty = first.trim() !== firstName.trim() || last.trim() !== lastName.trim();

  const saveName = async (event) => {
    event.preventDefault();
    if (!first.trim() || !last.trim()) { setState('invalid'); return; }
    setState('saving');
    try {
      await updateProfileName(createClient(), userId, first, last);
      setState('saved');
      router.refresh();
    } catch {
      setState('error');
    }
  };

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <main className="flh-account">
      <header className="flh-account-header">
        <p className="flh-eyebrow">Account &amp; Settings</p>
        <h1 className="hh-serif">Your account</h1>
      </header>

      <section className="flh-card flh-account-section" aria-labelledby="account-profile">
        <h2 id="account-profile" className="flh-section-kicker"><UserRound size={14} aria-hidden="true" /> Profile</h2>
        <form onSubmit={saveName} className="flh-account-form">
          <div className="flh-account-name-row">
            <div><label className="hh-label" htmlFor="account-first">First name</label><input id="account-first" className="hh-input" value={first} onChange={(e) => { setFirst(e.target.value); setState('idle'); }} autoComplete="given-name" /></div>
            <div><label className="hh-label" htmlFor="account-last">Last name</label><input id="account-last" className="hh-input" value={last} onChange={(e) => { setLast(e.target.value); setState('idle'); }} autoComplete="family-name" /></div>
          </div>
          <div><span className="hh-label">Email</span><p className="flh-account-value">{email || 'No email on file'}</p></div>
          <div className="flh-account-actions">
            <button type="submit" className="hh-btn" disabled={!dirty || state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save name'}</button>
            <span role="status" className="flh-account-status">
              {state === 'saved' && 'Saved.'}
              {state === 'invalid' && 'Please enter your first and last name.'}
              {state === 'error' && 'We couldn’t save that. Please try again.'}
            </span>
          </div>
        </form>
      </section>

      <section className="flh-card flh-account-section" aria-labelledby="account-access">
        <h2 id="account-access" className="flh-section-kicker">My access</h2>
        <p className="flh-account-copy">Everything in Feels Like Home today is included with your account. There’s nothing to upgrade or manage here yet.</p>
      </section>

      <section className="flh-card flh-account-section" aria-labelledby="account-search">
        <h2 id="account-search" className="flh-section-kicker"><SlidersHorizontal size={14} aria-hidden="true" /> Your search</h2>
        {searchSummary ? <>
          <p className="flh-account-copy">{searchSummary.participantCount > 1 ? `A shared search with ${searchSummary.participantCount} people.` : 'A search just for you.'}{!searchSummary.isOwner && ' You were invited to it.'}</p>
          <Link className="hh-btn hh-btn-ghost" href="/search">Open My Search</Link>
        </> : <>
          <p className="flh-account-copy">You don’t have an active home search yet.</p>
          <Link className="hh-btn hh-btn-ghost" href="/onboarding">Start a search</Link>
        </>}
      </section>

      <section className="flh-card flh-account-section" aria-labelledby="account-session">
        <h2 id="account-session" className="flh-section-kicker">Session</h2>
        <button type="button" className="hh-btn hh-btn-ghost flh-account-signout" onClick={signOut}><LogOut size={15} aria-hidden="true" /> Sign out</button>
      </section>
    </main>
  );
}
