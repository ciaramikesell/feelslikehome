// Co-Buyer V1 — collaboration resolution helpers (Phase B/C).
//
// This is the ONLY place "which search/priorities/home-state applies to the
// current user" logic lives. Pages resolve through these functions; nothing
// else in the app re-derives this logic. RLS (Phase A) remains the final
// authority — these helpers never assume more access than RLS actually grants;
// a query that RLS would reject simply returns no rows, and every function
// here degrades safely (falls back, never throws the user into a broken state).

import { defaultPriorities } from '@/lib/constants';
import { deriveSharedFactPriorityAwareness } from '@/lib/sharedFactPriorityAwareness';
import { hasOutstandingWantToTour } from '@/lib/lifecycle';

// Application allowlists for the shared records. Personal legacy columns are
// intentionally absent so a later column-privilege cutover cannot change the
// shape consumed by runtime code.
export const SEARCH_SHARED_COLUMNS = 'id,user_id,created_at,updated_at';
const HOME_SHARED_COLUMNS_PRE_PASS_B = [
  'id', 'user_id', 'search_id', 'address', 'crossroads', 'listing_url', 'photo_url',
  'price', 'est_monthly', 'sqft', 'beds', 'baths', 'lot_size', 'garage_spaces',
  'year_built', 'days_on_market', 'home_layout', 'home_condition',
  'primary_bedroom_location', 'secondary_bedroom_location', 'notes', 'pros', 'cons',
  'latitude', 'longitude', 'coordinate_address_fingerprint', 'coordinate_status',
  'coordinate_source', 'hoa_fee_monthly', 'property_tax_annual', 'property_tax_year',
  'basement_notes', 'schools_notes', 'condition_notes', 'created_at', 'updated_at',
].join(',');
export const HOME_SHARED_COLUMNS = `${HOME_SHARED_COLUMNS_PRE_PASS_B},property_type,available_on,pets_allowed,utilities_included,in_unit_laundry`;

const PASS_B_DATABASE_COLUMNS = ['property_type', 'available_on', 'pets_allowed', 'utilities_included', 'in_unit_laundry'];
function isPrePassBSchemaError(error) {
  return error?.code === '42703' || (error?.code === 'PGRST204' && PASS_B_DATABASE_COLUMNS.some((column) => error.message?.includes(column)));
}

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
    supabase.from('searches').select(SEARCH_SHARED_COLUMNS).eq('user_id', userId).maybeSingle(),
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
    .from('searches').select(SEARCH_SHARED_COLUMNS).eq('id', profile.active_search_id).maybeSingle();
  if (activeError) throw activeError;

  if (!activeSearch) return { search: ownedSearch, isOwner: true };
  return { search: activeSearch, isOwner: activeSearch.user_id === userId };
}

