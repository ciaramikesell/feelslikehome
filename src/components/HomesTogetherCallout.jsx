'use client';

import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import InviteCoBuyer from '@/components/InviteCoBuyer';
import { IconBadge } from '@/components/MobileSystem';

// My Homes' compact collaboration note, derived from the search's actual state:
// a collaborative search says so (each person keeps their own Match); the owner
// of a solo search can open the existing invitation flow; anyone else sees
// nothing. No new invitation path and no entitlement assumptions.
export default function HomesTogetherCallout({ searchId, userId, isOwner, isCollaborative }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  if (isCollaborative) {
    return (
      <aside className="flh-card flh-card-sage flh-homes-together">
        <div className="flh-card-row">
          <IconBadge icon={Users} tone="sage" />
          <div className="flh-card-heading">
            <p className="flh-card-title flh-card-title-small">Searching together</p>
            <p className="flh-card-sub">You compare the same homes while each keeping your own Match and perspective.</p>
          </div>
        </div>
      </aside>
    );
  }
  if (!isOwner) return null;
  return (
    <>
      <button type="button" className="flh-card flh-card-sage is-interactive flh-homes-together" onClick={() => setInviteOpen(true)}>
        <span className="flh-card-row">
          <IconBadge icon={UserPlus} tone="sage" />
          <span className="flh-card-heading">
            <span className="flh-card-title flh-card-title-small">Compare homes together</span>
            <span className="flh-card-sub">Invite a co-buyer or Realtor. Everyone keeps their own Match and perspective.</span>
          </span>
        </span>
      </button>
      {inviteOpen && <InviteCoBuyer searchId={searchId} userId={userId} embedded onClose={() => setInviteOpen(false)} />}
    </>
  );
}
