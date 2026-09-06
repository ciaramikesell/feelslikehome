// Co-Buyer V1 — collaboration resolution helpers (Phase B/C).
//
// This is the ONLY place "which search/priorities/home-state applies to the
// current user" logic lives. Pages resolve through these functions; nothing
// else in the app re-derives this logic. RLS (Phase A) remains the final
// authority — these helpers never assume more access than RLS actually grants;
// a query that RLS would reject simply returns no rows, and every function
// here degrades safely (falls back, never throws the user into a broken state).

import { defaultPriorities } from '@/lib/constants';

/* ------------------------------- active search ------------------------------- */

// Resolves which search the current user should be viewing right now.
// - active_search_id is null -> the user's own owned search (today's behavior,
//   unchanged for every account that never touches collaboration).
// - active_search_id is set and still accessible (owned, or an accepted
//   membership) -> that search.
// - active_search_id is set but no longer accessible (removed, revoked,
//   deleted) -> falls back safely to the user's own owned search rather than
//   ever leaving the user stuck on a search they can't see.
export async function resolveActiveSearch(supabase, userId) {
  const [{ data: profile, error: profileError }, { data: ownedSearch, error: ownedError }] = await Promise.all([
    supabase.from('profiles').select('active_search_id').eq('id', userId).maybeSingle(),
    supabase.from('searches').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  if (profileError) throw profileError;
  if (ownedError) throw ownedError;

  if (!profile?.active_search_id || profile.active_search_id === ownedSearch?.id) {
    return { search: ownedSearch, isOwner: true };
  }

  // RLS already scopes this to only what the signed-in user can actually
  // access — if nothing comes back, either the row is gone or access was
  // revoked, and either way we fall back rather than error.
  const { data: activeSearch, error: activeError } = await supabase
    .from('searches').select('*').eq('id', profile.active_search_id).maybeSingle();
  if (activeError) throw activeError;

  if (!activeSearch) return { search: ownedSearch, isOwner: true };
  return { search: activeSearch, isOwner: activeSearch.user_id === userId };
}

// Every search the current user can access, for the search switcher. Small
// by design — V1 is one owned search plus at most one shared search, never a
// full workspace list.
export async function getAccessibleSearches(supabase, userId) {
  const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
    supabase.from('searches').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('search_members').select('search_id').eq('user_id', userId),
  ]);
  if (ownedError) throw ownedError;
  if (memberError) throw memberError;

  const memberSearchIds = (memberships || []).map((m) => m.search_id);
  let memberSearches = [];
  if (memberSearchIds.length) {
    const { data, error } = await supabase.from('searches').select('*').in('id', memberSearchIds);
    if (error) throw error;
    memberSearches = data || [];
  }

  const list = [];
  if (owned) list.push({ id: owned.id, label: 'My Search', isOwner: true });
  memberSearches.forEach((s) => list.push({ id: s.id, label: 'Shared Search', isOwner: false }));
  return list;
}

export async function setActiveSearch(supabase, userId, searchId) {
  const { error } = await supabase.from('profiles').update({ active_search_id: searchId }).eq('id', userId);
  if (error) throw error;
}

/* -------------------------------- priorities -------------------------------- */

// Resolves priorities for (current search, current user):
// 1. A search_member_priorities row exists -> use it.
// 2. The current user OWNS the search and no such row exists yet -> legacy
//    fallback to searches.priorities (today's exact behavior, untouched).
// 3. The current user is a non-owner member with no row yet -> a fresh
//    default set — NEVER a copy of the owner's priorities.
export async function resolvePriorities(supabase, search, userId) {
  if (!search) return defaultPriorities();

  const { data: memberRow, error } = await supabase
    .from('search_member_priorities').select('priorities').eq('search_id', search.id).eq('user_id', userId).maybeSingle();
  if (error) throw error;

  if (memberRow) return memberRow.priorities;
  if (search.user_id === userId) return search.priorities;
  return defaultPriorities();
}

