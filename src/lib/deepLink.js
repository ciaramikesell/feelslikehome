// The entire native bridge's trust boundary — see DeepLinkBridge.jsx for how
// this is wired to the Capacitor App plugin's `appUrlOpen` event. Kept here,
// plain and dependency-free, so it's directly testable without mocking
// Capacitor or React (see test/universal-links.test.js).
const ALLOWED_HOSTNAME = 'feelslikehome.app';

// Takes the raw URL string as delivered by iOS/Capacitor and returns the
// internal path to navigate to, or null if the URL is not a trusted FLH URL.
// The returned path is built from the parsed URL's own pathname/search/hash
// with no decoding, re-encoding, or interpretation — this is what preserves
// #73's nested `?url=<percent-encoded listing URL>` byte-for-byte, and what
// keeps this bridge ignorant of listing providers, duplicate identity,
// Match, and collaboration/Realtor state.
export function resolveDeepLinkPath(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  // Reject javascript:, file:, http:, and anything else non-HTTPS.
  if (parsed.protocol !== 'https:') return null;
  // Exact match only — never a substring/suffix check — so a spoofed or
  // subdomained hostname (e.g. "evil.com/feelslikehome.app",
  // "feelslikehome.app.evil.com", "sub.feelslikehome.app") is rejected
  // rather than silently accepted. www.feelslikehome.app is deliberately
  // excluded too: nothing in this codebase's routing/redirect behavior
  // currently confirms that hostname is an intentionally supported alias
  // (see the audit in docs/universal-links.md) — add it here only alongside
  // the matching Associated Domains entry once that's verified.
  if (parsed.hostname !== ALLOWED_HOSTNAME) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
}
