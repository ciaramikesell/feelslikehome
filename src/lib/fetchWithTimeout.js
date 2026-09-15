// Bounds an outgoing fetch() so a hung upstream request fails on our own
// schedule instead of running until the hosting platform kills the whole
// serverless function (which returns an uncontrolled, uncatchable failure
// that bypasses the caller's own try/catch entirely). Every external call in
// the import/enrichment path (RentCast, Google Geocoding, Google Routes)
// should go through this rather than a bare fetch().
const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
