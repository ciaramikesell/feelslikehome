// Home Facts → Match parity (2026-11-02-home-facts-match-parity.sql,
// src/lib/homeFactCriteria.js), against real Postgres: for every check
// criterion, the participant's own Yes / No wins, else an exact shared Home
// Fact answers, else Unknown — identically in the participant's own Match
// (computeMatch) and in the sanitized Compare projection the other participant
// sees. Older labels and historical answer formats included. Skips unless
// FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';
import { computeMatch } from '../src/lib/matching.js';
import { homeFactAnswer } from '../src/lib/homeFactCriteria.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const MIGRATION = 'supabase/migrations/2026-11-02-home-facts-match-parity.sql';
const PREFLIGHT = readFileSync(new URL('../supabase/home-facts-match-parity-preflight.sql', import.meta.url), 'utf8').replace(/;\s*$/, '');

const FACT_CRITERIA = [
  ['exterior', 'Garage', 'must'], ['features', 'Finished basement', 'important'], ['features', 'Walkout basement', 'nice'],
  ['features', 'First-floor laundry', 'important'], ['features', 'Second-Floor Laundry', 'nice'], ['features', 'First-Floor Primary', 'must'],
  ['location', 'No HOA', 'important'],
];
const KEYS = FACT_CRITERIA.map(([category, label]) => `${category}:${label}`);

// A purchase buyer with every fact-backed criterion selected, stored exactly as selection stores it.
function factBuyer() {
  let priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '500000', tier: 'important' };
  for (const [categoryKey, label, tier] of FACT_CRITERIA) priorities = addCriterion(priorities, { categoryKey, label, kind: 'check' }, tier);
  return priorities;
}

// Home Facts combinations: exact facts, partial facts, contradictions and odd text.
const HOMES = {
  unknown: {},
  allYes: { garage_spaces: '2', basement_condition: 'finished', basement_style: 'walkout', laundry_location: 'first_floor', primary_bedroom_location: 'Main Floor', hoa_fee_monthly: 0 },
  allNo: { garage_spaces: '0', basement_condition: 'none', basement_style: 'none', laundry_location: 'second_floor', primary_bedroom_location: 'Upstairs', hoa_fee_monthly: 250 },
  partial: { garage_spaces: 'none', basement_condition: 'partially_finished', basement_style: 'traditional', laundry_location: 'basement' },
  contradictory: { garage_spaces: 'Attached', basement_condition: 'finished', basement_style: 'none' },
  oddText: { garage_spaces: '1.2.3', basement_condition: 'unfinished', basement_style: 'gardenview' },
  walkoutNoBasement: { garage_spaces: '3+', basement_condition: 'none', basement_style: 'walkout' },
};
// What the fact alone answers, per home (true / 'no' / undefined), in KEYS order.
const EXPECTED_FACTS = {
  unknown: [undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  allYes: [true, true, true, true, undefined, true, undefined],
  allNo: ['no', 'no', 'no', undefined, true, 'no', 'no'],
  partial: ['no', undefined, undefined, undefined, undefined, undefined, undefined],
  contradictory: [undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  oddText: [undefined, 'no', undefined, undefined, undefined, undefined, undefined],
  walkoutNoBasement: [true, undefined, undefined, undefined, undefined, undefined, undefined],
};

let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.factparity@example.com', firstName: 'Ciara', lastName: 'M' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.factparity@example.com', firstName: 'Andrew', lastName: 'M' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
});
after(() => db?.drop());

async function joinCoBuyer(database, owner, coBuyer, search, email) {
  const invitation = await createInvitation(database.clientFor(owner), search, owner, email, 'co_buyer');
  assert.equal((await acceptInvitation(database.clientFor(coBuyer), invitation.token)).success, true);
}

async function addHomes(client, owner, search, prefix) {
  const homeIds = {};
  for (const [name, facts] of Object.entries(HOMES)) {
    const inserted = await client.from('homes').insert({ user_id: owner, search_id: search, address: `${prefix} ${name} Ln, Royal Oak, MI 48073`, price: '450000', ...facts }).select('id').single();
    assert.equal(inserted.error, null, name);
    homeIds[name] = inserted.data.id;
  }
  return homeIds;
}

