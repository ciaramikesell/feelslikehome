import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';
import ClientSearchSetup from '@/components/ClientSearchSetup';

export default async function StartClientSearchPage({ searchParams }) {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    const user = await requireUser(supabase);
    const { id } = await searchParams;
    let initialDraft = null;
    if (id) {
      const { data } = await supabase.from('prospective_searches').select('id,client_name,invited_email,draft_priorities,status').eq('id', id).maybeSingle();
      initialDraft = data;
    }
    return <ClientSearchSetup initialDraft={initialDraft} />;
  });
}
