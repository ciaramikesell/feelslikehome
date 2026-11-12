// Add Home V3 review: listing facts offered at Add Home but not added are kept
// for later (homes.listing_import.offeredFacts, additive jsonb, no migration)
// and reviewed in Home Facts, never accepted automatically, never read by
// Match; and a fact the buyer accepted survives a later paste that omits it.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  applyHomeFactSuggestion, importResultWithHomeFacts, importResultWithOfferedFacts, isPreselectedHomeFact, offeredHomeFacts, pendingOfferedFacts, suggestHomeFacts,
} = await import('../src/lib/listingTextHomeFacts.js');
const { listingTextEvidence } = await import('../src/lib/listingTextAnswers.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { fieldProvenance } = await import('../src/lib/homeProvenance.js');
const { importedDetailCount } = await import('../src/lib/homeFacts.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { emptyHome, normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared } = await import('../src/lib/supabase/collaboration.js');
const { applyListingAnswer, resuggestListingAnswers, suggestListingAnswers, undoListingAnswer } = await import('../src/lib/listingTextAnswers.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/HomeModal.jsx');
const facts = read('src/components/HomeFacts.jsx');
const TEXT = 'Finished walkout basement. Laundry on the main level. Primary suite on the first floor. HOA dues of $1,200 per year. Rochester Community Schools.';

// A paste where the buyer added the default checked facts except Laundry.
function pastedAndSaved() {
  const suggestions = suggestHomeFacts(TEXT, emptyHome());
  const chosen = suggestions.filter((item) => isPreselectedHomeFact(item) && item.field !== 'laundryLocation');
  const home = chosen.reduce(applyHomeFactSuggestion, { ...emptyHome(), address: '5 Offer Ct, Testville, MI 48000' });
  const used = Object.fromEntries(chosen.map((item) => [item.id, item]));
  const base = { source: 'raw-text', fields: {}, listingFacts: [], descriptionFeatures: listingTextEvidence(TEXT) };
  const source = importResultWithOfferedFacts(importResultWithHomeFacts(base, used, home), offeredHomeFacts(suggestions, used, home));
  return { home: { ...home, listingImport: listingImportSnapshot(source, 'x') }, suggestions, used };
}

test('the snapshot keeps exactly the offered-but-not-added facts, with their sentences, one per field', () => {
  const { home } = pastedAndSaved();
  const offered = home.listingImport.offeredFacts;
  assert.deepEqual(offered.map((item) => item.field), ['laundryLocation', 'hoaFeeMonthly', 'schoolDistrict']);
  assert.ok(offered.every((item) => item.evidence && item.sourceProvider === 'user_paste' && item.display && !('id' in item)));
  // Added facts are in pastedFacts / fields, never in offeredFacts.
  assert.deepEqual(home.listingImport.pastedFacts.map((item) => item.field).sort(), ['basementCondition', 'basementStyle', 'primaryBedroomLocation']);
  // No offer: no key. No paste: no snapshot change.
  assert.equal(importResultWithOfferedFacts({ fields: {} }, []).offeredFacts, undefined);
  assert.equal(importResultWithOfferedFacts(null, [{ field: 'laundryLocation' }]), null);
  assert.equal('offeredFacts' in listingImportSnapshot({ fields: {}, source: 'raw-text' }, 'x'), false);
});

test('offered facts are only an offer: never a value, never counted, never read by Match', () => {
  const { home } = pastedAndSaved();
  assert.equal(home.laundryLocation ?? null, null);
  assert.equal(home.hoaFeeMonthly ?? null, null);
  assert.equal(home.schoolDistrict ?? null, null);
  const without = { ...home, listingImport: { ...home.listingImport, offeredFacts: undefined } };
  assert.equal(importedDetailCount(home.listingImport), importedDetailCount(without.listingImport), 'not counted as listing details');
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'First-floor laundry', kind: 'check' }, 'must');
  priorities = addCriterion(priorities, { categoryKey: 'location', label: 'No HOA', kind: 'check' }, 'important');
  assert.deepEqual(computeMatch(home, priorities), computeMatch(without, priorities));
  const laundry = computeMatch(home, priorities).allSelected.find((item) => /laundry/i.test(item.label));
  assert.equal(laundry.evaluated, false, 'Unknown, not No');
});

