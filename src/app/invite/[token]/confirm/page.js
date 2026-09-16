import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { previewInvitation } from '@/lib/supabase/collaboration';
import ClientSearchSetup from '@/components/ClientSearchSetup';

export default async function ConfirmStartedSearchPage({ params }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/sign-in?redirect=${encodeURIComponent(`/invite/${token}/confirm`)}`);
  const preview = await previewInvitation(supabase, token);
  if (!preview.valid || preview.invitation_direction !== 'realtor_to_buyer') redirect(`/invite/${token}`);
  return <ClientSearchSetup mode="buyer" token={token} inviterName={preview.inviter_display_name || 'Your Realtor'} initialDraft={{ draftPriorities: preview.draft_priorities || {} }} />;
}
