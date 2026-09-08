'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { leaveSearch, removeMember } from '@/lib/supabase/collaboration';

// Phase 7 — Leave Search / Remove Co-Buyer. Deliberately small: this is an
// access-management action, not a daily home-shopping one, so it lives
// tucked into My Search rather than anywhere prominent. Renders nothing at
// all for a non-collaborative search (the common case for most users).
export default function CoBuyerManagement({ userId, search, isOwner, participantCount, memberUserId }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const isCollaborative = participantCount > 1;

  // TEMPORARY DIAGNOSTIC — Phase 7 runtime trace, remove after root cause confirmed.
  console.log('[Phase7 CoBuyerManagement]', {
    userId,
    searchId: search?.id,
    searchOwnerId: search?.user_id,
    isOwner,
    participantCount,
    memberUserId,
    willRender: isCollaborative,
  });

  if (!isCollaborative) return null;

  const act = async () => {
    setWorking(true);
    setError('');
    try {
      const supabase = createClient();
      if (isOwner) {
        await removeMember(supabase, search.id, memberUserId);
      } else {
        await leaveSearch(supabase, userId, search.id);
      }
      window.location.href = '/homes';
    } catch (err) {
      console.error('Co-Buyer management action failed', err);
      setError("Something went wrong. Please try again.");
      setWorking(false);
    }
  };

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
      {/* TEMPORARY DIAGNOSTIC — remove after root cause confirmed. */}
      <p style={{ fontSize: 12, color: 'red', fontWeight: 700 }}>Phase 7 diagnostic loaded</p>
      <div className="hh-serif" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Searching together</div>
      {!confirming ? (
        <button
          type="button"
          className="hh-btn hh-btn-ghost"
          style={{ fontSize: 12, color: 'var(--brick)', borderColor: 'rgba(193,89,47,0.35)' }}
          onClick={() => setConfirming(true)}
        >
          {isOwner ? 'Remove co-buyer from this search' : 'Leave this search'}
        </button>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', maxWidth: 440 }}>
          <p style={{ fontSize: 13, color: 'var(--ink)', margin: '0 0 4px', fontWeight: 600 }}>
            {isOwner ? 'Remove co-buyer?' : 'Leave this search?'}
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {isOwner
              ? "They'll lose access to this shared search and its homes. Your search and home data will not be deleted."
              : "You'll lose access to the shared homes and search. This won't delete the search for the other person."}
          </p>
          {error && <p style={{ fontSize: 12, color: 'var(--brick)', margin: '0 0 10px' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirming(false)} disabled={working}>
              Cancel
            </button>
            <button
              type="button"
              className="hh-btn"
              style={{ fontSize: 12, background: 'var(--brick)', borderColor: 'var(--brick)' }}
              onClick={act}
              disabled={working}
            >
              {working ? 'Working…' : (isOwner ? 'Remove' : 'Leave search')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