// Every search the current user can access, for the search switcher. Small
// by design — V1 is one owned search plus at most one shared search, never a
// full workspace list.
export async function getAccessibleSearches(supabase, userId) {
  const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
    supabase.from('searches').select(SEARCH_SHARED_COLUMNS).eq('user_id', userId).maybeSingle(),
    supabase.from('search_members').select('search_id').eq('user_id', userId),
  ]);
  if (ownedError) throw ownedError;
  if (memberError) throw memberError;

  const memberSearchIds = (memberships || []).map((m) => m.search_id);
  let memberSearches = [];
  if (memberSearchIds.length) {
    const { data, error } = await supabase.from('searches').select(SEARCH_SHARED_COLUMNS).in('id', memberSearchIds);
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
// A missing caller-owned row is neutral; legacy searches.priorities is never
// read or treated as authoritative.
export async function resolvePriorities(supabase, search, userId) {
  if (!search) return defaultPriorities();

  const { data: memberRow, error } = await supabase
    .from('search_member_priorities').select('priorities').eq('search_id', search.id).eq('user_id', userId).maybeSingle();
  if (error) throw error;

  return memberRow?.priorities || defaultPriorities();
}

// The RPC verifies search access and projects protected participant priorities
// to tier-free shared-fact booleans inside Postgres. Neither this resolver nor
// any client component can receive the underlying co-buyer priority document.
export async function resolveSharedFactPriorityAwareness(supabase, search) {
  if (!search) return {};
  const { data, error } = await supabase.rpc('resolve_shared_fact_priority_awareness', {
    p_search_id: search.id,
  });
  if (error) throw error;
  return deriveSharedFactPriorityAwareness(data || []);
}

// Compare's only bridge to another participant's protected priorities and
// evaluation state. The SECURITY DEFINER RPC calculates Match independently
// in Postgres and projects only sanitized display results; raw priorities,
// tiers, checks, and ratings never cross into application code.
export async function resolveCoBuyerComparePerspectives(supabase, search, homeIds) {
  if (!search || !homeIds.length) return new Map();
  const { data, error } = await supabase.rpc('resolve_cobuyer_compare_perspectives', {
    p_search_id: search.id,
    p_home_ids: homeIds,
  });
  if (error) throw error;
  return new Map((data || []).map((row) => [row.home_id, {
    match: row.selected_count > 0 ? {
      pct: row.pct,
      evaluatedCount: row.evaluated_count,
      selectedCount: row.selected_count,
    } : null,
    overallFeeling: row.overall_feeling || 0,
    differentTakes: row.different_takes || [],
  }]));
}

// Saves priorities only to the authenticated participant's row, for owners
// and co-buyers alike.
export async function savePriorities(supabase, search, userId, priorities) {
  const { error } = await supabase.from('search_member_priorities')
    .upsert({ search_id: search.id, user_id: userId, priorities }, { onConflict: 'search_id,user_id' });
  if (error) throw error;
}

/* -------------------------- private commute data -------------------------- */

function rowToCommuteDestination(row) {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    maxDriveMinutes: row.max_drive_minutes,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    coordinateAddressFingerprint: row.coordinate_address_fingerprint,
    coordinateStatus: row.coordinate_status,
  };
}

// RLS additionally enforces user_id = auth.uid(); this explicit filter makes
// the participant boundary obvious and limits every normal query by design.
export async function getCommuteDestinations(supabase, searchId, userId) {
  const { data, error } = await supabase.from('commute_destinations').select('*')
    .eq('search_id', searchId).eq('user_id', userId).order('created_at');
  if (error) throw error;
  return (data || []).map(rowToCommuteDestination);
}

export async function createCommuteDestination(supabase, searchId, userId, destination) {
  const { data, error } = await supabase.from('commute_destinations').insert({
    search_id: searchId, user_id: userId, label: destination.label.trim(),
    address: destination.address.trim(), max_drive_minutes: destination.maxDriveMinutes,
  }).select().single();
  if (error) throw error;
  return rowToCommuteDestination(data);
}

export async function updateCommuteDestination(supabase, id, changes) {
  const row = {};
  if (changes.label !== undefined) row.label = changes.label.trim();
  if (changes.address !== undefined) row.address = changes.address.trim();
  if (changes.maxDriveMinutes !== undefined) row.max_drive_minutes = changes.maxDriveMinutes;
  const { data, error } = await supabase.from('commute_destinations').update(row).eq('id', id).select().single();
  if (error) throw error;
  return rowToCommuteDestination(data);
}

export async function deleteCommuteDestination(supabase, id) {
  const { error } = await supabase.from('commute_destinations').delete().eq('id', id);
  if (error) throw error;
}

/* -------------------------------- home state -------------------------------- */

// Personal, per-user fields. Everything else on a home (address, price,
// facts, enrichment, Pros/Cons/Notes) stays shared and untouched by any of this.
const PERSONAL_FIELDS = ['status', 'touredAt', 'isFavorite', 'reaction', 'rejectionReason', 'ratings', 'checks'];

