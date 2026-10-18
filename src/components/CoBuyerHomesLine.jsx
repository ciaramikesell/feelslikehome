'use client';

import { useState } from 'react';
import InviteCoBuyer from '@/components/InviteCoBuyer';
import { ParticipantStack } from '@/components/MobileSystem';

// The My Homes toolbar's collaboration line (right of the filter chips).
// Three states only:
//   1. Owner, not yet collaborative -> "Searching together? Invite collaborator →",
//      opening the existing invitation sheet (InviteCoBuyer).
//   2. Collaborative (owner or member) -> a plain status line, not clickable.
//   3. Non-owner, non-collaborative -> shouldn't occur (a member's search is
//      collaborative by definition), so nothing renders.
export default function CoBuyerHomesLine({ searchId, userId, isOwner, isCollaborative, collaboratorName = null }) {
  const [inviteOpen, setInviteOpen] = useState(false);

  if (isCollaborative) {
    return (
      <p className="hh-cobuyer-line is-together">
        <ParticipantStack collaboratorName={collaboratorName} />
        <span>Searching together · each of you keeps your own Match</span>
      </p>
    );
  }

  if (!isOwner) return null;

  return (
    <>
      <p className="hh-cobuyer-line">
        Searching together?{' '}
        <button type="button" className="hh-cobuyer-invite" onClick={() => setInviteOpen(true)} aria-haspopup="dialog">
          Invite collaborator <span aria-hidden="true">→</span>
        </button>
      </p>
      {inviteOpen && <InviteCoBuyer searchId={searchId} userId={userId} embedded onClose={() => setInviteOpen(false)} />}
    </>
  );
}
