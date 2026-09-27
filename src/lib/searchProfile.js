// Pure, React-free helpers behind the authenticated-mobile Onboarding and My Search
// surfaces. Everything here READS the participant's existing priorities document
// or returns a new copy of it through the same primitives the rest of the app
// already uses (selectPriorityItem, the category `tiers` map, commute destination
// rows) — no new storage shape, no second scoring path. Match itself
// (computeMatch) is never consulted or changed from here.

import {
  TIER_META, getItemlistCategories, criterionDisplayLabel, effectiveTier,
  isRetiredPurchaseBuiltIn, isDiscontinuedOffering, isCriterionApplicable,
  isApartmentRental, isRentalType, searchExperienceLabel, normalizePriorities, isExperientialCriterion,
  garagePreferenceLabel, GARAGE_PREFERENCE_OPTIONS, DEFAULT_SELECTED_TIER,
} from './constants.js';
import { normalizeSearchIntent, PROPERTY_TYPE_LABELS } from './searchIntent.js';
import { splitCategoryItems, selectPriorityItem, parseNum } from './matching.js';
import { ONBOARDING_SUGGESTIONS } from './onboarding.js';

/* ---------------------------------- levels ---------------------------------- */

export const PRIORITY_LEVELS = Object.freeze(['must', 'important', 'nice']);

// The three levels as the product describes them to a buyer. Labels come from the
// canonical TIER_META so they can never drift from what Match uses.
export const LEVEL_COPY = Object.freeze({
  must: Object.freeze({ label: TIER_META.must.label, heading: 'Must Have', description: 'I could rule out a home over this.', hint: 'Could rule out a home' }),
  important: Object.freeze({ label: TIER_META.important.label, heading: 'Important', description: 'This meaningfully affects my decision.', hint: 'Strongly shapes your Match' }),
  nice: Object.freeze({ label: TIER_META.nice.label, heading: 'Nice to Have', description: "I'd love it, but I can live without it.", hint: 'A welcome bonus' }),
});

const criterionKey = (categoryKey, label) => `${categoryKey}:${label}`;

// Every selected criterion on the participant's board, grouped by level, in the
// same category order computeMatch walks. The product has no
// within-level ordering, so none is invented here.
export function priorityLevels(raw) {
  const priorities = normalizePriorities(raw);
  const garageQualifier = garagePreferenceLabel(priorities);
  const selected = getItemlistCategories(priorities.searchType).flatMap((def) => {
    const { catState, core, custom } = splitCategoryItems(def, priorities);
    return [...core, ...custom]
      .map((item) => ({ item, tier: effectiveTier(def.key, item.label, priorities, catState.tiers?.[item.label]) }))
      .filter(({ tier }) => PRIORITY_LEVELS.includes(tier))
      .map(({ item, tier }) => ({
        key: criterionKey(def.key, item.label),
        categoryKey: def.key,
        label: item.label,
        kind: item.kind,
        displayLabel: criterionDisplayLabel(def.key, item.label),
        qualifier: def.key === 'exterior' && item.label === 'Garage' ? garageQualifier : null,
        legacy: isRetiredPurchaseBuiltIn(def.key, item, priorities.searchType),
        // Judged in person after a tour (e.g. Natural Light) rather than from a listing.
        experiential: isExperientialCriterion(def.key, item.label),
        tier,
      }));
  });
  return PRIORITY_LEVELS.map((tier) => ({ tier, ...LEVEL_COPY[tier], items: selected.filter((entry) => entry.tier === tier) }));
}

export function selectedPriorityCount(raw) {
  return priorityLevels(raw).reduce((sum, level) => sum + level.items.length, 0);
}

// How many selected priorities actually feed Match right now (retired legacy
// built-ins stay visible on the board but no longer count).
export function matchShapingPriorityCount(raw) {
  return priorityLevels(raw).reduce((sum, level) => sum + level.items.filter((item) => !item.legacy).length, 0);
}

function categoryDef(priorities, categoryKey) {
  return getItemlistCategories(priorities.searchType).find((def) => def.key === categoryKey)
    || { key: categoryKey, coreItems: [], suggestedItems: [], defaultCustomKind: 'check' };
}

// Moves one criterion to another level ('dontcare' removes it from the board). The
// stored identity, kind, and custom-ness are never rewritten — only its tier.
export function moveCriterion(raw, categoryKey, label, tier) {
  const priorities = normalizePriorities(raw);
  const catState = priorities[categoryKey] || { customItems: [], tiers: {} };
  return { ...priorities, [categoryKey]: { ...catState, tiers: { ...(catState.tiers || {}), [label]: tier } } };
}

