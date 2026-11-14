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
  isRetiredPurchaseBuiltIn, normalizePriorities,
} from './constants.js';
import { ONBOARDING_SUGGESTIONS } from './onboarding.js';
import { splitCategoryItems } from './matching.js';
import {
  PRIORITY_LEVELS, addCriterion, isCriterionSelected, moveCriterion, priorityLevels, searchExperienceKey, setGaragePreference,
} from './searchProfile.js';
import { switchSearchType } from './whatMattersCatalog.js';
import { groupValueLabel, whatMattersGroups } from './whatMattersGroups.js';

const HOMES = Object.freeze(['home_buy', 'home_rent']);
const RENTALS = Object.freeze(['home_rent', 'apartment_rent']);
const BUY = Object.freeze(['home_buy']);
const APARTMENT = Object.freeze(['apartment_rent']);

// A feature definition. `custom: true` = no catalog identity; created as the
// buyer's own priority. `only` limits it to some kinds of search. `apartment`
// names the identity an apartment search already uses for the same idea (its
// rental catalog), so the same idea is never stored twice.
const f = (categoryKey, label, options = {}) => Object.freeze({ categoryKey, label, ...options });

export const PRIORITY_CATEGORIES = Object.freeze([
  Object.freeze({
    key: 'essentials', step: 'cat_essentials', storage: 'features', only: RENTALS,
    title: 'Rental Essentials', heading: ['The rental ', 'essentials'],
    lead: 'The everyday basics of renting. Tap any that matter and choose how much.',
    features: Object.freeze([
      f('features', 'Pets Allowed', { text: 'Pet-Friendly', art: 'pet-friendly', icon: 'PawPrint' }),
      f('features', 'In-Unit Laundry', { text: 'In-Unit Laundry', art: 'in-unit-laundry', icon: 'WashingMachine' }),
      f('features', 'Utilities Included', { text: 'Utilities Included', icon: 'PlugZap' }),
      f('exterior', 'Parking', { text: 'Parking', icon: 'SquareParking' }),
      f('features', 'Central Air', { text: 'Central Air', icon: 'AirVent' }),
      f('features', 'Dishwasher', { text: 'Dishwasher', art: 'dishwasher', icon: 'Utensils' }),
    ]),
    suggestions: Object.freeze([
      f('exterior', 'Driveway / Off-Street Parking', { text: 'Off-Street Parking', icon: 'Car' }),
      f('features', 'Storage Unit', { custom: true, icon: 'Archive' }),
      f('features', 'Package Room', { custom: true, icon: 'Package' }),
    ]),
  }),
  Object.freeze({
    key: 'layout', step: 'cat_layout', storage: 'features',
    title: 'Layout & Living Spaces', heading: ['Layout & ', 'living spaces'],
    lead: 'How the rooms come together. Choose only what you’d weigh.',
    features: Object.freeze([
      f('features', 'First-Floor Bedroom', { art: 'first-floor-bedroom', icon: 'BedSingle', only: HOMES }),
      f('features', 'Home office', { art: 'home-office', icon: 'Laptop' }),
      f('features', 'Finished basement', { art: 'finished-basement', icon: 'Sofa', only: HOMES }),
      f('features', 'Primary ensuite', { art: 'primary-ensuite', icon: 'BedDouble' }),
    ]),
    suggestions: Object.freeze([
      f('features', 'First-floor laundry', { art: 'first-floor-laundry', icon: 'WashingMachine', only: HOMES }),
      f('features', 'Walkout basement', { art: 'walkout-basement', icon: 'DoorOpen', only: HOMES }),
      f('exterior', 'Front porch', { art: 'front-porch', icon: 'Armchair', only: HOMES }),
      f('features', 'Walk-In Closet', { icon: 'Shirt', only: APARTMENT }),
    ]),
  }),
  Object.freeze({
    key: 'kitchen', step: 'cat_kitchen', storage: 'features',
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
    key: 'living', step: 'cat_living', storage: 'features',
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
    key: 'bath', step: 'cat_bath', storage: 'features',
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
  // existing attached/detached qualifier and garage details. Not for apartments.
  Object.freeze({
    key: 'garage', step: 'cat_garage', storage: 'exterior', only: HOMES,
    title: 'Garage', heading: ['The ', 'garage'],
    lead: 'First, how much does a garage matter to you?',
    features: Object.freeze([]),
    suggestions: Object.freeze([
      f('exterior', 'Workbench', { custom: true, art: 'workbench', icon: 'Wrench' }),
      f('exterior', 'Garage Extension', { custom: true, art: 'garage-extension', icon: 'Warehouse' }),
      f('exterior', 'Door to Backyard', { custom: true, art: 'garage-yard-door', icon: 'DoorOpen' }),
    ]),
  }),
  Object.freeze({
    key: 'exterior', step: 'cat_exterior', storage: 'exterior',
    title: 'Exterior & Property', heading: ['Exterior & ', 'property'],
    lead: 'The outdoor space that comes with it.',
    features: Object.freeze([
      f('exterior', 'Patio / deck', { art: 'deck-patio', icon: 'Sun', apartment: { label: 'Patio / Deck / Outdoor Living', text: 'Balcony / Patio' } }),
      f('exterior', 'Fenced yard', { art: 'fenced-yard', icon: 'Fence', only: HOMES }),
    ]),
    suggestions: Object.freeze([
      f('location', 'Mature Trees', { art: 'mature-trees', icon: 'TreeDeciduous', only: HOMES }),
      f('exterior', 'Garden Space', { art: 'garden', icon: 'Sprout', only: HOMES }),
      f('exterior', 'Pool', { art: 'pool', icon: 'Waves' }),
      f('exterior', 'Fitness Center', { icon: 'Dumbbell', only: APARTMENT }),
      f('exterior', 'Secure Entry', { icon: 'ShieldCheck', only: APARTMENT }),
      f('exterior', 'Elevator', { icon: 'ArrowUpDown', only: APARTMENT }),
    ]),
  }),
  // Street and neighborhood photos where the founder supplied one; abstract
  // preferences (No HOA) stay icon-only.
  Object.freeze({
    key: 'neighborhood', step: 'cat_neighborhood', storage: 'location',
    title: 'Location & Neighborhood', heading: ['Location & ', 'neighborhood'],
    lead: 'The street and the neighborhood around it.',
    features: Object.freeze([
      f('location', 'Low-Traffic Street', { art: 'low-traffic-street', icon: 'Route' }),
      f('location', 'Sidewalks', { art: 'sidewalks', icon: 'Footprints' }),
      f('location', 'Tree-lined street', { text: 'Tree-Lined Street', art: 'tree-lined-street', icon: 'Trees' }),
      f('location', 'No HOA', { icon: 'Ban', only: BUY }),
    ]),
    suggestions: Object.freeze([
      f('location', 'Cul-de-Sac', { art: 'cul-de-sac', icon: 'Milestone' }),
      f('location', 'Walkable schools', { text: 'Walkable to Schools', art: 'walkable-schools', icon: 'School' }),
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
    if (definition.apartment) return { ...definition, ...definition.apartment };
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

// 'must' | 'important' | 'nice' when chosen; null otherwise (never chosen, or
// set to Not important). Unknown is never reported as anything else.
export function featureLevel(raw, feature) {
  const priorities = normalizePriorities(raw);
  const tier = priorities[feature.categoryKey]?.tiers?.[feature.label];
  return PRIORITY_LEVELS.includes(tier) && isCriterionSelected(priorities, feature.categoryKey, feature.label) ? tier : null;
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
  const own = stored
    .filter((item) => item.group === category.key && item.source === 'custom' && !offeredKeys.has(normalizeFeatureKey(idOf(item.categoryKey, item.label))))
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
  if (!PRIORITY_LEVELS.includes(level)) {
    return priorities[feature.categoryKey]?.tiers?.[feature.label] ? moveCriterion(priorities, feature.categoryKey, feature.label, 'dontcare') : priorities;
  }
  if (feature.custom) {
    const ensured = ensureCustom(priorities, feature);
    priorities = ensured.priorities;
    return moveCriterion(priorities, feature.categoryKey, ensured.feature.label, level);
  }
  return isCriterionSelected(priorities, feature.categoryKey, feature.label)
    ? moveCriterion(priorities, feature.categoryKey, feature.label, level)
    : addCriterion(priorities, { categoryKey: feature.categoryKey, label: feature.label, kind: 'check' }, level);
}

// Things the person might mean that FLH already has an identity for: the
// catalog for this kind of search, its curated lists and Home Preferences.
// Retired built-ins are left out (they no longer count in Match), so typing
// one creates the person's own priority instead.
function catalogMatches(priorities) {
  const experience = searchExperienceKey(priorities) || 'home_buy';
  const fromDefs = getItemlistCategories(priorities.searchType).flatMap((def) => [...def.coreItems, ...def.suggestedItems, ...(def.specificItems || [])]
    .filter((item) => !isRetiredPurchaseBuiltIn(def.key, item, priorities.searchType))
    .map((item) => ({ categoryKey: def.key, label: item.label })));
  const curated = (ONBOARDING_SUGGESTIONS[experience] || []).flatMap(([, items]) => items).map((item) => ({ categoryKey: item.categoryKey, label: item.label }));
  const prefs = homePreferenceCriteriaFor(experience).map((item) => ({ categoryKey: item.categoryKey, label: item.label }));
  const essentials = experience === 'home_buy' ? [] : RENTAL_ESSENTIALS.map((item) => ({ categoryKey: item.categoryKey, label: item.label }));
  return [...essentials, ...curated, ...prefs, ...fromDefs].filter((item) => item.categoryKey !== 'homeFeel');
}

// "Add your own" on a screen (typed text or a suggestion chip). Never creates a
// duplicate: anything that matches — ignoring case, spacing and punctuation —
// a feature on any screen, something already in the person's document, or a
// catalog criterion is reused. Otherwise a new custom feature is created on
// this screen. Nothing is selected: the importance picker opens next.
//   → { priorities, feature, homeCategory } (homeCategory: the screen the
//     feature is shown on, when that isn't this one) or null for empty input.
export function addOwnFeature(raw, categoryKey, typed) {
  const priorities = normalizePriorities(raw);
  const category = priorityCategory(priorities, categoryKey);
  const label = cleanFeatureLabel(typed?.label ?? typed);
  if (!category || !label) return null;
  const key = normalizeFeatureKey(label);
  const keyOf = (feature) => [normalizeFeatureKey(feature.label), normalizeFeatureKey(feature.text)];
  const otherScreen = (feature) => (feature.group && feature.group !== category.key ? feature.group : null);

  const offered = allOffered(priorities).find((feature) => keyOf(feature).includes(key));
  if (offered) {
    if (!offered.custom) return { priorities, feature: offered, homeCategory: otherScreen(offered) };
    const ensured = ensureCustom(priorities, offered);
    return { priorities: ensured.priorities, feature: ensured.feature, homeCategory: otherScreen(offered) };
  }

  const stored = storedItems(priorities).find((item) => item.categoryKey !== 'homeFeel'
    && [normalizeFeatureKey(item.label), normalizeFeatureKey(criterionDisplayLabel(item.categoryKey, item.label))].includes(key));
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
export function switchPrioritySearchType(raw, choiceKey) {
  const before = normalizePriorities(raw);
  const beforeItems = priorityLevels(before).flatMap((level) => level.items);
  const result = switchSearchType(before, choiceKey);
  let next = result.priorities;
  const offered = new Map(allOffered(next).map((feature) => [normalizeFeatureKey(feature.id), feature]));
  const restored = new Set();
  for (const item of beforeItems) {
    const feature = offered.get(normalizeFeatureKey(item.key));
    if (!feature || featureLevel(next, feature)) continue;
    next = setFeatureLevel(next, feature, item.tier);
    restored.add(item.displayLabel);
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
  const groupedCustom = new Set(storedItems(priorities).filter((item) => item.source === 'custom' && item.group && priorityCategory(priorities, item.group)).map((item) => idOf(item.categoryKey, item.label).toLowerCase()));
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
