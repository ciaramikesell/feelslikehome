import Link from 'next/link';
import { Users, Footprints, ChevronRight, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getRealtorRelationships, getProspectiveSearches } from '@/lib/supabase/collaboration';
import InviteBuyer from '@/components/InviteBuyer';

export default async function PeoplePage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const [relationships, prospective] = await Promise.all([getRealtorRelationships(supabase, user.id), getProspectiveSearches(supabase)]);
    return <main className="hh-people-page">
      <header className="hh-people-header"><span>Realtor workspace</span><h1>People I’m Helping</h1><p>Keep your clients&apos; searches organized without taking over their decision.</p><div className="hh-people-actions"><Link className="hh-btn" href="/people/start"><Search size={16} /> Start a client&apos;s search</Link><InviteBuyer /></div></header>
      {prospective.length > 0 && <section className="hh-pending-searches" aria-labelledby="pending-searches-heading"><h2 id="pending-searches-heading">Searches waiting for a buyer</h2>{prospective.map((draft) => <article key={draft.id} className="hh-client-card"><div className="hh-client-avatar"><Users size={20} /></div><div><h3>{draft.client_name || draft.invited_email || 'Client search'}</h3><p>{draft.status === 'invited' ? 'Invitation pending' : 'Not invited yet'} <span>·</span> Search started</p></div><Link href={`/people/start?id=${draft.id}`} aria-label="Edit draft search"><ChevronRight size={20} /></Link></article>)}</section>}
      {relationships.length ? <div className="hh-client-list">{relationships.map((client) => {
        const names = client.people.map((person) => person.display_name).join(' & ') || 'Buyer search';
        return <Link key={client.id} href={`/people/${client.id}`} className="hh-client-card"><div className="hh-client-avatar"><Users size={20} /></div><div><h2>{names}</h2><p>{client.activeCount} active {client.activeCount === 1 ? 'home' : 'homes'}{client.wantToTourCount > 0 && <> <span>·</span> <strong><Footprints size={13} /> {client.wantToTourCount} Want to Tour</strong></>}</p></div><ChevronRight size={20} /></Link>;
      })}</div> : prospective.length === 0 && <div className="hh-realtor-empty hh-people-empty"><Users size={28} /><h2>People I’m Helping</h2><p>Set up what you already know about what they&apos;re looking for, then invite them to make the search their own.</p><Link className="hh-btn" href="/people/start">Start a client&apos;s search</Link><div className="hh-empty-secondary"><span>Or, if you&apos;d rather let the buyer establish their own criteria:</span><InviteBuyer /></div></div>}
    </main>;
  });
}
