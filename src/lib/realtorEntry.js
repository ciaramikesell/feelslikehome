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
//   which sends an already-onboarded buyer straight on to their Homes, and
//   keeps the search they were using;
// - a Realtor joining a buyer's search goes to that client's workspace, and the
//   buyer-side active search is left alone (a client search is not the
//   Realtor's own buyer search);
// - a co-buyer joins the shared search and continues in Homes, as before.
export function invitationAcceptance({ relationshipType, invitationDirection, searchId }) {
  // The buyer approved it for the search they are using: nothing to switch.
  if (invitationDirection === 'realtor_to_buyer') return { destination: '/onboarding', setActiveSearch: false };
  if (relationshipType === 'realtor') {
    return { destination: searchId ? `${REALTOR_WORKSPACE_PATH}/${searchId}` : REALTOR_WORKSPACE_PATH, setActiveSearch: false };
  }
  return { destination: '/homes', setActiveSearch: true };
}

// The Realtor workspace preference is the same account_entry_intent the
// Realtor sign-up already stores in the person's own account metadata
// (auth user_metadata). It is a routing preference only: the person can edit
// their own metadata, so nothing in the database reads it and it never grants
// access to a search. It survives losing every client relationship, which a
// membership cannot.
export const REALTOR_PREFERENCE = Object.freeze({ account_entry_intent: 'realtor' });

const NOT_THEIRS = new Set(['wrong_account', 'self_invite', 'not_found', 'not_authenticated']);

// A buyer's invitation to join as their Realtor that can no longer be accepted
// (expired, revoked, already used) still tells us how this person came to FLH.
// Remember it only for an account that hasn't started a buyer experience, and
// never for an invitation addressed to someone else.
export function remembersRealtorFromFailedInvitation({ preview, onboardingComplete }) {
  if (onboardingComplete || !preview || preview.valid) return false;
  if (preview.relationship_type !== 'realtor' || preview.invitation_direction === 'realtor_to_buyer') return false;
  return !NOT_THEIRS.has(preview.reason);
}

// Records the preference once; repeat calls (repeat sign-ins, re-visits) are
// no-ops. Never throws: a failed write only means routing falls back to the
// membership signal.
export async function rememberRealtorWorkspace(supabase) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.account_entry_intent === 'realtor') return false;
    const { error } = await supabase.auth.updateUser({ data: { ...REALTOR_PREFERENCE } });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('Realtor workspace preference not saved', err?.message);
    return false;
  }
}
