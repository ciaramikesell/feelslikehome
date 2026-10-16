import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getClientRecordForSearch, getRealtorSearchContext } from '@/lib/supabase/collaboration';
import RealtorWorkspace from '@/components/RealtorWorkspace';

export default async function RealtorSearchPage({ params }) {
  const { searchId } = await params;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const context = await getRealtorSearchContext(supabase, user.id, searchId);
    if (!context) notFound();
    // The Realtor's own private record for this client (owner-only RLS), if any.
    const record = await getClientRecordForSearch(supabase, searchId).catch(() => null);
    return <RealtorWorkspace context={context} record={record} />;
  });
}
