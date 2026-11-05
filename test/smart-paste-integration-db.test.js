// Smart Listing Details Paste (#173) with #172 (inline Notes / Pros / Cons,
// guarded shared saves) and #170 (Match Reveal) against real Postgres.
// Opt-in like the other DB tests (docs/database-tests.md).
//
// A pasted fact is used only in Add Home, before the home exists; Home Facts
// edits happen afterwards on the saved row. These tests pin that neither can
// overwrite the other, and that the Notes / Pros / Cons typed in Add Home are
// saved exactly as typed.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  SharedNotesConflictError, acceptInvitation, claimMatchReveal, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomeSharedFields,
} = await import('../src/lib/supabase/collaboration.js');
const { suggestHomeFacts, applyHomeFactSuggestion, importResultWithHomeFacts, combineImportResults, resuggestHomeFacts } = await import('../src/lib/listingTextHomeFacts.js');
const { listingTextEvidence } = await import('../src/lib/listingTextAnswers.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { fieldProvenance } = await import('../src/lib/homeProvenance.js');
const { resolveCriterionAnswer } = await import('../src/lib/homeFactCriteria.js');
const { emptyHome } = await import('../src/lib/constants.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const TEXT = 'Finished walkout basement. Laundry on the main level. Attached 2-car garage. HOA $85/month. Located in the award-winning Rochester Community Schools.';

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  for (const key of ['owner', 'coBuyer']) ids[key] = db.createUser({ email: `${key}.smartpaste@example.com` });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'coBuyer.smartpaste@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

const reload = async (who, id) => (await getHomesForUser(db.clientFor(ids[who]), ids[who], ids.search, { homeId: id }))[0];

// What Add Home does: typed Notes / Pros / Cons, pasted text, Use on every suggestion, then Save.
async function addWithPaste(address, { notes = '', pros = '', cons = '' } = {}) {
  const typed = { ...emptyHome(), address, status: 'Saved', checks: {}, ratings: {}, notes, pros, cons };
  const suggestions = suggestHomeFacts(TEXT, typed);
  const form = suggestions.reduce(applyHomeFactSuggestion, typed);
  const used = Object.fromEntries(suggestions.map((item) => [item.id, item]));
  const textResult = { fields: {}, descriptionFeatures: listingTextEvidence(TEXT), suggestions: [], source: 'raw-text' };
  const snapshot = listingImportSnapshot(importResultWithHomeFacts(combineImportResults(null, textResult), used, form));
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...form, listingImport: snapshot }, ids.owner, ids.search);
  return { id: saved.id, form, used };
}

dbTest('Add Home: pasted facts save, and typed Notes / Pros / Cons are saved exactly as typed', async () => {
  const { id } = await addWithPaste('1 Paste Integration Way, Testville, MI', { notes: 'Ask about the sewer line', pros: 'Great backyard\nQuiet street', cons: '' });
  const home = await reload('owner', id);
  assert.deepEqual([home.notes, home.pros, home.cons], ['Ask about the sewer line', 'Great backyard\nQuiet street', '']);
  assert.equal(home.basementCondition, 'finished');
  assert.equal(home.laundryLocation, 'first_floor');
  assert.equal(home.garageSpaces, '2');
  assert.equal(Number(home.hoaFeeMonthly), 85);
  assert.equal(home.schoolDistrict, 'Rochester Community Schools');
  assert.equal(home.listingImport.source, 'pasted_text');
  assert.equal(fieldProvenance(home.basementCondition, home.listingImport, 'basementCondition'), 'listing');
  // No personal answer was written by pasting.
  const state = db.admin(`select checks from public.home_member_state where home_id = '${id}' and user_id = '${ids.owner}'`)[0];
  assert.deepEqual(state?.checks || {}, {});
});

dbTest('a Home Facts edit after Add Home wins over the pasted value, and the snapshot never re-applies or claims it', async () => {
  const { id } = await addWithPaste('2 Paste Integration Way, Testville, MI');
  const before = db.admin(`select listing_import from public.homes where id = '${id}'`)[0].listing_import;
  // The co-buyer corrects the basement in Home Facts (overlay autosave: column-level UPDATE).
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), id, { basementCondition: 'partially_finished' });
  const home = await reload('owner', id);
  assert.equal(home.basementCondition, 'partially_finished');
  assert.equal(fieldProvenance(home.basementCondition, home.listingImport, 'basementCondition'), 'you', 'an edited value is never shown as From listing');
  assert.deepEqual(db.admin(`select listing_import from public.homes where id = '${id}'`)[0].listing_import, before, 'Home Facts saves never touch the snapshot');
  // The snapshot can't be written through the overlay's shared save at all.
  await assert.rejects(() => saveHomeSharedFields(db.clientFor(ids.owner), id, { listingImport: { fields: {} } }), /Not shared home fields: listingImport/);
  // Reading the same text again (as a rerun would) never suggests over the edit.
  assert.equal(suggestHomeFacts(TEXT, home).some((item) => item.field === 'basementCondition'), false);
  assert.equal(resuggestHomeFacts(TEXT, home, {}).home.basementCondition, 'partially_finished');
  // Untouched pasted facts stay as saved.
  assert.equal(home.laundryLocation, 'first_floor');
  assert.equal(fieldProvenance(home.laundryLocation, home.listingImport, 'laundryLocation'), 'listing');
});

