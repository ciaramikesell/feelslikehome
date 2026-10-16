import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getClientRecord } from '@/lib/supabase/collaboration';
import ClientRecordView from '@/components/ClientRecordView';

// A Realtor's private client record. RLS returns it only to the Realtor who
// owns it; anyone else gets a 404. For a connected record, whether they are
// still connected is read from their current membership on every request —
// nothing about the buyer's search is stored on the record or cached here.
export default async function ClientRecordPage({ params }) {
  const { id } = await params;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const record = await getClientRecord(supabase, id).catch(() => null);
    if (!record) notFound();
    let relationship = record.status;
    if (record.status === 'connected') {
      const { data: membership } = record.searchId
        ? await supabase.from('search_members').select('search_id').eq('search_id', record.searchId).eq('user_id', user.id).eq('role', 'realtor').maybeSingle()
        : { data: null };
      relationship = membership ? 'connected' : 'disconnected';
    }
    return <ClientRecordView record={record} relationship={relationship} />;
  });
}
