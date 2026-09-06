'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { setActiveSearch } from '@/lib/supabase/collaboration';

// Deliberately minimal: a native <select>, not a custom dropdown component —
// this is not workspace navigation, just "which of my (at most two) searches
// am I looking at right now." Renders nothing at all for the vast majority of
// users who only ever have their own search.
export default function SearchSwitcher({ userId, searches, activeSearchId }) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  if (!searches || searches.length < 2) return null;

  const handleChange = async (e) => {
    const searchId = e.target.value;
    if (searchId === activeSearchId) return;
    setSwitching(true);
    try {
      const supabase = createClient();
      await setActiveSearch(supabase, userId, searchId);
      router.refresh();
    } catch (err) {
      console.error('Could not switch search', err);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <select
      className="hh-btn hh-btn-ghost"
      style={{ fontSize: 12.5, padding: '6px 10px', cursor: 'pointer' }}
      value={activeSearchId || searches[0].id}
      onChange={handleChange}
      disabled={switching}
      aria-label="Switch search"
    >
      {searches.map((s) => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  );
}
