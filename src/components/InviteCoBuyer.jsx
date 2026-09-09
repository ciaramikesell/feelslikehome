'use client';

import { useState } from 'react';
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
      <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => setOpen(true)}>
        Invite co-buyer
      </button>
    );
  }

  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', marginTop: 8, maxWidth: 420 }}>
      {!inviteLink ? (
        <>
          <label className="hh-label" style={{ marginBottom: 6, display: 'block' }}>Invite a co-buyer by email</label>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 10px', lineHeight: 1.45 }}>Share homes and notes while keeping your own priorities, Match, feelings, and choices.</p>
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
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '8px 0 0' }}>Expires in 7 days. Send this link to your co-buyer however you like.</p>
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, marginTop: 10 }} onClick={close}>Done</button>
        </>
      )}
    </div>
  );
}
