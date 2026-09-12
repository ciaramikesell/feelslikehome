// Shared validator for every `redirect=`/`next=` value this app passes
// through its auth flow (sign-in, sign-up, the email-confirmation callback,
// and the post-auth app-group gate that originates it). A `redirect` value
// ultimately gets handed to `router.push`/`NextResponse.redirect`, so it must
// never be allowed to become an attacker-supplied absolute URL — that's a
// classic open-redirect vector (e.g. `/auth/sign-in?redirect=https://evil.com`
// or the protocol-relative `//evil.com`).
//
// Deliberately conservative: only a same-origin path starting with exactly
// one `/` is ever considered safe. Anything else (empty, protocol-relative,
// absolute with a scheme, containing backslashes a browser could still treat
// as a host separator) falls back to the caller's own default.
export function sanitizeRedirectPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  if (trimmed.includes('\\')) return null;
  // A relative path can still smuggle an absolute URL past the leading-slash
  // check via an embedded scheme (e.g. "/\t/evil.com" browsers may not accept,
  // but "/redirect?to=http://evil.com" is fine — the risk is the path ITSELF
  // resolving off-origin, not its query string). new URL() against a known
  // origin resolves exactly the way a browser would and lets us confirm the
  // result is still same-origin before trusting it.
  try {
    const resolved = new URL(trimmed, 'https://safe-redirect.invalid');
    if (resolved.origin !== 'https://safe-redirect.invalid') return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}
