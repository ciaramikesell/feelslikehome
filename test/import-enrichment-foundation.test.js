import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EVIDENCE_STRENGTH,
  createFinding,
  fieldPatchFromResolutions,
  findingsFromFields,
  mergeImportFields,
  resolveFindings,
  resolveImport,
} from '../src/lib/importDomain.js';
import { parseListingText, parseListingTextFindings } from '../src/lib/matching.js';
import { normalizeRentCastFields } from '../src/lib/rentcast.js';
import { computeMatch } from '../src/lib/matching.js';

const modal = fs.readFileSync('src/components/HomeModal.jsx', 'utf8');

test('field-aware merge fills empties, preserves false and zero, and is idempotent', () => {
  const patch = { address: '123 Main St', petsAllowed: false, garageSpaces: 0, sqft: '0' };
  const once = mergeImportFields({ address: '', petsAllowed: null, garageSpaces: '', sqft: undefined }, patch);
  assert.deepEqual(once, patch);
  assert.deepEqual(mergeImportFields(once, patch), once);
});

test('field-aware merge never overwrites an existing or user-edited value', () => {
  const imported = mergeImportFields({ price: '' }, { price: '100000' });
  const edited = { ...imported, price: '95000' };
  assert.equal(mergeImportFields(edited, { price: '100000' }).price, '95000');
  assert.equal(mergeImportFields({ petsAllowed: false }, { petsAllowed: true }).petsAllowed, false);
  assert.equal(mergeImportFields({ garageSpaces: 0 }, { garageSpaces: 2 }).garageSpaces, 0);
});

test('resolver corroborates normalized equivalent values', () => {
  const findings = [
    createFinding({ concept: 'garageSpaces', value: '2', sourceType: 'structured_listing', sourceProvider: 'rentcast', evidenceStrength: EVIDENCE_STRENGTH.AUTHORITATIVE }),
    createFinding({ concept: 'garageSpaces', value: 2, sourceType: 'listing_prose', sourceProvider: 'user_paste', evidenceStrength: EVIDENCE_STRENGTH.EXPLICIT }),
  ];
  const [resolution] = resolveFindings(findings);
  assert.equal(resolution.status, 'corroborated');
  assert.equal(resolution.winningFindingIds.length, 2);
});

test('resolver reports conflicting explicit facts and emits no patch', () => {
  const findings = findingsFromFields({ garageSpaces: 1 }, { sourceProvider: 'rentcast', evidenceStrength: 'authoritative' })
    .concat(findingsFromFields({ garageSpaces: 2 }, { sourceType: 'listing_prose', sourceProvider: 'user_paste' }));
  const result = resolveImport(findings);
  assert.equal(result.resolutions[0].status, 'conflict');
  assert.deepEqual(result.fieldPatch, {});
});

test('omission creates no finding and forbidden destinations cannot write', () => {
  assert.deepEqual(findingsFromFields({ petsAllowed: undefined, utilitiesIncluded: null }), []);
  assert.equal(createFinding({ concept: 'conditionNotes', value: 'New roof', sourceType: 'listing_prose', sourceProvider: 'paste' }), null);
  assert.deepEqual(mergeImportFields({ conditionNotes: '' }, { conditionNotes: 'New roof', ratings: { feel: 5 }, checks: { garage: true } }), { conditionNotes: '' });
  assert.deepEqual(fieldPatchFromResolutions([{ concept: 'schoolsNotes', status: 'resolved', value: 'Great schools' }]), {});
});

test('a current user value outranks an import candidate', () => {
  const finding = createFinding({ concept: 'beds', value: 3, sourceType: 'structured_listing', sourceProvider: 'rentcast' });
  const [resolution] = resolveFindings([finding], { beds: '4' });
  assert.equal(resolution.status, 'user_value');
  assert.equal(resolution.value, '4');
  assert.deepEqual(fieldPatchFromResolutions([resolution]), {});
});

