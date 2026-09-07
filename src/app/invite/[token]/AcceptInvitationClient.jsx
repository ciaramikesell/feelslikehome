'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { acceptInvitation, setActiveSearch } from '@/lib/supabase/collaboration';
import { BrandMark, Wordmark } from '@/components/ui';

const REASON_COPY = {
  not_found: "This invite link doesn't look right. Double-check the link, or ask for a new one.",
  already_accepted: 'This invite has already been used.',
  revoked: 'This invite has been cancelled by the person who sent it.',
  expired: 'This invite has expired. Ask your co-buyer to send a new one.',
  self_invite: "You can't accept an invite you sent yourself.",
  wrong_account: "This invite was sent to a different email address than the one you're signed in with. Sign in with the invited email and try again.",
  not_authenticated: 'Please sign in first.',
  unknown: 'Something went wrong. Please try again.',
};

// The preview result now arrives already resolved from the server (see
// page.js) — no client-side fetch, no loading state needed for it, and no
// exposure to the session-propagation race that caused this to fail right
// after a fresh sign-up.
export default function AcceptInvitationClient({ token, initialPreview }) {
  const router = useRouter();
  const [state, setState] = useState(initialPreview.valid ? 'valid' : 'invalid'); // valid | invalid | accepting | done
  const [reason, setReason] = useState(initialPreview.reason || '');

  const accept = async () => {
    setState('accepting');
    try {
      const supabase = createClient();
      const result = await acceptInvitation(supabase, token);
      if (!result.success) {
        setState('invalid');
        setReason(result.reason);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user && result.search_id) {
        await setActiveSearch(supabase, user.id, result.search_id);
      }
      setState('done');
      setTimeout(() => { router.push('/homes'); router.refresh(); }, 1200);
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
            <h1 className="hh-serif" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>You've been invited to a shared home search</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, margin: '0 0 20px' }}>
              You'll see the same homes as your co-buyer, with your own priorities, Match, and tour notes — kept separate from theirs.
            </p>
            <button type="button" className="hh-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={accept}>
              Accept invitation
            </button>
          </>
        )}

        {state === 'accepting' && <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>Joining...</p>}

        {state === 'done' && (
          <>
            <h1 className="hh-serif" style={{ fontSize: 20, fontWeight: 700, color: 'var(--moss)', margin: '0 0 8px' }}>You're in!</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>Taking you to your shared search...</p>
          </>
        )}

        {state === 'invalid' && (
          <>
            <h1 className="hh-serif" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>We couldn't complete that</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{REASON_COPY[reason] || REASON_COPY.unknown}</p>
          </>
        )}

        <div style={{ marginTop: 22 }}><Wordmark size={20} /></div>
      </div>
    </div>
  );
}
