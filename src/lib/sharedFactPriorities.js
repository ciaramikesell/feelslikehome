import {
  effectiveTier, getItemlistCategories, isExperientialCriterion, normalizePriorities,
} from './constants';

// Add/Edit Home can only collect facts which already have shared-home storage.
// Keeping this allow-list explicit prevents a newly-added personal/tour criterion
// from accidentally becoming homework for somebody else's co-buyer.
const SHARED_BASIC_FIELDS = {
  budget: 'price', bedsMin: 'beds', bathsMin: 'baths', sqftTarget: 'sqft', lotSizeTarget: 'lotSize',
  homeLayout: 'homeLayout', homeCondition: 'homeCondition',
  primaryBedroomLocation: 'primaryBedroomLocation', secondaryBedroomLocation: 'secondaryBedroomLocation',
};

const SHARED_CRITERION_FIELDS = {
  'exterior:Garage': 'garageSpaces',
  'location:Schools': 'schoolsNotes',
  'features:Basement': 'basementNotes',
  'features:Finished Basement': 'basementNotes',
  'features:Walkout Basement': 'basementNotes',
  'features:Basement Bedroom': 'basementNotes',
  'homeFeel:Overall Condition': 'conditionNotes',
};

function selectedBasic(priorities, key) {
  const item = priorities?.[key];
  if (!item || item.tier === 'dontcare') return false;
  if ('values' in item) return (item.values || []).some((value) => value !== 'No Preference');
  return item.value !== '' && item.value !== null && item.value !== undefined;
}

function sourceMeta(selectedByCurrentUser, selectedByCoBuyer, field, criterionKey) {
  return {
    field, criterionKey, selectedByCurrentUser, selectedByCoBuyer,
    selectedByBoth: selectedByCurrentUser && selectedByCoBuyer,
    eligibleForSharedFactCapture: true,
    coBuyerOnly: !selectedByCurrentUser && selectedByCoBuyer,
  };
}

/**
 * Produces a deliberately tier-free projection for Add/Edit Home. Full co-buyer
 * priority objects stop here; UI receives only selection/source booleans.
 */
export function deriveSharedFactPriorityAwareness(currentRaw, coBuyerRaw = []) {
  const current = normalizePriorities(currentRaw);
  const coBuyers = (coBuyerRaw || []).filter(Boolean).map(normalizePriorities);
  const fields = {};
  const criteria = {};

  Object.entries(SHARED_BASIC_FIELDS).forEach(([key, field]) => {
    const currentSelected = selectedBasic(current, key);
    const coBuyerSelected = coBuyers.some((priorities) => selectedBasic(priorities, key));
    fields[field] = sourceMeta(currentSelected, coBuyerSelected, field, key);
  });

  const searchTypes = new Set([current.searchType, ...coBuyers.map((p) => p.searchType)].filter(Boolean));
  searchTypes.forEach((searchType) => {
    getItemlistCategories(searchType).forEach((category) => {
      [...category.coreItems, ...category.suggestedItems].forEach((item) => {
        const criterionKey = `${category.key}:${item.label}`;
        const field = SHARED_CRITERION_FIELDS[criterionKey];
        if (!field || isExperientialCriterion(category.key, item.label)) return;
        const selected = (priorities) => effectiveTier(
          category.key, item.label, priorities, priorities?.[category.key]?.tiers?.[item.label]
        ) !== 'dontcare';
        const currentSelected = selected(current);
        const coBuyerSelected = coBuyers.some(selected);
        const meta = sourceMeta(currentSelected, coBuyerSelected, field, criterionKey);
        criteria[criterionKey] = meta;
        // Several basement criteria intentionally share one descriptive fact field.
        const previous = fields[field];
        fields[field] = previous
          ? sourceMeta(previous.selectedByCurrentUser || currentSelected, previous.selectedByCoBuyer || coBuyerSelected, field, previous.criterionKey)
          : meta;
      });
    });
  });

  return {
    hasCoBuyer: coBuyers.length > 0,
    fields,
    criteria,
    sharedFactRelevantPriorities: Object.values(fields).filter((meta) => meta.selectedByCurrentUser || meta.selectedByCoBuyer),
  };
}

