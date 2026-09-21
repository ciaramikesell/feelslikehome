// Keep this file free of React/JSX so it can be imported from both client and
// server code without pulling in any UI dependencies.

import {
  CANONICAL_SEARCH_INTENT_OPTIONS,
  normalizeSearchIntent,
} from './searchIntent.js';

export const LAYOUT_OPTIONS = ['Ranch / Single Story', 'Two Story', 'Split Level', 'Other', 'No Preference'];
export const HOME_CONDITION_OPTIONS = ['New Construction', 'Move-In Ready', 'Renovation Potential', 'No Preference'];

// Schools is deliberately check-kind (Yes/No), not rating-kind — it answers
// "does this home satisfy what I said matters about schools," a personal
// yes/no evaluation set in Add/Edit Home, not something learned by touring.
// Being check-kind means it automatically routes through home_member_state
// for Co-Buyer isolation via the same mechanism every other check-kind
// criterion already uses — no new architecture needed for this change.
export const LOCATION_CORE = [];
// "Overall Location" is intentionally retired from future selection (2026 criteria
// audit: no meaningfully distinct job from "Neighborhood" was found in how either is
// used). Existing users who already selected it keep it — splitCategoryItems reads a
// user's already-selected suggested items from their own stored `customItems`, never
// from this list, so removing it here only stops it being *offered* to new selections;
// nothing is deleted, renamed, or migrated.
//
// 2026 onboarding/My Search taxonomy unification: 'Near downtown area', 'Groceries
// nearby', and 'Tree-lined street' are retired the same way — dropped from future
// offering only, never deleted from anyone's stored priorities. 'Charming
// Neighborhood', 'Reputable Schools', 'Walkable to Town', and 'No HOA' are new.
// Everything else keeps its pre-existing stored identity (case included — see
// CRITERION_DISPLAY_LABEL_OVERRIDES below for the Title Case shown to users) so no
// existing selection is orphaned. See PURCHASE_LEGACY_LABEL_ALIASES for the one
// stored-identity fold this pass required (Parks Nearby).
export const LOCATION_SUGGESTED = [
  'Charming Neighborhood', 'Reputable Schools', 'Walkable to Town', 'Parks nearby',
  'Quiet street', 'Bustling Street', 'Near waterfront', 'Walkable schools', 'No HOA',
].map((label) => ({ label, kind: 'check' }));

export const HOME_FEEL_CORE = [];
export const HOME_FEEL_SUGGESTED = [];
const LEGACY_HOME_FEEL_CORE = ['Overall Condition', 'Layout / Flow'].map((label) => ({ label, kind: 'rating' }));
const LEGACY_HOME_FEEL_SUGGESTED = ['Natural Light', 'Character / Charm', 'Room Sizes', 'Openness / Ceiling Height', 'Privacy', 'Social Community', 'On-Site Management'].map((label) => ({ label, kind: 'rating' }));

export const EXTERIOR_CORE = [];
// 'Privacy Fencing' is new — a purely factual yes/no fact, deliberately distinct from
// the subjective post-tour 'exterior:Privacy' ("Yard Privacy") rating below.
export const EXTERIOR_SUGGESTED = [
  'Patio / deck', 'Fenced yard', 'Privacy Fencing', 'Attached garage', 'Detached garage',
  'Large backyard', 'Front porch', 'Pool', 'Landscaping',
].map((label) => ({ label, kind: 'check' }));

// 'Guest suite' is retired in favor of the canonical 'Guest / In-Law Suite' identity
// (previously dead — see RETIRED_PURCHASE_BUILT_INS's history — now restored as a real
// canonical item; see PURCHASE_LEGACY_LABEL_ALIASES for the safe fold from 'Guest suite').
// 'First-Floor Primary', 'Move-in Ready', 'Renovation Potential', and 'New Construction'
// are new. 'Move-in Ready'/'Renovation Potential'/'New Construction' are deliberately
// separate from the existing Home Condition multiselect (priorities.homeCondition) —
// that remains an unrelated, single-tier structural field; these are independently
// rankable Must/Important/Nice priorities, per the 2026 taxonomy.
export const FEATURES_CORE = [];
export const FEATURES_SUGGESTED = [
  'Finished basement', 'Walkout basement', 'First-Floor Primary', 'Primary ensuite',
  'First-floor laundry', 'Home office', 'Central air', 'Fireplace', 'Move-in Ready',
  'Renovation Potential', 'New Construction', 'Guest / In-Law Suite',
].map((label) => ({ label, kind: 'check' }));
// These remain part of the canonical catalog. PriorityBoard combines them with
// the regular suggestion tray so both onboarding and My Search discover the same
// criteria without an additional generic disclosure.
export const FEATURES_SPECIFIC = [];

