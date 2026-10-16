'use server';

import { revalidatePath } from 'next/cache';

// Invalidates the client Router Cache for My Homes after a home is added.
//
// A Server Action that revalidates makes the App Router rebuild its whole
// client cache from the action's response ("server actions have to invalidate
// the entire cache"), and the caller awaits it before navigating — unlike
// router.refresh(), which a navigation discards (or which cancels a navigation
// already in flight). It reads and writes no data, so it needs no
// authorization of its own; the re-render it triggers runs the page's normal
// signed-in, RLS-scoped reads.
export async function refreshMyHomes() {
  revalidatePath('/homes');
}