// Both scorers for one participant on the given homes: their own Match and the
// other participant's Compare view of them must agree exactly.
async function bothScorers(database, { viewer, viewerId, subject, subjectId, search, homeIds }) {
  const priorities = normalizePriorities(await resolvePriorities(database.clientFor(subjectId), { id: search }, subjectId));
  const homes = await getHomesForUser(database.clientFor(subjectId), subjectId, search);
  const projected = await resolveCoBuyerComparePerspectives(database.clientFor(viewerId), { id: search }, Object.values(homeIds));
  const out = {};
  for (const [name, id] of Object.entries(homeIds)) {
    const own = computeMatch(homes.find((home) => home.id === id), priorities);
    const other = projected.get(id).match;
    assert.deepEqual([other.pct, other.selectedCount, other.evaluatedCount], [own.pct, own.selectedCount, own.evaluatedCount], `${viewer} sees ${subject} on ${name}`);
    out[name] = own;
  }
  return out;
}

async function setChecks(database, userId, search, homeIds, checksFor) {
  const homes = await getHomesForUser(database.clientFor(userId), userId, search);
  for (const [name, id] of Object.entries(homeIds)) {
    const home = homes.find((entry) => entry.id === id);
    await saveHomePersonalState(database.clientFor(userId), { ...home, checks: checksFor(name) }, userId, search);
  }
}

const answers = (match) => KEYS.map((key) => {
  const item = match.allSelected.find((entry) => entry.key === key);
  return item.evaluated ? (item.met ? true : 'no') : undefined;
});

dbTest('every fact combination: the fact answers when there is no own answer; own Yes / No overrides; historical false stays Unknown — both scorers agree', async () => {
  await joinCoBuyer(db, ids.owner, ids.coBuyer, ids.search, 'cobuyer.factparity@example.com');
  await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, factBuyer());
  const homeIds = await addHomes(db.clientFor(ids.owner), ids.owner, ids.search, '10');
  const subject = { viewer: 'owner', viewerId: ids.owner, subject: 'co-buyer', subjectId: ids.coBuyer, search: ids.search, homeIds };

  // No answers of their own: the fact alone.
  let result = await bothScorers(db, subject);
  for (const name of Object.keys(HOMES)) assert.deepEqual(answers(result[name]), EXPECTED_FACTS[name], name);
  for (const key of KEYS) assert.equal(result.allYes.allSelected.find((item) => item.key === key).source, EXPECTED_FACTS.allYes[KEYS.indexOf(key)] === undefined ? undefined : 'home_facts', key);
  assert.equal(result.unknown.pct, 100, 'only the budget is known');

  // Historical false (the old blind toggle) is not an answer: the fact still decides.
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => Object.fromEntries(KEYS.map((key) => [key, false])));
  result = await bothScorers(db, subject);
  for (const name of Object.keys(HOMES)) assert.deepEqual(answers(result[name]), EXPECTED_FACTS[name], `false on ${name}`);

  // Own No everywhere overrides every fact, including Garage spaces.
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => Object.fromEntries(KEYS.map((key) => [key, 'no'])));
  result = await bothScorers(db, subject);
  for (const name of Object.keys(HOMES)) assert.deepEqual(answers(result[name]), KEYS.map(() => 'no'), `own No on ${name}`);
  assert.equal(result.allYes.allSelected.find((item) => item.key === 'exterior:Garage').source, undefined, 'an own answer is not labelled Home Facts');

  // Own Yes everywhere likewise.
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => Object.fromEntries(KEYS.map((key) => [key, true])));
  result = await bothScorers(db, subject);
  for (const name of Object.keys(HOMES)) assert.deepEqual(answers(result[name]), KEYS.map(() => true), `own Yes on ${name}`);

  // Reading never writes: the stored checks are exactly what the co-buyer saved.
  const stored = db.admin(`select checks from public.home_member_state where user_id = '${ids.coBuyer}'`).map((row) => row.checks);
  assert.ok(stored.every((checks) => KEYS.every((key) => checks[key] === true) && Object.keys(checks).length === KEYS.length));
});