test('later review: open offers only while the field is empty and the value fits; anything else is ignored', () => {
  const { home } = pastedAndSaved();
  assert.deepEqual(pendingOfferedFacts(home).map((item) => item.field), ['laundryLocation', 'hoaFeeMonthly', 'schoolDistrict']);
  // Filled since (by anyone, any value, including $0): that offer is gone, never overwritten.
  assert.deepEqual(pendingOfferedFacts({ ...home, laundryLocation: 'basement', hoaFeeMonthly: 0 }).map((item) => item.field), ['schoolDistrict']);
  // A value that would contradict the home now is not offered.
  const walkoutOffer = { ...home, basementStyle: null, basementCondition: 'none', listingImport: { ...home.listingImport, offeredFacts: [{ field: 'basementStyle', value: 'walkout', sourceProvider: 'user_paste' }] } };
  assert.deepEqual(pendingOfferedFacts(walkoutOffer), []);
  // Malformed, foreign or duplicate entries are ignored.
  const junk = { ...emptyHome(), listingImport: { offeredFacts: [null, { field: 'photoUrl', value: 'x', sourceProvider: 'user_paste' }, { field: 'laundryLocation', value: 'first_floor', sourceProvider: 'rentcast' },
    { field: 'laundryLocation', value: '', sourceProvider: 'user_paste' }, { field: 'laundryLocation', value: 'first_floor', sourceProvider: 'user_paste' }, { field: 'laundryLocation', value: 'basement', sourceProvider: 'user_paste' }] } };
  assert.deepEqual(pendingOfferedFacts(junk).map((item) => [item.field, item.value]), [['laundryLocation', 'first_floor']]);
  assert.deepEqual(pendingOfferedFacts(emptyHome()), []);
  assert.deepEqual(pendingOfferedFacts({ listingImport: { offeredFacts: 'nope' } }), []);
});

test('provenance: a later-added offer reads From listing only while it holds the offered value', () => {
  const { home } = pastedAndSaved();
  assert.equal(fieldProvenance('first_floor', home.listingImport, 'laundryLocation'), 'listing');
  assert.equal(fieldProvenance('second_floor', home.listingImport, 'laundryLocation'), 'you');
  assert.equal(fieldProvenance('finished', home.listingImport, 'basementCondition'), 'listing', 'added facts unchanged');
  assert.equal(fieldProvenance(null, home.listingImport, 'laundryLocation'), 'unknown');
});

test('wiring: Save keeps the offers; Home Facts shows one row and a sheet, unchecked; Add uses the ordinary save, empty fields only', () => {
  assert.match(modal, /importResultWithOfferedFacts\(importResultWithHomeFacts\(importResult, usedFacts, form\), offeredHomeFacts\(factSuggestions, usedFacts, form\)\)/);
  // Home Facts: one quiet row, no inline fold-out; Review opens the shared checklist in a sheet.
  const entry = facts.match(/function OfferedFactsEntry[\s\S]*?\n\}/)[0];
  assert.match(entry, /From the listing · \{count\} detail\{count === 1 \? '' : 's'\} not added yet/);
  assert.match(entry, /<button type="button" className="flh-offered-review" onClick=\{\(\) => setOpen\(true\)\} aria-haspopup="dialog">Review<\/button>/);
  assert.match(entry, /if \(!count\) return null;/);
  assert.doesNotMatch(facts, /<details/, 'Home Facts has no inline fold-out');
  assert.match(facts, /\{!isReadOnly && <OfferedFactsEntry home=\{home\} onAdd=\{save\} \/>\}/, 'Realtors and read-only views never see it');
  const sheet = read('src/components/FactChecklist.jsx').match(/export function OfferedFactsSheet[\s\S]*?\n\}/)[0];
  assert.match(sheet, /<Sheet open=\{open && offered\.length > 0\}/);
  assert.match(sheet, /const \[chosen, setChosen\] = useState\(\{\}\);/, 'nothing preselected');
  assert.match(sheet, /isSelected=\{\(item\) => !!chosen\[item\.id\]\}/);
  assert.match(sheet, /const after = applyHomeFactSuggestion\(next, item\);/, 'empty fields only, values that fit');
  assert.match(sheet, /<FactChecklistRows /, 'the same checklist as Add Home');
  assert.doesNotMatch(sheet, /checks|onAnswer|listingImport/, 'no Match answers, no listing_import write');
  // A re-paste that only restates kept facts or personal mentions never claims the text said nothing.
  assert.match(modal, /if \(!details && !answers && !facts && mentioned\) return \[reset, 'Nothing new to add from that text\. What it mentions is noted below, and anything you already added is kept\.'\]/);
  assert.match(modal, /const mentioned = homeFactDisagreements\(pasteText, next\)\.length \+ \(personalDeferred/);
});

