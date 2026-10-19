// Home Facts completeness (PR #160): HOA fee always offered for a home to buy
// (Unknown vs a confirmed $0), an editable property tax year that never keeps
// a misleading listing year, Townhome on Home Facts, and the apartment floor
// plan / unit editable again. Pure checks run always; the database checks run
// against real Postgres when FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  PROPERTY_TYPE_CHOICES, editHoaFee, formatHoaFee, parseTaxYear, propertyTaxPatch, propertyTypeLabel,
} = await import('../src/lib/homeFacts.js');
const { fieldProvenance } = await import('../src/lib/homeProvenance.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities, TIER_META } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomeSharedFields,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const homeFactsSource = read('src/components/HomeFacts.jsx');
const homeModalSource = read('src/components/HomeModal.jsx');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);

/* ----------------------------------- HOA ----------------------------------- */

test('HOA fee: Unknown, a confirmed $0 and an amount read differently', () => {
  assert.equal(formatHoaFee(null), '', 'Unknown shows the Unknown placeholder');
  assert.equal(formatHoaFee(undefined), '');
  assert.equal(formatHoaFee(0), 'No HOA · $0/mo', 'a confirmed $0 is a real answer');
  assert.equal(formatHoaFee(275), '$275/mo');
  assert.equal(editHoaFee(0), '0', 'editing a confirmed $0 never opens blank (blank would mean Unknown)');
  assert.equal(editHoaFee(null), '');
  assert.equal(editHoaFee(1250), '$1,250');
});

