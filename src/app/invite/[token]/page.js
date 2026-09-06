import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AcceptInvitationClient from './AcceptInvitationClient';

export default async function InvitePage({ params }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Not signed in — preserve this exact destination through sign-in, per the
  // explicit requirement not to dump the invitee on Homes and lose the
  // invite. The sign-in/sign-up pages read this same `redirect` param.
  if (!user) {
    redirect(`/auth/sign-in?redirect=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return <AcceptInvitationClient token={token} />;
}
