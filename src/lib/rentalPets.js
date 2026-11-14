// Rental Essentials: "Will pets be moving with you?" Yes / No / Not sure yet.
// See docs/rental-foundations-onboarding-spec.md §7 (founder decisions D2, D7, D8).
//
// Pure and framework-free. The answer lives in the participant's OWN
// priorities document, next to the criterion it drives (the
// exterior.garagePreference precedent):
//
//   features.petsMoving  'yes' | 'no' | 'not_sure'   absent = not answered
//   features.petsAuto    { previousTier, setAt }     only while FLH owns the
//                                                    Pet-Friendly Must Have
//
// Neither key is a Match input: computeMatch and the SQL scorer read only
// features.tiers. normalizePriorities keeps both keys, so no migration is
// needed. The only priority this module writes is the existing canonical
// features:Pets Allowed ("Pet-Friendly"). It never writes a "No", an anti-pet
// criterion, homes.pets_allowed or anything about any home, and it collects no
// pet type, count, weight, breed or name.
//
// Ownership: Yes makes Pet-Friendly a Must Have and remembers the level it
// had, so No / Not sure can put it back. Any explicit manual edit to
// Pet-Friendly's level (moveCriterion, addCriterion, the live flow's
// applyOnboardingSelections) calls clearPetsAuto, after which FLH never changes
// that level again. Provenance never relies on the tier still being Must Have.

import { getItemlistCategories, normalizePriorities } from './constants.js';
import { selectPriorityItem } from './matching.js';

export const PETS_ANSWERS = Object.freeze(['yes', 'no', 'not_sure']);
export const PETS_CRITERION = Object.freeze({ categoryKey: 'features', label: 'Pets Allowed', kind: 'check' });
export const PETS_CRITERION_KEY = `${PETS_CRITERION.categoryKey}:${PETS_CRITERION.label}`;
export const PETS_TEXT = 'Pet-Friendly';

const SELECTED = Object.freeze(['must', 'important', 'nice']);
const LEVEL_TEXT = Object.freeze({ must: 'a Must Have', important: 'Important', nice: 'Nice to Have' });

const isPetsCriterion = (categoryKey, label) => categoryKey === PETS_CRITERION.categoryKey && label === PETS_CRITERION.label;
const tierOf = (priorities) => priorities.features?.tiers?.[PETS_CRITERION.label];
const isMarker = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// The stored answer, or null when not answered (or skipped).
export function petsMovingAnswer(raw) {
  const value = normalizePriorities(raw).features?.petsMoving;
  return PETS_ANSWERS.includes(value) ? value : null;
}

// FLH's automatic-ownership marker, or null.
export function petsAutoMarker(raw) {
  const value = normalizePriorities(raw).features?.petsAuto;
  return isMarker(value) ? value : null;
}

// Pet-Friendly's level: 'must' | 'important' | 'nice', or null when not selected.
export function petsTier(raw) {
  const tier = tierOf(normalizePriorities(raw));
  return SELECTED.includes(tier) ? tier : null;
}

// Drops the automatic marker when `categoryKey:label` is Pet-Friendly. Called
// by every user-facing tier write; any other criterion is left untouched.
// Takes and returns one category's state (e.g. priorities.features).
export function clearPetsAuto(catState, categoryKey, label) {
  if (!isPetsCriterion(categoryKey, label) || !catState || !Object.hasOwn(catState, 'petsAuto')) return catState;
  const { petsAuto, ...rest } = catState;
  return rest;
}

// The exact pets-related state of a document: what Undo restores.
export function snapshotPets(raw) {
  const features = normalizePriorities(raw).features || {};
  const tiers = features.tiers || {};
  return Object.freeze({
    hasTier: Object.hasOwn(tiers, PETS_CRITERION.label),
    tier: tiers[PETS_CRITERION.label],
    customItems: (features.customItems || []).map((item) => ({ ...item })),
    hasAnswer: Object.hasOwn(features, 'petsMoving'),
    petsMoving: features.petsMoving,
    hasMarker: Object.hasOwn(features, 'petsAuto'),
    petsAuto: isMarker(features.petsAuto) ? { ...features.petsAuto } : features.petsAuto,
  });
}

// Undo: puts Pet-Friendly's tier, customItems, petsMoving and petsAuto back
// exactly as `snapshot` recorded them. Every other key is left as it is now.
export function restorePets(raw, snapshot) {
  const priorities = normalizePriorities(raw);
  const features = { ...priorities.features };
  const tiers = { ...(features.tiers || {}) };
  if (snapshot.hasTier) tiers[PETS_CRITERION.label] = snapshot.tier;
  else delete tiers[PETS_CRITERION.label];
  features.tiers = tiers;
  features.customItems = snapshot.customItems.map((item) => ({ ...item }));
  if (snapshot.hasAnswer) features.petsMoving = snapshot.petsMoving; else delete features.petsMoving;
  if (snapshot.hasMarker) features.petsAuto = isMarker(snapshot.petsAuto) ? { ...snapshot.petsAuto } : snapshot.petsAuto;
  else delete features.petsAuto;
  return { ...priorities, features };
}