// Saves priorities for (current search, current user). Once a member-
// priorities row exists for a user, we keep writing there consistently
// (never flip back to the legacy column) — this matters even for the owner,
// once they've started using the new path on a shared search.
export async function savePriorities(supabase, search, userId, priorities) {
  const { data: existingRow, error: checkError } = await supabase
    .from('search_member_priorities').select('id').eq('search_id', search.id).eq('user_id', userId).maybeSingle();
  if (checkError) throw checkError;

  if (existingRow || search.user_id !== userId) {
    const { error } = await supabase
      .from('search_member_priorities')
      .upsert({ search_id: search.id, user_id: userId, priorities }, { onConflict: 'search_id,user_id' });
    if (error) throw error;
    return;
  }

  // Owner, no member-priorities row yet — this is every existing single-user
  // account, and stays on the exact same legacy path forever unless they
  // actually start collaborating.
  const { error } = await supabase.from('searches').update({ priorities }).eq('id', search.id);
  if (error) throw error;
}

/* -------------------------------- home state -------------------------------- */

// Personal, per-user fields. Everything else on a home (address, price,
// facts, enrichment, Pros/Cons/Notes) stays shared and untouched by any of this.
const PERSONAL_FIELDS = ['status', 'reaction', 'rejectionReason', 'ratings', 'checks'];

function emptyPersonalState() {
  return { status: 'Saved', reaction: null, rejectionReason: '', ratings: {}, checks: {} };
}

// Resolves personal lifecycle/evaluation state for one home + one user:
// 1. A home_member_state row exists -> use it.
// 2. The user is the home's original adder (homes.user_id, i.e. today's sole
//    owner field) and no row exists -> legacy fallback to the flat columns
//    already on `homes` — today's exact behavior for every existing home.
// 3. Otherwise (a member who hasn't touched this home yet) -> fresh, empty
//    personal state — never inherited from anyone else.
export function resolvePersonalState(home, memberStateRow, userId) {
  if (memberStateRow) {
    return {
      status: memberStateRow.status || 'Saved',
      reaction: memberStateRow.reaction || null,
      rejectionReason: memberStateRow.rejection_reason || '',
      ratings: memberStateRow.ratings || {},
      checks: memberStateRow.checks || {},
    };
  }
  if (home.userId === userId) {
    return {
      status: home.status,
      reaction: home.reaction,
      rejectionReason: home.rejectionReason,
      ratings: home.ratings,
      checks: home.checks,
    };
  }
  return emptyPersonalState();
}

// Fetches every home in a search, with each home's PERSONAL fields already
// resolved for the current user — so every existing component (HomesBoard,
// HomeCard, matching.js, etc.) keeps reading home.status/reaction/ratings/
// checks exactly as it always has, with zero changes needed for reading.
export async function getHomesForUser(supabase, userId, searchId) {
  const { data: rows, error } = await supabase
    .from('homes').select('*').eq('search_id', searchId).order('created_at', { ascending: true });
  if (error) throw error;

  const homes = (rows || []).map((row) => ({ ...rowToHomeWithOwner(row) }));
  const homeIds = homes.map((h) => h.id);

  let stateRows = [];
  if (homeIds.length) {
    const { data, error: stateError } = await supabase
      .from('home_member_state').select('*').eq('user_id', userId).in('home_id', homeIds);
    if (stateError) throw stateError;
    stateRows = data || [];
  }
  const stateByHomeId = new Map(stateRows.map((r) => [r.home_id, r]));

  return homes.map((home) => ({ ...home, ...resolvePersonalState(home, stateByHomeId.get(home.id), userId) }));
}

