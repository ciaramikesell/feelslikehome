'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Copy, Lock, Mail, MapPin, Pencil, Phone, Trash2 } from 'lucide-react';
import Sheet from '@/components/Sheet';
import ClientRecordForm from '@/components/ClientRecordForm';
import { createClient } from '@/lib/supabase/client';
import { deleteClientRecord, inviteProspectiveClient } from '@/lib/supabase/collaboration';
import { STATUS_LABEL, criteriaSummary, initialsOf, wishlistLabels } from '@/lib/clientRecords';

function InviteToJoin({ record }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(record.invitedEmail || record.contactEmail || '');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const create = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const invite = await inviteProspectiveClient(createClient(), record.id, email);
      setLink(`${window.location.origin}/invite/${invite.token}`);
    } catch (caught) {
      setError(/already has an active invitation/.test(caught?.message || '') ? 'There’s already a link for a different email. It expires in 7 days.' : 'We couldn’t create that link. Check the email and try again.');
    } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } };
  return <>
    <button type="button" className="hh-btn" onClick={() => setOpen(true)}><Mail size={15} /> {record.status === 'invited' ? 'Copy invitation link' : 'Invite them to join'}</button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Invite them to Feels Like Home" size="default" className="hh-client-sheet">
      <p className="flh-sheet-lead">This creates a private link for you to send yourself. No email is sent. When they open it with this email, they review your suggested starting point and decide what to keep. Your notes and contact details are never shown.</p>
      {!link ? <form className="hh-client-invite" onSubmit={create}>
        <label className="hh-client-field is-wide"><span className="hh-label">Their email</span><input className="hh-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jamie@example.com" /></label>
        {error && <p className="flh-people-error" role="alert">{error}</p>}
        <div className="flh-sheet-actions"><button type="button" className="flh-button flh-button-outline" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="flh-button flh-button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create private link'}</button></div>
      </form> : <div className="hh-client-invite">
        <p>Link ready for {email}. Feels Like Home doesn’t send it for you.</p>
        <input className="hh-input" readOnly value={link} onFocus={(event) => event.target.select()} aria-label="Invitation link" />
        <div className="flh-sheet-actions"><button type="button" className="flh-button flh-button-outline" onClick={() => setOpen(false)}>Done</button><button type="button" className="flh-button flh-button-primary" onClick={copy}><Copy size={14} /> {copied ? 'Copied' : 'Copy link'}</button></div>
        <small>Expires in 7 days.</small>
      </div>}
    </Sheet>
  </>;
}

// One private client record. Everything on this page is the Realtor's own:
// for a connected client it links to their search (buyer-owned, read live
// under the current membership) rather than repeating any of it here.
export default function ClientRecordView({ record, relationship }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = relationship === 'disconnected' ? 'disconnected' : record.status;
  const name = record.name || record.invitedEmail || (status === 'connected' ? 'Your client' : 'Unnamed client');
  const criteria = criteriaSummary(record.draftPriorities);
  const wishes = wishlistLabels(record.draftPriorities);
  const prospective = record.status === 'draft' || record.status === 'invited';

  const remove = async () => {
    setBusy(true); setError('');
    try {
      await deleteClientRecord(createClient(), record.id);
      router.push('/people'); router.refresh();
    } catch { setError('We couldn’t delete this record. Please try again.'); setBusy(false); }
  };

  return <main className="hh-people-page hh-client-page">
    <Link className="hh-client-back" href="/people">← My Clients</Link>
    <header className="hh-client-hero">
      <span className="hh-client-initials" aria-hidden="true">{initialsOf(name)}</span>
      <div>
        <span className={`hh-client-status is-${status}`}>{STATUS_LABEL[status]}</span>
        <h1>{name}</h1>
        {status === 'invited' && record.invitedEmail && <p>Invitation link created for {record.invitedEmail}. Nothing is shared until they open it and confirm.</p>}
        {status === 'draft' && <p>Not on Feels Like Home yet. Nothing here is shared with anyone.</p>}
        {status === 'connected' && <p>Connected on Feels Like Home. Their priorities, homes and decisions live in their own search.</p>}
        {status === 'disconnected' && <p>You’re no longer connected to their search, so you can’t see it. Your own notes stay here until you delete them.</p>}
      </div>
    </header>

    <div className="hh-client-actions">
      {status === 'connected' && record.searchId && <Link className="hh-btn" href={`/people/${record.searchId}`}>Open their search <ArrowRight size={15} /></Link>}
      {prospective && <InviteToJoin record={record} />}
      <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>
    </div>

    <div className="hh-client-sections">
      {prospective && <section className="hh-client-panel" aria-labelledby="client-looking">
        <h2 id="client-looking">What they’re looking for</h2>
        <p className="hh-client-panel-note">Your understanding so far. If you invite them, they’ll review it as suggestions.</p>
        {criteria.length || wishes.length ? <>
          {criteria.length > 0 && <p className="hh-client-criteria">{criteria.join(' · ')}</p>}
          {wishes.length > 0 && <ul className="hh-client-tags">{wishes.map((label) => <li key={label}>{label}</li>)}</ul>}
        </> : <p className="hh-muted">Nothing added yet.</p>}
        {prospective && <Link className="hh-client-inline-link" href={`/people/start?id=${record.id}`}>Open the full search setup</Link>}
      </section>}

      <section className="hh-client-panel" aria-labelledby="client-private">
        <h2 id="client-private"><Lock size={15} aria-hidden="true" /> Private to you</h2>
        <dl className="hh-client-details">
          <div><dt><Mail size={14} aria-hidden="true" /> Email</dt><dd>{record.contactEmail || <span className="hh-muted">—</span>}</dd></div>
          <div><dt><Phone size={14} aria-hidden="true" /> Phone</dt><dd>{record.contactPhone || <span className="hh-muted">—</span>}</dd></div>
          <div><dt><MapPin size={14} aria-hidden="true" /> Preferred locations</dt><dd>{record.preferredLocations.length ? record.preferredLocations.join(', ') : <span className="hh-muted">—</span>}</dd></div>
        </dl>
        <h3>Notes</h3>
        {record.notes ? <p className="hh-client-notes">{record.notes}</p> : <p className="hh-muted">No notes yet.</p>}
      </section>
    </div>

    <button type="button" className="hh-client-delete" onClick={() => setConfirming(true)}><Trash2 size={14} /> Delete private record</button>

    <Sheet open={editing} onClose={() => setEditing(false)} title={`Edit ${name}`} size="large" className="hh-client-sheet">
      {editing && <ClientRecordForm record={record} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh(); }} />}
    </Sheet>
    <Sheet open={confirming} onClose={() => !busy && setConfirming(false)} title="Delete this private record?" size="compact">
      <ul className="flh-people-consequences">
        <li>Your notes and contact details for {name} are deleted.</li>
        {status === 'invited' && <li>The invitation link you created stops working.</li>}
        {(status === 'connected' || status === 'disconnected') && <li>Their search isn’t affected{status === 'connected' ? ', and you stay connected' : ''}.</li>}
      </ul>
      {error && <p className="flh-people-error" role="alert">{error}</p>}
      <div className="flh-sheet-actions flh-people-confirm-actions">
        <button type="button" className="flh-button flh-button-outline" onClick={() => setConfirming(false)} disabled={busy}>Keep it</button>
        <button type="button" className="flh-button flh-button-primary" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
      </div>
    </Sheet>
  </main>;
}