// Selects an offered criterion at a level (Important by default), promoting a
// suggestion into the participant's own customItems exactly as the existing
// selectPriorityItem does everywhere else.
export function addCriterion(raw, criterion, tier = DEFAULT_SELECTED_TIER) {
  const priorities = normalizePriorities(raw);
  const def = categoryDef(priorities, criterion.categoryKey);
  return {
    ...priorities,
    [criterion.categoryKey]: selectPriorityItem(priorities[criterion.categoryKey], def, {
      label: criterion.label, kind: criterion.kind, ...(criterion.source === 'custom' ? { source: 'custom' } : {}),
    }, tier),
  };
}

export function isCriterionSelected(raw, categoryKey, label) {
  const priorities = normalizePriorities(raw);
  return PRIORITY_LEVELS.includes(effectiveTier(categoryKey, label, priorities, priorities[categoryKey]?.tiers?.[label]));
}

export function toggleCriterion(raw, criterion) {
  return isCriterionSelected(raw, criterion.categoryKey, criterion.label)
    ? moveCriterion(raw, criterion.categoryKey, criterion.label, 'dontcare')
    : addCriterion(raw, criterion);
}

// A buyer's own typed priority. A label that matches (case-insensitively) something
// already offered or already on the board selects that instead of creating a visibly
// duplicate custom priority beside it.
export function addCustomCriterion(raw, categoryKey, typedLabel, offered = []) {
  const label = String(typedLabel || '').trim();
  if (!label) return normalizePriorities(raw);
  const priorities = normalizePriorities(raw);
  const normalized = label.toLowerCase();
  const offeredMatch = offered.find((criterion) => criterion.label.toLowerCase() === normalized || criterion.displayLabel?.toLowerCase() === normalized);
  if (offeredMatch) return isCriterionSelected(priorities, offeredMatch.categoryKey, offeredMatch.label) ? priorities : addCriterion(priorities, offeredMatch);
  const def = categoryDef(priorities, categoryKey);
  const { core, custom } = splitCategoryItems(def, priorities);
  const existing = [...core, ...custom].find((item) => item.label.toLowerCase() === normalized);
  if (existing) return addCriterion(priorities, { categoryKey, label: existing.label, kind: existing.kind });
  return addCriterion(priorities, { categoryKey, label, kind: def.defaultCustomKind || 'check', source: 'custom' });
}

export function setGaragePreference(raw, value) {
  const priorities = normalizePriorities(raw);
  if (!GARAGE_PREFERENCE_OPTIONS.some((option) => option.key === value)) return priorities;
  return { ...priorities, exterior: { ...priorities.exterior, garagePreference: value } };
}

/* ------------------------------ offered criteria ------------------------------ */

const CATEGORY_GROUP_TITLES = { location: 'Location', features: 'Home Features', exterior: 'Exterior & Property', homeFeel: 'Home Feel' };

// The canonical criteria offered to this participant, grouped for display.
// Home to Buy / Home to Rent use the curated canonical Home lists (the same lists
// onboarding shows); Apartment to Rent, historical rentals, and Investment keep the
// full catalog My Search already offered them. Retired and discontinued built-ins
// are never offered.
export function offeredCriteriaGroups(raw) {
  const priorities = normalizePriorities(raw);
  const experience = priorities.onboardingSearchType;
  const curated = (experience === 'home_buy' || experience === 'home_rent' || (!experience && normalizeSearchIntent(priorities.searchType) === 'purchase'))
    ? ONBOARDING_SUGGESTIONS[experience || 'home_buy']
    : null;
  const propertyTypes = priorities.preferredPropertyTypes?.values || [];
  const groups = curated
    ? curated.map(([title, items]) => ({ title, items: items.map((entry) => ({ ...entry, key: criterionKey(entry.categoryKey, entry.label) })) }))
    : getItemlistCategories(priorities.searchType).map((def) => {
      const { core, custom, suggestions } = splitCategoryItems(def, priorities);
      const items = [...core, ...custom, ...suggestions, ...(def.specificItems || [])]
        .filter((entry) => isCriterionApplicable(def.key, entry.label, propertyTypes))
        .filter((entry) => !isRetiredPurchaseBuiltIn(def.key, entry, priorities.searchType))
        .filter((entry, index, all) => all.findIndex((candidate) => candidate.label === entry.label) === index)
        .map((entry) => ({ categoryKey: def.key, label: entry.label, kind: entry.kind, displayLabel: criterionDisplayLabel(def.key, entry.label), key: criterionKey(def.key, entry.label) }));
      return { title: CATEGORY_GROUP_TITLES[def.key] || def.title, items };
    });
  return groups
    .map((group) => ({ ...group, items: group.items.filter((entry) => !isDiscontinuedOffering(entry.categoryKey, entry)) }))
    .filter((group) => group.items.length);
}

