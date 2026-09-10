import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSearchTypeForWrite,
  normalizeSearchIntent,
  PURCHASE_PROPERTY_TYPE_OPTIONS,
  RENTAL_PROPERTY_TYPE_OPTIONS,
  searchIntentCapabilities,
} from '../src/lib/searchIntent.js';
import {
  defaultPriorities,
  getItemlistCategories,
  isRentalType,
  isSimpleRentalType,
  normalizePriorities,
  searchTypeLabel,
  showsHomeLayout,
  showsMultiselectCategory,
  terminology,
} from '../src/lib/constants.js';
import { computeMatch, parseListingText } from '../src/lib/matching.js';

const legacyTypes = ['buy', 'rent_home', 'rent_apartment', 'investment'];

test('normalizes the exact legacy and canonical intent map', () => {
  const expected = {
    buy: 'purchase', purchase: 'purchase',
    rent_home: 'rental', rent_apartment: 'rental', rental: 'rental',
    investment: 'investment',
  };
  for (const [raw, canonical] of Object.entries(expected)) {
    assert.equal(normalizeSearchIntent(raw), canonical);
    assert.equal(canonicalSearchTypeForWrite(raw), canonical);
  }
});

test('unknown and malformed intent values fail closed', () => {
  for (const raw of [null, undefined, '', ' ', 'BUY', 'rent', 'unknown', 0, false, {}, []]) {
    assert.equal(normalizeSearchIntent(raw), null);
    assert.equal(canonicalSearchTypeForWrite(raw), null);
    assert.deepEqual(searchIntentCapabilities(raw), {
      intent: null,
      isPurchase: false,
      isRental: false,
      isInvestment: false,
      showsRentalFacts: false,
      showsPurchaseFinancials: false,
      preferredPropertyTypeOptions: [],
    });
  }
});

test('capabilities describe canonical behavior without activating product UI', () => {
  assert.deepEqual(searchIntentCapabilities('buy'), {
    intent: 'purchase', isPurchase: true, isRental: false, isInvestment: false,
    showsRentalFacts: false, showsPurchaseFinancials: true,
    preferredPropertyTypeOptions: PURCHASE_PROPERTY_TYPE_OPTIONS,
  });
  assert.deepEqual(searchIntentCapabilities('rental'), {
    intent: 'rental', isPurchase: false, isRental: true, isInvestment: false,
    showsRentalFacts: true, showsPurchaseFinancials: false,
    preferredPropertyTypeOptions: RENTAL_PROPERTY_TYPE_OPTIONS,
  });
  assert.deepEqual(searchIntentCapabilities('investment'), {
    intent: 'investment', isPurchase: false, isRental: false, isInvestment: true,
    showsRentalFacts: false, showsPurchaseFinancials: true,
    preferredPropertyTypeOptions: [],
  });
});

test('legacy UI helpers now present canonical intent behavior without mutating raw values', () => {
  const expected = {
    buy: ['Purchase', false, false, true, true, true, 'Maximum Budget', 'Asking price', '450,000'],
    rent_home: ['Rental', true, true, false, false, false, 'Maximum Monthly Price', 'Monthly Rent', '2,200'],
    rent_apartment: ['Rental', true, true, false, false, false, 'Maximum Monthly Price', 'Monthly Rent', '2,200'],
    investment: ['Investment Property', false, false, false, false, true, 'Maximum Budget', 'Asking price', '450,000'],
  };
  for (const type of legacyTypes) {
    const term = terminology(type);
    assert.deepEqual([
      searchTypeLabel(type), isRentalType(type), isSimpleRentalType(type),
      showsHomeLayout(type), showsMultiselectCategory('homeLayout', type),
      showsMultiselectCategory('homeCondition', type), term.budgetLabel,
      term.priceFieldLabel, term.pricePlaceholder,
    ], expected[type]);
    assert.equal(showsMultiselectCategory('futureCategory', type), true);
  }

  assert.equal(searchTypeLabel('rental'), 'Rental');
  assert.equal(isRentalType('rental'), true);
  assert.equal(showsHomeLayout('purchase'), true);
  assert.notDeepEqual(terminology('rental'), terminology(''));
});