dbTest('a changed Home Fact updates the evaluation for everyone without an override; overrides and the other buyer are untouched', async () => {
  const homeIds = { live: (await db.clientFor(ids.owner).from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: '20 Live Ln, Royal Oak, MI 48073', price: '450000' }).select('id').single()).data.id };
  // The owner selects the same criteria; the co-buyer overrides Finished basement only.
  await savePriorities(db.clientFor(ids.owner), { id: ids.search }, ids.owner, factBuyer());
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({ 'features:Finished basement': 'no' }));
  const owner = { viewer: 'co-buyer', viewerId: ids.coBuyer, subject: 'owner', subjectId: ids.owner, search: ids.search, homeIds };
  const coBuyer = { viewer: 'owner', viewerId: ids.owner, subject: 'co-buyer', subjectId: ids.coBuyer, search: ids.search, homeIds };
  const basement = (match) => match.live.allSelected.find((item) => item.key === 'features:Finished basement');

  assert.equal(basement(await bothScorers(db, owner)).evaluated, false);
  // Someone corrects the shared fact: the owner (no override) follows it at once.
  await db.clientFor(ids.coBuyer).from('homes').update({ basement_condition: 'finished' }).eq('id', homeIds.live);
  assert.deepEqual([basement(await bothScorers(db, owner)).met, basement(await bothScorers(db, owner)).source], [true, 'home_facts']);
  // The co-buyer's own No still wins for the co-buyer, and only for them.
  assert.deepEqual([basement(await bothScorers(db, coBuyer)).met, basement(await bothScorers(db, coBuyer)).source], [false, undefined]);
  // The fact changes again; the owner follows, the co-buyer's override holds.
  await db.clientFor(ids.owner).from('homes').update({ basement_condition: 'unfinished' }).eq('id', homeIds.live);
  assert.equal(basement(await bothScorers(db, owner)).met, false);
  assert.equal(basement(await bothScorers(db, coBuyer)).met, false);
  // The owner's own answer never reaches the co-buyer's Match.
  await setChecks(db, ids.owner, ids.search, homeIds, () => ({ 'features:Finished basement': true }));
  assert.equal(basement(await bothScorers(db, owner)).met, true);
  assert.equal(basement(await bothScorers(db, coBuyer)).met, false);
  // And no derived value was written into anyone's checks.
  const states = db.admin(`select user_id, checks from public.home_member_state where home_id = '${homeIds.live}' order by user_id`);
  assert.deepEqual(Object.fromEntries(states.map((row) => [row.user_id === ids.owner ? 'owner' : 'coBuyer', row.checks])), { owner: { 'features:Finished basement': true }, coBuyer: { 'features:Finished basement': 'no' } });
});

