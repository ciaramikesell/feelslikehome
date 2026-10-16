// My Clients: the Realtor's private client records (prospective_searches) and
// how they sit next to the buyer searches a Realtor is connected to.
//
// Two kinds of information never mix here:
//   * a record is the Realtor's own: name, contact details, preferred
//     locations, notes and — before the buyer joins — the proposed criteria
//     (draft_priorities) a buyer sees only through an invitation they open;
//   * a connected client's budget, beds, baths and areas are the buyer's own
//     preferences, read live through the Realtor's current membership and
//     never written into a record.
// Nothing here links records to searches or to each other: that happens only
// in the database, by a buyer claiming an invitation or a Realtor opening a
// record for a search they are on. Possible duplicates are only flagged.
import { defaultPriorities, normalizePriorities } from './constants.js';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applyOnboardingSelections, applySearchChoice } from './onboarding.js';
import { searchAreasOf } from './searchAreas.js';
import { formatHomePrice } from './homeDisplay.js';

export const CLIENT_LIMITS = Object.freeze({ name: 120, email: 320, phone: 40, notes: 5000, locations: 12, location: 80 });

export const RECORD_COLUMNS = 'id,client_name,invited_email,status,draft_priorities,contact_email,contact_phone,preferred_locations,notes,search_id,created_at,updated_at';