// "Privacy" exists as two independent criteria (Exterior & Property, and Home Feel) —
// a legitimate distinction (outdoor/yard privacy vs. privacy from neighbors' sightlines
// into the home), but the identical label was confusing. The stored label/key ("Privacy"
// under each category) is intentionally UNCHANGED — renaming it would orphan every
// existing user's already-stored ratings and tiers under the old key. This is a
// display-only override, looked up by "categoryKey:label" wherever a criterion is
// rendered, so it applies uniformly to both new selections and old stored data alike.
const CRITERION_DISPLAY_LABEL_OVERRIDES = {
  'exterior:Privacy': 'Yard Privacy',
  'homeFeel:Privacy': 'Privacy from Neighbors',
  // 2026 onboarding/My Search taxonomy unification — these stored identities predate
  // the finalized Title Case product taxonomy and are shared with Rental/Investment
  // (whose own real canonical identities use different casing — see
  // PURCHASE_LEGACY_LABEL_ALIASES), so the stored label/key is intentionally left
  // exactly as it already is in production; only the displayed text changes.
  'location:Parks nearby': 'Parks Nearby',
  'location:Quiet street': 'Quiet Street',
  'location:Near waterfront': 'Near Waterfront',
  'location:Walkable schools': 'Walkable Schools',
  'features:Finished basement': 'Finished Basement',
  'features:Walkout basement': 'Walkout Basement',
  'features:Primary ensuite': 'Primary Ensuite',
  'features:First-floor laundry': 'First-Floor Laundry',
  'features:Home office': 'Home Office',
  'features:Central air': 'Central Air',
  'exterior:Patio / deck': 'Deck / Patio',
  'exterior:Fenced yard': 'Fenced Yard',
  'exterior:Attached garage': 'Attached Garage',
  'exterior:Detached garage': 'Detached Garage',
  'exterior:Large backyard': 'Large Backyard',
  'exterior:Front porch': 'Front Porch',
};

// Additive catalog metadata. Stored priority identities remain `category:label`;
// this registry classifies those durable identities without migrating or renaming
// any participant documents already in production.
export const EVALUATION_MODE = Object.freeze({ PRE_TOUR: 'pre_tour', TOUR: 'tour' });
export const TOUR_RESPONSE = Object.freeze({ NOT_EVALUATED: 'not_evaluated', NEGATIVE: 'negative', NEUTRAL: 'neutral', POSITIVE: 'positive' });
const ALL_PROPERTY_TYPES = Object.freeze(['apartment', 'house', 'townhome', 'condo', 'multifamily', 'other']);
const ATTACHED_PROPERTY_TYPES = Object.freeze(['apartment', 'condo', 'multifamily']);
const RENTAL_PROPERTY_TYPES = Object.freeze(['apartment']);

const TOUR_CRITERIA = new Set([
  'homeFeel:Overall Condition', 'homeFeel:Layout / Flow', 'homeFeel:Natural Light',
  'homeFeel:Character / Charm', 'homeFeel:Room Sizes', 'homeFeel:Openness / Ceiling Height',
  'homeFeel:Privacy', 'location:Immediate Street / Surroundings', 'exterior:Yard',
  'exterior:Privacy', 'exterior:Exterior Condition',
  'exterior:Curb Appeal', 'exterior:Outdoor Space', 'exterior:Noise Level', 'features:Storage',
]);

const PROPERTY_TYPE_APPLICABILITY = Object.freeze({
  'homeFeel:On-Site Management': ATTACHED_PROPERTY_TYPES,
  'exterior:Fitness Center': ATTACHED_PROPERTY_TYPES,
  'exterior:Elevator': ATTACHED_PROPERTY_TYPES,
  'exterior:Secure Entry': ATTACHED_PROPERTY_TYPES,
  'features:Pets Allowed': RENTAL_PROPERTY_TYPES,
  'features:Utilities Included': RENTAL_PROPERTY_TYPES,
  'features:In-Unit Laundry': ['apartment', 'condo'],
  'exterior:Building Amenities': ATTACHED_PROPERTY_TYPES,
});

export function criterionMetadata(categoryKey, label) {
  const key = `${categoryKey}:${label}`;
  return Object.freeze({
    evaluationMode: TOUR_CRITERIA.has(key) ? EVALUATION_MODE.TOUR : EVALUATION_MODE.PRE_TOUR,
    applicablePropertyTypes: PROPERTY_TYPE_APPLICABILITY[key] || ALL_PROPERTY_TYPES,
  });
}

export function isCriterionApplicable(categoryKey, label, propertyTypes = []) {
  if (!propertyTypes?.length) return true;
  const applicable = criterionMetadata(categoryKey, label).applicablePropertyTypes;
  return propertyTypes.some((type) => applicable.includes(type));
}