test('HOA fee is always offered for a home to buy, including when Unknown, and never for a rental', () => {
  assert.doesNotMatch(homeFactsSource, /home\.hoaFeeMonthly != null &&/, 'no longer hidden when empty');
  assert.match(homeFactsSource, /\{!showsRentalFacts && <Row label="HOA fee" hint=\{isReadOnly \? null : 'Enter 0 if there’s no HOA'\} htmlFor="hf-hoaFeeMonthly">/, 'the $0 hint is for editors only');
  assert.match(homeFactsSource, /text\('hoaFeeMonthly', null, \{ parse: parseMoneyNumber, format: formatHoaFee, edit: editHoaFee/);
});

test('HOA fee is not a Match input, and the personal "No HOA" answer is untouched; weights stay 4 / 2 / 1', () => {
  assert.deepEqual([TIER_META.must.weight, TIER_META.important.weight, TIER_META.nice.weight], [4, 2, 1]);
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities.preferredPropertyTypes = { values: [], tier: 'dontcare' };
  priorities.budget = { ...priorities.budget, value: '400000', tier: 'important' };
  priorities = addCriterion(priorities, { categoryKey: 'location', label: 'No HOA', kind: 'check' }, 'must');
  const base = { price: '350000', checks: {} };
  const unknown = computeMatch(base, priorities);
  for (const hoaFeeMonthly of [null, 0, 450]) {
    assert.deepEqual(computeMatch({ ...base, hoaFeeMonthly }, priorities), unknown, `HOA ${hoaFeeMonthly} never moves Match`);
  }
  const noHoa = unknown.allSelected.find((item) => item.key === 'location:No HOA');
  assert.equal(noHoa.evaluated, false, 'a $0 fee does not answer anyone\'s personal No HOA');
});

/* -------------------------------- Tax year -------------------------------- */

test('tax year: four digits, blank is Unknown, anything else is not saved', () => {
  assert.equal(parseTaxYear('2025'), 2025);
  assert.equal(parseTaxYear(' 2024 '), 2024);
  assert.equal(parseTaxYear(''), null);
  for (const bad of ['25', '20255', '1899', String(new Date().getFullYear() + 2), 'next year', '2025.5']) {
    assert.equal(parseTaxYear(bad), undefined, bad);
  }
});

const imported = { fields: { propertyTaxAnnual: 4210, propertyTaxYear: 2025 } };

test('correcting an imported amount returns the listing\'s year to Unknown instead of mislabelling the new figure', () => {
  const home = { propertyTaxAnnual: 4210, propertyTaxYear: 2025, listingImport: imported };
  assert.deepEqual(propertyTaxPatch(home, 4800), { propertyTaxAnnual: 4800, propertyTaxYear: null });
  assert.deepEqual(propertyTaxPatch(home, null), { propertyTaxAnnual: null, propertyTaxYear: null }, 'clearing the amount clears the listing year too');
  // The snapshot is never edited, so the original stays provable.
  assert.equal(fieldProvenance(4210, imported, 'propertyTaxAnnual'), 'listing');
  assert.equal(fieldProvenance(4800, imported, 'propertyTaxAnnual'), 'you');
});

test('a year a person entered is theirs; setting the listing amount back brings the listing year back', () => {
  const corrected = { propertyTaxAnnual: 4800, propertyTaxYear: 2026, listingImport: imported };
  assert.equal(fieldProvenance(2026, imported, 'propertyTaxYear'), 'you');
  assert.deepEqual(propertyTaxPatch(corrected, 5000), { propertyTaxAnnual: 5000 }, 'their own year is never touched');
  const cleared = { propertyTaxAnnual: 4800, propertyTaxYear: null, listingImport: imported };
  assert.deepEqual(propertyTaxPatch(cleared, 4210), { propertyTaxAnnual: 4210, propertyTaxYear: 2025 });
  // No snapshot (manual home): only the amount changes.
  assert.deepEqual(propertyTaxPatch({ propertyTaxAnnual: 3000, propertyTaxYear: 2024, listingImport: null }, 3100), { propertyTaxAnnual: 3100 });
});

test('Home Facts edits the tax year beside the amount, and the amount routes through propertyTaxPatch', () => {
  assert.match(homeFactsSource, /<label htmlFor="hf-propertyTaxAnnual">Annual taxes<\/label>/);
  assert.match(homeFactsSource, /onCommit: \(value\) => save\(propertyTaxPatch\(home, value\)\)/);
  assert.match(homeFactsSource, /<label htmlFor="hf-propertyTaxYear">Tax year<\/label>\{text\('propertyTaxYear', null, \{ parse: parseTaxYear/);
  assert.doesNotMatch(homeFactsSource, /annualTaxesLabel/);
});

/* -------------------------------- Townhome -------------------------------- */

test('Townhome is offered on Home Facts with its canonical value; the other choices are unchanged', () => {
  assert.deepEqual(PROPERTY_TYPE_CHOICES, [['house', 'Single-Family'], ['townhome', 'Townhome'], ['multifamily', 'Multi-Family'], ['condo', 'Condominium']]);
  assert.equal(propertyTypeLabel('townhome'), 'Townhome');
  // A saved value not offered (Other, Apartment) still reads by its label.
  assert.equal(propertyTypeLabel('other'), 'Other');
  assert.equal(propertyTypeLabel('apartment'), 'Apartment');
});

/* ------------------------- Apartment floor plan / unit ------------------------- */

test('the apartment editor edits floor plan name and unit; the house quick-add card does not', () => {
  assert.match(homeModalSource, /\{apartment && <div className="hh-edit-fields-grid">\s*<div><label className="hh-label" htmlFor="home-floor-plan-name">Floor plan name<\/label>/);
  assert.match(homeModalSource, /set\('selectedFloorPlanName', e\.target\.value\)/);
  assert.match(homeModalSource, /set\('selectedUnitLabel', e\.target\.value\)/);
  const quickAdd = homeModalSource.slice(homeModalSource.indexOf('function ImportFoundCard'), homeModalSource.indexOf('export default function HomeModal'));
  assert.doesNotMatch(quickAdd, /selectedFloorPlanName|selectedUnitLabel/);
  assert.match(homeFactsSource, /\{apartment && identity\.option && <p className="flh-hf2-locality">\{identity\.option\}<\/p>\}/);
});

/* ------------------------------ Real Postgres ------------------------------ */

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  for (const key of ['owner', 'coBuyer', 'realtor', 'outsider']) ids[key] = db.createUser({ email: `${key}.completeness@example.com` });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  for (const [key, role] of [['coBuyer', 'co_buyer'], ['realtor', 'realtor']]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, `${key}.completeness@example.com`, role);
    assert.equal((await acceptInvitation(db.clientFor(ids[key]), invitation.token)).success, true);
  }
});
after(() => db?.drop());

const row = (id) => db.admin(`select * from public.homes where id = '${id}'`)[0];
const reload = async (user, homeId) => (await getHomesForUser(db.clientFor(user), user, ids.search, { homeId }))[0];
async function rejectsWith(promise, pattern) {
  try { await promise; } catch (error) { assert.match(`${error.code || ''} ${error.message}`, pattern); return; }
  assert.fail('expected the write to be refused');
}

dbTest('HOA: Unknown → confirmed $0 → amount → Unknown, saved and reloaded by owner and co-buyer', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), { address: '1 Hoa Ct', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  assert.equal(row(added.id).hoa_fee_monthly, null, 'a new home is Unknown');
  assert.equal((await reload(ids.coBuyer, added.id)).hoaFeeMonthly, null);

  await saveHomeSharedFields(db.clientFor(ids.coBuyer), added.id, { hoaFeeMonthly: 0 });
  assert.equal(Number(row(added.id).hoa_fee_monthly), 0, 'a confirmed $0 is stored as 0, not null');
  const zero = await reload(ids.owner, added.id);
  assert.equal(Number(zero.hoaFeeMonthly), 0);
  assert.equal(formatHoaFee(zero.hoaFeeMonthly), 'No HOA · $0/mo', 'and reloads as No HOA, not Unknown');

  await saveHomeSharedFields(db.clientFor(ids.owner), added.id, { hoaFeeMonthly: 325 });
  assert.equal(Number((await reload(ids.coBuyer, added.id)).hoaFeeMonthly), 325);
  await saveHomeSharedFields(db.clientFor(ids.owner), added.id, { hoaFeeMonthly: null });
  assert.equal(row(added.id).hoa_fee_monthly, null, 'back to Unknown');
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${added.id}' and checks <> '{}'::jsonb`)[0].n, 0, 'no personal answer was written');
});

dbTest('tax year: a corrected amount clears the listing year, a typed year saves, the snapshot is untouched', async () => {
  const owner = db.clientFor(ids.owner);
  const added = await saveHomePersonalAndShared(owner, { address: '2 Tax Ter', status: 'Saved', checks: {}, ratings: {}, propertyTaxAnnual: 4210, propertyTaxYear: 2025, listingImport: imported }, ids.owner, ids.search);
  let home = await reload(ids.coBuyer, added.id);
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), added.id, propertyTaxPatch(home, 4800));
  assert.deepEqual([Number(row(added.id).property_tax_annual), row(added.id).property_tax_year], [4800, null]);
  await saveHomeSharedFields(owner, added.id, { propertyTaxYear: parseTaxYear('2026') });
  home = await reload(ids.owner, added.id);
  assert.deepEqual([Number(home.propertyTaxAnnual), home.propertyTaxYear], [4800, 2026]);
  assert.deepEqual(row(added.id).listing_import, imported, 'the listing snapshot still proves what the listing said');
  assert.equal(fieldProvenance(home.propertyTaxYear, home.listingImport, 'propertyTaxYear'), 'you');
});

dbTest('Townhome saves and reloads as the canonical value; non-canonical values are refused', async () => {
  const owner = db.clientFor(ids.owner);
  const added = await saveHomePersonalAndShared(owner, { address: '3 Row Ln', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), added.id, { propertyType: 'townhome' });
  assert.equal(row(added.id).property_type, 'townhome');
  assert.equal((await reload(ids.owner, added.id)).propertyType, 'townhome');
  await rejectsWith(saveHomeSharedFields(owner, added.id, { propertyType: 'Townhome' }), /homes_property_type_check|violates check/);
  assert.equal(row(added.id).property_type, 'townhome');
});

dbTest('apartment floor plan and unit: full-editor save and reload, blank is Unknown (null)', async () => {
  const owner = db.clientFor(ids.owner);
  const added = await saveHomePersonalAndShared(owner, { address: '4 Tower Pl, Ann Arbor, MI', propertyName: 'The Tower', selectedFloorPlanName: ' The Aspen ', selectedUnitLabel: '304', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  assert.deepEqual([row(added.id).selected_floor_plan_name, row(added.id).selected_unit_label], ['The Aspen', '304']);
  const view = await reload(ids.coBuyer, added.id);
  assert.deepEqual([view.selectedFloorPlanName, view.selectedUnitLabel], ['The Aspen', '304']);
  await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), { ...view, selectedUnitLabel: '   ' }, ids.coBuyer, ids.search);
  assert.equal(row(added.id).selected_unit_label, null, 'whitespace is Unknown, not an answer');
  assert.equal(row(added.id).selected_floor_plan_name, 'The Aspen');
});

dbTest('Realtors and outsiders cannot change any of the new or restored facts', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), { address: '5 Guarded Way', status: 'Saved', checks: {}, ratings: {}, hoaFeeMonthly: 0, propertyTaxAnnual: 3000, propertyTaxYear: 2024, propertyType: 'townhome' }, ids.owner, ids.search);
  const before = row(added.id);
  for (const user of [ids.realtor, ids.outsider]) {
    for (const patch of [{ hoaFeeMonthly: 999 }, { propertyTaxYear: 2020 }, { propertyType: 'condo' }, { selectedUnitLabel: '9' }, { selectedFloorPlanName: 'X' }]) {
      await rejectsWith(saveHomeSharedFields(db.clientFor(user), added.id, patch), /row-level security|permission denied|expected one row/i);
    }
  }
  assert.deepEqual(row(added.id), before);
});

dbTest('heating and cooling still save and reload exactly as before (unchanged by this PR)', async () => {
  const owner = db.clientFor(ids.owner);
  const added = await saveHomePersonalAndShared(owner, { address: '6 Climate Ct', status: 'Saved', checks: {}, ratings: {} }, ids.owner, ids.search);
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), added.id, { heating: 'Forced Air, Gas', cooling: 'Central Air' });
  const view = await reload(ids.owner, added.id);
  assert.deepEqual([view.heating, view.cooling], ['Forced Air, Gas', 'Central Air']);
  await saveHomeSharedFields(owner, added.id, { heating: null, cooling: null });
  assert.deepEqual([row(added.id).heating, row(added.id).cooling], [null, null]);
});
