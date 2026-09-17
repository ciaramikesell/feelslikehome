import { createClient } from '@/lib/supabase/server';
import RealtorLanding from '@/components/RealtorLanding';

export const metadata = {
  title: 'For Realtors | Feels Like Home',
  description: 'Help buyers organize what matters, suggest better-fit homes, and keep every decision in their hands.',
};

export default async function ForRealtorsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <RealtorLanding isAuthenticated={Boolean(user)} />;
}