export function recordFromRow(row) {
  return {
    id: row.id,
    name: row.client_name || '',
    status: row.status,
    invitedEmail: row.invited_email || '',
    contactEmail: row.contact_email || '',
    contactPhone: row.contact_phone || '',
    preferredLocations: Array.isArray(row.preferred_locations) ? row.preferred_locations : [],
    notes: row.notes || '',
    draftPriorities: row.draft_priorities || {},
    searchId: row.search_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// "Brooklyn, Park Slope; Hoboken" → ['Brooklyn', 'Park Slope', 'Hoboken'], de-duplicated and bounded.
export function parseLocations(text) {
  const seen = new Set();
  return String(text || '').split(/[,;\n]/).map((part) => part.trim().slice(0, CLIENT_LIMITS.location)).filter((part) => {
    const key = part.toLowerCase();
    if (!part || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, CLIENT_LIMITS.locations);
}

const digits = (value) => String(value ?? '').replace(/[^\d.]/g, '');

export function wishlistChoices(searchChoice) {
  return (ONBOARDING_SUGGESTIONS[searchChoice] || []).flatMap(([, items]) => items);
}

const selectedKeysOf = (priorities) => new Set(Object.entries(priorities).flatMap(([category, value]) =>
  Object.entries(value?.tiers || {}).filter(([, tier]) => tier === 'must' || tier === 'important').map(([label]) => `${category}:${label}`)));
const mustKeysOf = (priorities) => new Set(Object.entries(priorities).flatMap(([category, value]) =>
  Object.entries(value?.tiers || {}).filter(([, tier]) => tier === 'must').map(([label]) => `${category}:${label}`)));

// The editable form for a record (empty for a new one).
export function formFromRecord(record = null) {
  const draft = normalizePriorities(record?.draftPriorities && Object.keys(record.draftPriorities).length ? record.draftPriorities : defaultPriorities());
  const choice = draft.onboardingSearchType || 'home_buy';
  return {
    name: record?.name || '',
    contactEmail: record?.contactEmail || '',
    contactPhone: record?.contactPhone || '',
    locations: (record?.preferredLocations || []).join(', '),
    notes: record?.notes || '',
    searchChoice: NEW_SEARCH_CHOICES.some((option) => option.key === choice) ? choice : 'home_buy',
    budget: draft.budget?.value || '',
    beds: draft.bedsMin?.value || '',
    baths: draft.bathsMin?.value || '',
    wishlist: [...selectedKeysOf(draft)],
    dealbreakers: [...mustKeysOf(draft)],
  };
}

// The proposed criteria a buyer would review, in the same shape buyers use.
// Built on the record's existing draft so criteria edited in the full
// "Start a client search" flow are kept.
export function draftFromForm(form, existingDraft = null) {
  const base = existingDraft && Object.keys(existingDraft).length ? existingDraft : defaultPriorities();
  let next = normalizePriorities(base);
  if (next.onboardingSearchType !== form.searchChoice) next = applySearchChoice(next, form.searchChoice);
  next = applyOnboardingSelections(next, new Set(form.wishlist), new Set((form.dealbreakers || []).filter((key) => form.wishlist.includes(key))));
  next.budget = { ...next.budget, value: digits(form.budget) };
  next.bedsMin = { ...next.bedsMin, value: digits(form.beds) };
  next.bathsMin = { ...next.bathsMin, value: digits(form.baths) };
  return next;
}

export function validateForm(form, { connected = false } = {}) {
  const errors = {};
  if (!connected && !form.name.trim()) errors.name = 'Add a name so you can find this client again.';
  if (form.name.length > CLIENT_LIMITS.name) errors.name = 'Keep the name under 120 characters.';
  if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) errors.contactEmail = 'That email doesn’t look right.';
  if (form.contactPhone.length > CLIENT_LIMITS.phone) errors.contactPhone = 'Keep the phone number under 40 characters.';
  if (form.notes.length > CLIENT_LIMITS.notes) errors.notes = 'Notes can be up to 5,000 characters.';
  return errors;
}

// The short "what they're looking for" line for a card.
export function criteriaSummary(priorities) {
  const p = normalizePriorities(priorities || {});
  const parts = [];
  const budget = formatHomePrice(p.budget?.value, p.searchType);
  if (budget) parts.push(`Up to ${budget}`);
  if (p.bedsMin?.value) parts.push(`${p.bedsMin.value}+ beds`);
  if (p.bathsMin?.value) parts.push(`${p.bathsMin.value}+ baths`);
  return parts;
}

export function wishlistLabels(priorities, limit = 6) {
  const p = normalizePriorities(priorities || {});
  const keys = selectedKeysOf(p);
  const known = wishlistChoices(p.onboardingSearchType || 'home_buy');
  return known.filter((item) => keys.has(`${item.categoryKey}:${item.label}`)).map((item) => item.displayLabel).slice(0, limit);
}

// What a connected card shows, from the buyers' own preference documents
// (read live under the Realtor's current membership). Owner first.
export function buyerSearchSummary(priorityRows = [], ownerId = null) {
  const rows = [...priorityRows].sort((a, b) => (a.user_id === ownerId ? -1 : b.user_id === ownerId ? 1 : 0));
  const primary = rows[0]?.priorities;
  if (!primary) return { criteria: [], areas: [] };
  const areas = [];
  rows.forEach((row) => searchAreasOf(row.priorities).forEach((area) => { if (!areas.includes(area.name)) areas.push(area.name); }));
  return { criteria: criteriaSummary(primary), areas: areas.slice(0, 4) };
}

const norm = (value) => String(value || '').trim().toLowerCase();

// Groups everything My Clients shows. One card per connected search, however
// many records point at it; records whose search the Realtor is no longer on
// become "No longer connected" and show only the Realtor's own data.
export function buildClientCards({ records = [], relationships = [], summaries = {} } = {}) {
  const connectedIds = new Set(relationships.map((client) => client.id));
  const connected = relationships.map((client) => {
    const linked = records.filter((record) => record.status === 'connected' && record.searchId === client.id)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return {
      kind: 'connected',
      key: `search:${client.id}`,
      searchId: client.id,
      names: client.people.map((person) => person.display_name).filter(Boolean),
      record: linked[0] || null,
      extraRecords: linked.slice(1),
      activeCount: client.activeCount || 0,
      wantToTourCount: client.wantToTourCount || 0,
      summary: summaries[client.id] || { criteria: [], areas: [] },
      flags: linked.length > 1 ? ['multiple_records'] : [],
    };
  });
  const disconnected = records.filter((record) => record.status === 'connected' && !connectedIds.has(record.searchId))
    .map((record) => ({ kind: 'disconnected', key: `record:${record.id}`, record, flags: [] }));
  const prospective = records.filter((record) => record.status === 'draft' || record.status === 'invited')
    .map((record) => ({ kind: 'prospective', key: `record:${record.id}`, record, flags: [] }));

  // Possible duplicates are flagged, never merged: same email on two private
  // records, or a prospect whose name matches someone already connected.
  const emailOf = (record) => norm(record.contactEmail || record.invitedEmail);
  const byEmail = new Map();
  [...prospective, ...disconnected, ...connected.filter((card) => card.record)].forEach((card) => {
    const email = emailOf(card.record);
    if (!email) return;
    byEmail.set(email, [...(byEmail.get(email) || []), card]);
  });
  byEmail.forEach((cards) => { if (cards.length > 1) cards.forEach((card) => card.flags.push('same_email')); });
  const connectedNames = new Map(connected.flatMap((card) => card.names.map((name) => [norm(name), card])));
  prospective.forEach((card) => {
    const match = connectedNames.get(norm(card.record.name)) || connectedNames.get(norm(card.record.name).split(/\s+/)[0]);
    if (card.record.name && match) card.possibleMatch = match.names.join(' & ');
    if (card.possibleMatch) card.flags.push('name_matches_connected');
  });
  return { connected, prospective, disconnected };
}

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}

export const STATUS_LABEL = Object.freeze({ draft: 'Prospective', invited: 'Invited', connected: 'Connected', disconnected: 'No longer connected' });
