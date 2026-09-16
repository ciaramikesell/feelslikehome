import { cache } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';

// Layouts (unlike page.js) never receive the current path/query as a prop —
// a well-known Next.js App Router gap — so an auth gate that needs to send a
// signed-out visitor back to e.g. `/homes?url=...` after sign-in has no way
// to know it was that route rather than some other one. middleware.js sets
// the `x-pathname` header on every request; this reads it back via
// next/headers and keeps it to a same-origin path via sanitizeRedirectPath,
// so it can never become an open redirect.
export async function currentPathForRedirect() {
  const requestHeaders = await headers();
  return sanitizeRedirectPath(requestHeaders.get('x-pathname'));
}

export function withRedirectParam(path, destination) {
  return destination ? `${path}?redirect=${encodeURIComponent(destination)}` : path;
}

async function redirectToSignIn() {
  redirect(withRedirectParam('/auth/sign-in', await currentPathForRedirect()));
}

// Every Server Component on an authenticated route creates its own client via
// createClient() — the (app) layout, that route's own page.js, any nested
// component that needs its own query. getUser() re-verifies the JWT with
// Supabase Auth on every call, refreshing it first if it's expired. Without
// memoizing that call per request, the layout and the page each
// independently refresh the same expiring session: Supabase rotates refresh
// tokens on use, so whichever call refreshes second is handed a refresh
// token its sibling has already consumed and comes back with
// "Refresh Token Not Found" — a real signed-in user's own page losing its
// session partway through a single request. cache() (React's per-request
// memoization for Server Components) makes every caller in the same request
// share one in-flight getUser() call/result, so the refresh happens once.
const getAuthenticatedUser = cache(async (supabase) => supabase.auth.getUser());

// Canonical "is anyone signed in" check for an authenticated Server
// Component. Supabase's own getUser() already collapses every dead-session
// case — no cookie, expired/rotated refresh token, terminal auth error —
// into `user: null`; this is the one place that turns that into the app's
// sign-in recovery path (preserving the destination) instead of letting a
// caller dereference a null user.
export async function requireUser(supabase) {
  const { data: { user } } = await getAuthenticatedUser(supabase);
  if (!user) await redirectToSignIn();
  return user;
}

// Postgrest's own JWT-validation failure codes — distinct from RLS denying a
// query, which returns an empty/filtered result set, never one of these.
// Seeing one means the access token itself was rejected as expired or (see
// PGRST303, "JWT issued at future") temporally invalid: the session
// requireUser() had just accepted turned out not to hold up for the
// database moments later — not that the signed-in user lacks permission for
// the row.
const JWT_POSTGREST_CODES = new Set(['PGRST301', 'PGRST303']);

function isAuthSessionError(error) {
  if (!error) return false;
  if (error.__isAuthError) return true;
  return typeof error.code === 'string' && JWT_POSTGREST_CODES.has(error.code);
}

// Runs an authenticated page's data loading and rendering. If a query throws
// one of the JWT-validation errors above, this sends the user through the
// same sign-in recovery path as requireUser() rather than letting it surface
// as the generic error boundary. Any other error (a real bug, notFound(),
// an unrelated redirect()) is rethrown untouched.
export async function withAuthRecovery(loader) {
  try {
    return await loader();
  } catch (error) {
    if (isAuthSessionError(error)) await redirectToSignIn();
    throw error;
  }
}