export const TOUR_RESPONSE_LABELS = Object.freeze({
  'homeFeel:Natural Light': ['Disappointing', 'Fine', 'Great'],
  'homeFeel:Layout / Flow': ["Doesn't work", 'Could work', 'Love it'],
  'homeFeel:Overall Condition': ['More work than expected', 'About what I expected', 'Better than expected'],
  'homeFeel:Character / Charm': ['Missing it', 'Some', 'Lots of character'],
  'homeFeel:Room Sizes': ['Feels too tight', 'Works', 'Feels spacious'],
  'features:Storage': ['Not enough', 'Probably enough', 'Plenty'],
  'exterior:Noise Level': ['Too noisy', 'Noticeable', 'Comfortable'],
  'exterior:Curb Appeal': ['Not for me', 'Fine', 'Love it'],
  'homeFeel:Privacy': ['Not private enough', 'Fine', 'Very private'],
  'exterior:Privacy': ['Not private enough', 'Fine', 'Very private'],
  'exterior:Outdoor Space': ["Doesn't work for me", 'Works', 'Love it'],
  'exterior:Yard': ["Doesn't work for me", 'Works', 'Love it'],
  'location:Immediate Street / Surroundings': ['Concern', 'Fine', 'Love it'],
});

export function tourResponseOptions(categoryKey, label) {
  const labels = TOUR_RESPONSE_LABELS[`${categoryKey}:${label}`] || ['Not for me', 'Fine', 'Great'];
  return [TOUR_RESPONSE.NEGATIVE, TOUR_RESPONSE.NEUTRAL, TOUR_RESPONSE.POSITIVE]
    .map((value, index) => ({ value, label: labels[index] }));
}

export function tourResponseLabel(categoryKey, label, value) {
  return tourResponseOptions(categoryKey, label).find((option) => option.value === value)?.label || null;
}

export function criterionDisplayLabel(categoryKey, label) {
  return CRITERION_DISPLAY_LABEL_OVERRIDES[`${categoryKey}:${label}`] || label;
}

// Historical built-ins remain untouched in saved priority JSON, but no longer
// appear as active purchase-search criteria or contribute Unknowns. An item the
// buyer explicitly created carries `source: 'custom'` and is always preserved.
// 'features:Guest / In-Law Suite' was previously retired here but is restored as the
// canonical Guest / In-Law Suite identity in the 2026 taxonomy unification (it had been
// wrongly retired in favor of nothing — onboarding kept offering it as a dead selection
// that never counted toward Match; see FEATURES_SUGGESTED and
// PURCHASE_LEGACY_LABEL_ALIASES). Restoring it here means anyone who already selected it
// starts counting toward Match again — a restoration of their original intent, not a
// change to their stored choice.
const RETIRED_PURCHASE_BUILT_INS = new Set([
  'location:Neighborhood', 'location:Walkability', 'location:Immediate Street / Surroundings',
  'location:Dog Parks Nearby', 'location:Restaurants / Coffee / Shopping Nearby',
  'homeFeel:Overall Condition', 'homeFeel:Layout / Flow', 'homeFeel:Natural Light',
  'homeFeel:Character / Charm', 'homeFeel:Room Sizes', 'homeFeel:Openness / Ceiling Height',
  'homeFeel:Privacy', 'homeFeel:Social Community', 'homeFeel:On-Site Management',
  'exterior:Yard', 'exterior:Garage', 'exterior:Privacy', 'exterior:Sidewalks',
  'exterior:Exterior Condition', 'exterior:Curb Appeal', 'exterior:Outdoor Space',
  'exterior:Noise Level', 'exterior:Driveway / Off-Street Parking', 'exterior:Fitness Center',
  'exterior:Secure Entry', 'exterior:Elevator', 'features:Basement', 'features:Mudroom',
  'features:Pantry', 'features:Storage', 'features:Updated Kitchen', 'features:Updated Bathrooms',
  'features:Walk-In Closet', 'features:Additional Living Space', 'features:Hardwood Floors',
  'features:Dishwasher', 'features:In-Unit Laundry', 'features:Updated Interior',
  'features:Pets Allowed', 'features:Utilities Included',
  'features:Basement Bedroom',
]);

export function isRetiredPurchaseBuiltIn(categoryKey, item, searchType) {
  return normalizeSearchIntent(searchType) === 'purchase'
    && item?.source !== 'custom'
    && RETIRED_PURCHASE_BUILT_INS.has(`${categoryKey}:${item?.label}`);
}

// 2026 onboarding/My Search taxonomy unification — root cause of the "duplicate Home
// Office", "duplicate Fenced Yard", and similar bugs this pass fixes: onboarding and
// My Search's canonical catalog (getItemlistCategories) had drifted into separate,
// differently-cased label sets for the same purchase concept (e.g. onboarding wrote
// "Home Office", the canonical catalog uses "Home office"), so a buyer who touched both
// screens ended up with two independent stored priorities for one idea. These pairs are
// exactly the ones already confirmed identical in meaning (not a guess — "Home Office"
// vs "Home office" is a casing accident, not a semantic question). Deliberately scoped
// to purchase only: several of these exact Title Case strings ARE the real, unrelated
// canonical identity for Rental/Investment (see LEGACY_FEATURES/LEGACY_EXTERIOR) and
// must never be folded there.
//
// This folds in memory, inside normalizePriorities, the moment an existing search's
// priorities are read — never via a bulk SQL migration. The very next explicit save
// (any patch at all) persists the already-folded, canonical-only shape back to the
// database, so the fix propagates naturally without a destructive rewrite of live rows.
// If both the legacy and canonical label were already independently selected, the
// canonical label's own tier wins and the legacy entry is dropped (never silently
// overwriting an explicit canonical choice with a stale legacy one).
const PURCHASE_LEGACY_LABEL_ALIASES = {
  location: { 'Parks Nearby': 'Parks nearby' },
  features: {
    'Home Office': 'Home office', 'Central Air': 'Central air', 'Primary Ensuite': 'Primary ensuite',
    'First-Floor Laundry': 'First-floor laundry', 'Guest suite': 'Guest / In-Law Suite',
  },
  exterior: { 'Fenced Yard': 'Fenced yard', 'Patio / Deck / Outdoor Living': 'Patio / deck' },
};

