// Onboarding V2: home details move from Step 1 (Basics) to Step 4 (What
// Matters) in the inactive six-step flow. They use the existing grouped
// preferences (homeLayout, homeCondition, preferredPropertyTypes) and the
// existing Garage criterion — no new priority system, no new identifiers.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { applySearchChoice, flatOnboardingSuggestions } from '../src/lib/onboarding.js';
import { CURRENT_ONBOARDING_VERSION, onboardingStepsFor } from '../src/lib/onboardingFlow.js';
import { addCriterion, priorityLevels } from '../src/lib/searchProfile.js';
import {
  groupPriorityItems, isGroupValueSelected, moveGroup, priorityLevelsWithGroups, toggleGroupValue, unrankedGroups, whatMattersGroups,
} from '../src/lib/whatMattersGroups.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const buy = () => applySearchChoice(normalizePriorities({}), 'home_buy');
const choicesOf = (priorities) => Object.fromEntries(whatMattersGroups(priorities).map((group) => [group.key, group.choices.map((choice) => choice.label)]));

test('Step 4 offers the approved home details for buyers, using the existing option values', () => {
  assert.deepEqual(choicesOf(buy()), {
    preferredPropertyTypes: ['House', 'Condo', 'Multifamily'],
    homeLayout: ['Ranch', 'Two Story', 'Other'],
    homeCondition: ['New Construction', 'Move-in Ready', 'Renovation Potential'],
  });
  // Renting a home keeps its existing property types and has no layout/condition; apartments have none.
  assert.deepEqual(Object.keys(choicesOf(applySearchChoice(normalizePriorities({}), 'home_rent'))), ['preferredPropertyTypes']);
  assert.deepEqual(choicesOf(applySearchChoice(normalizePriorities({}), 'apartment_rent')), {});
});

test('no duplicate concepts: Garage is the existing criterion, and condition is never a second features criterion', () => {
  const offered = flatOnboardingSuggestions('home_buy').map((criterion) => `${criterion.categoryKey}:${criterion.label}`);
  assert.equal(offered.filter((key) => key === 'exterior:Garage').length, 1);
  for (const duplicate of ['features:Move-in Ready', 'features:Renovation Potential', 'features:New Construction', 'exterior:Attached garage']) {
    assert.ok(!offered.includes(duplicate), duplicate);
  }
  // Ranking keys never collide with criterion keys.
  let priorities = addCriterion(buy(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' });
  priorities = toggleGroupValue(toggleGroupValue(priorities, 'homeLayout', 'Ranch / Single Story'), 'homeCondition', 'Move-In Ready');
  const keys = priorityLevelsWithGroups(priorities).flatMap((level) => level.items.map((item) => item.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('exterior:Garage') && keys.includes('group:homeLayout') && keys.includes('group:preferredPropertyTypes'));
});

test('choosing options adds alternatives; a new group starts Important and keeps any importance it already had', () => {
  let priorities = buy();
  assert.equal(priorities.homeLayout.tier, 'dontcare');
  priorities = toggleGroupValue(priorities, 'homeLayout', 'Ranch / Single Story');
  priorities = toggleGroupValue(priorities, 'homeLayout', 'Two Story');
  assert.deepEqual(priorities.homeLayout, { values: ['Ranch / Single Story', 'Two Story'], tier: 'important' });
  priorities = moveGroup(priorities, 'homeLayout', 'must');
  priorities = toggleGroupValue(priorities, 'homeLayout', 'Two Story');
  assert.deepEqual(priorities.homeLayout, { values: ['Ranch / Single Story'], tier: 'must' });
  priorities = toggleGroupValue(priorities, 'homeLayout', 'Ranch / Single Story');
  assert.deepEqual(priorities.homeLayout.values, []);
  assert.deepEqual(groupPriorityItems(priorities).map((item) => item.key), ['group:preferredPropertyTypes'], 'an empty group is not ranked');
  // "No Preference" (older data) never mixes with a real choice.
  assert.deepEqual(toggleGroupValue({ ...buy(), homeCondition: { values: ['No Preference'], tier: 'dontcare' } }, 'homeCondition', 'Move-In Ready').homeCondition.values, ['Move-In Ready']);
});

test('multiple property types and layouts are alternatives in Match, never simultaneous requirements', () => {
  let priorities = buy();
  priorities = toggleGroupValue(priorities, 'preferredPropertyTypes', 'condo'); // house is already chosen by "a home to buy"
  priorities = moveGroup(priorities, 'preferredPropertyTypes', 'must');
  priorities = toggleGroupValue(toggleGroupValue(priorities, 'homeLayout', 'Ranch / Single Story'), 'homeLayout', 'Two Story');
  const result = (home) => computeMatch({ beds: '', baths: '', ...home }, priorities);
  const text = (home) => JSON.stringify(result(home));
  assert.match(text({ propertyType: 'condo', homeLayout: ['Two Story'] }), /"key":"preferredPropertyTypes"[^}]*"met":true/);
  assert.match(text({ propertyType: 'house', homeLayout: ['Ranch / Single Story'] }), /"key":"homeLayout"[^}]*"met":true/);
  assert.match(text({ propertyType: 'townhome' }), /"key":"preferredPropertyTypes"[^}]*"met":false/);
  // Unknown is never a miss.
  assert.match(text({}), /"key":"preferredPropertyTypes"[^}]*"evaluated":false/);
  assert.match(text({}), /"key":"homeLayout"[^}]*"evaluated":false/);
});

