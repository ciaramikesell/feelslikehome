'use client';

import { useState } from 'react';
import { Users, Home as HomeIcon, Lock, Copy } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { createClient } from '@/lib/supabase/client';
import { createInvitation, removeMember } from '@/lib/supabase/collaboration';

// Gated presentation for a Free search. Routes to the FLH+ section instead
// of offering any real invite action — per product direction, a Free search
// must never create a real invitation or membership from here.
function GatedRelationship({ icon: Icon, title, description, unlockTitle, unlockCopy }) {
  return (
    <article className="hh-account-relationship is-gated">
      <div className="hh-account-relationship-head">
        <div className="hh-account-relationship-icon"><Icon size={20} /></div>
        <div className="hh-account-relationship-copy">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="hh-account-badge"><Lock size={11} /> FLH+ required</span>
      </div>
      <div className="hh-account-relationship-unlock">
        <div>
          <strong>{unlockTitle}</strong>
          <p>{unlockCopy}</p>
        </div>
        <a className="hh-btn hh-btn-ghost" href="#unlock-flh-plus">Learn more about FLH+ →</a>
      </div>
    </article>
  );
}

// Real invite, using the existing email-bound invitation architecture
// (createInvitation) — legitimate because the caller already confirmed
// hasFlhPlus before rendering this. Mirrors InviteCoBuyer's link-reveal
// pattern rather than inventing a second one.
function InviteRelationship({ icon: Icon, title, description, searchId, userId, relationshipType }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError('');
    try {
      const invitation = await createInvitation(createClient(), searchId, userId, email, relationshipType);
      setLink(`${window.location.origin}/invite/${invitation.token}`);
    } catch {
      setError("We couldn't create that invite. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="hh-account-relationship">
      <div className="hh-account-relationship-head">
        <div className="hh-account-relationship-icon is-active"><Icon size={20} /></div>
        <div className="hh-account-relationship-copy">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {!open ? (
        <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setOpen(true)}>Invite {relationshipType === 'co_buyer' ? 'a co-buyer' : 'your Realtor'}</button>
      ) : !link ? (
        <form onSubmit={send} className="hh-account-invite-form">
          <input className="afh-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="their@email.com" />
          <button type="submit" className="hh-btn" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
        </form>
      ) : (
        <div className="hh-account-invite-link">
          <input className="afh-input" readOnly value={link} onFocus={(event) => event.target.select()} />
          <button type="button" className="hh-btn hh-btn-ghost" onClick={() => navigator.clipboard.writeText(link)}><Copy size={14} /> Copy</button>
        </div>
      )}
      {error && <p className="hh-error-text" role="alert">{error}</p>}
    </article>
  );
}

// Connected — real search_members data, resolved via resolve_search_relationships.
function ConnectedRelationship({ icon: Icon, title, person, searchId, onRemoved }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    setWorking(true); setError('');
    try {
      await removeMember(createClient(), searchId, person.user_id);
      onRemoved(person.user_id);
    } catch {
      setError('Something went wrong. Please try again.');
      setWorking(false);
    }
  };

  return (
    <article className="hh-account-relationship">
      <div className="hh-account-relationship-head">
        <div className="hh-account-relationship-icon is-active"><Icon size={20} /></div>
        <div className="hh-account-relationship-copy">
          <h3>{person.display_name}</h3>
          <p>{title}</p>
        </div>
      </div>
      <button type="button" className="hh-btn hh-btn-ghost hh-account-remove" onClick={() => setConfirming(true)}>Remove {title.toLowerCase()}</button>
      <Sheet open={confirming} onClose={() => !working && setConfirming(false)} size="compact" title={`Remove ${person.display_name}?`}>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px', lineHeight: 1.5 }}>
          They&apos;ll lose access to this search and its homes. Your search and home data will not be deleted.
        </p>
        {error && <p className="hh-error-text" role="alert" style={{ margin: '0 0 10px' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setConfirming(false)} disabled={working}>Cancel</button>
          <button type="button" className="hh-btn" style={{ background: 'var(--brick)', borderColor: 'var(--brick)' }} onClick={remove} disabled={working}>{working ? 'Removing…' : 'Remove'}</button>
        </div>
      </Sheet>
    </article>
  );
}

export default function Connections({ hasFlhPlus, relationships, searchId, userId, onRelationshipsChange }) {
  const coBuyer = relationships.find((r) => r.role === 'co_buyer');
  const realtor = relationships.find((r) => r.role === 'realtor');
  const dropRelationship = (removedUserId) => onRelationshipsChange(relationships.filter((r) => r.user_id !== removedUserId));

  return (
    <section className="hh-account-card" aria-labelledby="connections-title">
      <span className="hh-account-eyebrow">Connections</span>
      <h2 id="connections-title">People in your search</h2>
      <p className="hh-account-card-intro">Bring the people you&apos;re making decisions with into your search.</p>

      <div className="hh-account-relationships">
        {!hasFlhPlus ? (
          <GatedRelationship
            icon={Users}
            title="Co-Buyer"
            description="Search together without combining your perspectives. Each of you keeps your own priorities, Match, Favorites, and reactions."
            unlockTitle="Unlock FLH+ to invite a co-buyer"
            unlockCopy="FLH+ lets you invite a co-buyer so you can compare the same homes while keeping your individual priorities and Match."
          />
        ) : coBuyer ? (
          <ConnectedRelationship icon={Users} title="Co-buyer" person={coBuyer} searchId={searchId} onRemoved={dropRelationship} />
        ) : (
          <InviteRelationship icon={Users} title="Co-Buyer" description="Search together without combining your perspectives. Each of you keeps your own priorities, Match, Favorites, and reactions." searchId={searchId} userId={userId} relationshipType="co_buyer" />
        )}

        {!hasFlhPlus ? (
          <GatedRelationship
            icon={HomeIcon}
            title="Your Realtor"
            description="Bring the Realtor you're already working with into your search. They can understand what matters to you, suggest homes, add professional context, and recommend homes to tour — while your decisions stay yours."
            unlockTitle="Unlock Realtor collaboration with FLH+"
            unlockCopy="FLH+ lets you invite your Realtor so you can search together and get their professional context alongside your own decision-making."
          />
        ) : realtor ? (
          <ConnectedRelationship icon={HomeIcon} title="Realtor" person={realtor} searchId={searchId} onRemoved={dropRelationship} />
        ) : (
          <InviteRelationship icon={HomeIcon} title="Your Realtor" description="Bring the Realtor you're already working with into your search." searchId={searchId} userId={userId} relationshipType="realtor" />
        )}
      </div>
    </section>
  );
}
