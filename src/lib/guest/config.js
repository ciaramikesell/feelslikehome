// Both the entry and the writer are off unless the separate release flag and
// the server configuration are present. No credential is exposed to clients.
export function guestOnboardingEnabled(env = process.env) {
  if (env.FLH_GUEST_ONBOARDING !== 'on' || !env.FLH_GUEST_WRITER_DATABASE_URL) return false;
  try {
    const origin = new URL(env.FLH_GUEST_APP_ORIGIN);
    return origin.origin === env.FLH_GUEST_APP_ORIGIN &&
      (origin.protocol === 'https:' || (origin.protocol === 'http:' && origin.hostname === 'localhost'));
  } catch {
    return false;
  }
}