dbTest('a value a person entered before Use is never overwritten by a pasted suggestion', async () => {
  const typed = { ...emptyHome(), address: '3 Paste Integration Way, Testville, MI', status: 'Saved', checks: {}, ratings: {}, basementCondition: 'unfinished', garageSpaces: '0', hoaFeeMonthly: 0 };
  const suggestions = suggestHomeFacts(TEXT, typed);
  assert.equal(suggestions.some((item) => ['basementCondition', 'garageSpaces', 'hoaFeeMonthly'].includes(item.field)), false);
  const form = suggestHomeFacts(TEXT, {}).reduce(applyHomeFactSuggestion, typed);
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), form, ids.owner, ids.search);
  const home = await reload('owner', saved.id);
  assert.equal(home.basementCondition, 'unfinished');
  assert.equal(home.garageSpaces, '0');
  assert.equal(Number(home.hoaFeeMonthly), 0);
  assert.notEqual(home.hoaFeeMonthly, null);
});

dbTest('#172 guarded Notes saves keep working on a pasted home, and never touch its Home Facts', async () => {
  const { id } = await addWithPaste('4 Paste Integration Way, Testville, MI', { notes: 'Ask about the sewer line' });
  // The co-buyer edits notes inline; the owner's editor still holds the older text.
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), id, { notes: 'Ask about the sewer line\nRoof 2019' }, { expected: { notes: 'Ask about the sewer line' } });
  await assert.rejects(
    () => saveHomeSharedFields(db.clientFor(ids.owner), id, { notes: 'Sewer is city' }, { expected: { notes: 'Ask about the sewer line' } }),
    (error) => error instanceof SharedNotesConflictError && error.current.notes === 'Ask about the sewer line\nRoof 2019',
  );
  const home = await reload('owner', id);
  assert.equal(home.notes, 'Ask about the sewer line\nRoof 2019');
  assert.equal(home.basementCondition, 'finished');
  assert.equal(home.schoolDistrict, 'Rochester Community Schools');
});

dbTest('Match: a pasted fact answers both buyers through Home Facts; each buyer\'s own answer stays theirs', async () => {
  const { id } = await addWithPaste('5 Paste Integration Way, Testville, MI');
  const owner = await reload('owner', id);
  const coBuyer = await reload('coBuyer', id);
  assert.equal(resolveCriterionAnswer(owner, 'features:Finished basement', owner.checks).source, 'home_facts');
  assert.equal(resolveCriterionAnswer(coBuyer, 'features:Finished basement', coBuyer.checks).source, 'home_facts');
  // The co-buyer overrides for themselves only.
  db.exec(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${id}', '${ids.coBuyer}', 'Saved', '{"features:Finished basement": "no"}')
    on conflict (home_id, user_id) do update set checks = excluded.checks`);
  assert.equal(resolveCriterionAnswer(await reload('coBuyer', id), 'features:Finished basement', (await reload('coBuyer', id)).checks).value, 'no');
  assert.equal(resolveCriterionAnswer(await reload('owner', id), 'features:Finished basement', (await reload('owner', id)).checks).value, true);
});

dbTest('Match Reveal (#170): Add Home records no reveal; a later claim still works once per buyer', async () => {
  const { id } = await addWithPaste('6 Paste Integration Way, Testville, MI');
  assert.equal(db.admin(`select count(*)::int as n from public.match_reveals where home_id = '${id}'`)[0].n, 0, 'saving a pasted home claims nothing');
  assert.equal(await claimMatchReveal(db.clientFor(ids.owner), id, { token: randomUUID() }), true);
  assert.equal(await claimMatchReveal(db.clientFor(ids.owner), id, { token: randomUUID() }), false);
  assert.equal(await claimMatchReveal(db.clientFor(ids.coBuyer), id, { token: randomUUID() }), true, 'the co-buyer has their own');
});
