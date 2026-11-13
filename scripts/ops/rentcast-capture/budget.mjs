// Add Home V3, phase 5: the request budget and pre-flight gate for the one-off
// RentCast validation capture (docs/add-home-v3-real-response-validation.md).
// Pure functions only, so every rule is tested without a network or a key.
//
// Approved budget: at most 10 RentCast requests in total, on the existing free
// Developer-plan account. Failures, timeouts and 404s all count. There are no
// automatic retries. The ledger is written BEFORE each request is sent, so a
// crash mid-request still counts it.

export const MAX_TOTAL_REQUESTS = 10;
export const MAX_PROPERTIES = 5;
export const REQUESTS_PER_PROPERTY = 2;

export const ENDPOINTS = Object.freeze({
  property: '/v1/properties',
  sale: '/v1/listings/sale',
  rental: '/v1/listings/rental/long-term',
});

/** The two requests FLH makes for one property, exactly as rentcastLookup.js does. */
export function plannedRequests(targets) {
  return targets.flatMap((target) => [
    { targetId: target.id, kind: 'property', path: ENDPOINTS.property },
    { targetId: target.id, kind: 'listing', path: target.mode === 'rental' ? ENDPOINTS.rental : ENDPOINTS.sale },
  ]);
}

const TARGET_ID = /^[a-z0-9-]{1,40}$/;
export function validateTargets(targets) {
  const problems = [];
  if (!Array.isArray(targets) || !targets.length) return ['targets file must be a non-empty array'];
  if (targets.length > MAX_PROPERTIES) problems.push(`at most ${MAX_PROPERTIES} properties (got ${targets.length})`);
  const ids = new Set();
  targets.forEach((target, i) => {
    if (!target || typeof target !== 'object') { problems.push(`target ${i} is not an object`); return; }
    if (!TARGET_ID.test(target.id || '')) problems.push(`target ${i}: id must be lowercase letters, digits or dashes`);
    if (ids.has(target.id)) problems.push(`target ${i}: duplicate id`);
    ids.add(target.id);
    if (typeof target.address !== 'string' || !target.address.trim() || target.address.length > 200) problems.push(`target ${target.id || i}: address missing or too long`);
    else if (/[<>]/.test(target.address)) problems.push(`target ${target.id || i}: address is still a placeholder`);
    if (!['sale', 'rental'].includes(target.mode)) problems.push(`target ${target.id || i}: mode must be "sale" or "rental"`);
  });
  return problems;
}

/**
 * Every pre-flight check must pass before the first live request. Quota is never
 * assumed: the founder reads the remaining allowance from the RentCast dashboard
 * and passes it in, with where it was read and when.
 */
export function checkPreflight({ apiKeyPresent, plan, allowanceRemaining, allowanceSource, allowanceCheckedAt, overageConfirmed, planned, alreadyUsed = 0, now = new Date() }) {
  const problems = [];
  if (!apiKeyPresent) problems.push('RENTCAST_API_KEY is not set in this shell');
  if (plan !== 'developer') problems.push('--plan=developer is required: this capture is approved for the free Developer plan only');
  const remaining = Number(allowanceRemaining);
  if (!Number.isInteger(remaining) || remaining < 0) problems.push('--allowance-remaining=<n> is required: the remaining monthly requests shown in the RentCast dashboard');
  if (typeof allowanceSource !== 'string' || allowanceSource.trim().length < 5) problems.push('--allowance-source="…" is required: where the remaining allowance was read');
  const checkedAt = new Date(allowanceCheckedAt);
  if (Number.isNaN(checkedAt.getTime())) problems.push('--allowance-checked-at=<ISO time> is required');
  else if (now - checkedAt > 60 * 60 * 1000 || checkedAt - now > 5 * 60 * 1000) problems.push('the allowance must have been checked within the last hour');
  if (overageConfirmed !== true) problems.push('--no-overage-confirmed is required: confirm in RentCast billing that these requests cannot incur a charge');
  const toSend = Math.min(planned, MAX_TOTAL_REQUESTS - alreadyUsed);
  if (planned + alreadyUsed > MAX_TOTAL_REQUESTS) problems.push(`budget: ${alreadyUsed} already used + ${planned} planned exceeds ${MAX_TOTAL_REQUESTS}`);
  if (Number.isInteger(remaining) && remaining < toSend) problems.push(`allowance: ${remaining} remaining is less than the ${toSend} requests planned`);
  return { ok: problems.length === 0, problems };
}

/** A ledger that refuses the 11th request. Mutates and returns the ledger. */
export function reserveRequest(ledger, { targetId, kind }, at = new Date()) {
  if (ledger.requests.length >= MAX_TOTAL_REQUESTS) throw new Error(`budget exhausted: ${MAX_TOTAL_REQUESTS} requests already counted`);
  if (ledger.stopped) throw new Error(`capture stopped earlier (${ledger.stopped}); no further requests`);
  ledger.requests.push({ targetId, kind, at: at.toISOString(), outcome: 'sent' });
  return ledger;
}

export function emptyLedger() {
  return { version: 1, maxTotal: MAX_TOTAL_REQUESTS, requests: [], stopped: null };
}

/**
 * What to do after a response. Only 200 (data) and 404 (no record) continue.
 * Everything else stops the whole capture, with no retry: 401/403 auth,
 * 402 billing, 429 quota or rate limit, 400 refused address, 5xx outage, timeout.
 */
export function classifyResponse(httpStatus) {
  if (httpStatus === 200) return { outcome: 'ok', stop: null };
  if (httpStatus === 404) return { outcome: 'empty', stop: null };
  const stop = httpStatus === 401 || httpStatus === 403 ? 'auth'
    : httpStatus === 402 ? 'billing'
      : httpStatus === 429 ? 'quota_or_rate_limit'
        : httpStatus === 400 ? 'invalid_address'
          : httpStatus === 'timeout' ? 'timeout'
            : httpStatus === 'network' ? 'network'
              : 'unexpected_status';
  return { outcome: 'error', stop };
}

// Response headers kept as evidence: only ones that could say something about
// usage, limits or the payload. Never cookies, never anything echoing the key.
const KEEP_HEADER = /^(?:content-type|retry-after|date|x-ratelimit-[a-z-]+|ratelimit(?:-[a-z-]+)?|x-quota-[a-z-]+|x-usage-[a-z-]+|x-api-[a-z-]*(?:limit|remaining|usage)[a-z-]*)$/;
export function evidenceHeaders(headers) {
  const out = {};
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    if (KEEP_HEADER.test(key) && !/key|cookie|auth/i.test(key)) out[key] = String(value).slice(0, 200);
  }
  return out;
}
