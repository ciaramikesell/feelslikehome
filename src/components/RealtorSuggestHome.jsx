'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import HomeModal from '@/components/HomeModal';
import { emptyHome, normalizePriorities } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { createRealtorSuggestion } from '@/lib/supabase/collaboration';

const RESULT_COPY = {
  created: 'Suggestion sent. It will stay out of My Homes until a buyer adds it.',
  already_in_homes: "Already in this buyer's Homes.",
  already_suggested: 'Already suggested.',
  previously_dismissed: 'This home was previously dismissed.',
};

export default function RealtorSuggestHome({ context }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const owner = context.people.find((person) => person.relationship === 'Owner') || context.people[0];
  const ownerPriorities = normalizePriorities(context.priorities.find((row) => row.user_id === owner?.user_id)?.priorities);
  const perspectives = useMemo(() => context.people.map((person) => ({
    userId: person.user_id,
    name: person.display_name,
    priorities: normalizePriorities(context.priorities.find((row) => row.user_id === person.user_id)?.priorities),
  })), [context]);

  const suggest = async (home) => {
    const result = await createRealtorSuggestion(createClient(), context.search.id, home);
    setMessage(RESULT_COPY[result?.result] || 'Suggestion could not be created.');
    setOpen(false);
    if (result?.result === 'created') window.location.reload();
  };

  return <>
    <div className="hh-realtor-suggest-action">
      <button className="hh-btn" onClick={() => { setMessage(''); setOpen(true); }}><Plus size={15} /> Suggest a Home</button>
      {message && <p role="status">{message}</p>}
    </div>
    {open && <HomeModal initial={emptyHome()} priorities={ownerPriorities} userId={context.viewerId} onSave={suggest} onClose={() => setOpen(false)} matchPerspectives={perspectives} saveLabel="Suggest this home" />}
  </>;
}
