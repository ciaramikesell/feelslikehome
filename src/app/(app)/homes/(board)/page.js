import { createClient } from '@/lib/supabase/server';
import { requireUser, withAuthRecovery } from '@/lib/supabase/auth';

// My Homes itself is the (board) layout, which loads and guards the data;
// /homes has no overlay open. This page still resolves the signed-in user
// like every (app) page, so it can never render for a signed-out visitor.
export default async function HomesPage() {
  return withAuthRecovery(async () => {
    const supabase = await createClient();
    // Redirects to sign-in when there is no user; nothing else to render.
    const user = await requireUser(supabase);
    return user && null;
  });
}
