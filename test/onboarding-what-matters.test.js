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
import { addCriterion, isCriterionSelected, moveCriterion, priorityLevels, toggleCriterion } from '../src/lib/searchProfile.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { UNSUPPORTED_FIGMA_OPTIONS, chipKey, isChipSelected, moreToConsider, picksCount, whatMattersSections } from '../src/lib/whatMattersCatalog.js';
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
  // Renting a home keeps its existing property types and has no layout/condition;
  // apartments get an optional Building type (Apartment, Condo, Townhome).
  assert.deepEqual(Object.keys(choicesOf(applySearchChoice(normalizePriorities({}), 'home_rent'))), ['preferredPropertyTypes']);
  assert.deepEqual(choicesOf(applySearchChoice(normalizePriorities({}), 'apartment_rent')), { preferredPropertyTypes: ['Apartment', 'Condo', 'Townhome'] });
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
  assert.match(basics, /export default function BasicsStep\(\{ header, priorities, patch, onNext, homeDetails = true, presetPropertyType = true \}\)/);
  assert.match(basics, /const showGarage = homeDetails && choice !== 'apartment_rent';/);
  assert.match(basics, /const showDetails = homeDetails && choice && /);
  assert.match(onboarding, /homeDetails=\{!sixStep\}/);
  assert.match(onboarding, /const sixStep = version === 3;/);
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.deepEqual(onboardingStepsFor(1, {}), ['basics', 'what_matters', 'rank']);
  // The live Rank step and What Matters step are unchanged when not in the six-step flow.
  assert.match(onboarding, /step === 'rank' && !sixStep && <RankStep /);
  assert.match(read('src/components/onboarding/RankStepV2.jsx'), /const levels = onboardingPriorityLevels\(priorities\);/);
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
  assert.deepEqual(rent.map((section) => section.title), ['Rental essentials', 'Neighborhood', 'The home', 'Outdoor space', 'Property type']);
  const apartment = whatMattersSections(applySearchChoice(normalizePriorities({}), 'apartment_rent'));
  assert.deepEqual(apartment.map((section) => section.title), ['Rental essentials', 'The unit', 'Building & amenities', 'Building type', 'After you tour']);
  assert.ok(moreToConsider(applySearchChoice(normalizePriorities({}), 'apartment_rent')).length > 0, 'secondary apartment options sit under More to consider');
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

/* ------------------------ Step 4 locked decisions (2D) ------------------------ */

const v2Buyer = () => chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });

test('six-step flow: a fresh buyer has zero picks and property type genuinely unset; the live flow still presets House', () => {
  assert.deepEqual(v2Buyer().preferredPropertyTypes.values, []);
  assert.equal(picksCount(v2Buyer()), 0);
  assert.deepEqual(chooseSearchType(normalizePriorities({}), 'home_buy').preferredPropertyTypes.values, ['house']);
  // Skipping Step 4 leaves it unset: Match has no property-type entry at all.
  assert.doesNotMatch(JSON.stringify(computeMatch({ propertyType: 'condo' }, v2Buyer())), /preferredPropertyTypes/);
  // Explicit choices survive a change of search type where they still apply. An
  // apartment's Building type is optional too: never preset to Apartment.
  const chosen = toggleGroupValue(toggleGroupValue(v2Buyer(), 'preferredPropertyTypes', 'house'), 'preferredPropertyTypes', 'condo');
  assert.deepEqual(chooseSearchType(chosen, 'home_rent', { presetPropertyType: false }).preferredPropertyTypes.values, ['house', 'condo']);
  assert.deepEqual(chooseSearchType(chosen, 'home_buy', { presetPropertyType: false }).preferredPropertyTypes, chosen.preferredPropertyTypes);
  assert.deepEqual(chooseSearchType(chosen, 'apartment_rent', { presetPropertyType: false }).preferredPropertyTypes.values, ['condo']);
  assert.deepEqual(chooseSearchType(v2Buyer(), 'apartment_rent', { presetPropertyType: false }).preferredPropertyTypes.values, []);
  // The live flow still presets Apartment.
  assert.deepEqual(chooseSearchType(normalizePriorities({}), 'apartment_rent').preferredPropertyTypes.values, ['apartment']);
  const basics = read('src/components/onboarding/BasicsStep.jsx');
  assert.match(basics, /chooseSearchType\(next, key, \{ presetPropertyType \}\)/);
  assert.match(basics, /homeDetails = true, presetPropertyType = true \}\)/);
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /presetPropertyType=\{!sixStep\}/);
});

