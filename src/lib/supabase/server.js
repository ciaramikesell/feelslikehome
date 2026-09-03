import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server Component / Route Handler / Server Action client.
// This uses the *publishable* key (safe, RLS-respecting) plus the signed-in user's own
// session cookie — it never bypasses Row Level Security. We deliberately do not use a
// secret/service-role key anywhere in this app, since nothing here needs to bypass RLS.
export async function createClient() {
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
}
