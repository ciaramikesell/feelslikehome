'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Home as HomeIcon, Users, Compass } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { createClient } from '@/lib/supabase/client';
import { setActiveSearch } from '@/lib/supabase/collaboration';

const ROLE_COPY = {
  owner: { icon: HomeIcon, detail: 'Your homes and your preferences' },
  co_buyer: { icon: Users, detail: 'Shared homes · your own preferences' },
  realtor: { icon: Compass, detail: 'Client search · Realtor access' },
};

// "Which search am I looking at?" — always visible (with its owner's name) for
// anyone who owns or belongs to more than one search, and one tap from every
// other search they can access. Switching only changes profiles.active_search_id
// (setActiveSearch): it never changes memberships and never copies preferences
// or homes between searches. Every search-scoped page re-resolves the active
// search on the server, and AppShell remounts page content per search, so
// homes, preferences, collaborators, and Match all follow the switch.
export default function SearchSwitcher({ userId, searches, activeSearchId }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState(null);
  const [error, setError] = useState('');

  if (!searches || searches.length < 2) return null;
  const active = searches.find((search) => search.id === activeSearchId) || searches[0];

  const choose = async (searchId) => {
    if (searchId === active.id) { setOpen(false); return; }
    setError('');
    setSwitchingTo(searchId);
    try {
      await setActiveSearch(createClient(), userId, searchId);
      setOpen(false);
      router.push('/homes');
      router.refresh();
    } catch {
      setError('Couldn’t switch searches. You’re still in the same search—please try again.');
    } finally {
      setSwitchingTo(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className="hh-search-switcher"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Current search: ${active.label}. Switch search`}
      >
        <span className="hh-search-switcher-label">{active.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Switch search" size="compact" className="hh-search-sheet">
        <p className="hh-search-sheet-lead">Each search keeps its own homes. Your preferences in one search never change another.</p>
        {error && <p className="hh-save-error" role="alert">{error}</p>}
        <ul className="hh-search-options" role="list">
          {searches.map((search) => {
            const copy = ROLE_COPY[search.relationshipType] || ROLE_COPY.co_buyer;
            const Icon = copy.icon;
            const current = search.id === active.id;
            return (
              <li key={search.id}>
                <button
                  type="button"
                  className={`hh-search-option ${current ? 'is-current' : ''}`}
                  onClick={() => choose(search.id)}
                  disabled={Boolean(switchingTo)}
                  aria-current={current ? 'true' : undefined}
                >
                  <span className="hh-search-option-icon" aria-hidden="true"><Icon size={18} /></span>
                  <span className="hh-search-option-text">
                    <strong>{search.label}</strong>
                    <span>{switchingTo === search.id ? 'Switching…' : copy.detail}</span>
                  </span>
                  {current && <><Check size={18} aria-hidden="true" className="hh-search-option-check" /><span className="sr-only">Current search</span></>}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
