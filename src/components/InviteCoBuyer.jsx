'use client';

import { useState } from 'react';
import { X, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createInvitation } from '@/lib/supabase/collaboration';

export default function InviteCoBuyer({ searchId, userId, embedded = false, onClose }) {
  const [open, setOpen] = useState(embedded);
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const close = () => {
    if (embedded && onClose) onClose();
    else setOpen(false);
  };

  const submit = async () => {
    if (!email.trim()) return;
    setSending(true);
    setError('');
    try {
      const supabase = createClient();
      const invitation = await createInvitation(supabase, searchId, userId, email);
      const link = `${window.location.origin}/invite/${invitation.token}`;
      setInviteLink(link);
    } catch (err) {
      console.error('Could not create invitation', err);
      setError("We couldn't create that invite. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail quietly (permissions, older browsers) — the
      // link is still visible and selectable by hand either way.
    }
  };

  if (!open) {
    if (embedded) return null;
    return (
      <button type="button" className="hh-btn hh-btn-secondary" onClick={() => setOpen(true)}>
        <Users size={14} /> Invite collaborator
      </button>
    );
  }

  return (
    <div className="hh-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="hh-modal hh-corner hh-collaboration-modal" role="dialog" aria-modal="true" aria-labelledby="invite-collaborator-title">
        <div className="hh-collaboration-modal-heading">
          <div><div className="hh-label">Searching together</div><h2 id="invite-collaborator-title" className="hh-serif">The house is ours. The opinion is mine.</h2></div>
          <button type="button" className="hh-btn hh-btn-ghost" onClick={close} aria-label="Close"><X size={16} /></button>
        </div>
        <p>Invite someone to compare the same homes with you while keeping your individual opinions separate.</p>
        <div className="hh-collaboration-disclosure">
          <strong>Your opinions stay yours, but they aren&apos;t hidden from the people in this search.</strong>
          <p>People you search with may see your priorities, Match, Favorites, Want to Tour choices, commute destinations, notes, Overall Feeling, and how you rated a home after touring.</p>
          <p>Feels Like Home keeps each person&apos;s opinions separate—we don&apos;t combine them into one score or let another person change your preferences or ratings.</p>
        </div>
        <p className="hh-detail-context">Only people you invite to this search can see its shared-search activity.</p>
      {!inviteLink ? (
        <>
          <label className="hh-label" style={{ marginBottom: 6, display: 'block' }}>Collaborator email</label>
          <input
            className="hh-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their@email.com"
            style={{ width: '100%' }}
          />
          {error && <p style={{ fontSize: 12, color: 'var(--brick)', margin: '8px 0 0' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 12 }} onClick={close}>Cancel</button>
            <button type="button" className="hh-btn" style={{ fontSize: 12 }} onClick={submit} disabled={!email.trim() || sending}>
              {sending ? 'Creating...' : 'Create invite'}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="hh-label" style={{ marginBottom: 6, display: 'block' }}>Invite link</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="hh-input" readOnly value={inviteLink} style={{ width: '100%', fontSize: 12 }} onFocus={(e) => e.target.select()} />
            <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '8px 0 0' }}>Expires in 7 days. Send this link to your collaborator however you like.</p>
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, marginTop: 10 }} onClick={close}>Done</button>
        </>
      )}
      </div>
    </div>
  );
}
