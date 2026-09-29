// Search-scoped entitlement (Monetization Phase 1).
//
// The database is the only authority: public.search_entitlements and
// public.search_home_admissions are unreadable/unwritable by clients, and the
// homes admission trigger raises SQLSTATE FL402 ("paywall_required") when a
// search has used its free homes. Nothing in this module can grant access —
// it only reads the server's answer and recognizes the server's refusal.

export const FREE_HOME_LIMIT = 3;
export const PAYWALL_ERROR_CODE = 'FL402';

// Display-only product facts. Phase 2 should prefer the store's localized
// price when it is available; the server never trusts this value.
export const SEARCH_UNLOCK_PRODUCT = Object.freeze({
  id: 'flh_search_unlock',
  displayPrice: '$6.99',
});

export const ADMISSION_RESULTS = Object.freeze(['existing', 'unlocked', 'free', 'paywall_required']);

export function isPaywallError(error) {
  if (!error) return false;
  return error.code === PAYWALL_ERROR_CODE || error.message === 'paywall_required' || error.paywallRequired === true;
}

export function paywallError(context = {}) {
  const err = new Error('paywall_required');
  err.code = PAYWALL_ERROR_CODE;
  err.paywallRequired = true;
  err.context = context;
  return err;
}

export function normalizeEntitlement(row) {
  if (!row) return null;
  const limit = Number.isFinite(row.free_home_limit) ? row.free_home_limit : FREE_HOME_LIMIT;
  const used = Number.isFinite(row.free_homes_used) ? row.free_homes_used : 0;
  return {
    searchId: row.search_id,
    unlocked: row.status === 'unlocked',
    unlockedAt: row.unlocked_at || null,
    source: row.source || null,
    freeHomeLimit: limit,
    freeHomesUsed: used,
    freeHomesRemaining: Number.isFinite(row.free_homes_remaining) ? row.free_homes_remaining : Math.max(limit - used, 0),
  };
}

// Returns the normalized entitlement, or null when it can't be read (for
// example before the Phase 1 migration is applied). Null never means "free
// pass": the database still enforces admissions on write.
export async function getSearchEntitlement(supabase, searchId) {
  if (!searchId) return null;
  const { data, error } = await supabase.rpc('get_search_entitlement', { p_search_id: searchId });
  if (error) return null;
  return normalizeEntitlement(Array.isArray(data) ? data[0] : data);
}

// Advisory preflight before creating a home (e.g. before uploading a photo).
// Returns one of ADMISSION_RESULTS, or null if the check is unavailable — in
// which case callers proceed and let the server decide on write.
export async function checkHomeAdmission(supabase, searchId, { listingUrl = '', address = '' } = {}) {
  if (!searchId) return null;
  const { data, error } = await supabase.rpc('check_home_admission', {
    p_search_id: searchId, p_listing_url: listingUrl || '', p_address: address || '',
  });
  if (error || !ADMISSION_RESULTS.includes(data)) return null;
  return data;
}

// The action the buyer was attempting when the paywall appeared, kept for the
// current browser session so Phase 2 can resume it after a verified unlock.
// Only non-sensitive intent is stored; it never implies any entitlement.
const INTENT_KEY = 'flh:pending-home-admission';

export function savePendingAdmission(intent) {
  try {
    if (typeof window === 'undefined' || !intent?.searchId) return;
    const record = {
      searchId: intent.searchId,
      kind: intent.kind === 'suggestion_promotion' ? 'suggestion_promotion' : 'add_home',
      listingUrl: intent.listingUrl || '',
      address: intent.address || '',
      suggestionId: intent.suggestionId || null,
      savedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(record));
  } catch {}
}

export function readPendingAdmission() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(INTENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearPendingAdmission() {
  try { if (typeof window !== 'undefined') window.sessionStorage.removeItem(INTENT_KEY); } catch {}
}
