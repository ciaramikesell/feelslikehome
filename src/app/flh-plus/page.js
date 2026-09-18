import { createClient } from '@/lib/supabase/server';
import FlhPlusLanding from '@/components/FlhPlusLanding';

export const metadata = {
  title: 'FLH+ | Feels Like Home',
  description: 'Free to start. FLH+ is a one-time purchase that unlocks unlimited homes, co-buyer collaboration, and Realtor collaboration for a search.',
};

export default async function FlhPlusPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <FlhPlusLanding isAuthenticated={Boolean(user)} />;
}
