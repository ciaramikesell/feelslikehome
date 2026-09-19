import Link from 'next/link';
import { Users, Footprints, ChevronRight, Search, RefreshCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getRealtorRelationships, getProspectiveSearches } from '@/lib/supabase/collaboration';
import InviteBuyer from '@/components/InviteBuyer';
import peopleWorkspace from '@/lib/supabase/peopleWorkspace.cjs';

const { loadPeopleWorkspace } = peopleWorkspace;

export default async function PeoplePage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { clients: relationships, clientsError, drafts: prospective, draftsError } = await loadPeopleWorkspace(supabase, user.id, {
      getRealtorRelationships,
      getProspectiveSearches,
    });
    return <main className="hh-people-page">
      <header className="hh-people-header"><span>Realtor workspace</span><h1>People I’m Helping</h1><p>Help a buyer get their search organized from the start.</p><div className="hh-people-actions"><Link className="hh-btn" href="/people/start"><Search size={16} /> Start a client search</Link><InviteBuyer /></div></header>
      {draftsError && <section className="hh-realtor-empty" role="alert"><h2>Couldn&apos;t load searches waiting for a buyer</h2><p>Your client list below still works. Try refreshing the page — if this keeps happening, let us know.</p></section>}
      {!draftsError && prospective.length > 0 && <section className="hh-pending-searches" aria-labelledby="pending-searches-heading"><h2 id="pending-searches-heading">Searches waiting for a buyer</h2>{prospective.map((draft) => <article key={draft.id} className="hh-client-card"><div className="hh-client-avatar"><Users size={20} /></div><div><h3>{draft.client_name || draft.invited_email || 'Client search'}</h3><p>{draft.status === 'invited' ? 'Invitation pending' : 'Not invited yet'} <span>·</span> Search started</p></div><Link href={`/people/start?id=${draft.id}`} aria-label="Edit draft search"><ChevronRight size={20} /></Link></article>)}</section>}
      {clientsError ? (
        // A real failure loading the client roster (never a fabricated empty
        // workspace) — the header/actions and any drafts above still work.
        <section className="hh-realtor-empty" role="alert"><RefreshCcw size={20} aria-hidden="true" style={{ marginBottom: 10 }} /><h2>We couldn&apos;t load your clients</h2><p>Something went wrong loading your client roster. Try refreshing the page — if this keeps happening, let us know.</p></section>
      ) : relationships.length ? <div className="hh-client-list">{relationships.map((client) => {
        const names = client.people.map((person) => person.display_name).join(' & ') || 'Buyer search';
        return <Link key={client.id} href={`/people/${client.id}`} className="hh-client-card"><div className="hh-client-avatar"><Users size={20} /></div><div><h2>{names}</h2><p>{client.activeCount} active {client.activeCount === 1 ? 'home' : 'homes'}{client.wantToTourCount > 0 && <> <span>·</span> <strong><Footprints size={13} /> {client.wantToTourCount} Want to Tour</strong></>}</p></div><ChevronRight size={20} /></Link>;
      })}</div> : prospective.length === 0 && <section className="hh-realtor-empty hh-people-empty" aria-labelledby="people-empty-heading"><div className="hh-people-empty-icon"><Users size={28} /></div><h2 id="people-empty-heading">Your workspace is ready</h2><p>You don&apos;t have any client searches yet. Start one for a buyer you&apos;re already working with — you can add what you&apos;ve learned about their search and invite them when you&apos;re ready.</p><Link className="hh-btn" href="/people/start"><Search size={16} /> Start a client search</Link><small>Your buyers keep ownership of their priorities, Match, and decisions.</small></section>}
    </main>;
  });
}