dbTest('older purchase labels and answers fold exactly as computeMatch folds them, on both scorers', async () => {
  const homeIds = { legacy: (await db.clientFor(ids.owner).from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: '30 Legacy Ln, Royal Oak, MI 48073', price: '450000', laundry_location: 'first_floor' }).select('id').single()).data.id };
  const coBuyer = { viewer: 'owner', viewerId: ids.owner, subject: 'co-buyer', subjectId: ids.coBuyer, search: ids.search, homeIds };
  // Written as stored data (not through savePriorities, which would canonicalize it).
  const store = (priorities) => db.exec(`update public.search_member_priorities set priorities = '${JSON.stringify(priorities).replace(/'/g, "''")}'::jsonb where search_id = '${ids.search}' and user_id = '${ids.coBuyer}'`);
  const item = (match, key) => match.legacy.allSelected.find((entry) => entry.key === key);

  // Saved before the label unification: legacy labels only, never re-saved.
  store({ searchType: 'purchase', budget: { value: '500000', tier: 'important' }, features: { tiers: { 'First-Floor Laundry': 'must', 'Home Office': 'important' } }, exterior: { tiers: { 'Fenced Yard': 'nice' } } });
  // Answers under the old key (Home Office) and the new key (Fenced yard).
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({ 'features:Home Office': 'no', 'exterior:Fenced yard': true }));
  let result = await bothScorers(db, coBuyer);
  assert.equal(item(result, 'features:First-floor laundry').source, 'home_facts', 'the legacy laundry label is answered by the laundry fact');
  assert.equal(item(result, 'features:Home office').met, false, 'an answer under the old key counts');
  assert.equal(item(result, 'exterior:Fenced yard').met, true, 'an answer under the new key counts for the old label');

  // Both the legacy and the current label selected: one criterion, the current label's level.
  store({ searchType: 'purchase', budget: { value: '500000', tier: 'important' }, features: { tiers: { 'First-Floor Laundry': 'nice', 'First-floor laundry': 'must', 'Home Office': 'important', 'Home office': 'dontcare' } } });
  result = await bothScorers(db, coBuyer);
  assert.equal(result.legacy.selectedCount, 3, 'budget, laundry once, office once');
  assert.equal(item(result, 'features:First-floor laundry').tier, 'must');
  assert.equal(item(result, 'features:Home office').tier, 'important', 'a deselected current label takes the legacy level');

  // A current answer wins over a legacy one; historical false under the current key hides the legacy answer, as before.
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({ 'features:Home Office': true, 'features:Home office': 'no' }));
  assert.equal(item(await bothScorers(db, coBuyer), 'features:Home office').met, false);
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({ 'features:Home Office': true, 'features:Home office': false }));
  assert.equal(item(await bothScorers(db, coBuyer), 'features:Home office').evaluated, false);

  // Rentals keep their own (Title Case) labels: no folding, facts still answer.
  const rentalLabels = { 'First-Floor Laundry': 'must', 'Finished Basement': 'important', 'Home Office': 'nice' };
  store({ searchType: 'rental', features: { tiers: rentalLabels, customItems: Object.keys(rentalLabels).map((label) => ({ label, kind: 'check' })) } });
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({ 'features:Home office': true }));
  result = await bothScorers(db, coBuyer);
  assert.equal(item(result, 'features:First-Floor Laundry').source, 'home_facts');
  assert.equal(item(result, 'features:Home Office').evaluated, false, 'a rental answer under another label is not folded');
  assert.equal(item(result, 'features:Finished Basement').evaluated, false);
  await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, factBuyer());
});

dbTest('exhaustive: every basement condition × style, garage text and HOA value reads identically in both scorers, one criterion at a time', async () => {
  const conditions = [null, 'none', 'unfinished', 'partially_finished', 'finished'];
  const styles = [null, 'none', 'traditional', 'gardenview', 'walkout'];
  const grid = {};
  conditions.forEach((condition, i) => styles.forEach((style, j) => { grid[`basement-${i}${j}`] = { basement_condition: condition, basement_style: style }; }));
  ['2', '3+', '0', ' 1 ', '2 car', 'none', 'No garage', '', 'Attached', 'yes', '1.2.3', '1-2', 'No garage, 2 carport', '2.5', '0.0', '2 + 1 carport'].forEach((value, i) => { grid[`garage-${i}`] = { garage_spaces: value }; });
  [null, 0, 0.5, 450].forEach((fee, i) => { grid[`hoa-${i}`] = { hoa_fee_monthly: fee }; });
  ['Main Floor', 'Upstairs', '', 'No Preference'].forEach((location, i) => { grid[`primary-${i}`] = { primary_bedroom_location: location }; });
  ['first_floor', 'second_floor', 'basement', null].forEach((location, i) => { grid[`laundry-${i}`] = { laundry_location: location }; });
  const homeIds = {};
  for (const [name, facts] of Object.entries(grid)) {
    homeIds[name] = (await db.clientFor(ids.owner).from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: `${name} Grid Ct, Royal Oak, MI 48073`, ...facts }).select('id').single()).data.id;
  }
  await setChecks(db, ids.coBuyer, ids.search, homeIds, () => ({}));
  for (const [categoryKey, label] of FACT_CRITERIA) {
    // One criterion only: pct 100 = Yes, 0 = No, null = Unknown, on both sides.
    await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, addCriterion(normalizePriorities({ searchType: 'purchase' }), { categoryKey, label, kind: 'check' }, 'must'));
    const result = await bothScorers(db, { viewer: 'owner', viewerId: ids.owner, subject: 'co-buyer', subjectId: ids.coBuyer, search: ids.search, homeIds });
    for (const [name, match] of Object.entries(result)) {
      const item = match.allSelected[0];
      assert.equal(match.pct, item.evaluated ? (item.met ? 100 : 0) : null, `${label} on ${name}`);
    }
  }
  await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, factBuyer());
  for (const id of Object.values(homeIds)) await db.clientFor(ids.owner).from('homes').delete().eq('id', id);
});