test('existing buyer data is never rewritten by viewing the six-step steps', () => {
  const existing = normalizePriorities({ ...buy(), preferredPropertyTypes: { values: ['house', 'townhome'], tier: 'must' }, exterior: { customItems: [], tiers: {}, order: [], hiddenCore: [], garagePreference: 'attached' } });
  const copy = JSON.parse(JSON.stringify(existing));
  whatMattersSections(existing); moreToConsider(existing); picksCount(existing); priorityLevelsWithGroups(existing);
  assert.deepEqual(existing, copy);
  assert.deepEqual(choicesOf(existing).preferredPropertyTypes, ['House', 'Condo', 'Multifamily', 'Townhome']);
});

test('alternatives stay one Step 5 item each, so they can never become separate simultaneous Must Haves', () => {
  let priorities = v2Buyer();
  for (const [key, value] of [['preferredPropertyTypes', 'house'], ['preferredPropertyTypes', 'condo'], ['homeLayout', 'Ranch / Single Story'], ['homeLayout', 'Two Story'], ['homeCondition', 'Move-In Ready'], ['homeCondition', 'Renovation Potential']]) {
    priorities = toggleGroupValue(priorities, key, value);
  }
  priorities = moveGroup(priorities, 'preferredPropertyTypes', 'must');
  const items = priorityLevelsWithGroups(priorities).flatMap((level) => level.items);
  assert.deepEqual(items.map((item) => [item.key, item.qualifier, item.tier]), [
    ['group:preferredPropertyTypes', 'House or Condo', 'must'],
    ['group:homeLayout', 'Ranch or Two Story', 'important'],
    ['group:homeCondition', 'Move-in Ready or Renovation Potential', 'important'],
  ]);
  // Match: a condo meets the Must Have; a house meets it; neither needs to be both.
  for (const propertyType of ['house', 'condo']) assert.match(JSON.stringify(computeMatch({ propertyType }, priorities)), /"key":"preferredPropertyTypes"[^}]*"met":true/);
  assert.match(JSON.stringify(computeMatch({ homeCondition: ['Renovation Potential'] }, priorities)), /"key":"homeCondition"[^}]*"met":true/);
});

test('Garage ranks without an Attached/Detached question in the six-step flow; a saved qualifier is kept', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.doesNotMatch(read('src/components/onboarding/RankStepV2.jsx'), /garagePreference|GaragePreference/);
  assert.match(onboarding, /onGaragePreferenceChange=\{\(value\) => patch\(\(next\) => setGaragePreference\(next, value\)\)\}/, 'the live Rank step keeps it');
  assert.doesNotMatch(read('src/components/onboarding/WhatMattersStepV2.jsx'), /GarageQualifier|garagePreference/);
  const ranked = priorityLevelsWithGroups(addCriterion(v2Buyer(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' })).flatMap((level) => level.items);
  assert.deepEqual(ranked.map((item) => [item.key, item.qualifier]), [['exterior:Garage', null]]);
  const established = { ...addCriterion(v2Buyer(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must') };
  established.exterior = { ...established.exterior, garagePreference: 'detached' };
  assert.equal(priorityLevelsWithGroups(established)[0].items[0].qualifier, 'Detached');
});

test('the gaps are tracked, not offered: unsupported options are documented and never become chips', () => {
  const doc = read('docs/onboarding-v2-priority-gaps.md');
  for (const heading of ['### Natural light', '### Open kitchen', '### Easy commute', '## 2. Follow-up task — manual assessment on saved homes']) assert.ok(doc.includes(heading), heading);
  const texts = [...whatMattersSections(v2Buyer()).flatMap((section) => section.chips), ...moreToConsider(v2Buyer())].map((chip) => chip.text.toLowerCase());
  for (const option of UNSUPPORTED_FIGMA_OPTIONS) assert.ok(!texts.includes(option.text.toLowerCase()), option.text);
});

test('Step 4 actions sit at the end of the content (never over an option)', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.flh-onboarding-root \.flh-ob-matters-actions \{ position: static;/);
});

dbTest('choosing a layout in Step 4 makes the home’s layout recordable on saved homes (existing Home details field)', async () => {
  const { resolveSharedFactPriorityAwareness } = await import('../src/lib/supabase/collaboration.js');
  const owner = db.createUser({ email: 'owner.layoutfact@example.com' });
  const search = { id: db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id, user_id: owner };
  const client = db.clientFor(owner);
  await savePriorities(client, search, owner, v2Buyer());
  const before = await resolveSharedFactPriorityAwareness(client, search);
  assert.equal(before.homeLayout?.eligibleForSharedFactCapture, false);
  await savePriorities(client, search, owner, toggleGroupValue(v2Buyer(), 'homeLayout', 'Ranch / Single Story'));
  const after = await resolveSharedFactPriorityAwareness(client, search);
  assert.equal(after.homeLayout?.eligibleForSharedFactCapture, true);
});
