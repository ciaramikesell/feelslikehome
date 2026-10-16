'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { acceptInvitation, approveRealtorConnection, setActiveSearch } from '@/lib/supabase/collaboration';
import { ANALYTICS_EVENTS, track } from '@/lib/analytics';
import { REALTOR_WORKSPACE_PATH, invitationAcceptance, rememberRealtorWorkspace, remembersRealtorFromFailedInvitation } from '@/lib/realtorEntry';
import { BrandMark, Wordmark } from '@/components/ui';

const REASON_COPY = {
  not_found: "This invite link doesn't look right. Double-check the link, or ask for a new one.",
  already_accepted: 'This invite has already been used.',
  revoked: 'This invite has been cancelled by the person who sent it.',
  expired: 'This invite has expired. Ask your collaborator to send a new one.',
  self_invite: "You can't accept an invite you sent yourself.",
  wrong_account: "This invite was sent to a different email address than the one you're signed in with. Sign in with the invited email and try again.",
  not_authenticated: 'Please sign in first.',
  search_not_authorized: "We couldn't confirm which of your searches to connect. Open My Search, then try this link again.",
  search_changed: 'The search you’re using changed since this page opened. Open this link again to see which search it will connect.',
  active_search_unavailable: "We couldn't tell which home search you're using, so nothing was shared. Open this link again to choose.",
  no_search: "You don't have a home search yet. Start one, then open this link again.",
  relationship_conflict: 'They’re already part of this search as a buyer.',
  priorities_exist: 'You already have priorities in this search. Open this link again to connect without changing them.',
  confirmation_required: 'Review and confirm your priorities first. Open this link again to continue.',
  draft_unavailable: 'Your Realtor withdrew this search. Ask them for a new link.',
  accepted: 'This request has already been used.',
  unknown: 'Something went wrong. Please try again.',
};