// Saves personal fields to home_member_state (or the legacy homes columns for
// a genuinely non-collaborative search), and shared/objective fields to homes
// directly — in one call, so callers never need to know which field lives in
// which table.
//
// CRITICAL: whether this is a "legacy" save is determined by whether the
// SEARCH has any accepted members — never by who happened to add this
// specific home. An earlier version of this function used "did I add this
// home" as the test, which meant a co-buyer adding a brand-new home to an
// already-shared search would have had their own personal opinion written
// straight onto the shared row (exactly the outcome this whole architecture
// exists to prevent). Fixed: once a search is collaborative, EVERY
// participant's personal writes — including the original owner's — go to
// home_member_state from that point forward. The flat legacy columns remain
// exactly as they are for any home no one has touched since collaboration
// began (the read side in resolvePersonalState already prefers a
// home_member_state row over the flat columns whenever one exists), but no
// NEW write ever lands there once a search has a member.
export async function saveHomePersonalAndShared(supabase, home, userId, searchId) {
  const { count: memberCount, error: memberCountError } = await supabase
    .from('search_members').select('id', { count: 'exact', head: true }).eq('search_id', searchId);
  if (memberCountError) throw memberCountError;
  const isCollaborative = (memberCount || 0) > 0;

  // IMPORTANT: status/reaction/rejection_reason/ratings/checks on the shared
  // `homes` row represent ONE specific person's legacy personal data (kept
  // there only for pre-collaboration backward compatibility, never as a
  // generic "shared" value). This path is only ever taken at all when the
  // search has no members — i.e., a genuinely single-user account, exactly
  // today's behavior, unchanged.
  const isLegacyOwnerSave = !isCollaborative;

  const sharedRow = homeToSharedRow(home, userId, searchId, isLegacyOwnerSave);
  const { data: savedShared, error: sharedError } = await supabase
    .from('homes').upsert(sharedRow).select().single();
  if (sharedError) throw sharedError;

  const savedHome = rowToHomeWithOwner(savedShared);

  const personal = {
    status: home.status, reaction: home.reaction, rejectionReason: home.rejectionReason,
    ratings: home.ratings, checks: home.checks,
  };

  if (!isLegacyOwnerSave) {
    const { error } = await supabase.from('home_member_state').upsert({
      home_id: savedHome.id, user_id: userId,
      status: personal.status, reaction: personal.reaction, rejection_reason: personal.rejectionReason || '',
      ratings: personal.ratings || {}, checks: personal.checks || {},
    }, { onConflict: 'home_id,user_id' });
    if (error) throw error;
  }
  // Non-collaborative path: status/reaction/ratings/checks were already
  // written as part of the shared-row upsert above — nothing further to do.

  return { ...savedHome, ...personal };
}

/* -------------------------------- archive -------------------------------- */

// Every accepted participant in a search: the owner plus every active member.
export async function getSearchParticipantIds(supabase, search) {
  const { data, error } = await supabase.from('search_members').select('user_id').eq('search_id', search.id);
  if (error) throw error;
  return [search.user_id, ...(data || []).map((m) => m.user_id)];
}

// For a set of homes in a search, resolves every participant's personal
// status per home — the data needed for global archive aggregation and the
// "Archived by Co-Buyer" signal. Returns Map<homeId, Array<{userId, status}>>.
// A participant who has never touched a given home (no home_member_state row,
// and not the home's original legacy adder) resolves to status: null — never
// counted as "active" or "archived," simply "hasn't looked at this yet."
export async function getParticipantStatusesForHomes(supabase, search, homes) {
  const homeIds = homes.map((h) => h.id);
  if (!homeIds.length) return new Map();

  const participantIds = await getSearchParticipantIds(supabase, search);
  if (participantIds.length <= 1) {
    // Not collaborative — every home's only participant is the current
    // account itself, whose status is already on the home object.
    const result = new Map();
    homes.forEach((home) => result.set(home.id, [{ userId: home.userId, status: home.status }]));
    return result;
  }

  const { data: stateRows, error } = await supabase
    .from('home_member_state').select('home_id, user_id, status').in('home_id', homeIds).in('user_id', participantIds);
  if (error) throw error;

  const stateByHomeAndUser = new Map((stateRows || []).map((r) => [`${r.home_id}:${r.user_id}`, r.status]));

  const result = new Map();
  homes.forEach((home) => {
    const perParticipant = participantIds.map((pid) => {
      const stateStatus = stateByHomeAndUser.get(`${home.id}:${pid}`);
      if (stateStatus !== undefined) return { userId: pid, status: stateStatus };
      if (home.userId === pid) return { userId: pid, status: home.status }; // legacy fallback, adder only
      return { userId: pid, status: null }; // hasn't touched this home at all
    });
    result.set(home.id, perParticipant);
  });
  return result;
}

// A shared home is archived only when EVERY active participant (owner + all
// accepted members) has personally archived it. One shared definition, used
// everywhere "is this home fully archived?" matters — never duplicated.
export function isGloballyArchived(perParticipantStatuses) {
  return perParticipantStatuses.length > 0 && perParticipantStatuses.every((s) => s === 'Archived');
}

// For the current user's view of a home: are there OTHER participants who
// have archived it while the current user has not? Returns the count (for
// "Archived by 1 other" style copy) or null if there's nothing to show.
export function coBuyerArchivedSignal(currentUserStatus, otherParticipantStatuses) {
  if (currentUserStatus === 'Archived') return null;
  const archivedOthers = otherParticipantStatuses.filter((s) => s === 'Archived').length;
  return archivedOthers > 0 ? archivedOthers : null;
}

/* -------------------------------- invitations -------------------------------- */