test('no migration or schema change: offers ride in the existing listing_import jsonb', async () => {
  const { readdirSync } = await import('node:fs');
  const schema = read('supabase/schema.sql');
  assert.match(schema, /add column if not exists listing_import jsonb/);
  assert.match(schema, /grant update \(listing_import\) on public\.homes to authenticated;/);
  // Nothing in the database layer names the new keys: they are plain jsonb inside the snapshot.
  const sql = [schema, ...readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((file) => read(`supabase/migrations/${file}`))].join('\n');
  assert.doesNotMatch(sql, /offeredFacts|offered_facts|pastedFacts/);
  // And only the Add Home save writes them: Home Facts (and the later review) never write listing_import.
  const code = (facts + read('src/components/FactChecklist.jsx')).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /listingImport\s*:|listing_import/);
});

/* --------------------------------- real Postgres --------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.offered@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.offered@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.offered@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('saved offers survive reload; the co-buyer reviews and adds one; nothing else changes', async () => {
  const { home } = pastedAndSaved();
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), home, ids.owner, ids.search);
  const row = () => db.admin(`select laundry_location, hoa_fee_monthly, school_district, listing_import from public.homes where id = '${saved.id}'`)[0];
  assert.deepEqual([row().laundry_location, row().hoa_fee_monthly, row().school_district], [null, null, null], 'offers are not values');
  assert.deepEqual(row().listing_import.offeredFacts.map((item) => item.field), ['laundryLocation', 'hoaFeeMonthly', 'schoolDistrict']);

  // The co-buyer loads the same home and sees the same open offers.
  const asCoBuyer = (await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search)).find((item) => item.id === saved.id);
  const open = pendingOfferedFacts(asCoBuyer);
  assert.deepEqual(open.map((item) => item.field), ['laundryLocation', 'hoaFeeMonthly', 'schoolDistrict']);
  // They add Laundry through the ordinary shared save (what Home Facts' Add does).
  const laundry = open.find((item) => item.field === 'laundryLocation');
  await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), applyHomeFactSuggestion(asCoBuyer, laundry), ids.coBuyer, ids.search);

  const asOwner = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).find((item) => item.id === saved.id);
  assert.equal(asOwner.laundryLocation, 'first_floor');
  assert.equal(fieldProvenance(asOwner.laundryLocation, asOwner.listingImport, 'laundryLocation'), 'listing');
  assert.deepEqual(pendingOfferedFacts(asOwner).map((item) => item.field), ['hoaFeeMonthly', 'schoolDistrict'], 'the added offer drops off for everyone');
  assert.equal(row().hoa_fee_monthly, null, 'other offers untouched');
  assert.deepEqual(row().listing_import, home.listingImport, 'the snapshot itself is unchanged');
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${saved.id}' and checks <> '{}'::jsonb`)[0].n, 0, 'no Match answers');
});

dbTest('a confirmed personal answer survives a repeated paste and is saved for that buyer only; Undo and an explicit change still work', async () => {
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Fireplace', kind: 'check' }, 'must');
  const FIRE = 'features:Fireplace';
  // Full editor session: confirm from the first text…
  const [suggestion] = suggestListingAnswers('Gas fireplace in the den.', priorities, {}).filter((item) => item.key === FIRE);
  let checks = applyListingAnswer({}, suggestion, 'home_buy');
  let confirmed = { [FIRE]: true };
  // …then paste text that omits it, then text that contradicts it: still Yes, the No is information only.
  for (const text of ['Bright kitchen.', 'No fireplace.']) {
    const rerun = resuggestListingAnswers(text, priorities, checks, confirmed, [suggestion]);
    assert.deepEqual(rerun.checks, { [FIRE]: true }, text);
    ({ checks, confirmed } = rerun);
  }
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '9 Kept Answer Ln, Testville, MI 48000', checks }, ids.owner, ids.search);
  const states = db.admin(`select user_id, checks from public.home_member_state where home_id = '${saved.id}' order by user_id`);
  assert.deepEqual(states.find((row) => row.user_id === ids.owner).checks, { [FIRE]: true });
  assert.ok(states.filter((row) => row.user_id !== ids.owner).every((row) => !Object.keys(row.checks || {}).length), 'the co-buyer gets none of it');
  // Undo (still owned by the suggestion) goes back to Unknown; an explicit No is the buyer's own.
  assert.deepEqual(undoListingAnswer(checks, suggestion), {});
  const asOwner = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).find((item) => item.id === saved.id);
  await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...asOwner, checks: { [FIRE]: 'no' } }, ids.owner, ids.search);
  assert.deepEqual(db.admin(`select checks from public.home_member_state where home_id = '${saved.id}' and user_id = '${ids.owner}'`)[0].checks, { [FIRE]: 'no' });
});
