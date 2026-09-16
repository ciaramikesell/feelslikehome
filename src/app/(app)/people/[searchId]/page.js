import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getRealtorSearchContext } from '@/lib/supabase/collaboration';
import RealtorWorkspace from '@/components/RealtorWorkspace';

export default async function RealtorSearchPage({ params }) {
  const { searchId } = await params;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const context = await getRealtorSearchContext(supabase, user.id, searchId);
    if (!context) notFound();
    return <RealtorWorkspace context={context} />;
  });
}
