import Link from 'next/link';
import { ChevronRight, Footprints, Lock, MapPin, Search, Send, Users } from 'lucide-react';
import { STATUS_LABEL, criteriaSummary, initialsOf } from '@/lib/clientRecords';
import AddClient from '@/components/AddClient';
import InviteBuyer from '@/components/InviteBuyer';

// My Clients, as cards. Receives only what the page decided to show: the
// Realtor's own records and, for connected searches, one-line summaries of
// the buyers' preferences (never the documents themselves).
const noteLine = (notes) => (notes || '').split('\n').find((line) => line.trim())?.trim() || '';

function Status({ kind }) {
  return <span className={`hh-client-status is-${kind}`}>{STATUS_LABEL[kind]}</span>;
}

function ConnectedCard({ card }) {
  const names = card.names.join(' & ') || card.record?.name || 'Buyer search';
  const note = noteLine(card.record?.notes);
  return <Link href={`/people/${card.searchId}`} className="hh-client-tile">
    <div className="hh-client-tile-top"><span className="hh-client-initials" aria-hidden="true">{initialsOf(card.names[0] || names)}</span><Status kind="connected" /></div>
    <h3>{names}</h3>
    {card.summary.criteria.length > 0 && <p className="hh-client-tile-criteria">{card.summary.criteria.join(' · ')}</p>}
    {card.summary.areas.length > 0 && <p className="hh-client-tile-meta"><MapPin size={13} aria-hidden="true" /> {card.summary.areas.join(', ')}</p>}
    <p className="hh-client-tile-meta">{card.activeCount} active {card.activeCount === 1 ? 'home' : 'homes'}{card.wantToTourCount > 0 && <> <span aria-hidden="true">·</span> <strong><Footprints size={13} aria-hidden="true" /> {card.wantToTourCount} Want to Tour</strong></>}</p>
    {note && <p className="hh-client-tile-note"><Lock size={12} aria-hidden="true" /> {note}</p>}
    {card.flags.includes('multiple_records') && <p className="hh-client-tile-flag">You have {card.extraRecords.length + 1} private records for this client — review when you have a moment.</p>}
    {card.flags.includes('same_email') && <p className="hh-client-tile-flag">Shares an email with another of your records.</p>}
    <ChevronRight className="hh-client-tile-go" size={18} aria-hidden="true" />
  </Link>;
}

function RecordCard({ card }) {
  const { record } = card;
  const kind = card.kind === 'disconnected' ? 'disconnected' : record.status;
  const name = record.name || record.invitedEmail || (kind === 'disconnected' ? 'Former client' : 'Unnamed client');
  const criteria = kind === 'disconnected' ? [] : criteriaSummary(record.draftPriorities);
  const note = noteLine(record.notes);
  return <Link href={`/people/clients/${record.id}`} className={`hh-client-tile ${kind === 'disconnected' ? 'is-muted' : ''}`}>
    <div className="hh-client-tile-top"><span className="hh-client-initials" aria-hidden="true">{initialsOf(name)}</span><Status kind={kind} /></div>
    <h3>{name}</h3>
    {criteria.length > 0 && <p className="hh-client-tile-criteria">{criteria.join(' · ')}</p>}
    {record.preferredLocations.length > 0 && <p className="hh-client-tile-meta"><MapPin size={13} aria-hidden="true" /> {record.preferredLocations.slice(0, 3).join(', ')}</p>}
    {kind === 'invited' && <p className="hh-client-tile-meta"><Send size={13} aria-hidden="true" /> Invitation link created</p>}
    {note && <p className="hh-client-tile-note"><Lock size={12} aria-hidden="true" /> {note}</p>}
    {card.possibleMatch && <p className="hh-client-tile-flag">Might be {card.possibleMatch}, who you’re already connected with. Nothing is merged automatically.</p>}
    {card.flags.includes('same_email') && <p className="hh-client-tile-flag">Shares an email with another of your records.</p>}
    <ChevronRight className="hh-client-tile-go" size={18} aria-hidden="true" />
  </Link>;
}

export default function MyClientsView({ connected, prospective, disconnected }) {
  const empty = !connected.length && !prospective.length && !disconnected.length;
  return <main className="hh-people-page hh-clients-page">
    <header className="hh-people-header hh-clients-header">
      <div><span>Realtor workspace</span><h1>My Clients</h1><p>Everyone you’re helping, in one place.{!empty && ' Your buyers keep ownership of their search; your notes stay private to you.'}</p></div>
      {/* With no clients yet, the empty state below carries the one primary action. */}
      {!empty && <div className="hh-people-actions"><AddClient /><Link className="hh-btn hh-btn-ghost" href="/people/start"><Search size={16} /> Start a client search</Link><InviteBuyer /></div>}
    </header>

    {empty ? <section className="hh-realtor-empty hh-people-empty" aria-labelledby="people-empty-heading">
      <div className="hh-people-empty-icon"><Users size={28} /></div>
      <h2 id="people-empty-heading">Your workspace is ready</h2>
      <p>You don&apos;t have any clients here yet. Add someone you&apos;re working with — just a name is enough.</p>
      <AddClient label="Add your first client" />
      <div className="hh-clients-empty-alt"><span>Other ways to start</span><Link href="/people/start">Start a client search</Link><InviteBuyer buttonClassName="hh-clients-empty-link" /></div>
    </section> : <>
      <section className="hh-clients-section" aria-labelledby="connected-heading">
        <div className="hh-clients-section-title"><h2 id="connected-heading">Connected on Feels Like Home</h2><span>{connected.length}</span></div>
        {connected.length ? <div className="hh-client-grid">{connected.map((card) => <ConnectedCard key={card.key} card={card} />)}</div>
          : <p className="hh-clients-empty-line">When a buyer approves your request or accepts your invitation, their search appears here.</p>}
      </section>
      <section className="hh-clients-section" aria-labelledby="prospective-heading">
        <div className="hh-clients-section-title"><h2 id="prospective-heading">Not on Feels Like Home yet</h2><span>{prospective.length}</span></div>
        {prospective.length ? <div className="hh-client-grid">{prospective.map((card) => <RecordCard key={card.key} card={card} />)}</div>
          : <p className="hh-clients-empty-line">Keep track of someone before they join with <strong>Add client</strong>. Only you can see them.</p>}
      </section>
      {disconnected.length > 0 && <section className="hh-clients-section" aria-labelledby="former-heading">
        <div className="hh-clients-section-title"><h2 id="former-heading">No longer connected</h2><span>{disconnected.length}</span></div>
        <p className="hh-clients-empty-line">You can’t see these searches anymore. Only your own notes remain, until you delete them.</p>
        <div className="hh-client-grid">{disconnected.map((card) => <RecordCard key={card.key} card={card} />)}</div>
      </section>}
    </>}
  </main>;
}