test('legacy rental values resolve the unified canonical catalog while Investment remains unchanged', () => {
  const labels = (type, key, part) => getItemlistCategories(type)
    .find((category) => category.key === key)[part].map((item) => item.label);

  assert.deepEqual(getItemlistCategories('rent_apartment'), getItemlistCategories('rental'));
  assert.deepEqual(getItemlistCategories('rent_home'), getItemlistCategories('rental'));
  assert.ok(labels('rental', 'features', 'suggestedItems').includes('In-Unit Laundry'));
  assert.ok(!labels('rental', 'features', 'suggestedItems').includes('Pet Policy'));
  assert.ok(!labels('rental', 'homeFeel', 'suggestedItems').includes('Lease Terms'));
  assert.ok(labels('investment', 'location', 'suggestedItems').includes('Tenant Appeal'));
  assert.ok(labels('investment', 'features', 'suggestedItems').includes('Unit Configuration'));
  assert.ok(!labels('buy', 'features', 'suggestedItems').includes('Pet Policy'));
  for (const type of legacyTypes) {
    assert.deepEqual(getItemlistCategories(type).map(({ key }) => key), ['location', 'features', 'exterior', 'homeFeel']);
  }
});

test('defaults include an optional private property preference', () => {
  const priorities = defaultPriorities();
  assert.equal(priorities.searchType, '');
  assert.deepEqual(priorities.preferredPropertyTypes, { values: [], tier: 'important' });
});

test('normalization preserves complete legacy documents without mutation', () => {
  for (const searchType of ['rent_home', 'rent_apartment']) {
    const raw = {
      searchType,
      budget: { value: '2400', tier: 'must', legacyBudgetFlag: true },
      location: {
        customItems: [{ label: 'Near train', kind: 'rating', customMetadata: 7 }],
        tiers: { Schools: 'nice', 'Near train': 'must' },
        order: ['Near train', 'Schools'], hiddenCore: ['Commute'],
        commuteDestinations: [{ id: 'office', label: 'Office' }],
        schoolsRelevance: 'yes', unknownNested: { retained: true },
      },
      features: {
        customItems: [{ label: searchType === 'rent_home' ? 'Pet Policy' : 'Utilities Included', kind: 'check' }],
        tiers: { [searchType === 'rent_home' ? 'Pet Policy' : 'Utilities Included']: 'must' },
        order: [searchType === 'rent_home' ? 'Pet Policy' : 'Utilities Included'],
        hiddenCore: ['Fireplace'],
      },
      unknownTopLevel: { fromProduction: true },
    };
    const before = structuredClone(raw);
    assert.equal(normalizeSearchIntent(raw.searchType), 'rental');
    assert.deepEqual(raw, before);

    const normalized = normalizePriorities(raw);
    assert.deepEqual(raw, before);
    assert.equal(normalized.searchType, searchType);
    assert.deepEqual(normalized.unknownTopLevel, { fromProduction: true });
    assert.deepEqual(normalized.location.unknownNested, { retained: true });
    assert.deepEqual(normalized.location.customItems, raw.location.customItems);
    assert.deepEqual(normalized.features.customItems, raw.features.customItems);
    assert.notStrictEqual(normalized, raw);
    assert.notStrictEqual(normalized.location, raw.location);
  }
});

test('current Match result is search-type independent for the same selected facts', () => {
  const results = legacyTypes.map((searchType) => {
    const priorities = normalizePriorities({
      searchType,
      budget: { value: '500000', tier: 'must' },
      bedsMin: { value: '3', tier: 'important' },
    });
    return computeMatch({ price: '450000', beds: '2', checks: {}, ratings: {} }, priorities);
  });
  for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
  assert.equal(results[0].pct, 89);
  assert.deepEqual(results[0].satisfied.map(({ key }) => key), ['budget']);
  assert.deepEqual(results[0].missing.map(({ key }) => key), ['beds']);
});

test('current listing parser behavior remains search-intent agnostic', () => {
  const text = '123 Main St\n$2,200/mo\n3 beds 2 baths\n1,250 sqft\nBuilt in 1998\nhttps://example.com/listing';
  const expected = {
    // Current parser also captures a truncated purchase price from rent text.
    // This known Rental behavior is characterized, not fixed, in Pass A.
    price: '220', estMonthly: '2200', beds: '3', baths: '2', sqft: '1250', yearBuilt: '1998',
    address: '123 Main St', listingUrl: 'https://example.com/listing',
  };
  for (const _searchType of legacyTypes) assert.deepEqual(parseListingText(text), expected);
});
