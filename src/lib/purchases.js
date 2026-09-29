// Purchase provider abstraction (Monetization Phase 1).
//
// No purchase provider is configured in Phase 1. Every call resolves to an
// explicit "unavailable" result — there is intentionally no code path here
// that reports a successful purchase or restore, and nothing in the client can
// mark a search unlocked. A search becomes unlocked only when trusted server
// code calls public.record_search_entitlement_unlock (service_role only).
//
// PHASE 2 CONNECTION POINT (StoreKit): add an Apple provider that, on iOS,
// runs the StoreKit purchase for SEARCH_UNLOCK_PRODUCT.id, sends the signed
// transaction to a server route that verifies it with Apple and then calls
// record_search_entitlement_unlock, and only reports success once
// getSearchEntitlement(searchId) reads back `unlocked`. Register it in
// getPurchaseProvider() below. See docs/monetization-phase-1.md.

export const PURCHASE_UNAVAILABLE = 'unavailable';

const unconfiguredProvider = Object.freeze({
  id: 'unconfigured',
  available: false,
  async purchaseSearchUnlock() {
    return { status: PURCHASE_UNAVAILABLE, message: 'Unlocking isn’t available yet. Nothing was charged, and your homes are safe.' };
  },
  async restorePurchases() {
    return { status: PURCHASE_UNAVAILABLE };
  },
});

export function getPurchaseProvider() {
  return unconfiguredProvider;
}