test('raw rental text preserves explicit Yes, explicit No, and omission', () => {
  const yes = parseListingText('Apartment for rent. Pets allowed. All utilities included. In-unit laundry.', 'rental');
  assert.deepEqual({ pets: yes.petsAllowed, utilities: yes.utilitiesIncluded, laundry: yes.inUnitLaundry }, { pets: true, utilities: true, laundry: true });
  const no = parseListingText('No pets. Tenant pays all utilities. Shared laundry only.', 'rental');
  assert.deepEqual({ pets: no.petsAllowed, utilities: no.utilitiesIncluded, laundry: no.inUnitLaundry }, { pets: false, utilities: false, laundry: false });
  const omitted = parseListingText('A comfortable rental near everything.', 'rental');
  assert.equal(Object.hasOwn(omitted, 'petsAllowed'), false);
  assert.equal(Object.hasOwn(omitted, 'utilitiesIncluded'), false);
  assert.equal(Object.hasOwn(omitted, 'inUnitLaundry'), false);
});

test('raw adapter maps only exact property types and rejects marketing implications', () => {
  assert.equal(parseListingText('Property type: Townhouse').propertyType, 'townhome');
  const marketing = parseListingText('Turnkey open-concept gem with spa-like baths and amazing schools.');
  assert.deepEqual(marketing, {});
  assert.deepEqual(parseListingTextFindings('Turnkey open-concept gem.'), []);
});

test('RentCast adapter keeps normalized fields, zeroes, booleans when supported, and safety on empty input', () => {
  const result = normalizeRentCastFields({
    formattedAddress: '123 Main St', bedrooms: 3, bathrooms: 2, squareFootage: 1400, propertyType: 'Single Family',
    lotSize: 0, yearBuilt: 1990, features: { garageSpaces: 0 }, latitude: 0, longitude: 0,
    hoa: { fee: 0 }, propertyTaxes: { latest: { year: 2025, total: 0 } },
  }, { price: 0, daysOnMarket: 0 });
  assert.deepEqual(result.fields, {
    address: '123 Main St', price: '0', beds: '3', baths: '2', sqft: '1400',
    lotSize: '0 sq ft', yearBuilt: '1990', propertyType: 'house', garageSpaces: '0', daysOnMarket: '0',
    latitude: 0, longitude: 0, hoaFeeMonthly: 0, propertyTaxAnnual: 0, propertyTaxYear: 2025,
  });
  assert.ok(result.findings.length > 0);
  assert.equal(normalizeRentCastFields({ propertyType: 'Manufactured' }, null).fields.propertyType, undefined);
  assert.deepEqual(normalizeRentCastFields(null, null), { fields: {}, findings: [], resolutions: [], foundAny: false });
});

test('import foundation does not modify Match unknown semantics, ratings, or checks', () => {
  const priorities = { beds: { value: 3, tier: 'must' } };
  assert.equal(computeMatch({}, priorities), null);
  const current = { beds: '', ratings: { feel: 5 }, checks: { 'features:Fireplace': 'no' } };
  const merged = mergeImportFields(current, { beds: '3', ratings: {}, checks: {} });
  assert.deepEqual(merged.ratings, current.ratings);
  assert.deepEqual(merged.checks, current.checks);
});

test('HomeModal models successful raw text separately from provider errors and uses the shared merge', () => {
  assert.match(modal, /text-success/);
  assert.match(modal, /setImportPhase\(additions\.length > 0 \? 'text-success' : 'empty'\)/);
  assert.doesNotMatch(modal, /setImportPhase\('error'\);\s*\/\/ reveal the reviewable manual form/);
  assert.match(modal, /mergeImportFields\(form, result\.fieldPatch\)/);
  assert.match(modal, /mergeImportFields\(f, data\.fields \|\| \{\}\)/);
  assert.match(modal, /const showObjectiveGrid = !isNewHome/);
});
