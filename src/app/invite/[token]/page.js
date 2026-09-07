import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { previewInvitation } from '@/lib/supabase/collaboration';
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

  // Preview happens HERE, server-side, using the session this request already
  // confirmed above — not client-side. A freshly-mounted browser client
  // (right after a sign-up + client-side redirect back to this page) can have
  // a brief window before its session is fully attached, during which an
  // authenticated-only RPC call like preview_invitation would be rejected as
  // effectively anonymous. Running it here avoids that window entirely: this
  // server request's session is already known-good by the time we get here.
  let preview;
  try {
    preview = await previewInvitation(supabase, token);
  } catch (err) {
    console.error('Server-side invitation preview failed', err);
    preview = { valid: false, reason: 'unknown' };
  }

  return <AcceptInvitationClient token={token} initialPreview={preview} />;
}