test('Garage stays Yes / No / Unknown from what is actually known about the home', () => {
  const priorities = addCriterion(buy(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  const text = (home) => JSON.stringify(computeMatch(home, priorities));
  assert.match(text({ garageSpaces: '' }), /"key":"exterior:Garage"[^}]*"evaluated":false/);
  assert.match(text({ garageSpaces: '0' }), /"key":"exterior:Garage"[^}]*"met":false/);
  assert.match(text({ garageSpaces: '2' }), /"key":"exterior:Garage"[^}]*"met":true/);
  // A listing that never mentions a garage leaves it unknown (no inference).
  assert.doesNotMatch(read('src/lib/matching.js'), /garageSpaces\s*=\s*['"]?0['"]?;/);
});

test('earlier Basics answers are kept and shown, but never ranked or scored without the person choosing', () => {
  // As the old Basics stored them: values with no importance.
  const legacy = normalizePriorities({ ...buy(), homeLayout: { values: ['Ranch / Single Story', 'Other'], tier: 'dontcare' }, preferredPropertyTypes: { values: ['house', 'townhome'], tier: 'important' } });
  assert.equal(isGroupValueSelected(legacy, 'homeLayout', 'Ranch / Single Story'), true);
  assert.deepEqual(choicesOf(legacy).homeLayout, ['Ranch', 'Two Story', 'Other']);
  assert.deepEqual(choicesOf(legacy).preferredPropertyTypes, ['House', 'Condo', 'Multifamily', 'Townhome']);
  assert.deepEqual(unrankedGroups(legacy), ['homeLayout']);
  assert.ok(!groupPriorityItems(legacy).some((item) => item.key === 'group:homeLayout'));
  assert.doesNotMatch(JSON.stringify(computeMatch({ homeLayout: ['Two Story'] }, legacy)), /"key":"homeLayout"/);
  // Nothing about the stored shape changes until the person acts.
  assert.deepEqual(normalizePriorities(JSON.parse(JSON.stringify(legacy))).homeLayout, legacy.homeLayout);
});

test('the six-step flow hides home details on Step 1; the live flow keeps them', () => {
  const basics = read('src/components/onboarding/BasicsStep.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(basics, /export default function BasicsStep\(\{ header, priorities, patch, onNext, homeDetails = true \}\)/);
  assert.match(basics, /const showGarage = homeDetails && choice !== 'apartment_rent';/);
  assert.match(basics, /const showDetails = homeDetails && choice && /);
  assert.match(onboarding, /homeDetails=\{!sixStep\}/);
  assert.match(onboarding, /const sixStep = version === 3;/);
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  // The live Rank step and What Matters step are unchanged when not in the six-step flow.
  assert.match(onboarding, /const levels = sixStep \? priorityLevelsWithGroups\(priorities\) : priorityLevels\(priorities\);/);
  assert.match(onboarding, /title="What matters to you\?" lead="For now, just choose what matters\./);
  // Step 4 copy (approved Figma), on its own screen; the live What Matters step is the original.
  assert.match(onboarding, /title=\{<>What matters <em>most\?<\/em><\/>\} lead="Choose anything you’d weigh when comparing homes\. You’ll rank your picks next\."/);
  assert.match(onboarding, /step === 'priorities' && \(\n\s+<WhatMattersStepV2/);
  assert.doesNotMatch(onboarding, /sixStep = false \}\) \{\n  const suggested/);
  // The existing criteria board is unchanged.
  assert.deepEqual(priorityLevels(buy()).map((level) => level.items.length), [0, 0, 0]);
});

test('Step 4 group styles are scoped to onboarding', () => {
  const css = read('src/app/globals.css');
  const block = css.slice(css.indexOf('/* ── Onboarding V2 — Step 4'));
  assert.ok(block.length > 50);
  for (const selector of block.match(/^[^@\s/}][^{]*\{/gm) || []) assert.match(selector, /\.flh-ob-/, `unscoped selector: ${selector}`);
});

/* ------------------------------ real Postgres ------------------------------ */

register('./support/aliasHooks.mjs', import.meta.url);
const { savePriorities, resolvePriorities } = await import('../src/lib/supabase/collaboration.js');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('Step 4 choices and Step 5 ranks persist in the person’s own preferences and reload intact', async () => {
  const owner = db.createUser({ email: 'owner.matters@example.com' });
  const search = { id: db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id, user_id: owner };
  let priorities = addCriterion(buy(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' });
  priorities = toggleGroupValue(priorities, 'preferredPropertyTypes', 'condo');
  priorities = toggleGroupValue(toggleGroupValue(priorities, 'homeLayout', 'Ranch / Single Story'), 'homeLayout', 'Two Story');
  priorities = moveGroup(toggleGroupValue(priorities, 'homeCondition', 'Renovation Potential'), 'homeCondition', 'nice');
  await savePriorities(db.clientFor(owner), search, owner, priorities);
  const reloaded = normalizePriorities(await resolvePriorities(db.clientFor(owner), search, owner));
  assert.deepEqual(reloaded.homeLayout, { values: ['Ranch / Single Story', 'Two Story'], tier: 'important' });
  assert.deepEqual(reloaded.homeCondition, { values: ['Renovation Potential'], tier: 'nice' });
  assert.deepEqual(reloaded.preferredPropertyTypes.values, ['house', 'condo']);
  assert.deepEqual(priorityLevelsWithGroups(reloaded).map((level) => level.items.map((item) => item.key)), priorityLevelsWithGroups(priorities).map((level) => level.items.map((item) => item.key)));
});

/* --------------------------- Step 4 Figma catalog --------------------------- */

const { UNSUPPORTED_FIGMA_OPTIONS, chipKey, isChipSelected, moreToConsider, picksCount, whatMattersSections } = await import('../src/lib/whatMattersCatalog.js');
const { toggleCriterion, moveCriterion, isCriterionSelected } = await import('../src/lib/searchProfile.js');

test('the Step 4 catalog uses only existing canonical identities, with the approved wording', () => {
  const sections = whatMattersSections(buy());
  const table = sections.map((section) => [section.title, section.chips.map((chip) => `${chip.text} → ${chipKey(chip)}`)]);
  assert.deepEqual(table, [
    ['Neighborhood', ['Quiet street → location:Quiet street', 'Walkable to town → location:Walkable to Town', 'Great schools → location:Reputable Schools', 'Parks nearby → location:Parks nearby', 'Near the water → location:Near waterfront']],
    ['The home', ['Big backyard → exterior:Large backyard', 'Home office → features:Home office', 'Primary suite → features:Primary ensuite', 'Guest space → features:Guest Bedroom', 'Finished basement → features:Finished basement', 'Move-in ready → homeCondition=Move-In Ready', 'Room to renovate → homeCondition=Renovation Potential']],
    ['Property type', ['House → preferredPropertyTypes=house', 'Condo → preferredPropertyTypes=condo', 'Multifamily → preferredPropertyTypes=multifamily']],
    ['Layout', ['Ranch → homeLayout=Ranch / Single Story', 'Two story → homeLayout=Two Story', 'Other → homeLayout=Other']],
    ['Home features', ['Garage → exterior:Garage', 'New construction → homeCondition=New Construction']],
  ]);
  const offered = new Set(flatOnboardingSuggestions('home_buy').map((item) => `${item.categoryKey}:${item.label}`));
  for (const chip of sections.flatMap((section) => section.chips).filter((entry) => entry.type === 'criterion')) assert.ok(offered.has(chipKey(chip)), chipKey(chip));
  assert.deepEqual(UNSUPPORTED_FIGMA_OPTIONS.map((option) => option.text), ['Easy commute', 'Natural light', 'Open kitchen']);
});

test('nothing currently offered is removed: every other criterion stays under More to consider, with no duplicates', () => {
  const priorities = buy();
  const shown = [...whatMattersSections(priorities).flatMap((section) => section.chips), ...moreToConsider(priorities)].filter((chip) => chip.type === 'criterion').map(chipKey);
  assert.equal(new Set(shown).size, shown.length, 'no chip appears twice');
  assert.deepEqual([...shown].sort(), flatOnboardingSuggestions('home_buy').map((item) => `${item.categoryKey}:${item.label}`).sort());
});

test('renters see their own supported options; apartments keep their catalog', () => {
  const rent = whatMattersSections(applySearchChoice(normalizePriorities({}), 'home_rent'));
  const keys = rent.flatMap((section) => section.chips.map(chipKey));
  assert.ok(!keys.some((key) => key.startsWith('homeLayout') || key.startsWith('homeCondition')));
  assert.deepEqual(rent.find((section) => section.title === 'Property type').chips.map((chip) => chip.text), ['House', 'Townhome', 'Condo']);
  const apartment = whatMattersSections(applySearchChoice(normalizePriorities({}), 'apartment_rent'));
  assert.deepEqual(apartment.map((section) => section.title), ['The Unit', 'The Property', 'Living There']);
  assert.deepEqual(moreToConsider(applySearchChoice(normalizePriorities({}), 'apartment_rent')), []);
});

test('choosing a chip adds it at Important; a saved level is kept; deselecting removes it', () => {
  const garage = whatMattersSections(buy()).flatMap((section) => section.chips).find((chip) => chipKey(chip) === 'exterior:Garage');
  let priorities = toggleCriterion(buy(), garage);
  assert.equal(priorities.exterior.tiers.Garage, 'important');
  priorities = moveCriterion(priorities, 'exterior', 'Garage', 'must');
  assert.equal(isChipSelected(priorities, garage), true, 'a Must Have shows as chosen and is not reset');
  assert.equal(priorities.exterior.tiers.Garage, 'must');
  priorities = toggleCriterion(priorities, garage);
  assert.equal(isCriterionSelected(priorities, 'exterior', 'Garage'), false);
});

test('picks count every chosen criterion and option; the CTA reads Skip for now only with nothing chosen', () => {
  const none = { ...buy(), preferredPropertyTypes: { values: [], tier: 'important' } };
  assert.equal(picksCount(none), 0);
  assert.equal(picksCount(buy()), 1, 'House is chosen by "a home to buy"');
  const step = read('src/components/onboarding/WhatMattersStepV2.jsx');
  assert.match(step, /\{isSaving \? 'Saving…' : picks \? 'Rank my priorities' : 'Skip for now'\}/);
  assert.match(step, /aria-pressed=\{selected\}/);
  // No counter at the top of the step.
  assert.doesNotMatch(step, /HelperRow|flh-count-row/);
});
