import { createClient } from '@/lib/supabase/server';
import MySearchPanel from '@/components/MySearchPanel';
import { PageIntro } from '@/components/ui';
import { normalizePriorities } from '@/lib/constants';
import { resolveActiveSearch, resolvePriorities } from '@/lib/supabase/collaboration';

export default async function SearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { search } = await resolveActiveSearch(supabase, user.id);
  const priorities = await resolvePriorities(supabase, search, user.id);

  return (
    <>
      <PageIntro title="My Search" subtitle="Review what you're looking for and what matters most to you." />
      <MySearchPanel search={search} userId={user.id} initialPriorities={normalizePriorities(priorities)} />
    </>
  );
}
