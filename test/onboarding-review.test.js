// Onboarding V2, Step 6 ("Your search is ready."). A read-only summary of what
// earlier steps saved; completion goes through the existing services exactly
// once and only then leaves for the existing add-home flow or My Search.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { beginOnboarding, completeOnboardingState, setOnboardingAnswer } from '../src/lib/onboardingFlow.js';
import { areasSummary, basicsSummary, peopleSummary, placesSummary, prioritiesSummary } from '../src/lib/onboardingReview.js';
import { addSearchArea } from '../src/lib/searchAreas.js';
import { addCriterion, moveCriterion } from '../src/lib/searchProfile.js';
import { moveGroup, toggleGroupValue } from '../src/lib/whatMattersGroups.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = () => chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });

test('The Basics: unanswered questions are null ("Not set yet"); optional sizes appear only when entered', () => {
  assert.deepEqual(basicsSummary(fresh()).map((row) => [row.label, row.value]), [['Looking for', 'Home to buy'], ['Maximum budget', null], ['Bedrooms', null], ['Bathrooms', null]]);
  const filled = { ...fresh(), budget: { value: '650000', tier: 'important' }, bedsMin: { value: '3', tier: 'important' }, bathsMin: { value: '2', tier: 'nice' }, sqftTarget: { value: '1800', tier: 'nice' }, lotSizeTarget: { value: '0.25', tier: 'dontcare' } };
  assert.deepEqual(basicsSummary(filled).map((row) => row.value), ['Home to buy', '$650,000', '3+', '2+', '1,800 sq ft', '0.25 acres']);
  const rent = chooseSearchType(normalizePriorities({ budget: { value: '2200', tier: 'important' } }), 'home_rent', { presetPropertyType: false });
  assert.deepEqual(basicsSummary(rent)[1], { key: 'budget', label: 'Maximum monthly rent', value: '$2,200/mo' });
  assert.equal(basicsSummary(normalizePriorities({}))[0].value, null, 'no search type chosen is not invented');
});

test('areas, places, people and priorities are summarised as saved — intentions are never invitations', () => {
  const withAreas = addSearchArea(fresh(), { placeId: 'gp', name: 'Grosse Pointe', type: 'city' });
  assert.deepEqual(areasSummary(withAreas), [{ key: 'gp', name: 'Grosse Pointe', type: 'City' }]);
  assert.deepEqual(placesSummary([{ id: 'p', label: 'Work', address: '1 Main St' }]), [{ key: 'p', label: 'Work', address: '1 Main St' }]);
  assert.deepEqual(peopleSummary({ choice: 'co_buyer_and_realtor' }).map((line) => [line.kind, line.text]), [['intent', 'You’d like to search with a co-buyer'], ['intent', 'You’d like to work with a Realtor']]);
  assert.deepEqual(peopleSummary({ choice: 'solo', people: { coBuyers: [{ name: 'Jordan' }], realtors: 1 } }).map((line) => [line.kind, line.text]), [['joined', 'You’re searching with Jordan'], ['joined', 'Your Realtor is connected']]);
  assert.deepEqual(peopleSummary({ choice: 'co_buyer', role: 'co_buyer', people: { ownerName: 'Ciara' } }).map((line) => line.text), ['You’re searching with Ciara']);
  assert.deepEqual(peopleSummary({ choice: null }), []);
  for (const line of [...peopleSummary({ choice: 'co_buyer_and_realtor' })]) assert.doesNotMatch(line.text, /invit|joined|connected/i);
});

