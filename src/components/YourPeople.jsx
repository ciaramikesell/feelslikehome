'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Link2, Plus, UserRound } from 'lucide-react';
import Sheet from '@/components/Sheet';
import CoBuyerManagement from '@/components/CoBuyerManagement';
import InviteCoBuyer from '@/components/InviteCoBuyer';
import { Avatar, Chevron, IconBadge, SectionCard } from '@/components/MobileSystem';
import { createClient } from '@/lib/supabase/client';
import { createRealtorInvitation, removeRealtor, revokeInvitation } from '@/lib/supabase/collaboration';

// Your People: who is part of this home search. One search, several
// perspectives — buyers each keep their own priorities, ratings and reactions;
// a Realtor follows along and suggests homes. Every permission decision lives
// in the database (2026-10-15-buyer-realtor-management.sql): this component
// only asks, and shows what it was told.

const ROLE_LABEL = { owner: 'Owner', co_buyer: 'Co-buyer', realtor: 'Realtor' };

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || name;

function inviteLink(token) {
  return typeof window === 'undefined' ? `/invite/${token}` : `${window.location.origin}/invite/${token}`;
}

function daysLeft(expiresAt) {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  return days <= 1 ? 'Expires within a day' : `Expires in ${days} days`;
}

const ERROR_COPY = {
  invalid_email: 'That doesn’t look like an email address.',
  self_invite: 'That’s your own email address.',
  already_connected: 'That Realtor is already connected to this search.',
  already_a_buyer: 'That person is already a buyer in this search.',
};
const errorCopy = (err, fallback) => ERROR_COPY[Object.keys(ERROR_COPY).find((code) => String(err?.message || '').includes(code))] || fallback;