// Everything that belongs to the shared home record. Keeping this list beside
// the persistence helpers lets callers distinguish a personal-only edit from a
// real property edit without duplicating storage knowledge in UI components.
const SHARED_FIELDS = [
  'address', 'crossroads', 'listingUrl', 'photoUrl', 'price', 'estMonthly', 'sqft',
  'beds', 'baths', 'lotSize', 'garageSpaces', 'yearBuilt', 'daysOnMarket',
  'homeLayout', 'homeCondition', 'primaryBedroomLocation', 'secondaryBedroomLocation',
  'notes', 'pros', 'cons', 'latitude', 'longitude', 'coordinateAddressFingerprint',
  'coordinateStatus', 'coordinateSource', 'hoaFeeMonthly',
  'propertyTaxAnnual', 'propertyTaxYear', 'basementNotes',
  'schoolsNotes', 'conditionNotes',
  'propertyType', 'availableOn', 'petsAllowed', 'utilitiesIncluded', 'inUnitLaundry',
];

function emptyPersonalState() {
  return { status: 'Saved', touredAt: null, isFavorite: false, reaction: null, rejectionReason: '', ratings: {}, checks: {} };
}

// Resolves personal lifecycle/evaluation state from the caller-owned row.
// Unexpected absence is neutral and never falls back to legacy homes fields.
export function resolvePersonalState(home, memberStateRow, userId) {
  if (memberStateRow) {
    return {
      status: memberStateRow.status || 'Saved',
      touredAt: memberStateRow.toured_at || null,
      isFavorite: Boolean(memberStateRow.is_favorite),
      reaction: memberStateRow.reaction || null,
      rejectionReason: memberStateRow.rejection_reason || '',
      ratings: memberStateRow.ratings || {},
      checks: memberStateRow.checks || {},
    };
  }
  return emptyPersonalState();
}

// Fetches every home in a search, with each home's PERSONAL fields already
// resolved for the current user — so every existing component (HomesBoard,
// HomeCard, matching.js, etc.) keeps reading home.status/reaction/ratings/
// checks exactly as it always has, with zero changes needed for reading.
export async function getHomesForUser(supabase, userId, searchId) {
  let { data: rows, error } = await supabase
    .from('homes').select(HOME_SHARED_COLUMNS).eq('search_id', searchId).order('created_at', { ascending: true });
  // Repository merge precedes the manual production migration. Retry only the
  // recognizable missing-column response so the dormant release works on both schemas.
  if (isPrePassBSchemaError(error)) ({ data: rows, error } = await supabase
    .from('homes').select(HOME_SHARED_COLUMNS_PRE_PASS_B).eq('search_id', searchId).order('created_at', { ascending: true }));
  if (error) throw error;

  const homes = (rows || []).map((row) => ({ ...rowToHomeWithOwner(row) }));
  const homeIds = homes.map((h) => h.id);

  let stateRows = [];
  if (homeIds.length) {
    const { data, error: stateError } = await supabase
      .from('home_member_state').select('home_id,status,toured_at,is_favorite,reaction,rejection_reason,ratings,checks').eq('user_id', userId).in('home_id', homeIds);
    if (stateError) throw stateError;
    stateRows = data || [];
  }
  const stateByHomeId = new Map(stateRows.map((r) => [r.home_id, r]));

  return homes.map((home) => ({ ...home, ...resolvePersonalState(home, stateByHomeId.get(home.id), userId) }));
}

// Saves shared/objective fields to homes and the caller's personal fields to
// home_member_state. The same storage split applies to solo owners and every
// collaborative participant.
function personalStateFromHome(home) {
  return {
    status: home.status,
    touredAt: home.touredAt || null,
    isFavorite: Boolean(home.isFavorite),
    reaction: home.reaction,
    rejectionReason: home.rejectionReason,
    ratings: home.ratings,
    checks: home.checks,
  };
}

