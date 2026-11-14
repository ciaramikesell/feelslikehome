// Mobile Priority Onboarding V3 — category screens over the EXISTING priority
// document. Pure and framework-free (the onboarding screens, the review screen,
// a future desktop board and the tests all read this one definition).
//
// Nothing here is a new kind of priority or a new storage shape:
//
//   • A "feature" with a catalog identity (e.g. features:Kitchen Island) is that
//     identity: selecting it is the same addCriterion / moveCriterion My Search
//     uses, so Match weights (4 / 2 / 1) and scoring are unchanged.
//   • A feature with no catalog identity (e.g. Countertop Seating) is a buyer's
//     own custom priority — `{ label, kind: 'check', source: 'custom' }` in the
//     participant's customItems — answered Yes / No / Unknown by that buyer on
//     each home. Unknown is never scored, so it is never a mismatch.
//   • The screen a custom item was added on is remembered as an additive
//     `group` field on its customItems entry, so every surface (this flow,
//     Review, My Search, a future desktop board) can show it in its category.
//     Existing documents without it keep working unchanged.
//
// Categories are presentation only: a feature keeps its stored categoryKey
// (location / features / exterior) whichever screen shows it.
//
// Importance is chosen explicitly: opening a card never selects it. Skipping a
// screen, or closing the importance picker, changes nothing — an unanswered
// feature stays unset (never No, never Must Have).

import {
  RENTAL_ESSENTIALS, criterionDisplayLabel, getItemlistCategories, homePreferenceCriteriaFor,
  isExperientialCriterion, isRentalType, isRetiredPurchaseBuiltIn, isYesNoCriterion, normalizePriorities,
} from './constants.js';
import { ONBOARDING_SUGGESTIONS } from './onboarding.js';
import { splitCategoryItems } from './matching.js';
import {
  PRIORITY_LEVELS, addCriterion, isCriterionSelected, moveCriterion, priorityLevels, searchExperienceKey, setGaragePreference,
} from './searchProfile.js';
import { switchSearchType } from './whatMattersCatalog.js';
import { clearPetsState, restorePetsAfterSwitch, snapshotPets } from './rentalPets.js';
import { groupValueLabel, whatMattersGroups } from './whatMattersGroups.js';

const HOMES = Object.freeze(['home_buy', 'home_rent']);
const RENTALS = Object.freeze(['home_rent', 'apartment_rent']);
const BUY = Object.freeze(['home_buy']);
const HOME_RENT = Object.freeze(['home_rent']);
const APARTMENT = Object.freeze(['apartment_rent']);

// A feature definition. `custom: true` = no catalog identity; created as the
// buyer's own priority. `only` limits it to some kinds of search. `hint` is a short
// explanation shown with the card. `aliases` are other words a person might
// type for the same card in Add your own.
const f = (categoryKey, label, options = {}) => Object.freeze({ categoryKey, label, ...options });

// The one priority the Rental Essentials pets question writes
// (src/lib/rentalPets.js). It is never shown as its own ranked card.
export const PETS_QUESTION = Object.freeze({ key: 'pets', categoryKey: 'features', label: 'Pets Allowed', text: 'Pet-Friendly', art: 'pet-friendly', icon: 'PawPrint' });

