import { createClient } from '@/lib/supabase/server';
import { getSearch } from '@/lib/supabase/data';
import MySearchPanel from '@/components/MySearchPanel';
import { PageIntro } from '@/components/ui';

export default async function SearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const search = await getSearch(supabase, user.id);

  return (
    <>
      <PageIntro title="My Search" subtitle="Review what you're looking for and what matters most to you." />
      <MySearchPanel searchId={search.id} initialPriorities={search.priorities} />
    </>
  );
}
