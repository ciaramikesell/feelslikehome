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

test('wiring: Save keeps the offers; Home Facts shows them folded and unchecked; Add uses the ordinary save, empty fields only', () => {
  assert.match(modal, /importResultWithOfferedFacts\(importResultWithHomeFacts\(importResult, usedFacts, form\), offeredHomeFacts\(factSuggestions, usedFacts, form\)\)/);
  const offered = facts.match(/function OfferedFacts[\s\S]*?\n\}/)[0];
  assert.match(offered, /<details className="hh-details flh-offered-facts">/);
  assert.doesNotMatch(offered, /<details className="hh-details flh-offered-facts" open/);
  assert.match(offered, /const \[chosen, setChosen\] = useState\(\{\}\);/, 'nothing preselected');
  assert.match(offered, /const after = applyHomeFactSuggestion\(next, item\);/);
  assert.match(offered, /FLH hasn’t verified it or checked school boundaries\./);
  assert.match(facts, /\{!isReadOnly && <OfferedFacts home=\{home\} onAdd=\{save\} \/>\}/, 'Realtors and read-only views never see it');
  assert.doesNotMatch(offered, /checks|onAnswer/);
  // A re-paste that only restates kept facts or personal mentions never claims the text said nothing.
  assert.match(modal, /if \(!details && !answers && !facts && mentioned\) return \[reset, 'Nothing new to add from that text\. What it mentions is noted below, and anything you already added is kept\.'\]/);
  assert.match(modal, /const mentioned = homeFactDisagreements\(pasteText, next\)\.length \+ \(personalDeferred/);
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