// Offered criteria not already on the board. A selected legacy label that differs
// from a canonical one only by case (e.g. rental 'Home Office' vs canonical
// 'Home office') also hides the canonical chip, so the same idea is never offered twice.
export function availableCriteriaGroups(raw) {
  const priorities = normalizePriorities(raw);
  const selected = priorityLevels(priorities).flatMap((level) => level.items);
  const taken = new Set(selected.flatMap((item) => [item.key.toLowerCase(), `${item.categoryKey}:${item.displayLabel}`.toLowerCase()]));
  return offeredCriteriaGroups(priorities)
    .map((group) => ({ ...group, items: group.items.filter((entry) => !taken.has(entry.key.toLowerCase()) && !taken.has(`${entry.categoryKey}:${entry.displayLabel}`.toLowerCase())) }))
    .filter((group) => group.items.length);
}

export function customCategoryOptions(raw) {
  const priorities = normalizePriorities(raw);
  return getItemlistCategories(priorities.searchType).map((def) => ({ key: def.key, title: CATEGORY_GROUP_TITLES[def.key] || def.title }));
}

/* ----------------------------------- basics ----------------------------------- */

// Stored option values are unchanged (Home Edit and Match compare against them);
// only the approved display labels differ.
export const LAYOUT_CHOICES = Object.freeze([
  Object.freeze({ value: 'Ranch / Single Story', label: 'Ranch' }),
  Object.freeze({ value: 'Two Story', label: 'Two Story' }),
  Object.freeze({ value: 'Other', label: 'Other' }),
]);
export const CONDITION_CHOICES = Object.freeze([
  Object.freeze({ value: 'New Construction', label: 'New Construction' }),
  Object.freeze({ value: 'Move-In Ready', label: 'Move-in Ready' }),
  Object.freeze({ value: 'Renovation Potential', label: 'Renovation Potential' }),
]);
const EXPERIENCE_LABELS = Object.freeze({ home_buy: 'Home to Buy', home_rent: 'Home to Rent', apartment_rent: 'Apartment to Rent' });

// Title-cased product names for the three onboarding choices; historical searches
// keep their existing label (e.g. "Rental", "Investment Property").
export function experienceLabel(raw) {
  const priorities = normalizePriorities(raw);
  const key = priorities.onboardingSearchType || (isApartmentRental(priorities) ? 'apartment_rent' : null);
  return EXPERIENCE_LABELS[key] || (priorities.searchType ? searchExperienceLabel(priorities) : '');
}

const DISPLAY_VALUE = Object.fromEntries([...LAYOUT_CHOICES, ...CONDITION_CHOICES].map(({ value, label }) => [value, label]));

export function searchExperienceKey(raw) {
  const priorities = normalizePriorities(raw);
  if (priorities.onboardingSearchType) return priorities.onboardingSearchType;
  if (isApartmentRental(priorities)) return 'apartment_rent';
  const intent = normalizeSearchIntent(priorities.searchType);
  if (intent === 'rental') return 'home_rent';
  if (intent === 'purchase') return 'home_buy';
  return intent || null;
}

// Which Basics apply to each kind of search — audited against the existing
// applicability rules (showsHomeLayout / showsMultiselectCategory / BasicsCard's lot
// size rule), not cloned from the purchase set.
export function basicsFieldsFor(experienceKey) {
  const rent = experienceKey === 'home_rent' || experienceKey === 'apartment_rent';
  return {
    budgetLabel: rent ? 'Maximum monthly rent' : 'Maximum budget',
    budgetPlaceholder: rent ? '2,200' : '450,000',
    lotSize: experienceKey === 'home_buy' || experienceKey === 'home_rent' || experienceKey === 'investment',
    propertyTypes: experienceKey === 'home_buy' ? ['house', 'condo', 'multifamily']
      : experienceKey === 'home_rent' ? ['house', 'townhome', 'condo'] : [],
    layout: experienceKey === 'home_buy',
    condition: experienceKey === 'home_buy',
  };
}

// Keeps what a person types in a numeric Basics field to digits (and one decimal
// point where fractions are meaningful), so a stored value is always something
// parseNum — and therefore Match — reads exactly as intended.
export function sanitizeNumericInput(value, { decimal = false } = {}) {
  const text = String(value ?? '');
  const digits = text.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, '');
  if (!decimal) return digits;
  const [whole, ...rest] = digits.split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}

const plural = (n, one, many) => (n === 1 ? one : many);
const fmtCount = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));
const fmtAcres = (n) => (n < 1 ? String(n).replace(/^0(?=\.)/, '') : fmtCount(n));