function CopyButton({ text, label = 'Copy link' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link stays visible and selectable when clipboard access is unavailable.
    }
  };
  return (
    <button type="button" className="flh-people-action" onClick={copy}>
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

function RealtorAccess() {
  return (
    <div className="flh-people-access">
      <div>
        <p className="flh-people-access-title">They can</p>
        <ul>
          <li>See each buyer’s priorities, saved homes and Want to Tour list</li>
          <li>See how each of you reacted after touring</li>
          <li>Suggest homes for you to add or dismiss</li>
        </ul>
      </div>
      <div>
        <p className="flh-people-access-title">They can’t</p>
        <ul>
          <li>Change anyone’s priorities, ratings or reactions</li>
          <li>Add, edit or remove your homes</li>
          <li>Invite or remove people</li>
        </ul>
      </div>
    </div>
  );
}

function RemoveRealtor({ realtor, searchId, onRemoved }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const name = realtor.displayName || 'your Realtor';

  const remove = async () => {
    setWorking(true);
    setError('');
    try {
      const outcome = await removeRealtor(createClient(), searchId, realtor.userId);
      setOpen(false);
      onRemoved(outcome === 'not_connected' ? `${name} had already been removed from this search.` : `${name} no longer has access to this search.`);
    } catch (err) {
      console.error('Realtor removal failed', err?.message);
      setError('We couldn’t remove them just now. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <button type="button" className="flh-people-action is-quiet" onClick={() => setOpen(true)}>Remove Realtor</button>
      <Sheet open={open} onClose={() => !working && setOpen(false)} size="compact" title={`Remove ${name}?`}>
        <ul className="flh-people-consequences">
          <li>{firstName(name)} loses access right away, including everyone’s priorities and reactions.</li>
          <li>Homes you added from their suggestions stay in your Homes.</li>
          <li>Suggestions you haven’t answered are withdrawn.</li>
        </ul>
        {error && <p className="flh-people-error" role="alert">{error}</p>}
        <div className="flh-sheet-actions flh-people-confirm-actions">
          <button type="button" className="flh-button flh-button-outline" onClick={() => setOpen(false)} disabled={working}>Keep {firstName(name)}</button>
          <button type="button" className="flh-button flh-button-primary" onClick={remove} disabled={working}>{working ? 'Removing…' : 'Remove'}</button>
        </div>
      </Sheet>
    </>
  );
}

function InviteRealtor({ searchId, onInvited }) {
  const [email, setEmail] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setWorking(true);
    setError('');
    try {
      const invitation = await createRealtorInvitation(createClient(), searchId, email);
      onInvited({ ...invitation, email: email.trim().toLowerCase() });
      setEmail('');
    } catch (err) {
      console.error('Realtor invitation failed', err?.message);
      setError(errorCopy(err, 'We couldn’t create that link. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <form className="flh-people-invite" onSubmit={submit}>
      <label htmlFor="realtor-invite-email" className="flh-people-label">Your Realtor’s email</label>
      <div className="flh-people-invite-row">
        <input id="realtor-invite-email" className="hh-input" type="email" autoComplete="off" inputMode="email" placeholder="name@brokerage.com" aria-describedby="realtor-invite-hint" value={email} onChange={(event) => setEmail(event.target.value)} />
        <button type="submit" className="flh-button flh-button-primary" disabled={!email.trim() || working}><Link2 size={16} aria-hidden="true" /> {working ? 'Creating…' : 'Create private link'}</button>
      </div>
      {error && <p className="flh-people-error" role="alert">{error}</p>}
      <p id="realtor-invite-hint" className="flh-people-note">No email is sent. The address only makes sure the link opens for the right person; they see this search after they sign in with it and accept.</p>
    </form>
  );
}

function InvitationRow({ invitation, onRevoke, onReplace, busy }) {
  const incoming = invitation.direction === 'realtor_to_buyer';
  const pending = invitation.status === 'pending';
  const statusText = { pending: daysLeft(invitation.expiresAt), expired: 'Expired', revoked: incoming ? 'Declined' : 'Revoked' }[invitation.status] || invitation.status;
  return (
    <li className="flh-people-invitation">
      <div className="flh-people-invitation-text">
        <p className="flh-people-name">{incoming ? `${invitation.inviterName || 'A Realtor'} wants to connect as your Realtor` : invitation.email}</p>
        <p className={`flh-people-status is-${invitation.status}`}>{incoming ? 'Connection request · ' : 'Private link · '}{statusText}</p>
      </div>
      <div className="flh-people-invitation-actions">
        {incoming && pending && <a className="flh-people-action is-primary" href={`/invite/${invitation.token}`}>Review</a>}
        {!incoming && pending && invitation.token && <CopyButton text={inviteLink(invitation.token)} />}
        {pending && <button type="button" className="flh-people-action is-quiet" onClick={() => onRevoke(invitation)} disabled={busy}>{incoming ? 'Decline' : 'Revoke'}</button>}
        {!incoming && !pending && <button type="button" className="flh-people-action" onClick={() => onReplace(invitation)} disabled={busy}>Create a new link</button>}
      </div>
    </li>
  );
}

function PersonRow({ person, children, trailing }) {
  const tone = person.role === 'realtor' ? 'sage' : 'warm';
  return (
    <li className={`flh-people-person is-${person.role}`}>
      <Avatar name={person.isYou ? 'You' : person.displayName} tone={tone} />
      <div className="flh-people-person-text">
        <p className="flh-people-name">{person.isYou ? 'You' : person.displayName}<span className={`flh-people-role is-${person.role}`}>{ROLE_LABEL[person.role]}</span></p>
        {children}
      </div>
      {trailing}
    </li>
  );
}

export default function YourPeople({ search, userId, isOwner, participantCount, memberUserId, people, invitations, collaboratorSummary = null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [coBuyerInviteOpen, setCoBuyerInviteOpen] = useState(false);
  const [list, setList] = useState(invitations || []);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removedRealtors, setRemovedRealtors] = useState([]);
  const [fresh, setFresh] = useState(null);
  const messageRef = useRef(null);
  // Actions sit lower in the sheet than their outcome message: bring it into view.
  useEffect(() => {
    if ((notice || error) && messageRef.current?.scrollIntoView) messageRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice, error]);

  // The database refused to describe this search to this person (e.g. a stale
  // pointer to a search they're only a Realtor on): show nothing rather than guess.
  if (!people) return null;

  const buyers = people.filter((person) => person.role !== 'realtor');
  const realtors = people.filter((person) => person.role === 'realtor' && !removedRealtors.includes(person.userId));
  const others = buyers.filter((person) => !person.isYou);
  const me = buyers.find((person) => person.isYou) || { role: isOwner ? 'owner' : 'co_buyer', isYou: true };
  const requests = list.filter((item) => item.direction === 'realtor_to_buyer' && item.status === 'pending');
  const sent = list.filter((item) => item.direction !== 'realtor_to_buyer');
  const solo = others.length === 0;

  const summary = [
    ...others.map((person) => `${firstName(person.displayName)} (${ROLE_LABEL[person.role].toLowerCase()})`),
    ...realtors.map((person) => `${firstName(person.displayName)} (Realtor)`),
  ];

  const refresh = () => router.refresh();

  const revoke = async (invitation) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const outcome = await revokeInvitation(createClient(), invitation.id);
      setList((items) => items.map((item) => (item.id === invitation.id ? { ...item, status: outcome === 'already_accepted' ? 'accepted' : 'revoked', token: null } : item)).filter((item) => item.status !== 'accepted'));
      setNotice(invitation.direction === 'realtor_to_buyer' ? 'Request declined.' : outcome === 'already_accepted' ? 'That link was already accepted.' : 'Link revoked. It no longer works.');
      if (outcome === 'already_accepted') refresh();
    } catch (err) {
      console.error('Revoking invitation failed', err?.message);
      setError('We couldn’t update that link. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const replace = async (invitation) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await createRealtorInvitation(createClient(), search.id, invitation.email);
      onInvited({ ...created, email: invitation.email });
    } catch (err) {
      console.error('Replacement invitation failed', err?.message);
      setError(errorCopy(err, 'We couldn’t create a new link. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  function onInvited(invitation) {
    const row = { id: invitation.id, direction: 'buyer_to_realtor', email: invitation.email, status: 'pending', expiresAt: invitation.expiresAt, token: invitation.token };
    setList((items) => [row, ...items.filter((item) => item.id !== row.id)]);
    setFresh(row);
    setNotice(invitation.reused ? 'You already have a link waiting for this email — here it is again.' : 'Private link ready. Copy it and send it to your Realtor yourself.');
  }

  const onRemoved = (message) => {
    setRemovedRealtors((ids) => [...ids, ...realtors.map((person) => person.userId)]);
    setNotice(message);
    refresh();
  };

  return (
    <>
      <SectionCard tone="warm" onClick={() => setOpen(true)} className="flh-together-summary flh-people-summary" ariaLabel={`Your People. ${summary.length ? `Searching with ${summary.join(', ')}` : 'Just you so far'}. Manage`}>
        <div className="flh-card-row">
          {summary.length
            ? <span className="flh-avatar-stack"><Avatar name="You" />{others.map((person) => <Avatar key={person.userId} name={person.displayName} />)}{realtors.map((person) => <Avatar key={person.userId} name={person.displayName} tone="sage" />)}</span>
            : <IconBadge icon={Plus} />}
          <div className="flh-card-heading">
            <h2 className="flh-card-title">Your People</h2>
            <p className="flh-card-sub">
              {summary.length ? summary.join(' · ') : <>Just you so far. <span className="flh-link-text">Invite a co-buyer or your Realtor →</span></>}
            </p>
          </div>
          {requests.length > 0 && <span className="flh-people-badge">{requests.length === 1 ? '1 request' : `${requests.length} requests`}</span>}
          <Chevron />
        </div>
      </SectionCard>

      <Sheet open={open} onClose={() => setOpen(false)} title="Your People" size="large" className="flh-people-sheet">
        <p className="flh-sheet-lead">One home search, more than one perspective. Everyone here sees this search; each buyer keeps their own priorities, ratings and reactions.</p>
        <div ref={messageRef}>
          {notice && <p className="flh-people-notice" role="status">{notice}</p>}
          {error && <p className="flh-people-error" role="alert">{error}</p>}
        </div>

        {requests.length > 0 && (
          <section className="flh-people-section" aria-labelledby="people-requests">
            <h3 id="people-requests" className="flh-people-heading">Waiting for you</h3>
            <ul className="flh-people-list">{requests.map((item) => <InvitationRow key={item.id} invitation={item} onRevoke={revoke} onReplace={replace} busy={busy} />)}</ul>
          </section>
        )}

        <section className="flh-people-section" aria-labelledby="people-buyers">
          <h3 id="people-buyers" className="flh-people-heading">Buyers</h3>
          <ul className="flh-people-list">
            <PersonRow person={me}><p className="flh-people-detail">{me.role === 'owner' ? 'You started this search.' : 'You’re searching together.'}</p></PersonRow>
            {others.map((person) => (
              <PersonRow key={person.userId} person={person}>
                <p className="flh-people-detail">{person.role === 'owner' ? 'Started this search. Their priorities and ratings are their own.' : 'Choosing with you. Their priorities and ratings are their own.'}</p>
                {collaboratorSummary}
              </PersonRow>
            ))}
          </ul>
          {participantCount > 1 && (
            <div className="flh-people-buyer-actions">
              <CoBuyerManagement userId={userId} search={search} isOwner={isOwner} participantCount={participantCount} memberUserId={memberUserId} collaboratorName={others[0]?.displayName} />
            </div>
          )}
          {isOwner && solo && (
            <button type="button" className="flh-people-add" onClick={() => setCoBuyerInviteOpen(true)}>
              <UserRound size={17} aria-hidden="true" /> <span><strong>Invite a co-buyer</strong> Someone choosing this home with you</span>
            </button>
          )}
        </section>

        <section className="flh-people-section" aria-labelledby="people-realtor">
          <h3 id="people-realtor" className="flh-people-heading">Realtor</h3>
          {realtors.length > 0 ? (
            <ul className="flh-people-list">
              {realtors.map((person) => (
                <PersonRow key={person.userId} person={person} trailing={null}>
                  <p className="flh-people-detail">Helping with your search. They follow along and suggest homes; every decision stays yours.</p>
                  <RealtorAccess />
                  <RemoveRealtor realtor={person} searchId={search.id} onRemoved={onRemoved} />
                </PersonRow>
              ))}
            </ul>
          ) : (
            <div className="flh-people-empty">
              <p className="flh-people-empty-title">Working with a Realtor?</p>
              <p className="flh-people-detail">Create a private link to share this search with them. Feels Like Home doesn’t send it for you: copy the link and send it yourself, however you usually reach them. They can suggest homes, but can’t change anyone’s priorities or ratings.</p>
              <InviteRealtor searchId={search.id} onInvited={onInvited} />
            </div>
          )}
          {fresh?.token && (
            <div className="flh-people-fresh">
              <label className="flh-people-label" htmlFor="realtor-invite-link">Private link for {fresh.email}</label>
              <div className="flh-people-invite-row">
                <input id="realtor-invite-link" className="hh-input" readOnly value={inviteLink(fresh.token)} onFocus={(event) => event.target.select()} />
                <CopyButton text={inviteLink(fresh.token)} />
              </div>
              <p className="flh-people-note">We haven’t emailed anyone. Copy this link and send it yourself. It works for 7 days, only for {fresh.email}.</p>
            </div>
          )}
          {sent.length > 0 && (
            <>
              <h4 className="flh-people-subheading">Private links</h4>
              <ul className="flh-people-list">{sent.map((item) => <InvitationRow key={item.id} invitation={item} onRevoke={revoke} onReplace={replace} busy={busy} />)}</ul>
            </>
          )}
        </section>
      </Sheet>
      {coBuyerInviteOpen && <InviteCoBuyer searchId={search.id} userId={userId} embedded coBuyerOnly onClose={() => setCoBuyerInviteOpen(false)} />}
    </>
  );
}
