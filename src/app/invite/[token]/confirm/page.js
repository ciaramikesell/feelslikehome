import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRealtorConnectionTarget, previewInvitation } from '@/lib/supabase/collaboration';
import ClientSearchSetup from '@/components/ClientSearchSetup';
import KeepPrioritiesClaim from './KeepPrioritiesClaim';

// A Realtor started this buyer's search. It is claimed into the search the
// buyer is using (resolved by the database; without a safe one the invite page
// asks them to choose). A buyer who already has priorities there keeps them:
// the Realtor's proposal is never shown as a replacement, and the database
// refuses to overwrite them anyway.
export default async function ConfirmStartedSearchPage({ params }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/sign-in?redirect=${encodeURIComponent(`/invite/${token}/confirm`)}`);
  const preview = await previewInvitation(supabase, token);
  if (!preview.valid || preview.invitation_direction !== 'realtor_to_buyer') redirect(`/invite/${token}`);
  const target = await getRealtorConnectionTarget(supabase).catch(() => ({ searchId: null }));
  if (!target.searchId) redirect(`/invite/${token}`);
  const { data: existing } = await supabase.from('search_member_priorities').select('id')
    .eq('search_id', target.searchId).eq('user_id', user.id).maybeSingle();
  const inviterName = preview.inviter_display_name || 'Your Realtor';
  const searchLabel = target.partnerName ? `the search you share with ${target.partnerName}` : 'your home search';
  if (existing) return <KeepPrioritiesClaim token={token} searchId={target.searchId} inviterName={inviterName} searchLabel={searchLabel} />;
  return <ClientSearchSetup mode="buyer" token={token} targetSearchId={target.searchId} inviterName={inviterName} initialDraft={{ draftPriorities: preview.draft_priorities || {} }} />;
}
