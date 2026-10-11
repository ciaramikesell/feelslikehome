// Onboarding V2, Step 6 ("Your search is ready."): a read-only summary of what
// the earlier steps saved. Nothing here writes or infers: an unanswered
// question is null (shown as "Not set yet"), an intention is never described
// as an invitation, and grouped alternatives stay one line ("House or Condo").

import { normalizePriorities } from './constants.js';
import { NEW_SEARCH_CHOICES } from './onboarding.js';
import { formatThousands } from './onboardingBasics.js';
import { hasRelationship, normalizePeople, selectionFromChoice } from './onboardingPeople.js';
import { AREA_TYPES, searchAreasOf } from './searchAreas.js';
import { PRIORITY_LEVELS, searchExperienceKey } from './searchProfile.js';
import { priorityLevelsWithGroups } from './whatMattersGroups.js';

const entered = (value) => String(value ?? '').trim();

export function basicsSummary(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  const choice = NEW_SEARCH_CHOICES.find((entry) => entry.key === priorities.onboardingSearchType);
  const rent = experience === 'home_rent' || experience === 'apartment_rent';
  const budget = entered(priorities.budget.value);
  const beds = entered(priorities.bedsMin.value);
  const baths = entered(priorities.bathsMin.value);
  const sqft = entered(priorities.sqftTarget.value);
  const lot = entered(priorities.lotSizeTarget.value);
  return [
    { key: 'type', label: 'Looking for', value: choice ? choice.label : null },
    { key: 'budget', label: rent ? 'Maximum monthly rent' : 'Maximum budget', value: budget ? `$${formatThousands(budget)}${rent ? '/mo' : ''}` : null },
    { key: 'beds', label: 'Bedrooms', value: beds ? `${beds}+` : null },
    { key: 'baths', label: 'Bathrooms', value: baths ? `${baths}+` : null },
    // Optional: listed only when entered.
    ...(sqft ? [{ key: 'sqft', label: 'Ideal square footage', value: `${formatThousands(sqft)} sq ft` }] : []),
    ...(lot ? [{ key: 'lot', label: 'Ideal lot size', value: `${lot} acres` }] : []),
  ];
}

export function areasSummary(raw) {
  return searchAreasOf(normalizePriorities(raw)).map((area) => ({ key: area.placeId, name: area.name, type: AREA_TYPES[area.type] }));
}

export function placesSummary(places = []) {
  return (places || []).map((place) => ({ key: place.id, label: place.label, address: place.address }));
}

// Real relationships first; an intention is only ever "interested in".
export function peopleSummary({ choice = null, people = null, role = 'owner' } = {}) {
  const known = normalizePeople(people);
  const selection = selectionFromChoice(choice);
  const lines = [];
  if (role === 'co_buyer') lines.push({ key: 'joined-owner', kind: 'joined', text: `You’re searching with ${known.ownerName || 'your co-buyer'}` });
  else if (hasRelationship(known, 'co_buyer')) lines.push({ key: 'joined-co-buyer', kind: 'joined', text: `You’re searching with ${known.coBuyers[0]?.name || 'a co-buyer'}` });
  else if (selection.co_buyer) lines.push({ key: 'want-co-buyer', kind: 'intent', text: 'You’d like to search with a co-buyer' });
  if (role === 'owner' && hasRelationship(known, 'realtor')) lines.push({ key: 'joined-realtor', kind: 'joined', text: 'Your Realtor is connected' });
  else if (selection.realtor) lines.push({ key: 'want-realtor', kind: 'intent', text: 'You’d like to work with a Realtor' });
  return lines;
}

// The same level names Step 5 uses.
const LEVEL_TITLES = Object.freeze({ must: 'Must-Have', important: 'Important', nice: 'Nice-to-Have' });

export function prioritiesSummary(raw) {
  return priorityLevelsWithGroups(raw)
    .filter((level) => PRIORITY_LEVELS.includes(level.tier))
    .map((level) => ({
      tier: level.tier,
      title: LEVEL_TITLES[level.tier],
      items: level.items.map((item) => ({ key: item.key, label: item.displayLabel, qualifier: item.qualifier || null })),
    }));
}
