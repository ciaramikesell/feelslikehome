// Desktop priority board for Mobile Priority Onboarding V3 (flow 4). See
// docs/desktop-priority-board.md.
//
// On desktop the separate category screens (Layout, Kitchen, …) are shown as
// ONE board: a feature library grouped by those same categories, and three
// importance columns. This module is the board's pure model. It adds nothing
// to storage:
//
//   • The library and the columns are views of the SAME priorities document
//     and the SAME category catalog as the phone screens
//     (src/lib/priorityCategories.js): identical identities per kind of
//     search, identical dedupe, identical writes (setFeatureLevel). There is
//     no desktop catalog and no second ranking.
//   • The flow-4 step list (src/lib/onboardingFlow.js) is unchanged. The board
//     is a presentation of the consecutive card-category steps: it is shown
//     while the stored step is any of them, Continue / Skip complete all of
//     them at once, and Back leaves from the first. Progress is therefore the
//     same document on every screen size, so resizing never loses an answer
//     or restarts onboarding.
//   • Question screens (Rental Essentials) stay screens of their own on
//     desktop, exactly as on phones.

import { normalizePriorities } from './constants.js';
import { PRIORITY_LEVELS, basicsFieldsFor, priorityLevels } from './searchProfile.js';
import {
  PRIORITY_CATEGORIES, categoryView, featureLevel, garageImportance, normalizeFeatureKey, priorityCategoriesFor, setFeatureLevel,
} from './priorityCategories.js';
import { PETS_CRITERION_KEY, PETS_TEXT } from './rentalPets.js';
import { advanceOnboarding, onboardingStepsFor, retreatOnboarding, skipOnboardingStep } from './onboardingFlow.js';

/* ------------------------------- breakpoint -------------------------------- */

// The board is used at 1024 CSS px and wider (desktop, and a tablet in
// landscape). Narrower — phones, a portrait tablet, or any desktop browser
// zoomed to 200% — keeps the photo-card category screens unchanged.
export const DESKTOP_BOARD_MIN_WIDTH = 1024;
export const DESKTOP_BOARD_QUERY = `(min-width: ${DESKTOP_BOARD_MIN_WIDTH}px)`;

/* ---------------------------------- steps ---------------------------------- */

// The single progress entry the board stands for (rail and step count only;
// never stored — the stored step is always one of the category steps).
export const BOARD_STEP = 'priority_board';
export const BOARD_STEP_LABEL = 'What Matters Most';

// Card-category steps the board replaces. Question categories are excluded.
export const BOARD_CATEGORY_STEPS = Object.freeze(PRIORITY_CATEGORIES.filter((category) => !category.question).map((category) => category.step));
const BOARD_SET = new Set(BOARD_CATEGORY_STEPS);

export const isBoardStep = (step) => BOARD_SET.has(step);

// The board steps this person's flow shows, in order.
export function boardStepsIn(steps) {
  return steps.filter(isBoardStep);
}

// The desktop step list: the board's steps collapsed into one BOARD_STEP at
// the position of the first of them; every other step unchanged.
export function desktopSteps(steps) {
  const out = [];
  for (const key of steps) {
    if (!isBoardStep(key)) out.push(key);
    else if (!out.includes(BOARD_STEP)) out.push(BOARD_STEP);
  }
  return out;
}

// Progress as the desktop shows it: { index, position, total, steps }, review
// being the finish line rather than a counted step (as on phones).
export function desktopProgress(flowSteps, step) {
  const steps = desktopSteps(flowSteps).filter((key) => key !== 'review');
  const current = isBoardStep(step) ? BOARD_STEP : step;
  const index = current === 'review' ? steps.length - 1 : Math.max(0, steps.indexOf(current));
  return { index, position: current === 'review' ? steps.length : index + 1, total: steps.length, steps };
}

// Continue (or Skip) on the board: completes every board step, in order, with
// the same transitions the phone screens use one at a time. Skip marks every
// board step skipped (Review then offers each category again).
export function advanceBoard(version, rawState, { skip = false, now } = {}) {
  const steps = boardStepsIn(onboardingStepsFor(version, rawState));
  let result = { state: rawState, done: false };
  for (const key of steps) result = (skip ? skipOnboardingStep : advanceOnboarding)(version, result.state, key, now);
  return result;
}

// Back on the board: the screen before its first category.
export function retreatBoard(version, rawState, now) {
  const [first] = boardStepsIn(onboardingStepsFor(version, rawState));
  return retreatOnboarding(version, rawState, first, now);
}

/* ---------------------------------- model ---------------------------------- */

const norm = (id) => normalizeFeatureKey(id);

// Home to Buy asks the house garage as its own question on phones (overall
// importance, then attached / detached). On the board it is one chip with the
// same identity (exterior:Garage), so choosing a column is the same write as
// the phone's importance question, and removing it is its Not important.
export const BOARD_HOUSE_GARAGE = Object.freeze({
  id: 'exterior:Garage', categoryKey: 'exterior', label: 'Garage', text: 'Garage', kind: 'check',
  custom: false, art: null, icon: 'Warehouse', group: 'garage', role: 'feature',
});

const PETS_FEATURE = Object.freeze({
  id: PETS_CRITERION_KEY, categoryKey: 'features', label: 'Pets Allowed', text: PETS_TEXT, kind: 'check',
  custom: false, art: 'pet-friendly', icon: 'PawPrint', group: 'essentials', role: 'pets',
});