// Every purchase category's coreItems is always empty (see LOCATION_CORE/
// FEATURES_CORE/EXTERIOR_CORE) — every canonical item, including alias targets,
// is a "suggested" item that only renders as a selected priority once it has
// been promoted into customItems (exactly what selectPriorityItem does for a
// normal selection). Folding a tier onto a canonical label must do the same
// promotion, or the fold would leave a tier set with nothing on the board to
// show for it.
const PURCHASE_CATEGORY_CORE_LABELS = {
  location: new Set(LOCATION_CORE.map((item) => item.label)),
  features: new Set(FEATURES_CORE.map((item) => item.label)),
  exterior: new Set(EXTERIOR_CORE.map((item) => item.label)),
};

function foldLegacyLabelAliasesInCategory(catState, aliases, coreLabels) {
  const legacyLabels = Object.keys(aliases).filter((label) => catState?.tiers && Object.hasOwn(catState.tiers, label));
  if (!legacyLabels.length) return catState;
  const tiers = { ...catState.tiers };
  const customItems = (catState.customItems || []).slice();
  legacyLabels.forEach((legacyLabel) => {
    const canonicalLabel = aliases[legacyLabel];
    const legacyTier = tiers[legacyLabel];
    const canonicalTier = tiers[canonicalLabel];
    if (!canonicalTier || canonicalTier === 'dontcare') tiers[canonicalLabel] = legacyTier;
    delete tiers[legacyLabel];
    const customIndex = customItems.findIndex((entry) => entry.label === legacyLabel);
    const legacyKind = customIndex !== -1 ? customItems[customIndex].kind : 'check';
    if (customIndex !== -1) customItems.splice(customIndex, 1);
    const alreadyRenderable = coreLabels.has(canonicalLabel) || customItems.some((entry) => entry.label === canonicalLabel);
    if (!alreadyRenderable) customItems.push({ label: canonicalLabel, kind: legacyKind });
  });
  return { ...catState, tiers, customItems };
}

function foldLegacyLabelAliases(priorities) {
  if (normalizeSearchIntent(priorities.searchType) !== 'purchase') return priorities;
  let next = priorities;
  Object.entries(PURCHASE_LEGACY_LABEL_ALIASES).forEach(([categoryKey, aliases]) => {
    const folded = foldLegacyLabelAliasesInCategory(next[categoryKey], aliases, PURCHASE_CATEGORY_CORE_LABELS[categoryKey]);
    if (folded !== next[categoryKey]) next = { ...next, [categoryKey]: folded };
  });
  return next;
}

// The per-home analog of the fold above — a check-kind fact (Yes/No/Unknown) is stored
// on the home under the same `category:label` identity used for the search's priority.
// Read-only and additive: never writes the alias back, so an already-recorded fact under
// the legacy key stays visible (falls back to it only when the canonical key itself is
// unset) without ever overwriting an explicit canonical-key answer. Used wherever a
// home's checks are read for Match or for the Edit Home tri-state control.
export function foldLegacyCheckAliases(checks, searchType) {
  if (!checks || normalizeSearchIntent(searchType) !== 'purchase') return checks || {};
  let folded = null;
  Object.entries(PURCHASE_LEGACY_LABEL_ALIASES).forEach(([categoryKey, aliases]) => {
    Object.entries(aliases).forEach(([legacyLabel, canonicalLabel]) => {
      const canonicalKey = `${categoryKey}:${canonicalLabel}`;
      const legacyKey = `${categoryKey}:${legacyLabel}`;
      if (checks[canonicalKey] === undefined && checks[legacyKey] !== undefined) {
        folded = folded || { ...checks };
        folded[canonicalKey] = checks[legacyKey];
      }
    });
  });
  return folded || checks;
}

// Which selected criteria are genuinely experiential — things a person can only really
// judge by being in the home, as opposed to a fact the property already has (Garage),
// a category preference (Home Condition), or a context/lifestyle priority that simply
// isn't automatable yet (Schools, Commute, Walkability, Parks, etc.). This is the ONE
// place this classification lives — Onboarding, My Search, and Post-Tour all read from
// here rather than each keeping their own list, so a change here never goes stale in
// one surface while being fixed in another.
export function isExperientialCriterion(categoryKey, label) {
  return criterionMetadata(categoryKey, label).evaluationMode === EVALUATION_MODE.TOUR;
}