async function upsertPersonalState(supabase, homeId, userId, personal) {
  const { error } = await supabase.from('home_member_state').upsert({
    home_id: homeId,
    user_id: userId,
    status: personal.status,
    toured_at: personal.touredAt || null,
    is_favorite: Boolean(personal.isFavorite),
    reaction: personal.reaction,
    rejection_reason: personal.rejectionReason || '',
    ratings: personal.ratings || {},
    checks: personal.checks || {},
  }, { onConflict: 'home_id,user_id' });
  if (error) throw error;
}

// True when an edit changes data owned by the shared homes row. Object/array
// fields are JSON-compatible, so structural comparison avoids treating a new
// array reference with identical values as a shared edit.
export function hasSharedHomeChanges(home, previousHome) {
  if (!home?.id || !previousHome) return true;
  return SHARED_FIELDS.some((field) => JSON.stringify(home[field] ?? null) !== JSON.stringify(previousHome[field] ?? null));
}

export async function saveHomePersonalAndShared(supabase, home, userId, searchId) {
  const sharedRow = homeToSharedRow(home, userId, searchId);
  let { data: savedShared, error: sharedError } = await supabase
    .from('homes').upsert(sharedRow).select(HOME_SHARED_COLUMNS).single();
  if (isPrePassBSchemaError(sharedError)) {
    const legacyRow = Object.fromEntries(Object.entries(sharedRow).filter(([key]) => !PASS_B_DATABASE_COLUMNS.includes(key)));
    ({ data: savedShared, error: sharedError } = await supabase
      .from('homes').upsert(legacyRow).select(HOME_SHARED_COLUMNS_PRE_PASS_B).single());
  }
  if (sharedError) throw sharedError;

  const savedHome = rowToHomeWithOwner(savedShared);

  const personal = personalStateFromHome(home);

  await upsertPersonalState(supabase, savedHome.id, userId, personal);

  return { ...savedHome, ...personal };
}

// Personal lifecycle/evaluation actions always touch only the authenticated
// participant's state row, never the shared homes row.
export async function saveHomePersonalState(supabase, home, userId, searchId) {
  if (!home.id) throw new Error('Cannot save personal state for a home without an id.');

  const personal = personalStateFromHome(home);
  await upsertPersonalState(supabase, home.id, userId, personal);
  return { ...home, ...personal };
}

/* -------------------------------- archive -------------------------------- */

// Every accepted participant in a search: the owner plus every active member.
export async function getSearchParticipantIds(supabase, search) {
  const { data, error } = await supabase.from('search_members').select('user_id').eq('search_id', search.id);
  if (error) throw error;
  return [search.user_id, ...(data || []).map((m) => m.user_id)];
}

