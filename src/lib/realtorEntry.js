// Where a person lands when FLH has no more specific destination for them.
//
// There is no account-level Realtor role: Realtor access is a per-search
// membership (search_members.role = 'realtor'). Two signals mark an account
// whose way into FLH is the Realtor workspace rather than buyer onboarding:
// - the sign-up intent (`?intent=realtor`, stored as account_entry_intent), and
// - an existing Realtor membership on someone's search, which covers a Realtor
//   who first signed up from a buyer's invitation and so never set the intent.
// Neither signal grants access to anything; every People query stays
// relationship-scoped by RLS.

export const REALTOR_WORKSPACE_PATH = '/people';

export const isRealtorWorkspacePath = (path = '') => path.startsWith('/people') || path.startsWith('/realtor');

// True for an account that has not finished (or started) buyer onboarding and
// arrived as a Realtor. Such an account may still begin a personal buyer search
// later from /onboarding; it just isn't sent there by default.
export function entersAsRealtor({ onboardingComplete, entryIntent, hasRealtorMembership }) {
  if (onboardingComplete) return false;
  return entryIntent === 'realtor' || Boolean(hasRealtorMembership);
}

// Accepting an invitation:
// - a buyer approving a Realtor (realtor_to_buyer) continues to onboarding,
//   which sends an already-onboarded buyer straight on to their Homes;
// - a Realtor joining a buyer's search goes to that client's workspace, and the
//   buyer-side active search is left alone (a client search is not the
//   Realtor's own buyer search);
// - a co-buyer joins the shared search and continues in Homes, as before.
export function invitationAcceptance({ relationshipType, invitationDirection, searchId }) {
  if (invitationDirection === 'realtor_to_buyer') return { destination: '/onboarding', setActiveSearch: true };
  if (relationshipType === 'realtor') {
    return { destination: searchId ? `${REALTOR_WORKSPACE_PATH}/${searchId}` : REALTOR_WORKSPACE_PATH, setActiveSearch: false };
  }
  return { destination: '/homes', setActiveSearch: true };
}