// Schools relevance gate (Phase 6). 'no' means the user explicitly said
// schools don't factor into their decision. This deliberately does NOT touch
// the underlying stored tier or preference note anywhere — it only
// determines whether Schools counts as "selected" for Match/display purposes
// right now. Flipping relevance back to 'yes' instantly restores whatever
// tier/note was already stored, since nothing is ever overwritten by this
// check. Absence of this field (every existing search created before this
// gate existed) means "not answered yet" — current behavior is preserved
// exactly, never silently treated as "no."
export function isSchoolsSuppressed(priorities) {
  return priorities?.location?.schoolsRelevance === 'no';
}

// Applies the Schools relevance override to a single criterion's tier
// without touching storage — used at every place a criterion's tier is read
// for "is this an active selected priority right now" purposes (computeMatch,
// selectedOrderedItems, My Search's priority pooling), so the suppression is
// defined once and reused everywhere rather than re-implemented per caller.
export function effectiveTier(categoryKey, label, priorities, rawTier) {
  if (categoryKey === 'location' && label === 'Schools' && isSchoolsSuppressed(priorities)) return 'dontcare';
  return rawTier || 'dontcare';
}

const LEGACY_FEATURES = ['Basement', 'Fireplace', 'Primary Ensuite', 'Central Air', 'Home Office', 'Finished Basement', 'Walkout Basement', 'First-Floor Laundry', 'Mudroom', 'Pantry', 'Storage', 'Updated Kitchen', 'Updated Bathrooms', 'Walk-In Closet', 'Additional Living Space', 'Hardwood Floors', 'Dishwasher', 'In-Unit Laundry', 'Updated Interior', 'Pets Allowed', 'Utilities Included'].map((label) => ({ label, kind: label === 'Storage' ? 'rating' : 'check' }));
const LEGACY_LOCATION = ['Walkability', 'Immediate Street / Surroundings', 'Parks Nearby', 'Dog Parks Nearby', 'Groceries Nearby', 'Restaurants / Coffee / Shopping Nearby'].map((label) => ({ label, kind: 'rating' }));
const LEGACY_EXTERIOR = [{ label: 'Yard', kind: 'rating' }, { label: 'Garage', kind: 'check' }, { label: 'Privacy', kind: 'rating' }, { label: 'Fenced Yard', kind: 'check' }, { label: 'Sidewalks', kind: 'check' }, { label: 'Exterior Condition', kind: 'rating' }, { label: 'Landscaping', kind: 'rating' }, { label: 'Curb Appeal', kind: 'rating' }, { label: 'Outdoor Space', kind: 'rating' }, { label: 'Noise Level', kind: 'rating' }, { label: 'Patio / Deck / Outdoor Living', kind: 'check' }, { label: 'Attached Garage', kind: 'check' }, { label: 'Driveway / Off-Street Parking', kind: 'check' }, { label: 'Pool', kind: 'check' }, { label: 'Fitness Center', kind: 'check' }, { label: 'Secure Entry', kind: 'check' }, { label: 'Elevator', kind: 'check' }];
const RENTAL_FEATURES = LEGACY_FEATURES;
const RENTAL_EXTERIOR = [
  { label: 'Parking', kind: 'check' }, { label: 'Garage', kind: 'check' },
  { label: 'Driveway / Off-Street Parking', kind: 'check' }, { label: 'Fenced Yard', kind: 'check' },
  { label: 'Outdoor Space', kind: 'rating' }, { label: 'Patio / Deck / Outdoor Living', kind: 'check' },
  { label: 'Privacy', kind: 'rating' }, { label: 'Elevator', kind: 'check' },
  { label: 'Building Amenities', kind: 'check' }, { label: 'Noise Level', kind: 'rating' },
  { label: 'Pool', kind: 'check' }, { label: 'Fitness Center', kind: 'check' },
  { label: 'Secure Entry', kind: 'check' },
];

export const MULTISELECT_CATEGORIES = [
  { key: 'homeLayout', title: 'Home Layout', options: LAYOUT_OPTIONS },
  { key: 'homeCondition', title: 'Home Condition', options: HOME_CONDITION_OPTIONS },
];

// These are presented as sub-preferences nested under Home Layout, not their own major
// section — kept as separate priority entries under the hood, just visually subordinate.
export const SINGLESELECT_CATEGORIES = [
  { key: 'primaryBedroomLocation', title: 'Primary bedroom', options: ['Main Floor', 'Upstairs', 'No Preference'] },
  { key: 'secondaryBedroomLocation', title: 'Secondary bedrooms', options: ['Same Floor', 'Split Between Floors', 'No Preference'] },
];

