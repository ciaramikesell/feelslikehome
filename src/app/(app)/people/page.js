import Link from 'next/link';
import { Users, Footprints, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getRealtorRelationships } from '@/lib/supabase/collaboration';

export default async function PeoplePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const relationships = await getRealtorRelationships(supabase, user.id);
  return <main className="hh-people-page">
    <header className="hh-people-header"><span>Realtor workspace</span><h1>People I’m Helping</h1><p>See each buyer’s priorities, contenders, and decision signals in one read-only view.</p></header>
    {relationships.length ? <div className="hh-client-list">{relationships.map((client) => {
      const names = client.people.map((person) => person.display_name).join(' & ') || 'Buyer search';
      return <Link key={client.id} href={`/people/${client.id}`} className="hh-client-card"><div className="hh-client-avatar"><Users size={20} /></div><div><h2>{names}</h2><p>{client.activeCount} active {client.activeCount === 1 ? 'home' : 'homes'}{client.wantToTourCount > 0 && <> <span>·</span> <strong><Footprints size={13} /> {client.wantToTourCount} Want to Tour</strong></>}</p></div><ChevronRight size={20} /></Link>;
    })}</div> : <div className="hh-realtor-empty hh-people-empty"><Users size={28} /><h2>No client searches yet</h2><p>When a client invites you as their Realtor, their search will appear here. Invitations begin with the client, so there’s nothing you need to set up.</p></div>}
  </main>;
}
