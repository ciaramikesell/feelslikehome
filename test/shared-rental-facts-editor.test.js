// Pets Allowed, Utilities Included and In-Unit Laundry are shared facts about a
// saved property (homes.pets_allowed, etc.). Match has always read only those
// fields, but the saved-home editor's Yes / No / Unknown buttons wrote the
// person's own checks instead, so a manually recorded answer never counted.
// These tests pin the fix: the editor reads and writes the shared field, every
// member's priorities stay their own, and Unknown never counts as a miss.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../src/lib/constants.js');
const { computeMatch, SHARED_BOOLEAN_FACT_FIELDS, sharedFactAnswer, sharedFactValue } = await import('../src/lib/matching.js');
const { toggleCriterion, moveCriterion } = await import('../src/lib/searchProfile.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const FACTS = Object.keys(SHARED_BOOLEAN_FACT_FIELDS);

function apartmentSearch(tier = 'must') {
  let priorities = normalizePriorities({ searchType: 'rental', onboardingSearchType: 'apartment_rent' });
  for (const key of FACTS) {
    const label = key.split(':')[1];
    priorities = toggleCriterion(priorities, { categoryKey: 'features', label, kind: 'check' });
    priorities = moveCriterion(priorities, 'features', label, tier);
  }
  return priorities;
}
const statusOf = (match, key) => {
  const criterion = match.allSelected.find((entry) => entry.key === key);
  return criterion.evaluated ? (criterion.met ? 'yes' : 'no') : 'unknown';
};

test('Yes / No / Unknown map onto the shared field and back', () => {
  assert.deepEqual(SHARED_BOOLEAN_FACT_FIELDS, { 'features:Pets Allowed': 'petsAllowed', 'features:Utilities Included': 'utilitiesIncluded', 'features:In-Unit Laundry': 'inUnitLaundry' });
  assert.equal(sharedFactValue(true), true);
  assert.equal(sharedFactValue('no'), false);
  assert.equal(sharedFactValue(undefined), null);
  assert.equal(sharedFactAnswer({ petsAllowed: true }, 'features:Pets Allowed'), true);
  assert.equal(sharedFactAnswer({ petsAllowed: false }, 'features:Pets Allowed'), 'no');
  for (const unknown of [null, undefined, 'yes', 0, '']) assert.equal(sharedFactAnswer({ petsAllowed: unknown }, 'features:Pets Allowed'), undefined);
});

test('an answer recorded through the editor counts in Match; Unknown never does, even for a Must-Have', () => {
  const priorities = apartmentSearch('must');
  for (const key of FACTS) {
    const field = SHARED_BOOLEAN_FACT_FIELDS[key];
    const home = (answer) => ({ propertyType: 'apartment', checks: {}, ratings: {}, [field]: sharedFactValue(answer) });
    assert.equal(statusOf(computeMatch(home(true), priorities), key), 'yes', `${key} Yes`);
    assert.equal(statusOf(computeMatch(home('no'), priorities), key), 'no', `${key} No`);
    const unknown = computeMatch(home(undefined), priorities);
    assert.equal(statusOf(unknown, key), 'unknown', `${key} Unknown`);
    assert.equal(unknown.missing.some((entry) => entry.key === key), false, 'Unknown is never missing');
  }
  // A personal check under the same key never decides a shared fact.
  const personalOnly = computeMatch({ propertyType: 'apartment', checks: { 'features:Pets Allowed': 'no' }, ratings: {} }, priorities);
  assert.equal(statusOf(personalOnly, 'features:Pets Allowed'), 'unknown');
});

test('the saved-home editor reads and writes the shared field for these facts only', () => {
  const editor = read('src/components/HomeModal.jsx');
  assert.match(editor, /const answerOf = \(key\) => \(SHARED_BOOLEAN_FACT_FIELDS\[key\] \? sharedFactAnswer\(form, key\) : foldedChecks\[key\]\);/);
  assert.match(editor, /if \(SHARED_BOOLEAN_FACT_FIELDS\[key\]\) set\(SHARED_BOOLEAN_FACT_FIELDS\[key\], sharedFactValue\(next\)\);\n\s+else setCheckItem\(item\.categoryKey, item\.label, next\);/);
  assert.match(editor, /const value = answerOf\(key\);/);
  assert.match(editor, /onClick=\{\(\) => setAnswer\(item, next\)\}/);
  assert.doesNotMatch(editor, /onClick=\{\(\) => setCheckItem\(/, 'no tri-state writes a personal check directly');
  // Match keeps reading only the shared fields for them.
  assert.match(read('src/lib/matching.js'), /const sharedBooleanField = SHARED_BOOLEAN_FACT_FIELDS\[ns\];/);
  // They stay shared home facts (persisted on homes), not personal state.
  assert.match(read('src/lib/supabase/collaboration.js'), /SHARED_FIELDS = \[[\s\S]*'petsAllowed', 'utilitiesIncluded', 'inUnitLaundry'/);
});

/* ------------------------------ real Postgres ------------------------------ */

const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared } = await import('../src/lib/supabase/collaboration.js');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('a recorded answer is one shared fact every member sees; each member\'s Match uses their own priorities', async () => {
  const owner = db.createUser({ email: 'owner.facts@example.com' });
  const coRenter = db.createUser({ email: 'corenter.facts@example.com' });
  const searchId = db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(owner), searchId, owner, 'corenter.facts@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(coRenter), invitation.token)).success, true);

  // The co-renter adds an apartment; nothing is known yet.
  const added = await saveHomePersonalAndShared(db.clientFor(coRenter), { address: '10 Elm St Apt 4', propertyType: 'apartment', status: 'Saved', checks: {}, ratings: {} }, coRenter, searchId);
  assert.equal(added.petsAllowed, null, 'unknown until someone records it');

  // They record Yes / No in the editor: it writes the shared fields.
  await saveHomePersonalAndShared(db.clientFor(coRenter), { ...added, petsAllowed: sharedFactValue(true), inUnitLaundry: sharedFactValue('no') }, coRenter, searchId);

  const [ownerView] = await getHomesForUser(db.clientFor(owner), owner, searchId);
  assert.equal(ownerView.petsAllowed, true);
  assert.equal(ownerView.inUnitLaundry, false);
  assert.equal(ownerView.utilitiesIncluded, null);
  assert.deepEqual(ownerView.checks, {}, 'nobody\'s personal checks changed');

  // Same facts, different personal priorities.
  const ownerMatch = computeMatch(ownerView, apartmentSearch('must'));
  const coRenterMatch = computeMatch(ownerView, apartmentSearch('nice'));
  assert.equal(statusOf(ownerMatch, 'features:Pets Allowed'), 'yes');
  assert.equal(statusOf(ownerMatch, 'features:In-Unit Laundry'), 'no');
  assert.equal(statusOf(ownerMatch, 'features:Utilities Included'), 'unknown');
  assert.equal(ownerMatch.allSelected.find((entry) => entry.key === 'features:Pets Allowed').tier, 'must');
  assert.equal(coRenterMatch.allSelected.find((entry) => entry.key === 'features:Pets Allowed').tier, 'nice');

  // Clearing back to Unknown stores null, and it stops counting.
  const [again] = await getHomesForUser(db.clientFor(coRenter), coRenter, searchId);
  await saveHomePersonalAndShared(db.clientFor(coRenter), { ...again, inUnitLaundry: sharedFactValue(undefined) }, coRenter, searchId);
  const [cleared] = await getHomesForUser(db.clientFor(owner), owner, searchId);
  assert.equal(cleared.inUnitLaundry, null);
  assert.equal(statusOf(computeMatch(cleared, apartmentSearch('must')), 'features:In-Unit Laundry'), 'unknown');
});