// For a collaborative search, fetches only the four approved co-buyer/global
// lifecycle conclusions. Raw participant identities, statuses, tour timestamps,
// and favorite rows never enter application code.
export async function getParticipantStatusesForHomes(supabase, search, homes) {
  const homeIds = homes.map((h) => h.id);
  if (!homeIds.length) return new Map();

  const participantIds = await getSearchParticipantIds(supabase, search);
  if (participantIds.length <= 1) return new Map();

  const { data: stateRows, error } = await supabase.rpc('resolve_cobuyer_lifecycle_signals', {
    p_search_id: search.id,
    p_home_ids: homeIds,
  });
  if (error) throw error;
  return new Map((stateRows || []).map((row) => [row.home_id, {
    coBuyerWantsToTour: Boolean(row.co_buyer_wants_to_tour),
    coBuyerFavorited: Boolean(row.co_buyer_favorited),
    coBuyerArchived: Boolean(row.co_buyer_archived),
    allParticipantsArchived: Boolean(row.all_participants_archived),
  }]));
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

// "The house is ours. The opinion is mine." This is the single presentation
// derivation for the narrow Favorite/Archive signals collaborators may see.
// It never combines ownership or mutates either participant's state.
export function deriveCoBuyerPersonalSignals(currentUserState, otherParticipantStates = []) {
  const currentUserFavorited = Boolean(currentUserState.isFavorite);
  const coBuyerFavorited = otherParticipantStates.some((state) => Boolean(state.isFavorite));
  const currentUserArchived = currentUserState.status === 'Archived';
  const coBuyerArchived = otherParticipantStates.some((state) => state.status === 'Archived');
  const coBuyerArchivedCount = coBuyerArchivedSignal(
    currentUserState.status,
    otherParticipantStates.map((state) => state.status),
  );
  const globallyArchived = isGloballyArchived([
    currentUserState.status,
    ...otherParticipantStates.map((state) => state.status),
  ]);

  let favoriteLabel = null;
  if (currentUserFavorited && coBuyerFavorited) favoriteLabel = 'You both favorited this';
  else if (coBuyerFavorited) favoriteLabel = 'Favorited by Co-Buyer';

  return {
    currentUserFavorited,
    coBuyerFavorited,
    favoriteLabel,
    currentUserArchived,
    coBuyerArchived,
    globallyArchived,
    coBuyerArchivedCount,
  };
}

export function addCoBuyerPersonalSignals(homes, personalStatesByHome, currentUserId) {
  return homes.map((home) => {
    const signal = personalStatesByHome.get(home.id);
    if (!signal) return home;
    const currentUserFavorited = Boolean(home.isFavorite);
    let favoriteLabel = null;
    if (currentUserFavorited && signal.coBuyerFavorited) favoriteLabel = 'You both favorited this';
    else if (signal.coBuyerFavorited) favoriteLabel = 'Favorited by Co-Buyer';
    return {
      ...home,
      isCollaborative: true,
      currentUserFavorited,
      coBuyerFavorited: signal.coBuyerFavorited,
      favoriteLabel,
      currentUserArchived: home.status === 'Archived',
      coBuyerArchived: signal.coBuyerArchived,
      globallyArchived: signal.allParticipantsArchived,
      coBuyerArchivedCount: home.status !== 'Archived' && signal.coBuyerArchived ? 1 : null,
      coBuyerWantsToTour: signal.coBuyerWantsToTour,
    };
  });
}

/* ---------------------------- Want to Tour agenda ---------------------------- */

// Want to Tour remains a personal lifecycle choice, but a collaborative search's
// agenda is the union of both participants' choices. Keep this derivation beside
// the other participant-state helpers so pages never have to reinterpret another
// person's full home state (ratings, reaction, checks, etc.).
export function deriveWantToTourState(currentUserState, otherParticipantStates = []) {
  const current = typeof currentUserState === 'string' ? { status: currentUserState } : currentUserState;
  const others = otherParticipantStates.map((state) => typeof state === 'string' ? { status: state } : state);
  const currentUserWantsToTour = hasOutstandingWantToTour(current);
  const coBuyerWantsToTour = others.some(hasOutstandingWantToTour);
  const householdWantsToTour = currentUserWantsToTour || coBuyerWantsToTour;

  let wantToTourLabel = null;
  if (currentUserWantsToTour && coBuyerWantsToTour) wantToTourLabel = 'You both want to tour';
  else if (currentUserWantsToTour) wantToTourLabel = 'You want to tour';
  else if (coBuyerWantsToTour) wantToTourLabel = 'Co-Buyer wants to tour';

  return { currentUserWantsToTour, coBuyerWantsToTour, householdWantsToTour, wantToTourLabel };
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

/* -------------------------------- membership lifecycle -------------------------------- */

// Both of these are plain authenticated DELETE calls — no RPC needed. The
// existing search_members_owner_delete RLS policy (from Phase A) already
// enforces every rule required here: the owner may delete any member row on
// their own search, a user may delete only their own row (self = leave), and
// nobody else can delete anything. The owner structurally can never have a
// row in this table at all (see the foundation migration), so there is no
// way for this action to accidentally remove the owner.
//
// Neither of these touches search_member_priorities or home_member_state —
// confirmed by inspecting the schema: neither table has a foreign key
// referencing search_members, so deleting a membership row cannot cascade
// into personal data. That data simply becomes dormant (still owned by the
// same user_id, still subject to the same per-user RLS) until/unless that
// person is invited back, at which point it naturally reactivates — no
// rejoin-specific logic is needed for this to work correctly.

export async function leaveSearch(supabase, userId, searchId) {
  const { error } = await supabase.from('search_members').delete().eq('search_id', searchId).eq('user_id', userId);
  if (error) throw error;
  // Immediately clear this session's active_search_id back to their own
  // owned search, so they're not left pointed at a search they can no
  // longer read even before the next full page load's fallback would catch it.
  const { data: ownedSearch } = await supabase.from('searches').select('id').eq('user_id', userId).maybeSingle();
  if (ownedSearch) await setActiveSearch(supabase, userId, ownedSearch.id);
}

export async function removeMember(supabase, searchId, memberUserId) {
  const { error } = await supabase.from('search_members').delete().eq('search_id', searchId).eq('user_id', memberUserId);
  if (error) throw error;
  // The removed member's own active_search_id cannot be touched from here —
  // that's a different user's row, and RLS correctly prevents writing it.
  // resolveActiveSearch's existing fallback (search comes back null via RLS
  // -> fall back to their own owned search) already handles this safely the
  // next time they load the app — this is not new behavior, just relied upon.
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
    homeCondition: Array.isArray(row.home_condition) ? row.home_condition : [],
    primaryBedroomLocation: row.primary_bedroom_location || '',
    secondaryBedroomLocation: row.secondary_bedroom_location || '',
    // Caller-private state is overlaid from home_member_state after mapping.
    status: 'Saved',
    touredAt: null,
    isFavorite: false,
    reaction: null,
    rejectionReason: '',
    ratings: {},
    checks: {},
    notes: row.notes || '',
    pros: row.pros || '',
    cons: row.cons || '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    coordinateAddressFingerprint: row.coordinate_address_fingerprint || null,
    coordinateStatus: row.coordinate_status || 'unresolved',
    coordinateSource: row.coordinate_source || null,
    hoaFeeMonthly: row.hoa_fee_monthly ?? null,
    propertyTaxAnnual: row.property_tax_annual ?? null,
    propertyTaxYear: row.property_tax_year ?? null,
    basementNotes: row.basement_notes || '',
    schoolsNotes: row.schools_notes || '',
    conditionNotes: row.condition_notes || '',
    propertyType: row.property_type ?? null,
    availableOn: row.available_on ?? null,
    petsAllowed: row.pets_allowed ?? null,
    utilitiesIncluded: row.utilities_included ?? null,
    inUnitLaundry: row.in_unit_laundry ?? null,
  };
}

function homeToSharedRow(home, userId, searchId) {
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
    home_condition: Array.isArray(home.homeCondition) ? home.homeCondition : [],
    primary_bedroom_location: home.primaryBedroomLocation || '',
    secondary_bedroom_location: home.secondaryBedroomLocation || '',
    notes: home.notes || '',
    pros: home.pros || '',
    cons: home.cons || '',
    latitude: home.latitude ?? null,
    longitude: home.longitude ?? null,
    coordinate_address_fingerprint: home.coordinateAddressFingerprint || null,
    coordinate_status: home.coordinateStatus || 'unresolved',
    coordinate_source: home.coordinateSource || null,
    hoa_fee_monthly: home.hoaFeeMonthly ?? null,
    property_tax_annual: home.propertyTaxAnnual ?? null,
    property_tax_year: home.propertyTaxYear ?? null,
    basement_notes: home.basementNotes || '',
    schools_notes: home.schoolsNotes || '',
    condition_notes: home.conditionNotes || '',
    property_type: home.propertyType ?? null,
    available_on: home.availableOn ?? null,
    pets_allowed: home.petsAllowed ?? null,
    utilities_included: home.utilitiesIncluded ?? null,
    in_unit_laundry: home.inUnitLaundry ?? null,
    updated_at: new Date().toISOString(),
  };
}
