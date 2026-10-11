// Onboarding V2, Step 3 ("Your People"): what someone intends, kept apart
// from what has actually happened.
//
// • The cards are an intention, saved as the existing onboarding answer
//   (profiles.onboarding_state.answers.collaboration: solo | co_buyer |
//   realtor | co_buyer_and_realtor). Choosing a card never invites anyone.
// • An invitation exists only when the owner explicitly creates one: a
//   search_invitations row whose link they share themselves. FLH sends no
//   email. People who joined are search_members rows.
// Roles and permissions are the existing ones; nothing here grants access.

import { collaborationIncludes } from './onboardingFlow.js';

export const PEOPLE_KINDS = Object.freeze(['co_buyer', 'realtor']);

export function selectionFromChoice(choice) {
  return { co_buyer: collaborationIncludes(choice, 'co_buyer'), realtor: collaborationIncludes(choice, 'realtor') };
}

export function choiceFromSelection(selection) {
  if (selection.co_buyer && selection.realtor) return 'co_buyer_and_realtor';
  if (selection.co_buyer) return 'co_buyer';
  if (selection.realtor) return 'realtor';
  return 'solo';
}

export function toggleSelection(choice, kind) {
  const selection = selectionFromChoice(choice);
  return choiceFromSelection({ ...selection, [kind]: !selection[kind] });
}

// The people state Step 3 shows: who has joined and which invite links are
// still open. Built from rows the owner can already read (existing RLS).
export function emptyPeople() {
  return { coBuyers: [], realtors: 0, pending: [], ownerName: null };
}

export function normalizePeople(raw) {
  const people = raw && typeof raw === 'object' ? raw : {};
  return {
    coBuyers: Array.isArray(people.coBuyers) ? people.coBuyers.map((person) => ({ name: typeof person?.name === 'string' && person.name.trim() ? person.name.trim() : null })) : [],
    realtors: Number.isInteger(people.realtors) && people.realtors > 0 ? people.realtors : 0,
    pending: Array.isArray(people.pending) ? people.pending.filter((invite) => invite && PEOPLE_KINDS.includes(invite.type) && invite.email && invite.token) : [],
    ownerName: typeof people.ownerName === 'string' && people.ownerName.trim() ? people.ownerName.trim() : null,
  };
}

export function pendingInvite(row) {
  return { id: row.id, email: row.invited_email, type: row.relationship_type, token: row.token, expiresAt: row.expires_at };
}

export function peopleFromRows({ members = [], invitations = [], coBuyerName = null, ownerName = null, now = new Date() } = {}) {
  const coBuyerCount = members.filter((member) => member.role === 'co_buyer').length;
  return normalizePeople({
    coBuyers: Array.from({ length: coBuyerCount }, (_, index) => ({ name: index === 0 ? coBuyerName : null })),
    realtors: members.filter((member) => member.role === 'realtor').length,
    pending: invitations
      .filter((row) => row.status === 'pending' && new Date(row.expires_at) > now)
      .map(pendingInvite),
    ownerName,
  });
}

export function hasRelationship(people, kind) {
  return kind === 'co_buyer' ? people.coBuyers.length > 0 : people.realtors > 0;
}

export function pendingFor(people, kind) {
  return people.pending.filter((invite) => invite.type === kind);
}

// Where nothing was answered yet, existing relationships and open invitations
// are the honest starting point; a saved answer always wins.
export function initialChoice(storedChoice, people) {
  if (storedChoice) return storedChoice;
  const engaged = (kind) => hasRelationship(people, kind) || pendingFor(people, kind).length > 0;
  return engaged('co_buyer') || engaged('realtor') ? choiceFromSelection({ co_buyer: engaged('co_buyer'), realtor: engaged('realtor') }) : null;
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(value));
}

// Why an invite link can't be created for this email, or null if it can.
export function inviteProblem(email, { accountEmail = null } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return 'Enter their email address first.';
  if (!isValidEmail(normalized)) return 'Enter a full email address, like name@example.com.';
  if (accountEmail && normalized === normalizeEmail(accountEmail)) return 'That’s your own email. Enter the email of the person you’d like to invite.';
  return null;
}

// An open invite for the same person and relationship is reused, never duplicated.
export function findOpenInvite(people, kind, email) {
  const normalized = normalizeEmail(email);
  return people.pending.find((invite) => invite.type === kind && normalizeEmail(invite.email) === normalized) || null;
}

export function addPending(people, invite) {
  if (people.pending.some((entry) => entry.id === invite.id)) return people;
  return { ...people, pending: [...people.pending, invite] };
}