// Screen order per kind of search (src/lib/onboardingFlow.js, flow 4):
//   Home to Buy        layout, kitchen, living, bath, garage, exterior, neighborhood
//   Home to Rent       essentials, rent_layout, rent_features, exterior, neighborhood
//   Apartment to Rent  essentials, apt_unit, apt_property
// See docs/rental-foundations-onboarding-spec.md §1 and §3 for the rental lists.
export const PRIORITY_CATEGORIES = Object.freeze([
  // Rentals: one optional question ("Will pets be moving with you?"), no
  // cards. The former essentials are optional suggestions on later screens.
  Object.freeze({
    key: 'essentials', step: 'cat_essentials', storage: 'features', only: RENTALS, question: PETS_QUESTION,
    title: 'Rental Essentials', heading: ['The rental ', 'essentials'],
    lead: 'One quick question about moving in. You can skip it.',
    features: Object.freeze([]),
    suggestions: Object.freeze([]),
  }),
  Object.freeze({
    key: 'layout', step: 'cat_layout', storage: 'features', only: BUY,
    title: 'Layout & Living Spaces', heading: ['Layout & ', 'living spaces'],
    lead: 'How the rooms come together. Choose only what you’d weigh.',
    features: Object.freeze([
      f('features', 'First-Floor Bedroom', { art: 'first-floor-bedroom', icon: 'BedSingle' }),
      f('features', 'Home office', { art: 'home-office', icon: 'Laptop' }),
      f('features', 'Finished basement', { art: 'finished-basement', icon: 'Sofa' }),
      f('features', 'Primary ensuite', { art: 'primary-ensuite', icon: 'BedDouble' }),
    ]),
    suggestions: Object.freeze([
      f('features', 'First-floor laundry', { art: 'first-floor-laundry', icon: 'WashingMachine' }),
      f('features', 'Walkout basement', { art: 'walkout-basement', icon: 'DoorOpen' }),
      f('exterior', 'Front porch', { art: 'front-porch', icon: 'Armchair' }),
    ]),
  }),
  Object.freeze({
    key: 'kitchen', step: 'cat_kitchen', storage: 'features', only: BUY,
    title: 'Kitchen', heading: ['The ', 'kitchen'],
    lead: 'Where the day starts and ends. Tap what matters.',
    features: Object.freeze([
      f('features', 'Countertop Seating', { custom: true, art: 'countertop-seating', icon: 'Coffee' }),
      f('features', 'Stainless Steel Appliances', { art: 'stainless-appliances', icon: 'Refrigerator' }),
      f('features', 'Walk-in Pantry', { art: 'walk-in-pantry', icon: 'Package' }),
    ]),
    suggestions: Object.freeze([
      f('features', 'Eat-in Kitchen', { art: 'eat-in-kitchen', icon: 'Utensils' }),
      f('features', 'Kitchen Island', { art: 'kitchen-island', icon: 'ChefHat' }),
      f('features', 'Formal Dining Room', { art: 'formal-dining', icon: 'UtensilsCrossed' }),
    ]),
  }),
  Object.freeze({
    key: 'living', step: 'cat_living', storage: 'features', only: BUY,
    title: 'Living Room', heading: ['The ', 'living room'],
    lead: 'The room you’ll spend evenings in.',
    features: Object.freeze([
      f('features', 'Fireplace', { art: 'fireplace', icon: 'Flame' }),
      f('features', 'High Ceilings', { art: 'high-ceilings', icon: 'ArrowUpToLine' }),
    ]),
    suggestions: Object.freeze([
      f('features', 'Built-in Shelving', { custom: true, art: 'built-in-shelving', icon: 'Library' }),
      f('features', 'Large Windows', { custom: true, art: 'large-windows', icon: 'AppWindow' }),
    ]),
  }),
  Object.freeze({
    key: 'bath', step: 'cat_bath', storage: 'features', only: BUY,
    title: 'Bathroom', heading: ['The ', 'bathroom'],
    lead: 'Small details you’ll notice every day.',
    features: Object.freeze([
      f('features', 'Double Vanity', { art: 'double-vanity', icon: 'Droplets' }),
      f('features', 'Soaking Tub', { art: 'soaking-tub', icon: 'Bath' }),
    ]),
    suggestions: Object.freeze([
      f('features', 'Separate Shower / Tub', { custom: true, art: 'separate-shower', icon: 'ShowerHead' }),
      f('features', 'Private Toilet', { custom: true, art: 'private-toilet', icon: 'DoorClosed' }),
      f('features', 'Linen Closet', { custom: true, art: 'linen-closet', icon: 'Layers' }),
    ]),
  }),
  // Overall importance first (the existing exterior:Garage criterion), then the
  // existing attached/detached qualifier and garage details. Home to Buy only:
  // Home to Rent asks Garage as one card on Rental Features.
  Object.freeze({
    key: 'garage', step: 'cat_garage', storage: 'exterior', only: BUY,
    title: 'Garage', heading: ['The ', 'garage'],
    lead: 'First, how much does a garage matter to you?',
    features: Object.freeze([]),
    suggestions: Object.freeze([
      f('exterior', 'Workbench', { custom: true, art: 'workbench', icon: 'Wrench' }),
      f('exterior', 'Garage Extension', { custom: true, art: 'garage-extension', icon: 'Warehouse' }),
      f('exterior', 'Door to Backyard', { custom: true, art: 'garage-yard-door', icon: 'DoorOpen' }),
    ]),
  }),
  // Home to Rent. Stored identities are the ones Home to Rent already uses
  // (HOME_RENT_CATALOG casing, e.g. "Home office"); the rental essentials use
  // the one identity both rental flows share (e.g. "Central Air").
  Object.freeze({
    key: 'rent_layout', step: 'cat_rent_layout', storage: 'features', only: HOME_RENT,
    title: 'Layout & Living Spaces', heading: ['Layout & ', 'living spaces'],
    lead: 'How the rooms come together. Choose only what you’d weigh.',
    features: Object.freeze([
      f('features', 'First-Floor Bedroom', { art: 'first-floor-bedroom', icon: 'BedSingle' }),
      f('features', 'Home office', { art: 'home-office', icon: 'Laptop' }),
      f('features', 'Finished basement', { art: 'finished-basement', icon: 'Sofa' }),
      f('features', 'Primary ensuite', { text: 'Primary Ensuite Bathroom', art: 'primary-ensuite', icon: 'BedDouble' }),
    ]),
    suggestions: Object.freeze([
      f('features', 'First-floor laundry', { art: 'first-floor-laundry', icon: 'WashingMachine' }),
      // The renter's own Yes/No (D3). Never written from, or into, the
      // Basics bedroom count.
      f('features', 'Extra Bedroom', { custom: true, art: 'extra-bedroom', icon: 'BedSingle', hint: 'An extra bedroom beyond the minimum you entered in Basics.' }),
      f('exterior', 'Front porch', { art: 'front-porch', icon: 'Armchair' }),
    ]),
  }),
  Object.freeze({
    key: 'rent_features', step: 'cat_rent_features', storage: 'features', only: HOME_RENT,
    title: 'Rental Features', heading: ['Rental ', 'features'],
    lead: 'The things you’d notice living there. Choose only what you’d weigh.',
    features: Object.freeze([
      f('features', 'Countertop Seating', { custom: true, text: 'Kitchen Countertop Seating', art: 'countertop-seating', icon: 'Coffee' }),
      f('features', 'Stainless Steel Appliances', { art: 'stainless-appliances', icon: 'Refrigerator' }),
      f('features', 'Fireplace', { art: 'fireplace', icon: 'Flame' }),
      f('features', 'Central Air', { text: 'Central Air', icon: 'AirVent' }),
      f('exterior', 'Garage', { text: 'Garage', icon: 'Warehouse' }),
    ]),
    suggestions: Object.freeze([
      f('features', 'Kitchen Island', { art: 'kitchen-island', icon: 'ChefHat' }),
      f('features', 'High Ceilings', { art: 'high-ceilings', icon: 'ArrowUpToLine' }),
      f('features', 'In-Unit Laundry', { text: 'In-Unit Laundry', art: 'in-unit-laundry', icon: 'WashingMachine' }),
      f('features', 'Dishwasher', { text: 'Dishwasher', art: 'dishwasher', icon: 'Utensils' }),
      f('features', 'Utilities Included', { text: 'Utilities Included', icon: 'PlugZap' }),
      f('exterior', 'Driveway / Off-Street Parking', { text: 'Off-Street Parking', icon: 'Car' }),
    ]),
  }),
  // Apartment to Rent. Identities resolve to the rental catalog's own labels
  // (resolveDefinition). Apartment amenities never use house photography.
  Object.freeze({
    key: 'apt_unit', step: 'cat_apt_unit', storage: 'features', only: APARTMENT,
    title: 'The Unit', heading: ['The ', 'unit'],
    lead: 'Your own front door and everything behind it.',
    features: Object.freeze([
      f('features', 'In-Unit Laundry', { text: 'In-Unit Laundry', art: 'in-unit-laundry', icon: 'WashingMachine' }),
      f('features', 'Home Office', { text: 'Home Office Space', art: 'home-office', icon: 'Laptop' }),
      f('features', 'Central Air', { text: 'Central Air', icon: 'AirVent' }),
    ]),
    suggestions: Object.freeze([
      // Unit-level, the renter's own Yes/No (D1). Never inferred from the
      // building's garage count, which answers Garage Parking instead.
      f('exterior', 'Private Garage', { custom: true, icon: 'Warehouse', hint: 'A garage for your unit only.' }),
      f('exterior', 'Patio / Deck / Outdoor Living', { text: 'Private Outdoor Space', art: 'apartment-balcony', icon: 'Sun', aliases: ['Outdoor Space', 'Balcony', 'Balcony / Patio'] }),
      f('features', 'Dishwasher', { text: 'Dishwasher', art: 'dishwasher', icon: 'Utensils' }),
      f('features', 'Utilities Included', { text: 'Utilities Included', icon: 'PlugZap' }),
    ]),
  }),
  Object.freeze({
    key: 'apt_property', step: 'cat_apt_property', storage: 'exterior', only: APARTMENT,
    title: 'The Property', heading: ['The ', 'property'],
    lead: 'The building and what comes with it.',
    features: Object.freeze([
      f('exterior', 'Fitness Center', { art: 'fitness-center', icon: 'Dumbbell' }),
      f('exterior', 'Pool', { icon: 'Waves' }),
      f('exterior', 'Garage', { text: 'Garage Parking', art: 'apartment-parking-garage', icon: 'Warehouse' }),
    ]),
    suggestions: Object.freeze([
      f('exterior', 'Elevator', { art: 'elevator', icon: 'ArrowUpDown' }),
      f('exterior', 'Parking', { text: 'Sufficient Parking', art: 'sufficient-parking', icon: 'SquareParking' }),
      f('exterior', 'Secure Entry', { art: 'secure-entry', icon: 'ShieldCheck' }),
    ]),
  }),
  Object.freeze({
    key: 'exterior', step: 'cat_exterior', storage: 'exterior', only: HOMES,
    title: 'Exterior & Property', heading: ['Exterior & ', 'property'],
    lead: 'The outdoor space that comes with it.',
    features: Object.freeze([
      f('exterior', 'Patio / deck', { art: 'deck-patio', icon: 'Sun' }),
      f('exterior', 'Fenced yard', { art: 'fenced-yard', icon: 'Fence' }),
    ]),
    suggestions: Object.freeze([
      f('location', 'Mature Trees', { art: 'mature-trees', icon: 'TreeDeciduous' }),
      f('exterior', 'Garden Space', { art: 'garden', icon: 'Sprout', only: BUY }),
      f('exterior', 'Pool', { art: 'pool', icon: 'Waves' }),
      f('exterior', 'Landscaping', { art: 'landscaping', icon: 'Flower2', only: HOME_RENT, hint: 'A well-kept, landscaped yard.' }),
    ]),
  }),
  // Street and neighborhood photos where the founder supplied one; abstract
  // preferences (No HOA, Walkable Neighborhood, Reputable Schools) stay icon-only.
  Object.freeze({
    key: 'neighborhood', step: 'cat_neighborhood', storage: 'location', only: HOMES,
    title: 'Location & Neighborhood', heading: ['Location & ', 'neighborhood'],
    lead: 'The street and the neighborhood around it.',
    features: Object.freeze([
      f('location', 'Low-Traffic Street', { art: 'low-traffic-street', icon: 'Route' }),
      f('location', 'Sidewalks', { art: 'sidewalks', icon: 'Footprints', only: BUY }),
      f('location', 'Tree-lined street', { text: 'Tree-Lined Street', art: 'tree-lined-street', icon: 'Trees', only: BUY }),
      f('location', 'No HOA', { icon: 'Ban', only: BUY }),
      f('location', 'Walkable Neighborhood', { icon: 'Store', only: HOME_RENT }),
    ]),
    suggestions: Object.freeze([
      f('location', 'Cul-de-Sac', { art: 'cul-de-sac', icon: 'Milestone' }),
      f('location', 'Walkable schools', { text: 'Walkable to Schools', art: 'walkable-schools', icon: 'School', only: BUY }),
      // The Yes/No identity, never the rental catalog's unanswerable
      // "Parks Nearby" rating (spec A2).
      f('location', 'Parks nearby', { text: 'Parks Nearby', art: 'parks-nearby', icon: 'Trees', only: HOME_RENT }),
      f('location', 'Reputable Schools', { icon: 'School', only: HOME_RENT }),
    ]),
  }),
]);

