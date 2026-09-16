'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { createClient } from '@/lib/supabase/client';
import { createInvitation } from '@/lib/supabase/collaboration';

export default function InviteCoBuyer({ searchId, userId, embedded = false, onClose }) {
  const [open, setOpen] = useState(embedded);
  const [email, setEmail] = useState('');
  const [relationshipType, setRelationshipType] = useState('co_buyer');
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
      const invitation = await createInvitation(supabase, searchId, userId, email, relationshipType);
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
    <Sheet open onClose={close} title="The house is ours. The opinion is mine." size="default" className="hh-collaboration-modal">
      <p>Invite someone as a co-buyer who is choosing with you, or as the Realtor professionally helping with your search.</p>
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
          <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
            <legend className="hh-label" style={{ marginBottom: 8 }}>Relationship</legend>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <input type="radio" name="relationship" value="co_buyer" checked={relationshipType === 'co_buyer'} onChange={(e) => setRelationshipType(e.target.value)} />{' '}
              <strong>Co-buyer</strong> — We&apos;re choosing together.
            </label>
            <label style={{ display: 'block' }}>
              <input type="radio" name="relationship" value="realtor" checked={relationshipType === 'realtor'} onChange={(e) => setRelationshipType(e.target.value)} />{' '}
              <strong>Realtor</strong> — They&apos;re helping with my home search professionally.
            </label>
          </fieldset>
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
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '8px 0 0' }}>Expires in 7 days. This invite grants {relationshipType === 'realtor' ? 'Realtor' : 'Co-buyer'} access only after the invited person signs in and accepts it.</p>
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, marginTop: 10 }} onClick={close}>Done</button>
        </>
      )}
    </Sheet>
  );
}