// Invite creation needs no RPC — the owner already has direct INSERT rights
// via the existing Phase A policy. Email is normalized so a later
// case-difference doesn't accidentally block acceptance.
export async function createInvitation(supabase, searchId, invitedBy, invitedEmail) {
  const { data, error } = await supabase.from('search_invitations').insert({
    search_id: searchId,
    invited_by: invitedBy,
    invited_email: invitedEmail.trim().toLowerCase(),
  }).select().single();
  if (error) throw error;
  return data;
}

// The invitee has zero RLS access to search_invitations before accepting —
// preview/accept go through the two Phase D SECURITY DEFINER RPCs instead,
// which expose only a validity boolean and (on failure) a reason code, never
// the search's contents or any other invitation.
export async function previewInvitation(supabase, token) {
  const { data, error } = await supabase.rpc('preview_invitation', { p_token: token });
  if (error) throw error;
  return data?.[0] || { valid: false, reason: 'not_found' };
}

export async function acceptInvitation(supabase, token) {
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) throw error;
  return data?.[0] || { success: false, reason: 'unknown', search_id: null };
}

/* -------------------------------- internal -------------------------------- */

function rowToHomeWithOwner(row) {
  return {
    id: row.id,
    userId: row.user_id,
    address: row.address || '',
    crossroads: row.crossroads || '',
    listingUrl: row.listing_url || '',
    photoUrl: row.photo_url || '',
    price: row.price || '',
    estMonthly: row.est_monthly || '',
    sqft: row.sqft || '',
    beds: row.beds || '',
    baths: row.baths || '',
    lotSize: row.lot_size || '',
    garageSpaces: row.garage_spaces || '',
    yearBuilt: row.year_built || '',
    daysOnMarket: row.days_on_market || '',
    homeLayout: row.home_layout || [],
    primaryBedroomLocation: row.primary_bedroom_location || '',
    secondaryBedroomLocation: row.secondary_bedroom_location || '',
    status: row.status || 'Considering',
    reaction: row.reaction || null,
    rejectionReason: row.rejection_reason || '',
    ratings: row.ratings || {},
    checks: row.checks || {},
    notes: row.notes || '',
    pros: row.pros || '',
    cons: row.cons || '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    hoaFeeMonthly: row.hoa_fee_monthly ?? null,
    propertyTaxAnnual: row.property_tax_annual ?? null,
    propertyTaxYear: row.property_tax_year ?? null,
    schoolDistrict: row.school_district || null,
  };
}

function homeToSharedRow(home, userId, searchId, includeLegacyPersonalFields) {
  return {
    ...(home.id ? { id: home.id } : {}),
    user_id: home.id ? home.userId ?? userId : userId, // never reassign the adder of an existing home
    search_id: searchId,
    address: home.address || '',
    crossroads: home.crossroads || '',
    listing_url: home.listingUrl || '',
    photo_url: home.photoUrl || '',
    price: home.price || '',
    est_monthly: home.estMonthly || '',
    sqft: home.sqft || '',
    beds: home.beds || '',
    baths: home.baths || '',
    lot_size: home.lotSize || '',
    garage_spaces: home.garageSpaces || '',
    year_built: home.yearBuilt || '',
    days_on_market: home.daysOnMarket || '',
    home_layout: home.homeLayout || [],
    primary_bedroom_location: home.primaryBedroomLocation || '',
    secondary_bedroom_location: home.secondaryBedroomLocation || '',
    // Legacy personal-shaped fields — ONLY ever written by the home's actual
    // original owner (see saveHomePersonalAndShared). Omitted entirely from
    // a co-buyer's shared-row write, so their own personal save can never
    // clobber the owner's legacy-fallback data sitting on this same row.
    ...(includeLegacyPersonalFields ? {
      status: home.status || 'Considering',
      reaction: home.reaction || null,
      rejection_reason: home.rejectionReason || '',
      ratings: home.ratings || {},
      checks: home.checks || {},
    } : {}),
    notes: home.notes || '',
    pros: home.pros || '',
    cons: home.cons || '',
    latitude: home.latitude ?? null,
    longitude: home.longitude ?? null,
    hoa_fee_monthly: home.hoaFeeMonthly ?? null,
    property_tax_annual: home.propertyTaxAnnual ?? null,
    property_tax_year: home.propertyTaxYear ?? null,
    school_district: home.schoolDistrict || null,
    updated_at: new Date().toISOString(),
  };
}
