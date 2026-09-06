'use client';

import { useState } from 'react';
import InviteCoBuyer from '@/components/InviteCoBuyer';

// Three states only:
//   1. Owner, not yet collaborative -> a small clickable invitation line.
//   2. Collaborative (owner or member) -> a plain status line, not clickable.
//   3. Non-owner, non-collaborative -> shouldn't occur (a member's search is
//      collaborative by definition), so nothing renders.
export default function CoBuyerHomesLine({ searchId, userId, isOwner, isCollaborative }) {
  const [inviteOpen, setInviteOpen] = useState(false);

  if (isCollaborative) {
    return (
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--brick)', margin: '-12px 0 20px' }}>
        You're searching with a co-buyer.
      </p>
    );
  }

  if (!isOwner) return null;

  if (inviteOpen) {
    return (
      <div style={{ margin: '-12px 0 20px' }}>
        <InviteCoBuyer searchId={searchId} userId={userId} embedded onClose={() => setInviteOpen(false)} />
      </div>
    );
  }

  return (
    <p style={{ margin: '-12px 0 20px' }}>
      <button
        type="button"
        onClick={() => setInviteOpen(true)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          font: 'inherit', fontSize: 13, fontWeight: 500, color: 'var(--brick)',
        }}
      >
        Buying together? <span style={{ textDecoration: 'underline' }}>Add a co-buyer →</span>
      </button>
    </p>
  );
}
