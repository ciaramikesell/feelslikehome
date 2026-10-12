// Onboarding V2, Step 3 ("Your People"): what someone intends, kept apart
// from who is actually in the search.
//
// • The cards are an intention, saved as the existing onboarding answer
//   (profiles.onboarding_state.answers.collaboration: solo | co_buyer |
//   realtor | co_buyer_and_realtor). Choosing a card never invites anyone and
//   never creates a membership; inviting happens in My Search.
// • People who joined are search_members rows, read with the existing owner
//   policies and shown as they are.
// Roles and permissions are the existing ones; nothing here grants access.

import { collaborationIncludes } from './onboardingFlow.js';

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

// Who is already in this search (never invented).
export function emptyPeople() {
  return { coBuyers: [], realtors: 0, ownerName: null };
}

const nameOrNull = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function normalizePeople(raw) {
  const people = raw && typeof raw === 'object' ? raw : {};
  return {
    coBuyers: Array.isArray(people.coBuyers) ? people.coBuyers.map((person) => ({ name: nameOrNull(person?.name) })) : [],
    realtors: Number.isInteger(people.realtors) && people.realtors > 0 ? people.realtors : 0,
    ownerName: nameOrNull(people.ownerName),
  };
}

export function peopleFromRows({ members = [], coBuyerName = null, ownerName = null } = {}) {
  const coBuyerCount = members.filter((member) => member.role === 'co_buyer').length;
  return normalizePeople({
    coBuyers: Array.from({ length: coBuyerCount }, (_, index) => ({ name: index === 0 ? coBuyerName : null })),
    realtors: members.filter((member) => member.role === 'realtor').length,
    ownerName,
  });
}

export function hasRelationship(people, kind) {
  return kind === 'co_buyer' ? people.coBuyers.length > 0 : people.realtors > 0;
}

// How Step 3 and Review name the existing relationships. Renters see
// "Co-renter" and "Agent"; the stored roles (co_buyer, realtor), invitations
// and permissions are exactly the same for every kind of search.
const BUYER_WORDS = Object.freeze({
  coBuyer: 'Co-buyer', coBuyers: 'Co-buyers', coBuyerLower: 'co-buyer',
  coBuyerDescription: 'Compare priorities and see how each home fits both of you.',
  coBuyerSharing: 'share homes but keep their own priorities and ratings.',
  realtor: 'Realtor', realtors: 'Realtors', realtorLower: 'Realtor',
  realtorDescription: 'Share your wishlist and receive home suggestions from your agent.',
  realtorSharing: 'can view what you share with them and suggest homes.',
});
const RENTER_WORDS = Object.freeze({
  coBuyer: 'Co-renter', coBuyers: 'Co-renters', coBuyerLower: 'co-renter',
  coBuyerDescription: 'Compare priorities and see how each place fits both of you.',
  coBuyerSharing: 'share places but keep their own priorities and ratings.',
  realtor: 'Agent', realtors: 'Agents', realtorLower: 'agent',
  realtorDescription: 'Share your wishlist and receive rental suggestions from your agent.',
  realtorSharing: 'can view what you share with them and suggest places.',
});
export function peopleWords(experienceKey) {
  return experienceKey === 'home_rent' || experienceKey === 'apartment_rent' ? RENTER_WORDS : BUYER_WORDS;
}
