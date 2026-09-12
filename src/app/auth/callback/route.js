import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // See sign-in/sign-up's identical comment — this is the same `redirect`
  // value they forwarded into signUp's emailRedirectTo, arriving back here
  // untrusted from an email link, so it gets the same validation.
  const next = sanitizeRedirectPath(searchParams.get('next')) ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth-callback-failed`);
}