// Category order per product spec: Location, Home Features, Exterior & Property, Home Feel (last).
// Purchase uses the established catalog, Rental uses one unified suggestion bank,
// and Investment keeps its established additions.
export function getItemlistCategories(searchType) {
  const intent = normalizeSearchIntent(searchType);
  const isRental = intent === 'rental';
  const isInvestment = intent === 'investment';

  const location = {
    key: 'location', title: 'Location & Surroundings',
    blurb: 'Useful location details that can be established before a tour.',
    coreItems: isInvestment ? [{ label: 'Schools', kind: 'check' }, { label: 'Commute', kind: 'rating' }, { label: 'Neighborhood', kind: 'rating' }] : isRental ? [{ label: 'Neighborhood', kind: 'rating' }] : LOCATION_CORE,
    suggestedItems: [
      ...(intent === 'purchase' ? LOCATION_SUGGESTED : LEGACY_LOCATION),
      ...(isInvestment ? [{ label: 'Proximity to Family / Friends', kind: 'rating' }] : []),
      ...(isInvestment ? [{ label: 'Tenant Appeal', kind: 'rating' }] : []),
    ],
    defaultCustomKind: 'rating',
  };

  const features = isRental
    ? {
        key: 'features', title: 'Home Features', blurb: "Specific things the home either has or doesn't.",
        coreItems: [], suggestedItems: RENTAL_FEATURES, specificItems: FEATURES_SPECIFIC, defaultCustomKind: 'check',
      }
    : {
        key: 'features', title: 'Home Features', blurb: "Specific things the home either has or doesn't.",
        coreItems: isInvestment ? LEGACY_FEATURES.slice(0, 3) : FEATURES_CORE,
        suggestedItems: [
          ...(isInvestment ? LEGACY_FEATURES.slice(3) : FEATURES_SUGGESTED),
          ...(isInvestment ? [{ label: 'Separate Utilities', kind: 'check' }, { label: 'Unit Configuration', kind: 'check' }] : []),
        ],
        specificItems: isInvestment ? [] : FEATURES_SPECIFIC,
        defaultCustomKind: 'check',
      };

  const exterior = isRental
    ? {
        key: 'exterior', title: 'Exterior & Building', blurb: 'Parking, outdoor space, and how the building feels.',
        coreItems: [], suggestedItems: RENTAL_EXTERIOR, defaultCustomKind: 'check',
      }
    : {
        key: 'exterior', title: 'Exterior & Property', blurb: 'The yard, parking, and outdoor spaces.',
        coreItems: isInvestment ? LEGACY_EXTERIOR.slice(0, 3) : EXTERIOR_CORE,
        suggestedItems: [
          ...(isInvestment ? LEGACY_EXTERIOR.slice(3) : EXTERIOR_SUGGESTED),
          ...(isInvestment ? [{ label: 'Parking', kind: 'check' }] : []),
        ],
        defaultCustomKind: 'check',
      };

  const homeFeel = {
    key: 'homeFeel', title: 'Home Feel',
    blurb: "Some things can't really be known from a listing — we'll remind you to weigh in on these after you tour.",
    coreItems: intent === 'purchase' ? HOME_FEEL_CORE : LEGACY_HOME_FEEL_CORE,
    suggestedItems: [
      ...(intent === 'purchase' ? HOME_FEEL_SUGGESTED : LEGACY_HOME_FEEL_SUGGESTED),
      ...(isInvestment ? [{ label: 'Rental Income Potential', kind: 'rating' }, { label: 'Property Condition', kind: 'rating' }, { label: 'Owner-Occupancy Suitability', kind: 'rating' }] : []),
    ],
    defaultCustomKind: 'rating',
  };

  // Purchase searches intentionally expose only pre-tour, listing-verifiable
  // families. Stored legacy Home Feel priorities remain in the JSON document,
  // but are no longer offered or counted as unfinished pre-tour work.
  return intent === 'purchase' ? [location, features, exterior] : [location, features, exterior, homeFeel];
}

// Toured remains readable as a legacy status, but new writes store tour history in
// touredAt and use status only for current intent. Favorite is an independent flag.
export const STATUS_OPTIONS = ['Saved', 'Want to Tour', 'Toured', 'Archived'];
// Legacy values (from before V1.1) are kept here purely so existing homes still render
// with a sensible color instead of falling back to gray — they're not offered as choices.
export const STATUS_COLOR = {
  'Saved': '#A08868', 'Want to Tour': '#3E6B6F', 'Toured': '#74804F', 'Archived': '#B3A696',
  'Considering': '#A08868', 'Touring': '#3E6B6F', 'Offer made': '#C1592F', 'Under contract': '#74804F', 'Passed': '#B3A696',
};

// Treats the legacy 'Passed' value as equivalent to the new 'Archived' status, so existing
// production homes keep working without a data migration.
export function isArchivedStatus(status) {
  return status === 'Archived' || status === 'Passed';
}

export const TOUR_RATING_KEY = 'tour:overall';

export const TIER_ORDER = ['must', 'important', 'nice', 'dontcare'];
export const TIER_META = {
  must: { label: 'Must have', weight: 4, color: '#C1592F' },
  important: { label: 'Important', weight: 2, color: '#C69245' },
  nice: { label: 'Nice to have', weight: 1, color: '#3E6B6F' },
  dontcare: { label: "Don't care", weight: 0, color: '#9C8F80' },
};
export const TIER_DESCRIPTIONS = Object.freeze({
  must: 'One of your highest priorities.',
  important: 'This should weigh heavily in your Match.',
  nice: 'A bonus, but not a requirement.',
});
// Only these three are offered once a criterion is selected — "don't care" is simply
// what a criterion is when it's never been selected in the first place.
export const SELECTABLE_TIERS = ['nice', 'important', 'must'];
export const DEFAULT_SELECTED_TIER = 'important';

