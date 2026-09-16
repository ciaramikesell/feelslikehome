import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server Component / Route Handler / Server Action client.
// This uses the *publishable* key (safe, RLS-respecting) plus the signed-in user's own
// session cookie — it never bypasses Row Level Security. We deliberately do not use a
// secret/service-role key anywhere in this app, since nothing here needs to bypass RLS.
//
// Wrapped in React's cache() so every Server Component in one request — the
// (app) layout, that route's own page.js, any nested component that needs
// its own query — shares a single client/session instead of each creating
// its own. That matters because Supabase rotates refresh tokens on use: two
// independent clients both refreshing the same expiring session mid-request
// means whichever refreshes second is handed an already-consumed refresh
// token and comes back with "Refresh Token Not Found", i.e. a real
// signed-in user's own request treats them as signed out partway through.
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component during render — safe to ignore since
            // middleware.js already refreshes the session on every request.
          }
        },
      },
    }
  );
});