// Every feature the board offers for this kind of search, by category, in the
// phone screens' order: features, then suggestions, then the person's own.
function boardCategories(priorities) {
  return priorityCategoriesFor(priorities).filter((category) => !category.question).map((category) => {
    const view = categoryView(priorities, category.key);
    const own = view.cards.filter((card) => card.role === 'own');
    const offered = [...view.category.features, ...view.category.suggestions, ...own];
    const features = category.key === 'garage' ? [{ ...BOARD_HOUSE_GARAGE }, ...offered] : offered;
    const seen = new Set();
    return {
      category,
      features: features.filter((feature) => { const key = norm(feature.id); if (seen.has(key)) return false; seen.add(key); return true; }),
    };
  });
}

// The person's chosen priorities, by column. Read from priorityLevels — the
// same reader My Search and Match use — so a priority chosen anywhere
// (another screen, My Search, an older flow, the pets answer) is shown, once,
// in the column of its level. Ordered by category, then by position.
export function boardColumns(input, categories = boardCategories(input)) {
  const raw = normalizePriorities(input);
  const index = new Map();
  categories.forEach(({ category, features }, groupIndex) => features.forEach((feature, position) => {
    const key = norm(feature.id);
    if (!index.has(key)) index.set(key, { feature, order: groupIndex * 1000 + position });
  }));
  const columns = Object.fromEntries(PRIORITY_LEVELS.map((tier) => [tier, []]));
  const seen = new Set();
  for (const level of priorityLevels(raw)) {
    for (const item of level.items) {
      const key = norm(item.key);
      if (seen.has(key)) continue;
      seen.add(key);
      const known = index.get(key);
      const feature = known
        ? { ...known.feature, level: level.tier }
        : key === norm(PETS_CRITERION_KEY)
          ? { ...PETS_FEATURE, level: level.tier }
          : {
            id: item.key, categoryKey: item.categoryKey, label: item.label, text: item.displayLabel, kind: item.kind,
            custom: Boolean(raw[item.categoryKey]?.customItems?.some((entry) => entry.label === item.label && entry.source === 'custom')),
            art: null, icon: null, group: null, role: 'other', legacy: Boolean(item.legacy), level: level.tier,
          };
      columns[level.tier].push({ feature, order: known ? known.order : 1e9 + columns[level.tier].length });
    }
  }
  return Object.fromEntries(PRIORITY_LEVELS.map((tier) => [tier, columns[tier].sort((a, b) => a.order - b.order).map((entry) => entry.feature)]));
}

// The whole board: library groups (only what is NOT in a column, so every
// feature is in exactly one place) and the three columns.
//   group: { key, step, title, features, rankedCount, garageDetailsHidden, lotSize }
export function priorityBoard(input, { earlierRemoved = [] } = {}) {
  const raw = normalizePriorities(input);
  const categories = boardCategories(raw);
  const columns = boardColumns(raw, categories);
  const ranked = new Set(PRIORITY_LEVELS.flatMap((tier) => columns[tier].map((feature) => norm(feature.id))));
  const experience = raw.onboardingSearchType || 'home_buy';
  const garageMatters = PRIORITY_LEVELS.includes(garageImportance(raw));
  const groups = categories.map(({ category, features }) => {
    let library = features.filter((feature) => !ranked.has(norm(feature.id)));
    const rankedCount = features.length - library.length;
    // As on the phone screen: garage details once a garage matters (or once
    // any detail is already chosen).
    const garageDetailsHidden = category.key === 'garage' && !garageMatters && rankedCount === 0;
    if (garageDetailsHidden) library = library.filter((feature) => feature.id === BOARD_HOUSE_GARAGE.id);
    return {
      key: category.key, step: category.step, title: category.title, storage: category.storage,
      features: library.map((feature) => ({ ...feature, level: null })), rankedCount, garageDetailsHidden,
      lotSize: category.key === 'exterior' && Boolean(basicsFieldsFor(experience).lotSize),
    };
  });
  // Earlier priorities the board doesn't offer, removed during this visit:
  // kept in the library so they can be put back (they are never deleted).
  const earlier = earlierRemoved.filter((feature) => !ranked.has(norm(feature.id)) && !groups.some((group) => group.features.some((entry) => norm(entry.id) === norm(feature.id))));
  if (earlier.length) groups.push({ key: 'earlier', step: null, title: 'From earlier', features: earlier.map((feature) => ({ ...feature, level: null })), rankedCount: 0, garageDetailsHidden: false, lotSize: false });
  return { groups, columns, rankedCount: ranked.size };
}

// Where a feature currently is: 'must' | 'important' | 'nice' | null (library).
export function boardLevel(raw, feature) {
  const key = norm(feature.id);
  for (const [tier, items] of Object.entries(boardColumns(raw))) if (items.some((item) => norm(item.id) === key)) return tier;
  return featureLevel(raw, feature);
}

// The one write the board makes: a column (must / important / nice), or
// 'none' to move it back to the library — the existing "don't care" state,
// never a No on any home. Dropping a chip where it already is changes nothing.
export function placeOnBoard(raw, feature, target) {
  const current = boardLevel(raw, feature);
  if (target === current || (target === 'none' && !current)) return raw;
  return setFeatureLevel(raw, feature, PRIORITY_LEVELS.includes(target) ? target : 'none');
}

// Canonical suggestions for the board's Add your own field: library features
// (any category) whose name contains what was typed, ignoring case, spacing
// and punctuation. Ranked features are already on the board, so not offered.
export function boardSuggestions(board, typed, limit = 6) {
  const key = normalizeFeatureKey(typed);
  if (!key) return [];
  const out = [];
  for (const group of board.groups) {
    for (const feature of group.features) {
      const names = [feature.text, feature.label, ...(feature.aliases || [])].map(normalizeFeatureKey);
      if (names.some((name) => name.includes(key))) out.push({ feature, groupTitle: group.title });
    }
  }
  return out.slice(0, limit);
}
