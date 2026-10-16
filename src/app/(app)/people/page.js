import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getClientRecords, getClientSearchPriorities, getRealtorRelationships } from '@/lib/supabase/collaboration';
import { buildClientCards, buyerSearchSummary } from '@/lib/clientRecords';
import MyClientsView from '@/components/MyClientsView';
import peopleWorkspace from '@/lib/supabase/peopleWorkspace.cjs';

const { loadPeopleWorkspace } = peopleWorkspace;

export default async function PeoplePage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { clients: relationships, records, priorities } = await loadPeopleWorkspace(supabase, user.id, {
      getRealtorRelationships,
      getClientRecords,
      getClientSearchPriorities,
    });
    // Buyer-owned preferences, reduced here on the server to a one-line
    // summary per connected search; the documents themselves never reach the page.
    const summaries = Object.fromEntries(relationships.map((client) => [client.id, buyerSearchSummary(priorities.filter((row) => row.search_id === client.id), client.user_id)]));
    const { connected, prospective, disconnected } = buildClientCards({ records, relationships, summaries });
    return <MyClientsView connected={connected} prospective={prospective} disconnected={disconnected} />;
  });
}
