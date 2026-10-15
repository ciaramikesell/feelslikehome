import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAccessibleSearches, getRealtorConnectionTarget, previewInvitation } from '@/lib/supabase/collaboration';
import { getProfile } from '@/lib/supabase/data';
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

  // Whether this person already has a buyer experience: a failed Realtor
  // invitation only records the Realtor workspace preference for someone who
  // hasn't (see remembersRealtorFromFailedInvitation).
  const profile = await getProfile(supabase, user.id).catch(() => null);

  // A buyer approving a Realtor's connection request approves it for the
  // search they are using, as resolved by the database. When that can't be
  // established safely (a stale active search, for example) the screen says so
  // and offers the searches they buy in, rather than picking one for them; the
  // database re-checks the target when they approve.
  const approvalTarget = preview.valid && preview.invitation_direction === 'realtor_to_buyer' && !preview.requires_confirmation
    ? await approvalTargetFor(supabase, user.id).catch(() => ({ error: 'unknown', options: [] }))
    : null;

  return <AcceptInvitationClient token={token} initialPreview={preview} onboardingComplete={Boolean(profile?.onboarding_complete)} approvalTarget={approvalTarget} />;
}

async function approvalTargetFor(supabase, userId) {
  const target = await getRealtorConnectionTarget(supabase);
  if (!target.searchId) {
    const options = (await getAccessibleSearches(supabase, userId).catch(() => []))
      .filter((search) => search.relationshipType === 'owner' || search.relationshipType === 'co_buyer')
      .map((search) => ({ id: search.id, label: search.label }));
    return { error: target.reason, options };
  }
  return {
    id: target.searchId,
    label: target.partnerName ? `The search you share with ${target.partnerName}` : 'Your home search',
    homeCount: target.homeCount,
  };
}
