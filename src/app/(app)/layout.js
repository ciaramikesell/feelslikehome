import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getHomes } from '@/lib/supabase/data';
import { isArchivedStatus } from '@/lib/constants';
import AppShell from '@/components/AppShell';

export default async function AppGroupLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);
  if (!profile?.onboarding_complete) redirect('/onboarding');

  // Favorites/Archive only take up nav space once they're actually useful — see
  // AppShell's dynamic tab filtering. This mirrors exactly how each page itself
  // defines its list (active-only favorites, archived-only for Archive) so the nav
  // never promises something the page won't show.
  const homes = await getHomes(supabase, user.id);
  const hasFavorites = homes.some((h) => h.reaction === 'love' && !isArchivedStatus(h.status));
  const hasArchived = homes.some((h) => isArchivedStatus(h.status));

  return <AppShell userEmail={user.email} hasFavorites={hasFavorites} hasArchived={hasArchived}>{children}</AppShell>;
}