export const SEARCH_TYPE_OPTIONS = CANONICAL_SEARCH_INTENT_OPTIONS;

export const INVESTMENT_LIVING_PLAN_OPTIONS = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
  { key: 'not_sure', label: 'Not sure yet' },
];

export function isRentalType(searchType) {
  return normalizeSearchIntent(searchType) === 'rental';
}

// Apartment renters get a simpler basics set — no layout or lot size questions.
export function isSimpleRentalType(searchType) {
  return normalizeSearchIntent(searchType) === 'rental';
}

// New onboarding distinguishes rented houses and apartments without introducing a
// fourth database intent. This participant-private hint is stored inside the existing
// priorities JSON; older rental documents simply retain the established rental behavior.
export function isApartmentRental(prioritiesOrType) {
  if (prioritiesOrType && typeof prioritiesOrType === 'object') {
    return prioritiesOrType.onboardingSearchType === 'apartment_rent'
      || (normalizeSearchIntent(prioritiesOrType.searchType) === 'rental'
        && prioritiesOrType.preferredPropertyTypes?.values?.length === 1
        && prioritiesOrType.preferredPropertyTypes.values[0] === 'apartment');
  }
  return prioritiesOrType === 'apartment_rent';
}

// Home layout only makes sense for standalone homes — not apartments, not investment
// properties (which may span several layouts/unit types).
export function showsHomeLayout(searchType) {
  return normalizeSearchIntent(searchType) === 'purchase';
}

// Per-key visibility for MULTISELECT_CATEGORIES entries — Home Layout doesn't apply to
// apartments (see showsHomeLayout above). Home Condition's options ("Renovation
// Potential," "Some Updates Needed," etc.) are homeownership-oriented language that
// doesn't fit a rental unit a landlord maintains, so it's hidden for apartments too.
export function showsMultiselectCategory(key, searchType) {
  if (key === 'homeLayout') return showsHomeLayout(searchType);
  if (key === 'homeCondition') return !isSimpleRentalType(searchType);
  return true;
}

export const INVESTMENT_PROPERTY_TYPES = ['Single-Family', 'Duplex', 'Triplex', 'Fourplex', '5+ Units', 'No Preference'];

// Toggles an option in a multi-select array where "No Preference" is exclusive with
// everything else — used for both investment property types and Home Condition.
export function toggleWithNoPreference(cur, opt) {
  if (opt === 'No Preference') return cur.includes('No Preference') && cur.length === 1 ? [] : ['No Preference'];
  const withoutNoPref = cur.filter((x) => x !== 'No Preference');
  return withoutNoPref.includes(opt) ? withoutNoPref.filter((x) => x !== opt) : [...withoutNoPref, opt];
}

export function searchTypeLabel(searchType) {
  return { purchase: 'Purchase', rental: 'Rental', investment: 'Investment Property' }[normalizeSearchIntent(searchType)] || '';
}

export function searchExperienceLabel(priorities) {
  if (priorities?.onboardingSearchType === 'home_buy') return 'Home to buy';
  if (priorities?.onboardingSearchType === 'home_rent') return 'Home to rent';
  if (isApartmentRental(priorities)) return 'Apartment to rent';
  return searchTypeLabel(priorities?.searchType);
}

export function terminology(searchType) {
  const rental = isRentalType(searchType);
  return {
    budgetLabel: rental ? 'Maximum Monthly Price' : 'Maximum Budget',
    priceFieldLabel: rental ? 'Monthly Rent' : 'Asking price',
    pricePlaceholder: rental ? '2,200' : '450,000',
  };
}

// Primary navigation is now deliberately short and workflow-shaped: Homes is where
// everything starts, Want to Tour is the decision workspace (which itself contains
// Favorites/Archived as a progressive secondary nav — see DecisionNav.jsx), and
// Compare is available regardless of tour status. My Search moved to the top utility
// row since it's preferences, not a stage of the shopping workflow.
export const PRIMARY_TABS = [
  { key: 'homes', label: 'Homes', href: '/homes' },
  { key: 'tour', label: 'Want to Tour', href: '/tour' },
  { key: 'compare', label: 'Compare', href: '/compare' },
  { key: 'map', label: 'Map', href: '/map' },
];

// Mobile bottom navigation folds My Search back in as a primary destination
// (desktop keeps it as a header utility instead — see AppShell) and uses
// shorter labels sized for a 5-item tab bar. Desktop's PRIMARY_TABS above is
// untouched by this addition.
export const MOBILE_PRIMARY_TABS = [
  { key: 'homes', label: 'Homes', href: '/homes' },
  { key: 'tour', label: 'Tour', href: '/tour' },
  { key: 'compare', label: 'Compare', href: '/compare' },
  { key: 'map', label: 'Map', href: '/map' },
  { key: 'search', label: 'Search', href: '/search' },
];

