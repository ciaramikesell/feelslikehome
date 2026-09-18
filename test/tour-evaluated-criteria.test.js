import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  criterionMetadata, EVALUATION_MODE, isCriterionApplicable, TOUR_RESPONSE,
  tourResponseLabel, getItemlistCategories, normalizePriorities,
} from '../src/lib/constants.js';
import { computeMatch, selectedSubjectiveCriteria } from '../src/lib/matching.js';

const prioritiesWith = (tier = 'must') => normalizePriorities({
  searchType: 'purchase', preferredPropertyTypes: { values: ['house'], tier: 'important' },
  homeFeel: { tiers: { 'Natural Light': tier }, customItems: [{ label: 'Natural Light', kind: 'rating' }] },
});

test('catalog metadata distinguishes tour criteria and canonical property applicability', () => {
  assert.equal(criterionMetadata('homeFeel', 'Natural Light').evaluationMode, EVALUATION_MODE.TOUR);
  assert.equal(criterionMetadata('features', 'Fireplace').evaluationMode, EVALUATION_MODE.PRE_TOUR);
  for (const label of ['On-Site Management', 'Fitness Center', 'Elevator', 'Secure Entry']) {
    const category = label === 'On-Site Management' ? 'homeFeel' : 'exterior';
    assert.equal(isCriterionApplicable(category, label, ['house']), false);
    assert.equal(isCriterionApplicable(category, label, ['condo']), true);
  }
  assert.equal(isCriterionApplicable('features', 'Utilities Included', ['house']), false);
  assert.equal(isCriterionApplicable('features', 'Utilities Included', ['apartment']), true);
});

test('tour criteria retain ordinary Must, Important, and Nice tiers', () => {
  for (const tier of ['must', 'important', 'nice']) {
    assert.equal(computeMatch({ ratings: {} }, prioritiesWith(tier)).allSelected.find((x) => x.key === 'homeFeel:Natural Light').tier, tier);
  }
});

test('unanswered tour Must Have is Unknown and not missing', () => {
  const match = computeMatch({ propertyType: 'house', ratings: {} }, prioritiesWith());
  const light = match.allSelected.find((x) => x.key === 'homeFeel:Natural Light');
  assert.equal(light.evaluated, false);
  assert.equal(light.met, null);
  assert.equal(match.mustEvaluated, 0);
  assert.equal(match.mustMet, 0);
});

test('semantic positive and negative responses resolve without persisting UI copy', () => {
  const positive = computeMatch({ propertyType: 'house', ratings: { 'homeFeel:Natural Light': TOUR_RESPONSE.POSITIVE } }, prioritiesWith());
  const negative = computeMatch({ propertyType: 'house', ratings: { 'homeFeel:Natural Light': TOUR_RESPONSE.NEGATIVE } }, prioritiesWith());
  assert.equal(positive.allSelected.find((x) => x.key.endsWith('Natural Light')).met, true);
  assert.equal(negative.allSelected.find((x) => x.key.endsWith('Natural Light')).met, false);
  assert.equal(tourResponseLabel('homeFeel', 'Natural Light', TOUR_RESPONSE.POSITIVE), 'Great');
});

test('neutral is evaluated but neither No nor part of the score denominator', () => {
  const match = computeMatch({ propertyType: 'house', ratings: { 'homeFeel:Natural Light': TOUR_RESPONSE.NEUTRAL } }, prioritiesWith());
  const light = match.allSelected.find((x) => x.key.endsWith('Natural Light'));
  assert.equal(light.evaluated, true);
  assert.equal(light.met, null);
  assert.equal(light.score, null);
  assert.equal(match.mustMet, 0);
  assert.equal(match.pct, 100, 'only the known preferred property type is scored');
});

test('current active criteria dynamically control unresolved counts and removed criteria contribution', () => {
  const oldHome = { propertyType: 'house', ratings: { 'homeFeel:Natural Light': TOUR_RESPONSE.POSITIVE } };
  assert.equal(computeMatch(oldHome, prioritiesWith()).allSelected.some((x) => x.key.endsWith('Natural Light')), true);
  const removed = prioritiesWith(); removed.homeFeel.tiers['Natural Light'] = 'dontcare';
  assert.equal(computeMatch(oldHome, removed).allSelected.some((x) => x.key.endsWith('Natural Light')), false);
  const added = prioritiesWith(); added.homeFeel.tiers.Privacy = 'important'; added.homeFeel.customItems.push({ label: 'Privacy', kind: 'rating' });
  assert.equal(computeMatch(oldHome, added).allSelected.find((x) => x.key === 'homeFeel:Privacy').evaluated, false);
});

test('legacy selected criteria survive catalog filtering and structured parameters are not picker items', () => {
  const p = prioritiesWith();
  p.homeFeel.tiers['On-Site Management'] = 'important';
  p.homeFeel.customItems.push({ label: 'On-Site Management', kind: 'rating' });
  assert.ok(computeMatch({ ratings: {} }, p).allSelected.some((x) => x.key === 'homeFeel:On-Site Management'));
  const labels = getItemlistCategories('purchase').flatMap((c) => [...c.coreItems, ...c.suggestedItems].map((i) => i.label.toLowerCase()));
  for (const duplicate of ['budget', 'bedrooms', 'bathrooms', 'square footage', 'lot size', 'property type']) assert.ok(!labels.includes(duplicate));
});

test('Record Your Take is active-tour-only, semantic, accessible, and participant persistence is caller-owned', () => {
  const modal = readFileSync(new URL('../src/components/PostTourModal.jsx', import.meta.url), 'utf8');
  const collaboration = readFileSync(new URL('../src/lib/supabase/collaboration.js', import.meta.url), 'utf8');
  assert.match(modal, /selectedSubjectiveCriteria\(priorities\)/);
  assert.doesNotMatch(modal, /curatedAdditionalSubjectiveCriteria/);
  assert.match(modal, /role="radiogroup"/);
  assert.match(modal, /type="radio"/);
  assert.match(collaboration, /user_id: userId/);
  assert.match(collaboration, /from\('home_member_state'\)\.upsert/);
});

test('Realtor view cannot open or author Record Your Take', () => {
  const detail = readFileSync(new URL('../src/components/HomeDetail.jsx', import.meta.url), 'utf8');
  assert.match(detail, /!readOnly && <button[^>]*hh-detail-take-action/);
  assert.match(detail, /!readOnly && reflecting && <PostTourModal/);
});