// Both participants scored at once, each with their own answer state, over every
// fact combination: an own Yes / No overrides in either direction, false and
// absence fall through to the fact, and the other participant never moves.
dbTest('owner and co-buyer together: every fact × own-answer state, both scorers, both directions', async () => {
  const conditions = [null, 'none', 'unfinished', 'partially_finished', 'finished'];
  const styles = [null, 'none', 'traditional', 'gardenview', 'walkout'];
  const grid = {};
  conditions.forEach((condition, i) => styles.forEach((style, j) => {
    grid[`b${i}${j}`] = { basement_condition: condition, basement_style: style, garage_spaces: ['2', '0', 'none', '', 'No garage, 2 carport'][(i + j) % 5],
      laundry_location: ['first_floor', 'second_floor', 'basement', null][(i + j) % 4], primary_bedroom_location: ['Main Floor', 'Upstairs', ''][(i * 5 + j) % 3],
      hoa_fee_monthly: [null, 0, 125][(i * 5 + j) % 3] };
  }));
  const homeIds = {};
  for (const [name, facts] of Object.entries(grid)) {
    homeIds[name] = (await db.clientFor(ids.owner).from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: `${name} Both Way, Royal Oak, MI 48073`, ...facts }).select('id').single()).data.id;
  }
  const STATES = [undefined, false, true, 'no'];
  const toCamel = (facts) => ({ basementCondition: facts.basement_condition, basementStyle: facts.basement_style, garageSpaces: facts.garage_spaces,
    laundryLocation: facts.laundry_location, primaryBedroomLocation: facts.primary_bedroom_location, hoaFeeMonthly: facts.hoa_fee_monthly });
  const expected = (facts, own, key) => (own === true || own === 'no' ? own : homeFactAnswer(toCamel(facts), key));
  const checksFor = (offset, key) => (name) => {
    const own = STATES[(Object.keys(grid).indexOf(name) + offset) % 4];
    return own === undefined ? {} : { [key]: own };
  };
  for (const [categoryKey, label] of FACT_CRITERIA) {
    const key = `${categoryKey}:${label}`;
    const one = addCriterion(normalizePriorities({ searchType: 'purchase' }), { categoryKey, label, kind: 'check' }, 'must');
    await savePriorities(db.clientFor(ids.owner), { id: ids.search }, ids.owner, one);
    await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, one);
    // Different states for the two participants on every home.
    await setChecks(db, ids.owner, ids.search, homeIds, checksFor(0, key));
    await setChecks(db, ids.coBuyer, ids.search, homeIds, checksFor(1, key));
    const asOwner = await bothScorers(db, { viewer: 'co-buyer', viewerId: ids.coBuyer, subject: 'owner', subjectId: ids.owner, search: ids.search, homeIds });
    const asCoBuyer = await bothScorers(db, { viewer: 'owner', viewerId: ids.owner, subject: 'co-buyer', subjectId: ids.coBuyer, search: ids.search, homeIds });
    for (const name of Object.keys(grid)) {
      const ownerOwn = checksFor(0, key)(name)[key];
      const coBuyerOwn = checksFor(1, key)(name)[key];
      const toPct = (value) => (value === true ? 100 : value === 'no' ? 0 : null);
      assert.equal(asOwner[name].pct, toPct(expected(grid[name], ownerOwn, key)), `owner ${label} on ${name} (own ${ownerOwn})`);
      assert.equal(asCoBuyer[name].pct, toPct(expected(grid[name], coBuyerOwn, key)), `co-buyer ${label} on ${name} (own ${coBuyerOwn})`);
    }
  }
  // Nothing derived was written: every stored check is one the test saved.
  const stored = db.admin(`select checks from public.home_member_state where home_id in (${Object.values(homeIds).map((id) => `'${id}'`).join(',')})`);
  assert.ok(stored.every((row) => Object.values(row.checks).every((value) => value === false || value === true || value === 'no')));
  assert.ok(stored.every((row) => Object.keys(row.checks).length <= 1));
  await savePriorities(db.clientFor(ids.owner), { id: ids.search }, ids.owner, factBuyer());
  await savePriorities(db.clientFor(ids.coBuyer), { id: ids.search }, ids.coBuyer, factBuyer());
  for (const id of Object.values(homeIds)) await db.clientFor(ids.owner).from('homes').delete().eq('id', id);
});