// The Basics as short, readable parts. Uses parseNum, never Number(), so a stored
// value typed with separators ("650,000") formats correctly instead of as NaN, and
// any value that genuinely isn't a number is omitted rather than rendered.
export function basicsSummary(raw) {
  const priorities = normalizePriorities(raw);
  const experience = searchExperienceKey(priorities);
  const rent = isRentalType(priorities.searchType);
  const numbers = [];
  const budget = parseNum(priorities.budget?.value);
  if (budget) numbers.push(`$${fmtCount(budget)}${rent ? '/mo' : ''} maximum`);
  const beds = parseNum(priorities.bedsMin?.value);
  if (beds) numbers.push(`${fmtCount(beds)}+ ${plural(beds, 'bedroom', 'bedrooms')}`);
  const baths = parseNum(priorities.bathsMin?.value);
  if (baths) numbers.push(`${fmtCount(baths)}+ ${plural(baths, 'bathroom', 'bathrooms')}`);
  const sqft = parseNum(priorities.sqftTarget?.value);
  if (sqft) numbers.push(`${fmtCount(sqft)}+ sq ft`);
  const lot = experience !== 'apartment_rent' ? parseNum(priorities.lotSizeTarget?.value) : null;
  if (lot) numbers.push(`${fmtAcres(lot)}+ acres`);

  const details = [];
  const clean = (values) => (values || []).filter((value) => typeof value === 'string' && value.trim() && value !== 'No Preference');
  if (experience !== 'apartment_rent') {
    const types = clean(priorities.preferredPropertyTypes?.values).map((value) => PROPERTY_TYPE_LABELS[value] || value);
    if (types.length) details.push({ key: 'types', label: 'Home types', values: types });
  }
  const investmentTypes = clean(priorities.investmentPropertyTypes);
  if (normalizeSearchIntent(priorities.searchType) === 'investment' && investmentTypes.length) details.push({ key: 'investment', label: 'Property types', values: investmentTypes });
  const layout = clean(priorities.homeLayout?.values).map((value) => DISPLAY_VALUE[value] || value);
  if (layout.length) details.push({ key: 'layout', label: 'Layout', values: layout });
  const condition = clean(priorities.homeCondition?.values).map((value) => DISPLAY_VALUE[value] || value);
  if (condition.length) details.push({ key: 'condition', label: 'Condition', values: condition });

  return {
    experienceLabel: experienceLabel(priorities),
    numbers,
    details,
    setCount: numbers.length + details.length,
  };
}

/* ----------------------------------- places ----------------------------------- */

export function placesSummary(destinations = []) {
  const labels = destinations.map((destination) => String(destination?.label || '').trim()).filter(Boolean);
  return {
    count: destinations.length,
    names: labels.join(' · '),
    countLabel: `${destinations.length} ${plural(destinations.length, 'place', 'places')}`,
  };
}

export function placeDraftError(draft) {
  if (!String(draft?.label || '').trim()) return 'Give this place a name.';
  if (!String(draft?.address || '').trim()) return 'Add an address.';
  const raw = draft.maxDriveMinutes;
  if (raw === '' || raw === null || raw === undefined) return null;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) return 'Use whole minutes between 1 and 1,440.';
  return null;
}

const normalizedMinutes = (value) => (value === '' || value === null || value === undefined ? null : Number(value));

// Turns an edited list of places back into the existing per-row operations
// (create/update/delete on commute_destinations). Order is the stored created_at
// order; new places append. A place is only ever deleted when the person removed it —
// never because its commute data is missing or still pending.
export function planPlaceChanges(original = [], draft = []) {
  const byId = new Map(original.map((place) => [place.id, place]));
  const keptIds = new Set(draft.filter((place) => place.id).map((place) => place.id));
  const deletes = original.filter((place) => !keptIds.has(place.id)).map((place) => place.id);
  const creates = [];
  const updates = [];
  draft.forEach((place) => {
    const values = { label: String(place.label || '').trim(), address: String(place.address || '').trim(), maxDriveMinutes: normalizedMinutes(place.maxDriveMinutes) };
    if (!place.id) { creates.push({ key: place.key ?? null, values }); return; }
    const before = byId.get(place.id);
    if (!before) return;
    const changes = {};
    if (values.label !== before.label) changes.label = values.label;
    if (values.address !== before.address) changes.address = values.address;
    if (values.maxDriveMinutes !== (before.maxDriveMinutes ?? null)) changes.maxDriveMinutes = values.maxDriveMinutes;
    if (Object.keys(changes).length) updates.push({ id: place.id, changes });
  });
  return { creates, updates, deletes };
}

/* ----------------------------------- status ----------------------------------- */

// Functional, not celebratory, for an established search; the "ready" language is
// reserved for the moment a search is first set up.
export function searchStatusCopy({ count, firstRun = false }) {
  if (firstRun) return { title: 'Your search is ready.', body: 'See how your homes measure up against what matters to you.' };
  if (!count) return { title: 'Nothing is shaping your Match yet', body: 'Add what matters to you and your homes will start to measure up.' };
  return { title: `${count} ${plural(count, 'priority shapes', 'priorities shape')} your Match`, body: 'Changes here update how your homes measure up.' };
}