export function emptyHome() {
  return {
    id: null,
    propertyName: '', selectedFloorPlanName: '', selectedUnitLabel: '',
    address: '', crossroads: '', listingUrl: '', photoUrl: '',
    price: '', estMonthly: '', sqft: '', beds: '', baths: '', lotSize: '', garageSpaces: '', yearBuilt: '', daysOnMarket: '',
    homeLayout: [], homeCondition: [], primaryBedroomLocation: '', secondaryBedroomLocation: '',
    status: 'Saved', touredAt: null, isFavorite: false, reaction: null, rejectionReason: '',
    ratings: {}, checks: {},
    notes: '', pros: '', cons: '',
    // Auto Enrichment 1.0 — captured from RentCast when available, never user-entered.
    // latitude/longitude are infrastructure for future location features and are not
    // shown anywhere in the UI. hoaFeeMonthly/propertyTaxAnnual/propertyTaxYear are
    // informational only and never contribute to Match.
    latitude: null, longitude: null, coordinateAddressFingerprint: null,
    coordinateStatus: 'unresolved', coordinateSource: null,
    hoaFeeMonthly: null, propertyTaxAnnual: null, propertyTaxYear: null,
    // Property Details free-text — shared, descriptive, user-editable. Distinct
    // from personal preference criteria and from the check-kind Basement criteria
    // (Has/Finished/Walkout/Bedroom, which are personal Yes/No evaluations). These
    // three fields are just "what do I know about this" context, never Match inputs.
    basementNotes: '', schoolsNotes: '', conditionNotes: '',
    // Rental V1 Pass B dormant shared facts. No current control populates these.
    propertyType: null, availableOn: null, petsAllowed: null,
    utilitiesIncluded: null, inUnitLaundry: null,
  };
}

export function defaultPriorities() {
  return {
    searchType: '',
    investmentPropertyTypes: [],
    planningToLiveIn: '',
    preferredPropertyTypes: { values: [], tier: 'important' },
    budget: { value: '', tier: 'important' },
    sqftTarget: { value: '', tier: 'nice' },
    lotSizeTarget: { value: '', tier: 'dontcare' },
    bedsMin: { value: '', tier: 'important' },
    bathsMin: { value: '', tier: 'nice' },
    homeLayout: { values: [], tier: 'dontcare' },
    homeCondition: { values: [], tier: 'dontcare' },
    primaryBedroomLocation: { value: '', tier: 'dontcare' },
    secondaryBedroomLocation: { value: '', tier: 'dontcare' },
    location: { customItems: [], tiers: {}, order: [], hiddenCore: [], commuteDestinations: [] },
    homeFeel: { customItems: [], tiers: {}, order: [], hiddenCore: [] },
    exterior: { customItems: [], tiers: {}, order: [], hiddenCore: [] },
    features: { customItems: [], tiers: {}, order: [], hiddenCore: [] },
  };
}

// Guarantees every key MySearchPanel/CriteriaPicker directly read (e.g. `p.budget.value`,
// not `p.budget?.value`) actually exists, without ever discarding real stored data. Handles:
// `raw` being null/undefined entirely (e.g. a search row whose `priorities` column was
// never populated), and `raw` being a real but partial/older-shaped object (e.g. missing a
// key added after that record was first created). Only fills gaps — any value present in
// `raw`, at any depth, is always preserved as-is.
export function normalizePriorities(raw) {
  const base = defaultPriorities();
  if (!raw || typeof raw !== 'object') return base;

  const merged = { ...base, ...raw };
  const shapedKeys = [
    'budget', 'sqftTarget', 'lotSizeTarget', 'bedsMin', 'bathsMin',
    'homeLayout', 'homeCondition', 'primaryBedroomLocation', 'secondaryBedroomLocation', 'preferredPropertyTypes',
    'location', 'homeFeel', 'exterior', 'features',
  ];
  shapedKeys.forEach((key) => {
    // Excluding arrays here matters: typeof [] === 'object' in JS, so a stray
    // array value (e.g. an older/malformed stored shape) would otherwise get
    // spread as index-keyed properties (`{0: 'x', 1: 'y'}`) onto the correct
    // base shape instead of being safely discarded.
    const isPlainObject = raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]);
    merged[key] = { ...base[key], ...(isPlainObject ? raw[key] : {}) };
  });
  // Extra guarantee for the two multiselect-shaped keys specifically: `.values`
  // must always be a real array by the time any component reads it, regardless
  // of what shape might be sitting in older/malformed stored priorities data.
  // This is the correct place to close a class of "undefined.includes()"
  // crash — once guaranteed here, no consumer (Onboarding, My Search, Add/Edit
  // Home) needs its own defensive check for this specific failure mode.
  ['homeLayout', 'homeCondition', 'preferredPropertyTypes'].forEach((key) => {
    if (!Array.isArray(merged[key].values)) merged[key] = { ...merged[key], values: [] };
  });
  return foldLegacyLabelAliases(merged);
}
