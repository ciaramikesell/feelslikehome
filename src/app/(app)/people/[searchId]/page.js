import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRealtorSearchContext } from '@/lib/supabase/collaboration';
import RealtorWorkspace from '@/components/RealtorWorkspace';

export default async function RealtorSearchPage({ params }) {
  const { searchId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const context = await getRealtorSearchContext(supabase, user.id, searchId);
  if (!context) notFound();
  return <RealtorWorkspace context={context} />;
}
