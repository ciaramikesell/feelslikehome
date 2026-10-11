// Onboarding V2, Step 5 ("Let's put things in order."). Ranking changes only a
// priority's level — a criterion's tier or a grouped preference's single tier —
// never within-level order, never membership, ratings or Match.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { chooseSearchType } from '../src/lib/onboardingBasics.js';
import { addCriterion, moveCriterion } from '../src/lib/searchProfile.js';
import { moveGroup, priorityLevelsWithGroups, toggleGroupValue } from '../src/lib/whatMattersGroups.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = () => chooseSearchType(normalizePriorities({}), 'home_buy', { presetPropertyType: false });
const picked = () => {
  let p = addCriterion(addCriterion(fresh(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }), { categoryKey: 'features', label: 'Home office', kind: 'check' });
  p = toggleGroupValue(toggleGroupValue(p, 'preferredPropertyTypes', 'house'), 'preferredPropertyTypes', 'condo');
  return toggleGroupValue(toggleGroupValue(p, 'homeLayout', 'Ranch / Single Story'), 'homeLayout', 'Two Story');
};
const board = (p) => Object.fromEntries(priorityLevelsWithGroups(p).map((level) => [level.tier, level.items.map((item) => item.key)]));

test('every new pick starts Important; saved levels are restored, not reset', () => {
  assert.deepEqual(board(picked()), { must: [], important: ['features:Home office', 'exterior:Garage', 'group:preferredPropertyTypes', 'group:homeLayout'], nice: [] });
  let saved = moveCriterion(picked(), 'exterior', 'Garage', 'must');
  saved = moveGroup(saved, 'homeLayout', 'nice');
  const reloaded = normalizePriorities(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(board(reloaded), { must: ['exterior:Garage'], important: ['features:Home office', 'group:preferredPropertyTypes'], nice: ['group:homeLayout'] });
});

test('a group moves as one item and stays alternatives; Match is unchanged by ranking', () => {
  const ranked = moveGroup(picked(), 'preferredPropertyTypes', 'must');
  const items = priorityLevelsWithGroups(ranked).flatMap((level) => level.items);
  assert.equal(items.filter((item) => item.categoryKey === 'preferredPropertyTypes').length, 1);
  assert.deepEqual(ranked.preferredPropertyTypes, { values: ['house', 'condo'], tier: 'must' });
  for (const propertyType of ['house', 'condo']) assert.match(JSON.stringify(computeMatch({ propertyType }, ranked)), /"key":"preferredPropertyTypes"[^}]*"met":true/);
  // Garage stays Unknown when the home's garage is unknown, even as a Must-Have.
  assert.match(JSON.stringify(computeMatch({ garageSpaces: '' }, moveCriterion(ranked, 'exterior', 'Garage', 'must'))), /"key":"exterior:Garage"[^}]*"evaluated":false/);
});

test('Step 5 uses the approved copy, three levels, and accessible equal-weight controls', () => {
  const step = read('src/components/onboarding/RankStepV2.jsx');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /title=\{<>Let’s put things <em>in order\.<\/em><\/>\} lead="Everything you picked starts as Important\. Move each priority into Must-Have, Important, or Nice-to-Have\."/);
  assert.match(onboarding, /rank: 'Rank Priorities'/);
  assert.match(step, /must: \{ title: 'Must-Have', description: 'I could rule out a home over this\.' \}/);
  assert.match(step, /important: \{ title: 'Important', description: 'This meaningfully affects my decision\.' \}/);
  assert.match(step, /nice: \{ title: 'Nice-to-Have', description: 'I’d love it, but can live without it\.' \}/);
  // A native assignment menu on every row (tap, keyboard, screen reader), and a drag handle that alone starts a drag.
  assert.match(step, /<select\n\s+value=\{level\.tier\}\n\s+aria-label=\{`Importance of /);
  assert.match(step, /onPointerDown=\{\(event\) => onPointerDown\(event, item\)\}/);
  assert.match(read('src/app/globals.css'), /\.flh-ob-rank-handle \{[^}]*touch-action: none;/);
  // Empty state with a way back, and Continue never blocked.
  assert.match(step, /No priorities selected yet\./);
  assert.match(step, /onClick=\{onChoose\}>Choose priorities<\/button>/);
  assert.match(onboarding, /onChoose=\{\(\) => goBack\('rank'\)\}/);
  assert.doesNotMatch(step, /disabled=\{/);
  // No within-level order and no Attached/Detached question.
  assert.doesNotMatch(step, /order:|reorder|garagePreference/i);
  // The live Rank step is the original.
  assert.match(onboarding, /step === 'rank' && !sixStep && <RankStep priorities=\{priorities\} patch=\{patch\} progress=\{progress\} sharedFor=\{sharedFor\} onFinish=\{finish\} finishing=\{finishing\} \/>/);
});

test('Step 5 styles are scoped to onboarding', () => {
  const css = read('src/app/globals.css');
  const block = css.slice(css.indexOf('/* ── Onboarding V2 — Step 5'));
  assert.ok(block.length > 100);
  for (const selector of block.match(/^[^@\s/}][^{]*\{/gm) || []) assert.match(selector, /\.flh-onboarding-root|\.flh-ob-/, `unscoped selector: ${selector}`);
});

register('./support/aliasHooks.mjs', import.meta.url);
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('a co-buyer’s rankings save to their own preferences only; membership is untouched', async () => {
  const { acceptInvitation, createInvitation, resolvePriorities, savePriorities } = await import('../src/lib/supabase/collaboration.js');
  const owner = db.createUser({ email: 'owner.rank@example.com' });
  const partner = db.createUser({ email: 'partner.rank@example.com' });
  const search = { id: db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id, user_id: owner };
  const invite = await createInvitation(db.clientFor(owner), search.id, owner, 'partner.rank@example.com', 'co_buyer');
  await acceptInvitation(db.clientFor(partner), invite.token);
  await savePriorities(db.clientFor(owner), search, owner, moveGroup(picked(), 'preferredPropertyTypes', 'nice'));
  const members = db.admin(`select role from public.search_members where search_id = '${search.id}'`);
  await savePriorities(db.clientFor(partner), search, partner, moveGroup(moveCriterion(picked(), 'exterior', 'Garage', 'must'), 'preferredPropertyTypes', 'must'));
  const ownerBoard = board(normalizePriorities(await resolvePriorities(db.clientFor(owner), search, owner)));
  const partnerBoard = board(normalizePriorities(await resolvePriorities(db.clientFor(partner), search, partner)));
  assert.deepEqual(ownerBoard.nice, ['group:preferredPropertyTypes']);
  assert.deepEqual(partnerBoard.must, ['exterior:Garage', 'group:preferredPropertyTypes']);
  assert.deepEqual(db.admin(`select role from public.search_members where search_id = '${search.id}'`), members);
});