test('priorities keep their levels; alternatives stay one line; an unset property type is absent', () => {
  let p = addCriterion(fresh(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' });
  p = moveCriterion(p, 'exterior', 'Garage', 'must');
  p = toggleGroupValue(toggleGroupValue(p, 'homeLayout', 'Ranch / Single Story'), 'homeLayout', 'Two Story');
  p = moveGroup(p, 'homeLayout', 'nice');
  const summary = prioritiesSummary(p);
  assert.deepEqual(summary.map((level) => [level.title, level.items.map((item) => [item.label, item.qualifier])]), [
    ['Must-Have', [['Garage', null]]], ['Important', []], ['Nice-to-Have', [['Layout', 'Ranch or Two Story']]],
  ]);
  assert.ok(!summary.flatMap((level) => level.items).some((item) => item.label === 'Property type'));
});

test('Review completes once through the existing services, then leaves; failures keep everything', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const step = read('src/components/onboarding/ReviewStep.jsx');
  assert.match(onboarding, /title=\{<>Your search is <em>ready\.<\/em><\/>\}/);
  assert.match(step, /\{finishing \? 'Saving your search…' : 'Add my first home'\}/);
  assert.match(step, /onFinish\('\/homes\?add=1'\)/, 'the existing add-home flow');
  assert.match(step, /onFinish\('\/search\?welcome=1'\)/, 'My Search');
  const finish = onboarding.slice(onboarding.indexOf('const finishToDestination'), onboarding.indexOf('const finish = async'));
  assert.match(finish, /if \(finishingRef\.current\) return;/);
  assert.match(finish, /await persistPriorities\(priorities\);\n\s+if \(!sharedSetup\) \{\n\s+await services\.completeOnboarding\(userId, \{ version, state: completeOnboardingState\(version, progressRef\.current\) \}\);/);
  assert.match(finish, /leave\(pendingRedirect \|\| destination\);\n\s+\} catch \{\n\s+finishingRef\.current = false;/);
  assert.match(finish, /setFinishError\('Couldn’t finish setup\. Your answers are all still here—please try again\.'\)/);
  // Editing returns to Review; the live flow's finish and Ready screen are unchanged.
  assert.match(onboarding, /if \(returnToReview && sixStep\) \{\n\s+setReturnToReview\(false\);\n\s+persistProgress\(\{ \.\.\.next, step: 'review' \}\);/);
  assert.match(onboarding, /\{ready && <ReadyStep onAddHome=\{\(\) => leave\('\/homes\?add=1'\)\} onViewSearch=\{\(\) => leave\('\/search\?welcome=1'\)\} \/>\}/);
});

test('Step 6 styles are scoped to onboarding', () => {
  const css = read('src/app/globals.css');
  const block = css.slice(css.indexOf('/* ── Onboarding V2 — Step 6'));
  assert.ok(block.length > 100);
  for (const selector of block.match(/^[^@\s/}][^{]*\{/gm) || []) assert.match(selector, /\.flh-onboarding-root|\.flh-ob-/, `unscoped selector: ${selector}`);
});

register('./support/aliasHooks.mjs', import.meta.url);
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('completing the six-step flow keeps everything, creates nothing new, and repeating it is harmless', async () => {
  const { createCommuteDestination, getCommuteDestinations, resolvePriorities, savePriorities } = await import('../src/lib/supabase/collaboration.js');
  const { completeOnboarding, getProfile } = await import('../src/lib/supabase/data.js');
  const owner = db.createUser({ email: 'owner.review@example.com' });
  const search = { id: db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id, user_id: owner };
  const client = db.clientFor(owner);
  let p = addSearchArea(fresh(), { placeId: 'gp', name: 'Grosse Pointe', type: 'city' });
  p = moveGroup(toggleGroupValue(toggleGroupValue(p, 'homeLayout', 'Ranch / Single Story'), 'homeLayout', 'Two Story'), 'homeLayout', 'must');
  await savePriorities(client, search, owner, p);
  await createCommuteDestination(client, search.id, owner, { label: 'Work', address: '1 Main St, Detroit, MI', maxDriveMinutes: null });
  let state = beginOnboarding({ context: { searchId: search.id, role: 'owner' }, targetVersion: 3 }).state;
  state = setOnboardingAnswer({ ...state, step: 'review' }, 'collaboration', 'realtor');
  for (let i = 0; i < 2; i += 1) await completeOnboarding(client, owner, { version: 3, state: completeOnboardingState(3, state) });
  const profile = await getProfile(client, owner);
  assert.equal(profile.onboarding_complete, true);
  assert.equal(profile.onboarding_version, 3);
  assert.equal(db.admin(`select count(*)::int as n from public.searches where user_id = '${owner}'`)[0].n, 1, 'no new search');
  assert.equal(db.admin(`select count(*)::int as n from public.search_invitations where search_id = '${search.id}'`)[0].n, 0, 'a Realtor intention is not an invitation');
  const reloaded = normalizePriorities(await resolvePriorities(client, search, owner));
  assert.deepEqual(reloaded.homeLayout, { values: ['Ranch / Single Story', 'Two Story'], tier: 'must' });
  assert.deepEqual(reloaded.preferredPropertyTypes.values, [], 'unset property type stays unset');
  assert.deepEqual((await getCommuteDestinations(client, search.id, owner)).map((place) => place.label), ['Work']);
});

dbTest('a co-buyer finishing setup in a shared search saves only their own preferences there', async () => {
  const { acceptInvitation, createInvitation, resolvePriorities, savePriorities } = await import('../src/lib/supabase/collaboration.js');
  const owner = db.createUser({ email: 'owner.reviewshared@example.com' });
  const partner = db.createUser({ email: 'partner.reviewshared@example.com' });
  const search = { id: db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id, user_id: owner };
  const partnerOwn = db.admin(`select id from public.searches where user_id = '${partner}'`)[0].id;
  const invite = await createInvitation(db.clientFor(owner), search.id, owner, 'partner.reviewshared@example.com', 'co_buyer');
  await acceptInvitation(db.clientFor(partner), invite.token);
  await savePriorities(db.clientFor(owner), search, owner, moveCriterion(addCriterion(fresh(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }), 'exterior', 'Garage', 'nice'));
  // finishSharedSetup → persistPriorities(own row on the shared search) and nothing else.
  await savePriorities(db.clientFor(partner), search, partner, moveCriterion(addCriterion(fresh(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }), 'exterior', 'Garage', 'must'));
  assert.equal(normalizePriorities(await resolvePriorities(db.clientFor(owner), search, owner)).exterior.tiers.Garage, 'nice');
  assert.equal(normalizePriorities(await resolvePriorities(db.clientFor(partner), search, partner)).exterior.tiers.Garage, 'must');
  assert.deepEqual(db.admin(`select role from public.search_members where search_id = '${search.id}'`), [{ role: 'co_buyer' }]);
  assert.equal(db.admin(`select count(*)::int as n from public.search_member_priorities where search_id = '${partnerOwn}' and user_id = '${partner}'`)[0].n, 0, 'their own search is untouched');
});

/* ------------------------- Preview journey harness ------------------------- */

test('the six-step journey harness is Preview-only, signed-in, unindexed and writes nothing', () => {
  const harness = read('src/components/onboarding/OnboardingJourneyHarness.jsx');
  const page = read('src/app/qa/onboarding/page.js');
  // No Supabase client anywhere in the harness; every write <Onboarding> can make is an in-memory stand-in.
  assert.doesNotMatch(harness, /@\/lib\/supabase|createClient\(|SUPABASE_SERVICES/);
  for (const key of ['savePriorities', 'saveProgress', 'completeOnboarding', 'setActiveSearch', 'submitFeedback', 'createPlace', 'deletePlace', 'searchAreas', 'navigate']) {
    assert.match(harness, new RegExp(`${key}: `), `${key} must be stubbed`);
  }
  // Finishing never claims a real update.
  assert.match(harness, /nothing was saved/);
  assert.match(page, /if \(!previewQaAllowedHere\(host\)\) notFound\(\);/);
  assert.match(page, /if \(!user\) redirect\(/);
  assert.match(page, /\} else if \(process\.env\.NODE_ENV !== 'development'\) \{\n\s+notFound\(\);/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(read('src/middleware.js'), /pathname\.startsWith\('\/qa\/'\)[\s\S]*?previewQaAllowedHere/);
});

test('leaving onboarding goes through services.navigate when injected; real pages still use the router', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /if \(services\.navigate\) \{ services\.navigate\(destination\); return; \}\n\s+router\.push\(destination\); router\.refresh\(\);/);
  // The real services define no navigate, so live pages are unchanged.
  const defaults = onboarding.slice(onboarding.indexOf('const SUPABASE_SERVICES'), onboarding.indexOf('});', onboarding.indexOf('const SUPABASE_SERVICES')));
  assert.doesNotMatch(defaults, /navigate/);
  // The six-step flow stays inactive.
  assert.match(read('src/lib/onboardingFlow.js'), /export const CURRENT_ONBOARDING_VERSION = 1;/);
});
