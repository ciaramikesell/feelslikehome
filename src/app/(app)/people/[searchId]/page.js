import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import { getClientRecordForSearch, getRealtorSearchContext } from '@/lib/supabase/collaboration';
import RealtorWorkspace from '@/components/RealtorWorkspace';
import { floorPlansEnabled } from '@/lib/featureFlags';
import { loadFloorPlanCardState } from '@/lib/homeFloorPlans';

export default async function RealtorSearchPage({ params }) {
  const { searchId } = await params;
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const context = await getRealtorSearchContext(supabase, user.id, searchId);
    if (!context) notFound();
    // The Realtor's own private record for this client (owner-only RLS), if any.
    // Realtors only ever view floor plans (the database refuses their writes).
    const [record, floorPlans] = await Promise.all([
      getClientRecordForSearch(supabase, searchId).catch(() => null),
      floorPlansEnabled() ? loadFloorPlanCardState(supabase, { homeIds: context.homes.map((home) => home.id) }) : null,
    ]);
    return <RealtorWorkspace context={context} record={record} floorPlans={floorPlans} />;
  });
}
