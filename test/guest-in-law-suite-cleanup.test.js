import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getItemlistCategories, normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { ONBOARDING_SUGGESTIONS } from '../src/lib/onboarding.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const labelsFor = (searchType, isApartment, categoryKey) =>
  getItemlistCategories(searchType, { isApartment }).find((c) => c.key === categoryKey).suggestedItems.map((i) => i.label);

test('Home to Buy exposes Guest Bedroom and not Guest / In-Law Suite', () => {
  const features = labelsFor('purchase', false, 'features');
  assert.ok(features.includes('Guest Bedroom'));
  assert.ok(!features.includes('Guest / In-Law Suite'));
  const onboardingLabels = ONBOARDING_SUGGESTIONS.home_buy.flatMap(([, items]) => items.map((i) => i.label));
  assert.ok(onboardingLabels.includes('Guest Bedroom'));
  assert.ok(!onboardingLabels.includes('Guest / In-Law Suite'));
});

test('Home to Rent exposes Guest Bedroom and not Guest / In-Law Suite', () => {
  const features = labelsFor('rental', false, 'features');
  assert.ok(features.includes('Guest Bedroom'));
  assert.ok(!features.includes('Guest / In-Law Suite'));
  const onboardingLabels = ONBOARDING_SUGGESTIONS.home_rent.flatMap(([, items]) => items.map((i) => i.label));
  assert.ok(onboardingLabels.includes('Guest Bedroom'));
  assert.ok(!onboardingLabels.includes('Guest / In-Law Suite'));
});

test('My Search / Add Another Priority never offers the removed criterion for Home to Buy or Home to Rent', () => {
  for (const [searchType, isApartment] of [['purchase', false], ['rental', false]]) {
    const all = getItemlistCategories(searchType, { isApartment }).flatMap((c) => [...c.coreItems, ...c.suggestedItems].map((i) => i.label));
    assert.ok(!all.includes('Guest / In-Law Suite'));
  }
  const board = read('src/components/PriorityBoard.jsx');
  // The tray is generically sourced from getItemlistCategories/splitCategoryItems —
  // no separate hardcoded list to also check for the removed label.
  assert.match(board, /getItemlistCategories\(priorities\.searchType/);
});

test('existing "Guest / In-Law Suite" priorities normalize to Guest Bedroom without creating a duplicate row, for both Home to Buy and Home to Rent', () => {
  for (const searchType of ['purchase', 'rental']) {
    const priorities = normalizePriorities({
      searchType,
      features: { tiers: { 'Guest / In-Law Suite': 'must' }, customItems: [{ label: 'Guest / In-Law Suite', kind: 'check' }] },
    });
    assert.equal(priorities.features.tiers['Guest Bedroom'], 'must');
    assert.equal(priorities.features.tiers['Guest / In-Law Suite'], undefined);
    assert.equal(priorities.features.customItems.length, 1);
    assert.equal(priorities.features.customItems[0].label, 'Guest Bedroom');
  }
});

test('a search that already has both Guest Bedroom and Guest / In-Law Suite selected ends up with exactly one Guest Bedroom row, honoring the current explicit choice', () => {
  const priorities = normalizePriorities({
    searchType: 'purchase',
    features: {
      tiers: { 'Guest Bedroom': 'nice', 'Guest / In-Law Suite': 'must' },
      customItems: [{ label: 'Guest Bedroom', kind: 'check' }, { label: 'Guest / In-Law Suite', kind: 'check' }],
    },
  });
  assert.equal(priorities.features.tiers['Guest Bedroom'], 'nice'); // the current explicit selection wins, not the legacy one
  assert.equal(priorities.features.customItems.filter((item) => item.label === 'Guest Bedroom').length, 1);
});

test('Match credit is preserved across the merge — a home fact recorded under the old key still counts toward Guest Bedroom', () => {
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'Guest / In-Law Suite': 'important' } } });
  const match = computeMatch({ checks: { 'features:Guest / In-Law Suite': true } }, priorities);
  const entry = match.allSelected.find((item) => item.key === 'features:Guest Bedroom');
  assert.ok(entry && entry.evaluated && entry.met);
});

test('Apartment to Rent is unaffected — its approved taxonomy never included either Guest Bedroom or Guest / In-Law Suite', () => {
  const apartmentLabels = getItemlistCategories('rental', { isApartment: true }).flatMap((c) => c.suggestedItems.map((i) => i.label));
  assert.ok(!apartmentLabels.includes('Guest Bedroom'));
  assert.ok(!apartmentLabels.includes('Guest / In-Law Suite'));
  const onboardingLabels = ONBOARDING_SUGGESTIONS.apartment_rent.flatMap(([, items]) => items.map((i) => i.label));
  assert.ok(!onboardingLabels.includes('Guest Bedroom'));
  assert.ok(!onboardingLabels.includes('Guest / In-Law Suite'));
  // The Home-to-Rent-only fold never fires for an apartment search.
  const apartmentPriorities = normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent', features: { tiers: { 'Guest / In-Law Suite': 'important' } } });
  assert.equal(apartmentPriorities.features.tiers['Guest / In-Law Suite'], 'important');
  assert.equal(apartmentPriorities.features.tiers['Guest Bedroom'], undefined);
});