// The preview result now arrives already resolved from the server (see
// page.js) — no client-side fetch, no loading state needed for it, and no
// exposure to the session-propagation race that caused this to fail right
// after a fresh sign-up.
export default function AcceptInvitationClient({ token, initialPreview, onboardingComplete = false, approvalTarget = null }) {
  const router = useRouter();
  const [state, setState] = useState(initialPreview.valid ? 'valid' : 'invalid'); // valid | invalid | accepting | done
  const [reason, setReason] = useState(initialPreview.reason || '');
  const isRealtorInvite = initialPreview.relationship_type === 'realtor';
  const isBuyerInvite = initialPreview.invitation_direction === 'realtor_to_buyer';
  // A realtor_to_buyer invite only needs the confirm/priorities-review step
  // when it carries a Realtor-authored draft (prospective_searches) to
  // review. A direct connection request to an existing buyer has no draft —
  // accepting it only grants access to the search the buyer already has.
  const requiresConfirmation = isBuyerInvite && Boolean(initialPreview.requires_confirmation);
  const inviterName = initialPreview.inviter_display_name || 'Your Realtor';
  const asRealtor = isRealtorInvite && !isBuyerInvite;
  // No safe approval target (e.g. a stale active search): nothing is approved
  // until the buyer picks the search they are using.
  const needsTarget = isBuyerInvite && Boolean(approvalTarget?.error);
  const [choosing, setChoosing] = useState('');

  const useSearch = async (searchId) => {
    setChoosing(searchId);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await setActiveSearch(supabase, user.id, searchId);
      router.refresh();
    } catch (err) {
      console.error('Could not switch search', err?.message);
      setChoosing('');
    }
  };

  // Someone who came to FLH through a Realtor invitation keeps the Realtor
  // workspace even when that invitation can't be used (expired, revoked,
  // already used), instead of being routed into buyer onboarding.
  useEffect(() => {
    if (remembersRealtorFromFailedInvitation({ preview: initialPreview, onboardingComplete })) rememberRealtorWorkspace(createClient());
  }, [initialPreview, onboardingComplete]);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push(`/auth/sign-in?redirect=${encodeURIComponent(`/invite/${token}`)}`);
    router.refresh();
  };

  const accept = async () => {
    if (requiresConfirmation) {
      router.push(`/invite/${token}/confirm`);
      return;
    }
    setState('accepting');
    try {
      const supabase = createClient();
      // A Realtor's connection request is approved for the search shown on this
      // screen (the one this buyer is using); the database verifies they are a
      // buyer of it. Every other invitation keeps its own target.
      const result = isBuyerInvite
        ? (approvalTarget?.id ? await approveRealtorConnection(supabase, token, approvalTarget.id) : { success: false, reason: approvalTarget?.error || 'search_not_authorized' })
        : await acceptInvitation(supabase, token);
      if (!result.success) {
        // Safe to log: `reason` is either a known short code (e.g.
        // 'wrong_account') or, for an unexpected failure, a sanitized
        // 'error_<stage>_<sqlstate>' string with no token/email/user id/
        // search id in it — see accept_invitation's exception handler.
        console.error('Invitation not accepted, reason:', result.reason);
        setState('invalid');
        setReason(result.reason);
        return;
      }
      const next = invitationAcceptance({
        relationshipType: initialPreview.relationship_type,
        invitationDirection: initialPreview.invitation_direction,
        searchId: result.search_id,
      });
      // A Realtor's client search never becomes their own active buyer search;
      // their Realtor workspace preference outlives this one relationship.
      if (asRealtor) await rememberRealtorWorkspace(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (next.setActiveSearch && user && result.search_id) {
        await setActiveSearch(supabase, user.id, result.search_id);
      }
      // role = the collaborator who joined the search (a Realtor for both Realtor directions).
      track(ANALYTICS_EVENTS.COLLABORATOR_JOINED, { role: isBuyerInvite || isRealtorInvite ? 'realtor' : 'co_buyer', surface: 'invitation' });
      setState('done');
      setTimeout(() => { router.push(next.destination); router.refresh(); }, 1200);
    } catch (err) {
      console.error('Invitation acceptance failed', err);
      setState('invalid');
      setReason('unknown');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--paper)' }}>
      <div style={{ maxWidth: 420, width: '100%', background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 20, padding: '32px 28px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <BrandMark size={38} />
        </div>

        {state === 'valid' && (
          <>
            <h1 className="hh-serif" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>{!isBuyerInvite ? (isRealtorInvite ? "You've been invited as a Realtor" : "You've been invited to search together") : requiresConfirmation ? `${inviterName} invited you to Feels Like Home` : `${inviterName} wants to connect as your Realtor`}</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, margin: '0 0 20px' }}>
              {!isBuyerInvite ? (
                isRealtorInvite ? (
                  <>You&apos;ll be able to understand this buyer&apos;s search, homes, priorities, and opinions. You can see their decision, but you cannot make or change it for them.</>
                ) : (
                  <>You&apos;ll share the same collection of homes and be able to see each other&apos;s search preferences and opinions. Your ratings and preferences stay under your control—no one else can change them for you.</>
                )
              ) : requiresConfirmation ? (
                <>Keep the homes you&apos;re considering in one place, see how each one matches what matters to you, and make it easier for {inviterName} to understand what you&apos;re looking for. This remains your search.{approvalTarget?.id && <span className="hh-invite-target"><strong>{approvalTarget.label}</strong>{approvalTarget.homeCount} saved {approvalTarget.homeCount === 1 ? 'home' : 'homes'}</span>}</>
              ) : (
                <>{inviterName} will be able to see your search, priorities, and homes so they can help — nothing changes about your search itself, and you can remove them anytime from My Search → Your People.{approvalTarget?.id && <span className="hh-invite-target"><strong>{approvalTarget.label}</strong>{approvalTarget.homeCount} saved {approvalTarget.homeCount === 1 ? 'home' : 'homes'}</span>}</>
              )}
            </p>
            <p className="hh-collaboration-consent">{isBuyerInvite ? `${inviterName} will only see your search after you accept. You own the search and every decision in it.` : 'This includes priorities, Match, Favorites, Want to Tour choices, commute destinations, notes, Overall Feeling, and post-tour ratings. Only participants in this search can see its activity.'}</p>
            {needsTarget ? (
              <div className="hh-invite-choose" role="group" aria-labelledby="invite-choose-title">
                <p id="invite-choose-title" className="hh-invite-choose-title">Which home search should {inviterName} help with?</p>
                <p className="hh-invite-choose-body">We couldn&apos;t tell which search you&apos;re using right now, so nothing has been shared. Choose the search you use; you&apos;ll see it named here before you approve.</p>
                {approvalTarget.options?.length ? approvalTarget.options.map((option) => (
                  <button key={option.id} type="button" className="hh-btn hh-btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => useSearch(option.id)} disabled={Boolean(choosing)}>
                    {choosing === option.id ? 'Opening…' : `Use ${option.label === 'Your search' ? 'my own search' : option.label}`}
                  </button>
                )) : <a className="hh-btn" style={{ width: '100%', justifyContent: 'center' }} href="/search">Open My Search</a>}
              </div>
            ) : isBuyerInvite ? (
              <button type="button" className="hh-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={accept}>{requiresConfirmation ? 'Review my search' : 'Approve access'}</button>
            ) : isRealtorInvite ? (
              <button type="button" className="hh-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={accept}>Join as Realtor</button>
            ) : (
              <button type="button" className="hh-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={accept}>Join search</button>
            )}
          </>
        )}

        {state === 'accepting' && <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>Joining...</p>}

        {state === 'done' && (
          <>
            <h1 className="hh-serif" style={{ fontSize: 20, fontWeight: 700, color: 'var(--moss)', margin: '0 0 8px' }}>You're in!</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{isBuyerInvite ? `Your search is ready. ${inviterName} will be helping.` : isRealtorInvite ? "Taking you to your client's search..." : 'Taking you to your shared search...'}</p>
          </>
        )}

        {state === 'invalid' && (
          <>
            <h1 className="hh-serif" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>We couldn't complete that</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{REASON_COPY[reason] || REASON_COPY.unknown}</p>
            {reason === 'search_changed' || reason === 'active_search_unavailable' ? (
              <button type="button" className="hh-btn" onClick={() => window.location.reload()}>Review again</button>
            ) : reason === 'wrong_account' ? (
              <button type="button" className="hh-btn" onClick={signOut}>Sign in with another account</button>
            ) : (
              <button type="button" className="hh-btn hh-btn-ghost" onClick={async () => {
                if (asRealtor && remembersRealtorFromFailedInvitation({ preview: { ...initialPreview, valid: false, reason }, onboardingComplete })) await rememberRealtorWorkspace(createClient());
                router.push(asRealtor ? REALTOR_WORKSPACE_PATH : '/homes');
              }}>{asRealtor ? 'Go to My Clients' : 'Return to Homes'}</button>
            )}
          </>
        )}

        <div style={{ marginTop: 22 }}><Wordmark size={20} /></div>
      </div>
    </div>
  );
}
