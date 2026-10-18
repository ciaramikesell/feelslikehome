'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

// The one client copy of My Homes for the board and the home overlay above it.
//
// My Homes lives in a layout (src/app/(app)/homes/(board)/layout.js), so it
// stays mounted while /homes/[homeId] opens a home over it: filters, search,
// sort and scroll survive, and every autosaved change in the overlay shows on
// the card underneath right away. Because the board is never unmounted, there
// is no stale Router Cache payload to restore on Close or browser Back (the
// disappearing-home class of bug, docs/home-facts-flow-redesign.md §2).
//
// Server data stays authoritative: each overlay open adopts the freshly read
// home (adoptServerHome) unless that home has a save in flight.
const HomesWorkspaceContext = createContext(null);

export function useHomesWorkspace() {
  return useContext(HomesWorkspaceContext);
}

export default function HomesWorkspace({ initialHomes, priorities, commuteDestinations = [], sharedFactAwareness = {}, isCollaborative = false, userId, searchId, children }) {
  const [homes, setHomes] = useState(initialHomes);
  // Ids with an overlay autosave in flight: a server read must not replace them.
  const busy = useRef(new Set());
  // True once the board itself opened an overlay in this session, so Close can
  // step Back (restoring exactly where the buyer was) instead of pushing.
  const openedFromBoard = useRef(false);
  // However an overlay closed (Close, Escape, browser Back), back on My Homes
  // the next one steps back only if the board opens it again.
  const pathname = usePathname();
  useEffect(() => { if (pathname === '/homes') openedFromBoard.current = false; }, [pathname]);

  const updateHome = useCallback((id, patch) => {
    setHomes((current) => current.map((home) => (home.id === id ? { ...home, ...(typeof patch === 'function' ? patch(home) : patch) } : home)));
  }, []);

  const adoptServerHome = useCallback((serverHome) => {
    if (!serverHome?.id || busy.current.has(serverHome.id)) return;
    setHomes((current) => (current.some((home) => home.id === serverHome.id)
      // Keep the board's derived co-buyer signals; replace every stored field.
      ? current.map((home) => (home.id === serverHome.id ? { ...home, ...serverHome } : home))
      : [...current, serverHome]));
  }, []);

  const setBusy = useCallback((id, isBusy) => {
    if (isBusy) busy.current.add(id); else busy.current.delete(id);
  }, []);

  const value = useMemo(() => ({
    homes, setHomes, updateHome, adoptServerHome, setBusy, openedFromBoard,
    priorities, commuteDestinations, sharedFactAwareness, isCollaborative, userId, searchId,
  }), [homes, updateHome, adoptServerHome, setBusy, priorities, commuteDestinations, sharedFactAwareness, isCollaborative, userId, searchId]);

  return <HomesWorkspaceContext.Provider value={value}>{children}</HomesWorkspaceContext.Provider>;
}