dbTest('production path: preflight on pre-migration data, then the migration — Compare follows the new rule and nothing is rewritten', async () => {
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const owner = legacy.createUser({ email: 'owner.legacy.factparity@example.com', firstName: 'Ciara', lastName: 'M' });
    const coBuyer = legacy.createUser({ email: 'cobuyer.legacy.factparity@example.com', firstName: 'Andrew', lastName: 'M' });
    const search = legacy.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
    await joinCoBuyer(legacy, owner, coBuyer, search, 'cobuyer.legacy.factparity@example.com');
    await savePriorities(legacy.clientFor(coBuyer), { id: search }, coBuyer, factBuyer());
    const homeIds = await addHomes(legacy.clientFor(owner), owner, search, '40');
    // The co-buyer's existing answers: a Garage Yes that disagrees with 0 spaces, a historical false, nothing else.
    await setChecks(legacy, coBuyer, search, homeIds, (name) => (name === 'allNo' ? { 'exterior:Garage': true, 'features:Walkout basement': false } : {}));

    const snapshot = () => legacy.admin(`select
      (select json_agg(p order by p.user_id) from public.search_member_priorities p) as priorities,
      (select json_agg(h order by h.id) from public.homes h) as homes,
      (select json_agg(m order by m.home_id, m.user_id) from public.home_member_state m) as states`)[0];
    const compare = async () => resolveCoBuyerComparePerspectives(legacy.clientFor(owner), { id: search }, Object.values(homeIds));

    // Before: garage spaces '1.2.3' fails the old Compare scorer's numeric cast for the whole search.
    await assert.rejects(compare(), (error) => /invalid input syntax for type numeric/.test(error.message));
    // Without that home, the old scorer ignores the facts (and the Garage answer when spaces are set).
    const readable = Object.entries(homeIds).filter(([name]) => name !== 'oddText').map(([, id]) => id);
    const projected = await resolveCoBuyerComparePerspectives(legacy.clientFor(owner), { id: search }, readable);
    assert.equal(projected.get(homeIds.allYes).match.evaluatedCount, 2, 'budget and Garage from spaces, nothing else');
    assert.equal(projected.get(homeIds.allNo).match.evaluatedCount, 2);

    // The owner's document predates the label unification: the legacy and the current laundry label are
    // both selected (the scorer counts it once, under the current label) and their No is stored under the
    // legacy key, which the scorer reads. The preflight must see that as an own answer, not a new fact.
    const legacyDoc = '{"searchType":"purchase","features":{"tiers":{"First-Floor Laundry":"nice","First-floor laundry":"must"}}}';
    // The owner has no search_member_priorities row here, so (as for older searches) the scorer and the
    // preflight read the search's own priorities.
    assert.equal(legacy.admin(`select count(*)::int as n from public.search_member_priorities where search_id = '${search}' and user_id = '${owner}'`)[0].n, 0);
    legacy.exec(`update public.searches set priorities = '${legacyDoc}'::jsonb where id = '${search}'`);
    const ownerHomes = await getHomesForUser(legacy.clientFor(owner), owner, search);
    await saveHomePersonalState(legacy.clientFor(owner), { ...ownerHomes.find((home) => home.id === homeIds.allYes), checks: { 'features:First-Floor Laundry': 'no' } }, owner, search);

    const before = snapshot();
    const report = legacy.admin(PREFLIGHT);
    assert.deepEqual(report.filter((row) => row.check === 'required' && row.ok !== true), []);
    const info = (prefix) => report.find((row) => row.item.startsWith(prefix))?.detail;
    assert.match(info('current body is the 2026-10-18'), /^expected: 2026-10-18-lot-size-units-match-parity\.sql/);
    // Checked by hand against EXPECTED_FACTS (Garage is reported separately below).
    assert.equal(info('home × participant evaluations newly answered'), 'features:Finished basement important: 1 / 2, features:First-Floor Primary must: 1 / 1, features:First-floor laundry important: 1 / 0, features:Second-Floor Laundry nice: 1 / 0, features:Walkout basement nice: 1 / 1, location:No HOA important: 0 / 1');
    assert.equal(info('own answers that differ from the Home Fact'), '1', 'the owner\'s No under the legacy key, over first-floor laundry');
    assert.equal(info('participant selections of the fact-backed criteria'), 'exterior:Garage: 1, features:Finished basement: 1, features:First-Floor Primary: 1, features:First-floor laundry: 2, features:Second-Floor Laundry: 1, features:Walkout basement: 1, location:No HOA: 1', 'the owner\'s two laundry labels count once');
    assert.equal(info('Must-Haves that become a confirmed miss'), '1', 'First-Floor Primary: Upstairs on one home');
    assert.equal(info('Garage: own Yes / No that disagrees'), 'must: 1');
    assert.equal(info('Garage: historical false'), '0');
    assert.equal(info('saved homes whose garage spaces have no digits'), '1');
    assert.equal(info('saved homes whose garage spaces made the Compare cast fail'), '1');
    assert.equal(info('saved homes whose garage spaces have digits but several numbers'), '1', '"1.2.3" has two numbers');
    assert.equal(info('Garage: Must-Haves that become a confirmed miss'), '0');
    // allNo: Garage own Yes (changed) + 5 newly answered; allYes 5; partial 0 (Garage is not new); oddText 1; walkoutNoBasement 0.
    assert.equal(info('home × participant pairs by number of changed evaluations'), '1 / 0 / 2; Must-Have newly missed: 1');
    assert.equal(info('searches with at least one changed evaluation'), '1 of 2', 'the co-buyer also has a search of their own');
    assert.deepEqual(snapshot(), before, 'the preflight writes nothing');

    const applied = legacy.applyFile(MIGRATION);
    assert.equal(applied.error, null);
    assert.deepEqual(snapshot(), before, 'the migration rewrites no preferences, homes or answers');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 'the migration is re-runnable');
    assert.match(legacy.admin(PREFLIGHT).find((row) => row.item.startsWith('current body is the 2026-10-18')).detail, /^ALREADY APPLIED/);
    const security = legacy.admin(`select p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p where p.proname = 'resolve_cobuyer_compare_perspectives'`)[0];
    assert.deepEqual([security.prosecdef, security.proconfig, security.auth, security.anon], [true, ['search_path=""'], true, false]);

    // After: both scorers agree on every home, and the co-buyer's own Garage Yes wins over 0 spaces.
    const result = await bothScorers(legacy, { viewer: 'owner', viewerId: owner, subject: 'co-buyer', subjectId: coBuyer, search, homeIds });
    assert.equal(result.allNo.allSelected.find((item) => item.key === 'exterior:Garage').met, true);
    assert.equal(result.allNo.allSelected.find((item) => item.key === 'features:Walkout basement').met, false, 'historical false: the fact decides');

    // Rollback: re-applying the previous scorer restores its exact body and contract and rewrites nothing.
    const afterMigration = snapshot();
    assert.equal(legacy.applyFile('supabase/migrations/2026-10-18-lot-size-units-match-parity.sql').error, null);
    assert.deepEqual(snapshot(), afterMigration, 'the rollback rewrites no preferences, homes or answers');
    assert.match(legacy.admin(PREFLIGHT).find((row) => row.item.startsWith('current body is the 2026-10-18')).detail, /^expected: 2026-10-18-lot-size-units-match-parity\.sql/);
    const rolledBack = legacy.admin(`select p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p where p.proname = 'resolve_cobuyer_compare_perspectives'`)[0];
    assert.deepEqual([rolledBack.prosecdef, rolledBack.proconfig, rolledBack.auth, rolledBack.anon], [true, ['search_path=""'], true, false]);
    const old = await resolveCoBuyerComparePerspectives(legacy.clientFor(owner), { id: search }, readable);
    assert.equal(old.get(homeIds.allYes).match.evaluatedCount, 2, 'the previous Compare behaviour is back');
    // And forward again (re-runnable both ways).
    assert.equal(legacy.applyFile(MIGRATION).error, null);
    assert.match(legacy.admin(PREFLIGHT).find((row) => row.item.startsWith('current body is the 2026-10-18')).detail, /^ALREADY APPLIED/);
  } finally {
    legacy.drop();
  }
});
