'use client';

import { useSyncExternalStore } from 'react';
import { DESKTOP_BOARD_QUERY } from '@/lib/priorityBoard';

// true at DESKTOP_BOARD_QUERY (≥ 1024 CSS px), live as the window resizes or
// zooms. The server and the first client render report false, so phones and
// every server-rendered screen are exactly the photo-card flow; a desktop
// browser switches to the board right after hydration. Only presentation
// changes: answers and progress are the same document either way.
const subscribe = (onChange) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(DESKTOP_BOARD_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const snapshot = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP_BOARD_QUERY).matches : false);
const serverSnapshot = () => false;

export default function useDesktopBoard() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
