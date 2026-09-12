import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(request) {
  // Layouts (unlike page.js) never receive the current path/query as a prop —
  // a well-known Next.js App Router gap — so the auth gate in
  // src/app/(app)/layout.js has no way to know it was e.g. `/homes?url=...`
  // rather than some other app route when it needs to redirect a signed-out
  // user to sign-in and preserve that destination. This header is the
  // standard bridge: set once here, read via next/headers in the layout to
  // build the existing `?redirect=` param sign-in/sign-up/the auth callback
  // already understand. Purely additive — the session-refresh logic below is
  // unchanged.
  request.headers.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Touching auth.getUser() here is what actually refreshes an expiring session and
  // rewrites the cookie — Server Components alone can't write cookies, so without this
  // middleware, sessions would silently stop refreshing.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