// System write (not a manual edit): the tier through the same promotion
// addCriterion uses, without clearing the marker.
function writeTier(priorities, tier) {
  const def = getItemlistCategories(priorities.searchType).find((entry) => entry.key === PETS_CRITERION.categoryKey)
    || { key: PETS_CRITERION.categoryKey, coreItems: [], suggestedItems: [] };
  const features = selectPriorityItem(priorities.features || { customItems: [], tiers: {} }, def, { label: PETS_CRITERION.label, kind: PETS_CRITERION.kind }, tier);
  return { ...priorities, features };
}

const withFeatures = (priorities, patch) => {
  const features = { ...priorities.features, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete features[key];
  return { ...priorities, features };
};

// The one write path for the answer (Rental Essentials, Review, and the My
// Search Rental Essentials row all call this).
//   → { priorities, change, undo }
//     change: 'set_must' | 'restored' | null
//     undo:   a snapshot for restorePets (exact Undo)
// A missing or unknown answer (Skip) writes nothing.
export function setPetsMoving(raw, answer, now = new Date().toISOString()) {
  const priorities = normalizePriorities(raw);
  const undo = snapshotPets(priorities);
  if (!PETS_ANSWERS.includes(answer)) return { priorities, change: null, undo };
  const marker = petsAutoMarker(priorities);

  if (answer === 'yes') {
    const current = petsTier(priorities);
    // Already Pet-Friendly Must Have: the renter's own choice, or FLH's from
    // an earlier Yes. Nothing else changes and no marker is (re)set.
    if (current === 'must' || marker) return { priorities: withFeatures(priorities, { petsMoving: 'yes' }), change: null, undo };
    const next = writeTier(priorities, 'must');
    return {
      priorities: withFeatures(next, { petsMoving: 'yes', petsAuto: { previousTier: current, setAt: now } }),
      change: 'set_must',
      undo,
    };
  }

  // No / Not sure yet: no anti-pet requirement. Pet-Friendly is put back only
  // while FLH still owns it; a level the renter set stays exactly as it is.
  if (!marker) return { priorities: withFeatures(priorities, { petsMoving: answer }), change: null, undo };
  const previous = SELECTED.includes(marker.previousTier) ? marker.previousTier : 'dontcare';
  const restored = writeTier(priorities, previous);
  return { priorities: withFeatures(restored, { petsMoving: answer, petsAuto: undefined }), change: 'restored', undo };
}

// What the status line says after setPetsMoving (null: nothing to say).
export function petsChangeMessage(raw, change, answer) {
  const priorities = normalizePriorities(raw);
  const tier = petsTier(priorities);
  if (change === 'set_must') return `${PETS_TEXT} is now a Must Have.`;
  if (change === 'restored') return tier ? `${PETS_TEXT} is back to ${LEVEL_TEXT[tier]}.` : `${PETS_TEXT} is no longer one of your priorities.`;
  if ((answer === 'no' || answer === 'not_sure') && tier) return `${PETS_TEXT} stays ${LEVEL_TEXT[tier]} because you set it yourself.`;
  return null;
}

// Provenance for Review and My Search (D8): whether Pet-Friendly is a Must
// Have because of the pets answer, or because the renter set it.
export function petsProvenance(raw) {
  const priorities = normalizePriorities(raw);
  const tier = petsTier(priorities);
  return {
    answer: petsMovingAnswer(priorities),
    tier,
    automatic: Boolean(petsAutoMarker(priorities)) && tier === 'must',
  };
}

// Search-type switches. The existing switchSearchType clears curated tiers and
// re-adds what still applies through addCriterion, which would read as a
// manual edit. Rental ↔ rental therefore restores the earlier pets state.
//   → { priorities, restoredLabel } (restoredLabel: Pet-Friendly, when its
//     level had to be put back, so it is not reported as removed)
export function restorePetsAfterSwitch(raw, snapshot) {
  let priorities = normalizePriorities(raw);
  let restoredLabel = null;
  if (SELECTED.includes(snapshot.tier) && petsTier(priorities) !== snapshot.tier) {
    priorities = writeTier(priorities, snapshot.tier);
    restoredLabel = PETS_TEXT;
  }
  return {
    priorities: withFeatures(priorities, {
      petsMoving: snapshot.hasAnswer ? snapshot.petsMoving : undefined,
      petsAuto: snapshot.hasMarker ? (isMarker(snapshot.petsAuto) ? { ...snapshot.petsAuto } : snapshot.petsAuto) : undefined,
    }),
    restoredLabel,
  };
}

// Rental → Home to Buy: the answer and the marker go with Pet-Friendly.
export function clearPetsState(raw) {
  const priorities = normalizePriorities(raw);
  if (!Object.hasOwn(priorities.features || {}, 'petsMoving') && !Object.hasOwn(priorities.features || {}, 'petsAuto')) return priorities;
  return withFeatures(priorities, { petsMoving: undefined, petsAuto: undefined });
}
