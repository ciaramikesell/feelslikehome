'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, LogOut, SlidersHorizontal, UserRound } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { Avatar, Chevron, IconBadge, MobilePage, PageHeading, SectionCard, SectionLabel } from '@/components/MobileSystem';
import { createClient } from '@/lib/supabase/client';
import { updateProfileName } from '@/lib/supabase/data';

// Account & Settings: an account hub — identity, access, the search this person
// is part of, and session. It is about the person, not a search, so it never
// needs an active buyer search (searchSummary may be null). Access is described
// only from what the product actually has: there is no paid-access entitlement
// in the app or database today, so none is claimed here. Only implemented
// destinations are listed (no notification, privacy, or deletion screens exist).
export default function AccountSettings({ userId, email, firstName, lastName, searchSummary }) {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [state, setState] = useState('idle');
  const dirty = first.trim() !== firstName.trim() || last.trim() !== lastName.trim();
  const displayName = [firstName, lastName].map((part) => part.trim()).filter(Boolean).join(' ');

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
    <MobilePage width="narrow" className="flh-account">
      <PageHeading title="Account" />

      <SectionCard onClick={() => setProfileOpen(true)} className="flh-account-identity" ariaLabel={`Profile details: ${displayName || 'add your name'}, ${email || 'no email on file'}`}>
        <span className="flh-card-row">
          <Avatar name={displayName || email || '?'} />
          <span className="flh-card-heading">
            <span className="flh-card-title">{displayName || 'Add your name'}</span>
            <span className="flh-card-sub">{email || 'No email on file'}</span>
          </span>
          <Chevron />
        </span>
      </SectionCard>

      <SectionLabel>My access</SectionLabel>
      <SectionCard tone="warm" className="flh-account-access" aria-labelledby="account-access">
        <div className="flh-card-row">
          <IconBadge icon={KeyRound} />
          <div className="flh-card-heading">
            <h2 id="account-access" className="flh-card-title flh-card-title-small">Everything is included</h2>
            <p className="flh-card-sub">Every part of Feels Like Home comes with your account today. There’s nothing to buy, upgrade, or manage here.</p>
          </div>
        </div>
      </SectionCard>
      {searchSummary ? (
        <SectionCard href="/search" className="flh-account-search" ariaLabel="Your search. Open My Search">
          <span className="flh-card-row">
            <IconBadge icon={SlidersHorizontal} tone="sage" />
            <span className="flh-card-heading">
              <span className="flh-card-title flh-card-title-small">Your search</span>
              <span className="flh-card-sub">{searchSummary.isOwner ? 'You started this search' : 'You were invited to this search'} · {searchSummary.participantCount > 1 ? `shared by ${searchSummary.participantCount} people` : 'just you'}. Each person keeps their own priorities and Match.</span>
            </span>
            <Chevron />
          </span>
        </SectionCard>
      ) : (
        <SectionCard href="/onboarding" className="flh-account-search" ariaLabel="No active home search. Start a search">
          <span className="flh-card-row">
            <IconBadge icon={SlidersHorizontal} tone="sage" />
            <span className="flh-card-heading">
              <span className="flh-card-title flh-card-title-small">No active home search</span>
              <span className="flh-card-sub">Start a search to add homes and see how they measure up.</span>
            </span>
            <Chevron />
          </span>
        </SectionCard>
      )}

      <SectionLabel>Account and session</SectionLabel>
      <div className="flh-account-list">
        <button type="button" className="flh-account-row" onClick={() => setProfileOpen(true)}>
          <UserRound size={17} aria-hidden="true" />
          <span><strong>Profile details</strong><small>Your name and sign-in email</small></span>
          <Chevron />
        </button>
        <Link className="flh-account-row" href="/search">
          <SlidersHorizontal size={17} aria-hidden="true" />
          <span><strong>My Search</strong><small>What you’re looking for — search-specific, not account settings</small></span>
          <Chevron />
        </Link>
      </div>
      <button type="button" className="flh-button flh-button-outline flh-button-block flh-account-signout" onClick={signOut}><LogOut size={16} aria-hidden="true" /> Sign out</button>

      <Sheet open={profileOpen} onClose={() => { setProfileOpen(false); setFirst(firstName); setLast(lastName); setState('idle'); }} title="Profile details" size="default">
        <form onSubmit={saveName} className="flh-account-form">
          <div className="flh-account-name-row">
            <div className="flh-field"><label className="flh-field-label" htmlFor="account-first">First name</label><input id="account-first" className="flh-input" value={first} onChange={(e) => { setFirst(e.target.value); setState('idle'); }} autoComplete="given-name" /></div>
            <div className="flh-field"><label className="flh-field-label" htmlFor="account-last">Last name</label><input id="account-last" className="flh-input" value={last} onChange={(e) => { setLast(e.target.value); setState('idle'); }} autoComplete="family-name" /></div>
          </div>
          <div className="flh-field"><span className="flh-field-label">Email</span><p className="flh-account-value">{email || 'No email on file'}</p></div>
          <div className="flh-account-actions">
            <button type="submit" className="flh-button flh-button-primary" disabled={!dirty || state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save name'}</button>
            <span role="status" className="flh-account-status">
              {state === 'saved' && 'Saved.'}
              {state === 'invalid' && 'Please enter your first and last name.'}
              {state === 'error' && 'We couldn’t save that. Please try again.'}
            </span>
          </div>
        </form>
      </Sheet>
    </MobilePage>
  );
}
