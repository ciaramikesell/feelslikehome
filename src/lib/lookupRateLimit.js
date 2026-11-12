// A per-user limit on property lookups for the import route (Add Home V3,
// phase 4). BEST EFFORT: it lives in the memory of one serverless instance, so
// it stops a runaway loop or rapid clicking that reaches a warm instance, but
// it is not a durable, deployment-wide quota (that needs shared storage, a
// founder decision: docs/add-home-v3-lookup-efficiency.md). Keyed by the
// signed-in user's id only; nothing is logged or returned about the user.

export const USER_LOOKUP_LIMIT = 20;
export const USER_LOOKUP_WINDOW_MS = 10 * 60 * 1000;

export function createLookupLimiter({ limit = USER_LOOKUP_LIMIT, windowMs = USER_LOOKUP_WINDOW_MS, maxUsers = 5000 } = {}) {
  const hits = new Map();
  return {
    /** Records one lookup for `userId` at `now` if allowed. */
    take(userId, now = Date.now()) {
      if (!userId) return { allowed: false, retryAfterMs: windowMs };
      const recent = (hits.get(userId) || []).filter((time) => now - time < windowMs);
      if (recent.length >= limit) {
        hits.set(userId, recent);
        return { allowed: false, retryAfterMs: Math.max(1000, windowMs - (now - recent[0])) };
      }
      recent.push(now);
      hits.delete(userId);
      hits.set(userId, recent);
      // Bounded memory: drop the least recently active users first.
      while (hits.size > maxUsers) hits.delete(hits.keys().next().value);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
