import { createBrowserClient } from '@supabase/ssr';

// Client Component client — use this from 'use client' components that run in the browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