// Every screen step key, in order (used by the flow's tests to stay in sync).
export const PRIORITY_CATEGORY_STEPS = Object.freeze(PRIORITY_CATEGORIES.map((category) => category.step));

// Asked in Home Add / Home Facts, but no longer on the new-profile
// questionnaire. Saved values are kept, shown on Review and editable in My Search.
export const REMOVED_FROM_QUESTIONNAIRE = Object.freeze(['preferredPropertyTypes', 'homeLayout', 'homeCondition']);

/* ---------------------------------- keys ---------------------------------- */

// Case-, spacing- and punctuation-insensitive identity for dedupe:
// "Separate shower/tub", " separate  Shower / Tub " → "separateshowertub".
export function normalizeFeatureKey(text) {
  return String(text ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

// What a person typed, tidied for storage: trimmed, inner whitespace collapsed,
// at most 60 characters. Wording and case are otherwise theirs.
export function cleanFeatureLabel(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
}

const idOf = (categoryKey, label) => `${categoryKey}:${label}`;
const applies = (definition, experience) => !definition.only || definition.only.includes(experience || 'home_buy');

/* ------------------------------ catalog views ------------------------------ */

// The label an apartment search already uses for the same idea (its rental
// catalog), so e.g. "Home office" is stored as the existing "Home Office".
function resolveDefinition(definition, experience) {
  if (definition.custom) return { ...definition, label: definition.label };
  if (experience === 'apartment_rent') {
    const def = getItemlistCategories('rental').find((entry) => entry.key === definition.categoryKey);
    const rentalItem = [...(def?.coreItems || []), ...(def?.suggestedItems || [])]
      .find((item) => item.label.toLowerCase() === definition.label.toLowerCase());
    if (rentalItem) return { ...definition, label: rentalItem.label };
  }
  return definition;
}

function toFeature(definition, experience, category, role) {
  const resolved = resolveDefinition(definition, experience);
  return Object.freeze({
    id: idOf(resolved.categoryKey, resolved.label),
    categoryKey: resolved.categoryKey,
    label: resolved.label,
    text: resolved.text || (resolved.custom ? resolved.label : criterionDisplayLabel(resolved.categoryKey, resolved.label)),
    kind: 'check',
    custom: Boolean(resolved.custom),
    art: resolved.art || null,
    icon: resolved.icon || null,
    group: category.key,
    role, // 'feature' (a card from the start) | 'suggestion' (a chip until added)
    // Additive, only where defined, so the Home to Buy screens are unchanged.
    ...(resolved.hint ? { hint: resolved.hint } : {}),
    ...(resolved.aliases ? { aliases: Object.freeze([...resolved.aliases]) } : {}),
  });
}

// The category screens this kind of search sees, with resolved identities.
export function priorityCategoriesFor(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities) || 'home_buy';
  return PRIORITY_CATEGORIES.filter((category) => applies(category, experience)).map((category) => ({
    ...category,
    features: category.features.filter((entry) => applies(entry, experience)).map((entry) => toFeature(entry, experience, category, 'feature')),
    suggestions: category.suggestions.filter((entry) => applies(entry, experience)).map((entry) => toFeature(entry, experience, category, 'suggestion')),
  }));
}

export function priorityCategory(raw, key) {
  return priorityCategoriesFor(raw).find((category) => category.key === key || category.step === key) || null;
}

const allOffered = (raw) => priorityCategoriesFor(raw).flatMap((category) => [...category.features, ...category.suggestions]);

/* ------------------------------ reading state ------------------------------ */

const ITEM_CATEGORIES = ['location', 'features', 'exterior', 'homeFeel'];

// Every item already in the person's document (catalog, promoted or custom),
// with its stored identity. Used for dedupe and to find custom cards.
function storedItems(priorities) {
  return getItemlistCategories(priorities.searchType).flatMap((def) => {
    const { core, custom } = splitCategoryItems(def, priorities);
    return [...core, ...custom].map((item) => ({ ...item, categoryKey: def.key }));
  }).concat(ITEM_CATEGORIES
    .filter((key) => !getItemlistCategories(priorities.searchType).some((def) => def.key === key))
    .flatMap((key) => (priorities[key]?.customItems || []).map((item) => ({ ...item, categoryKey: key }))));
}

// A1 (rental searches only): the label this card reads and writes. Rental
// documents can hold a case variant of a card's identity (e.g. the live
// flow's "Central air" for the "Central Air" card, or "Fenced Yard" for
// "Fenced yard"). The purchase alias fold does not run for rentals, so two
// selected variants would be scored twice. The card therefore reads, and
// writes, the variant already stored: a selected one first, then one with any
// stored tier; otherwise its own label. Only Yes/No variants count (a rating
// such as the rental catalog's "Parks Nearby" is a different criterion). Home
// to Buy is unchanged: it always uses the card's own label.
export function storedFeatureLabel(raw, feature) {
  const priorities = normalizePriorities(raw);
  if (feature.custom || !isRentalType(priorities.searchType)) return feature.label;
  const catState = priorities[feature.categoryKey] || {};
  const tiers = catState.tiers || {};
  const key = normalizeFeatureKey(feature.label);
  const kindOf = (label) => storedItems(priorities).find((item) => item.categoryKey === feature.categoryKey && item.label === label)?.kind || 'check';
  const variants = Object.keys(tiers).filter((label) => label !== feature.label && normalizeFeatureKey(label) === key && kindOf(label) !== 'rating');
  const candidates = [feature.label, ...variants];
  return candidates.find((label) => isCriterionSelected(priorities, feature.categoryKey, label))
    || candidates.find((label) => Object.hasOwn(tiers, label))
    || feature.label;
}

// 'must' | 'important' | 'nice' when chosen; null otherwise (never chosen, or
// set to Not important). Unknown is never reported as anything else.
export function featureLevel(raw, feature) {
  const priorities = normalizePriorities(raw);
  const label = storedFeatureLabel(priorities, feature);
  const tier = priorities[feature.categoryKey]?.tiers?.[label];
  return PRIORITY_LEVELS.includes(tier) && isCriterionSelected(priorities, feature.categoryKey, label) ? tier : null;
}

const customFeature = (item, group) => Object.freeze({
  id: idOf(item.categoryKey, item.label), categoryKey: item.categoryKey, label: item.label,
  text: item.label, kind: item.kind || 'check', custom: true, art: null, icon: null, group, role: 'own',
});

// One screen: its cards (features, plus every suggestion or own item that has
// been added) and the suggestion chips still available.
export function categoryView(raw, key) {
  const priorities = normalizePriorities(raw);
  const category = priorityCategory(priorities, key);
  if (!category) return null;
  const stored = storedItems(priorities);
  const storedKeys = new Set(stored.map((item) => normalizeFeatureKey(idOf(item.categoryKey, item.label))));
  const exists = (feature) => storedKeys.has(normalizeFeatureKey(feature.id));
  const offered = [...category.features, ...category.suggestions];
  const offeredKeys = new Set(allOffered(priorities).map((feature) => normalizeFeatureKey(feature.id)));
  // A suggestion becomes a card once it is chosen, or (a custom suggestion)
  // once it has been created.
  const addedSuggestions = category.suggestions.filter((feature) => featureLevel(priorities, feature) || (feature.custom && exists(feature)));
  // A question screen (Rental Essentials) has no cards: anything saved there
  // by an earlier version (e.g. Storage Unit) is kept and shown on Review
  // under "More of your priorities" instead.
  const own = stored
    .filter((item) => !category.question && item.group === category.key && item.source === 'custom' && !offeredKeys.has(normalizeFeatureKey(idOf(item.categoryKey, item.label))))
    .map((item) => customFeature(item, category.key));
  const cards = [...category.features, ...addedSuggestions, ...own].map((feature) => ({ ...feature, level: featureLevel(priorities, feature) }));
  const shown = new Set(cards.map((card) => card.id));
  return {
    category,
    cards,
    suggestions: offered.filter((feature) => feature.role === 'suggestion' && !shown.has(feature.id)),
    chosenCount: cards.filter((card) => card.level).length,
  };
}

/* ---------------------------------- writes --------------------------------- */

// Makes sure a custom feature exists in the person's customItems (unselected
// until a level is chosen). Returns the stored identity, which may be an
// existing item that differs only by case, spacing or punctuation.
function ensureCustom(priorities, feature) {
  const key = normalizeFeatureKey(feature.label);
  const existing = storedItems(priorities).find((item) => item.categoryKey === feature.categoryKey && normalizeFeatureKey(item.label) === key);
  if (existing) return { priorities, feature: { ...feature, label: existing.label, id: idOf(feature.categoryKey, existing.label) } };
  const catState = priorities[feature.categoryKey] || { customItems: [], tiers: {} };
  const item = { label: feature.label, kind: 'check', source: 'custom', group: feature.group };
  return { priorities: { ...priorities, [feature.categoryKey]: { ...catState, customItems: [...(catState.customItems || []), item] } }, feature };
}

// Sets one feature's importance. A level selects it (a custom feature is
// created first if needed); 'none' (Not important / Remove) moves it to
// "don't care" — the existing deselected state, never a "No" on any home.
export function setFeatureLevel(raw, feature, level) {
  let priorities = normalizePriorities(raw);
  const label = storedFeatureLabel(priorities, feature);
  if (!PRIORITY_LEVELS.includes(level)) {
    return priorities[feature.categoryKey]?.tiers?.[label] ? moveCriterion(priorities, feature.categoryKey, label, 'dontcare') : priorities;
  }
  if (feature.custom) {
    const ensured = ensureCustom(priorities, feature);
    priorities = ensured.priorities;
    return moveCriterion(priorities, feature.categoryKey, ensured.feature.label, level);
  }
  return isCriterionSelected(priorities, feature.categoryKey, label)
    ? moveCriterion(priorities, feature.categoryKey, label, level)
    : addCriterion(priorities, { categoryKey: feature.categoryKey, label, kind: 'check' }, level);
}

// A8: in a rental search, a catalog item that is neither answered Yes / No
// nor judged after a tour can never be evaluated on any home (e.g. the rental
// catalog's "Walkability", "Groceries Nearby" or "Parks Nearby" ratings). Add
// your own never selects one; the typed text becomes the renter's own Yes/No
// priority instead. Existing selections are untouched and still counted.
function unanswerableForRental(priorities, categoryKey, item) {
  return isRentalType(priorities.searchType) && item.source !== 'custom'
    && !isYesNoCriterion(categoryKey, item) && !isExperientialCriterion(categoryKey, item.label);
}

// Things the person might mean that FLH already has an identity for: the
// catalog for this kind of search, its curated lists and Home Preferences.
// Retired built-ins are left out (they no longer count in Match), so typing
// one creates the person's own priority instead.
function catalogMatches(priorities) {
  const experience = searchExperienceKey(priorities) || 'home_buy';
  const fromDefs = getItemlistCategories(priorities.searchType).flatMap((def) => [...def.coreItems, ...def.suggestedItems, ...(def.specificItems || [])]
    .filter((item) => !isRetiredPurchaseBuiltIn(def.key, item, priorities.searchType))
    .map((item) => ({ categoryKey: def.key, label: item.label, kind: item.kind })));
  const curated = (ONBOARDING_SUGGESTIONS[experience] || []).flatMap(([, items]) => items).map((item) => ({ categoryKey: item.categoryKey, label: item.label, kind: item.kind }));
  const prefs = homePreferenceCriteriaFor(experience).map((item) => ({ categoryKey: item.categoryKey, label: item.label, kind: item.kind }));
  const essentials = experience === 'home_buy' ? [] : RENTAL_ESSENTIALS.map((item) => ({ categoryKey: item.categoryKey, label: item.label, kind: item.kind }));
  return [...essentials, ...curated, ...prefs, ...fromDefs]
    .filter((item) => item.categoryKey !== 'homeFeel' && !unanswerableForRental(priorities, item.categoryKey, item));
}

// "Add your own" on a screen (typed text or a suggestion chip). Never creates a
// duplicate: anything that matches — ignoring case, spacing and punctuation —
// a feature on any screen, something already in the person's document, or a
// catalog criterion is reused. Otherwise a new custom feature is created on
// this screen. Nothing is selected: the importance picker opens next.
//   → { priorities, feature, homeCategory } (homeCategory: the screen the
//     feature is shown on, when that isn't this one), { priorities, feature:
//     null, error } when nothing can be added (A8), or null for empty input.
export function addOwnFeature(raw, categoryKey, typed) {
  const priorities = normalizePriorities(raw);
  const category = priorityCategory(priorities, categoryKey);
  const label = cleanFeatureLabel(typed?.label ?? typed);
  if (!category || !label) return null;
  const key = normalizeFeatureKey(label);
  const keyOf = (feature) => [feature.label, feature.text, ...(feature.aliases || [])].map(normalizeFeatureKey);
  const otherScreen = (feature) => (feature.group && feature.group !== category.key ? feature.group : null);

  const offered = allOffered(priorities).find((feature) => keyOf(feature).includes(key));
  if (offered) {
    if (!offered.custom) return { priorities, feature: offered, homeCategory: otherScreen(offered) };
    const ensured = ensureCustom(priorities, offered);
    return { priorities: ensured.priorities, feature: ensured.feature, homeCategory: otherScreen(offered) };
  }

  const storedMatches = storedItems(priorities).filter((item) => item.categoryKey !== 'homeFeel'
    && [normalizeFeatureKey(item.label), normalizeFeatureKey(criterionDisplayLabel(item.categoryKey, item.label))].includes(key));
  // An unanswerable rental item is reused only when the renter already chose
  // it (so it is never duplicated); otherwise it is never selected here (A8).
  const stored = storedMatches.find((item) => !unanswerableForRental(priorities, item.categoryKey, item) || isCriterionSelected(priorities, item.categoryKey, item.label));
  if (stored) {
    const feature = stored.source === 'custom'
      ? customFeature(stored, stored.group || null)
      : { ...customFeature(stored, null), custom: false, text: criterionDisplayLabel(stored.categoryKey, stored.label), role: 'catalog' };
    return { priorities, feature, homeCategory: stored.group && stored.group !== category.key ? stored.group : null };
  }

  const catalog = catalogMatches(priorities).find((item) => [normalizeFeatureKey(item.label), normalizeFeatureKey(criterionDisplayLabel(item.categoryKey, item.label))].includes(key));
  if (catalog) {
    return { priorities, feature: { ...customFeature(catalog, null), custom: false, text: criterionDisplayLabel(catalog.categoryKey, catalog.label), role: 'catalog' }, homeCategory: null };
  }

  // The typed name is a rental catalog item FLH can't evaluate and that
  // already exists in this category (e.g. the rental "Neighborhood" rating).
  // A new item with the same name would share its stored key, so nothing is
  // created; the person is asked for something more specific.
  if (storedMatches.some((item) => item.categoryKey === category.storage)) {
    return { priorities, feature: null, homeCategory: null, error: `“${label}” is too broad to check on a home. Try something more specific.` };
  }
  const ensured = ensureCustom(priorities, { categoryKey: category.storage, label, group: category.key, custom: true });
  return { priorities: ensured.priorities, feature: customFeature({ categoryKey: category.storage, label: ensured.feature.label, kind: 'check' }, category.key), homeCategory: null };
}

// Renames the person's own (custom) feature. The importance moves with it.
// Refused when empty or when it would duplicate anything already offered or
// stored. A custom feature's answers on homes are keyed by its name, so this
// is offered while setting up (before homes are evaluated against it).
//   → { priorities, feature } or { error }
export function renameOwnFeature(raw, feature, typed) {
  const priorities = normalizePriorities(raw);
  const label = cleanFeatureLabel(typed);
  if (!feature?.custom) return { error: 'Only your own features can be renamed.' };
  if (!label) return { error: 'Give it a name.' };
  if (label === feature.label) return { priorities, feature };
  const key = normalizeFeatureKey(label);
  const selfKey = normalizeFeatureKey(feature.label);
  const taken = key !== selfKey && (
    allOffered(priorities).some((entry) => [normalizeFeatureKey(entry.label), normalizeFeatureKey(entry.text)].includes(key))
    || storedItems(priorities).some((item) => [normalizeFeatureKey(item.label), normalizeFeatureKey(criterionDisplayLabel(item.categoryKey, item.label))].includes(key))
    || catalogMatches(priorities).some((item) => normalizeFeatureKey(item.label) === key));
  if (taken) return { error: `“${label}” is already on your list.` };
  const catState = priorities[feature.categoryKey] || { customItems: [], tiers: {} };
  const customItems = (catState.customItems || []).map((item) => (item.label === feature.label ? { ...item, label } : item));
  const tiers = { ...(catState.tiers || {}) };
  if (Object.hasOwn(tiers, feature.label)) { tiers[label] = tiers[feature.label]; delete tiers[feature.label]; }
  const order = (catState.order || []).map((entry) => (entry === feature.label ? label : entry));
  return {
    priorities: { ...priorities, [feature.categoryKey]: { ...catState, customItems, tiers, order } },
    feature: { ...feature, label, text: label, id: idOf(feature.categoryKey, label) },
  };
}

/* ---------------------------------- garage --------------------------------- */

export const GARAGE_IMPORTANCE = Object.freeze(['must', 'important', 'nice', 'not_important']);
export const GARAGE_TYPES = Object.freeze([
  Object.freeze({ key: 'attached', label: 'Attached', art: 'garage-attached', icon: 'Warehouse' }),
  Object.freeze({ key: 'detached', label: 'Detached', art: 'garage-detached', icon: 'Warehouse' }),
  Object.freeze({ key: 'any', label: 'Either is fine', art: 'garage-either', icon: 'Warehouse' }),
]);

// The existing exterior:Garage criterion's level; 'not_important' when the
// person said so (stored as "don't care", exactly like deselecting it); null
// when never answered. Nothing is written to any home either way.
export function garageImportance(raw) {
  const priorities = normalizePriorities(raw);
  const tier = priorities.exterior?.tiers?.Garage;
  if (PRIORITY_LEVELS.includes(tier)) return tier;
  return tier === 'dontcare' ? 'not_important' : null;
}

export function setGarageImportance(raw, value) {
  const priorities = normalizePriorities(raw);
  if (value === 'not_important') return moveCriterion(priorities, 'exterior', 'Garage', 'dontcare');
  if (!PRIORITY_LEVELS.includes(value)) return priorities;
  return setFeatureLevel(priorities, { categoryKey: 'exterior', label: 'Garage', custom: false }, value);
}

// Attached / Detached / Either: the existing exterior.garagePreference
// qualifier (context for the buyer, not a Match input). null = not answered.
export function garageType(raw) {
  const value = normalizePriorities(raw).exterior?.garagePreference;
  return GARAGE_TYPES.some((type) => type.key === value) ? value : null;
}

export const setGarageType = (raw, value) => setGaragePreference(raw, value);

/* --------------------------- switching search type -------------------------- */

// Screen 1: the existing switch (keeps every answer that still applies, says
// what it removed), plus anything this flow offers for the new kind of
// search that the earlier catalogs didn't — e.g. a Kitchen Island chosen for a
// purchase stays chosen for an apartment, where this flow offers it too.
//
// The pets answer (src/lib/rentalPets.js): Home to Rent ↔ Apartment to Rent
// keeps the answer, Pet-Friendly's level and FLH's automatic ownership of it;
// a switch to Home to Buy clears the answer and the marker along with
// Pet-Friendly (the caller's Undo restores the whole earlier document).
//
// Garage: a house's garage (Home to Buy, Home to Rent) and an apartment
// building's Garage Parking share the identity exterior:Garage, but they are
// not the same wish. Moving into Apartment to Rent therefore never turns a
// house Garage priority into Garage Parking: the existing switch deactivates
// it (and says so), and its level is set aside in `exterior.heldGarage`
// (additive, never read by Match). Garage Parking counts only once the renter
// chooses it. Moving back to a house search restores the held level.
const HOUSE_GARAGE = Object.freeze({ categoryKey: 'exterior', label: 'Garage', kind: 'check' });
export function switchPrioritySearchType(raw, choiceKey) {
  const before = normalizePriorities(raw);
  if (before.onboardingSearchType === choiceKey) return { priorities: before, removed: [] };
  const beforeItems = priorityLevels(before).flatMap((level) => level.items);
  const pets = snapshotPets(before);
  const fromApartment = searchExperienceKey(before) === 'apartment_rent';
  const toApartment = choiceKey === 'apartment_rent' && !fromApartment;
  const garageTier = beforeItems.find((item) => item.key === 'exterior:Garage')?.tier || null;
  const result = switchSearchType(before, choiceKey);
  let next = result.priorities;
  const offered = new Map(allOffered(next).map((feature) => [normalizeFeatureKey(feature.id), feature]));
  const restored = new Set();
  for (const item of beforeItems) {
    if (toApartment && item.key === 'exterior:Garage') continue;
    const feature = offered.get(normalizeFeatureKey(item.key));
    if (!feature || featureLevel(next, feature)) continue;
    next = setFeatureLevel(next, feature, item.tier);
    restored.add(item.displayLabel);
  }
  if (choiceKey === 'home_rent' || choiceKey === 'apartment_rent') {
    const kept = restorePetsAfterSwitch(next, pets);
    next = kept.priorities;
    if (kept.restoredLabel) restored.add(kept.restoredLabel);
  } else {
    next = clearPetsState(next);
  }
  if (toApartment && garageTier) {
    next = { ...next, exterior: { ...next.exterior, heldGarage: { tier: garageTier, from: searchExperienceKey(before) } } };
  } else if (fromApartment && choiceKey !== 'apartment_rent' && next.exterior?.heldGarage) {
    const { heldGarage, ...exterior } = next.exterior;
    next = { ...next, exterior };
    if (PRIORITY_LEVELS.includes(heldGarage.tier)) {
      next = addCriterion(next, HOUSE_GARAGE, heldGarage.tier);
      restored.add('Garage');
    }
  }
  return { priorities: next, removed: result.removed.filter((label) => !restored.has(label)) };
}

/* ---------------------------------- review --------------------------------- */

const LEVEL_ORDER = Object.freeze({ must: 0, important: 1, nice: 2 });

// Review: every category with its chosen features (Must Have first).
export function reviewCategories(raw) {
  const priorities = normalizePriorities(raw);
  return priorityCategoriesFor(priorities).map((category) => {
    const view = categoryView(priorities, category.key);
    const chosen = view.cards.filter((card) => card.level).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    return { key: category.key, step: category.step, title: category.title, chosen, garage: category.key === 'garage' ? { importance: garageImportance(priorities), type: garageType(priorities) } : null };
  });
}

// Chosen priorities that no category screen shows (earlier My Search picks,
// an old flow's choices, Home Preferences). Kept, counted, editable on Review.
export function otherChosenPriorities(raw) {
  const priorities = normalizePriorities(raw);
  const onScreens = new Set(priorityCategoriesFor(priorities).flatMap((category) => categoryView(priorities, category.key).cards.map((card) => card.id.toLowerCase())));
  const groupedCustom = new Set(storedItems(priorities).filter((item) => item.source === 'custom' && item.group && priorityCategory(priorities, item.group) && !priorityCategory(priorities, item.group).question).map((item) => idOf(item.categoryKey, item.label).toLowerCase()));
  return priorityLevels(priorities).flatMap((level) => level.items)
    .filter((item) => !onScreens.has(item.key.toLowerCase()) && !groupedCustom.has(item.key.toLowerCase()) && !(item.categoryKey === 'exterior' && item.label === 'Garage'))
    .map((item) => {
      const storedItem = (priorities[item.categoryKey]?.customItems || []).find((entry) => entry.label === item.label);
      return { id: item.key, categoryKey: item.categoryKey, label: item.label, text: item.displayLabel, kind: item.kind, custom: storedItem?.source === 'custom', art: null, icon: null, group: null, role: 'other', level: item.tier, legacy: item.legacy };
    });
}

// Home type, layout and condition saved earlier (they are no longer asked
// here). Read-only on Review; never cleared by this flow.
export function earlierPreferences(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  const titles = Object.fromEntries(whatMattersGroups(priorities).map((group) => [group.key, group.title]));
  return REMOVED_FROM_QUESTIONNAIRE
    .map((key) => ({ key, title: titles[key] || { preferredPropertyTypes: 'Home type', homeLayout: 'Layout', homeCondition: 'Condition' }[key], values: (priorities[key]?.values || []).filter((value) => value && value !== 'No Preference') }))
    .filter((group) => group.values.length)
    .map((group) => ({ ...group, text: group.values.map((value) => groupValueLabel(group.key, value, experience)).join(' or ') }));
}
