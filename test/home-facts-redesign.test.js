// Add Home → Home Facts → Match Criteria. See docs/home-facts-flow-redesign.md.
//
// Pure helpers are tested directly; the flow guarantees (one Add action, a save
// before any navigation, the disappearing-home fix) are pinned in source; and
// the shared-fact writes, Unknown vs None, co-buyer edits, Realtor read-only,
// the import → save → retry path and the migration's preflight run against
// real Postgres.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  importedDetailCount, normalizeLotSizeInput, garageSpacesChoice, garageSpacesLabel, homeFactSections, homeFactsAvailability,
  homeFactsHeader, homeFactsPatch, homeFactsDraft, homeFactsWelcome, HOME_FACT_GROUP_FIELDS, fromListingLine,
} = await import('../src/lib/homeFacts.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { emptyHome, normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { normalizeRentCastFields, canonicalGarageType } = await import('../src/lib/rentcast.js');
const { createFinding, mergeImportFields } = await import('../src/lib/importDomain.js');
const { answerableCriteriaKeys, criterionAnswer } = await import('../src/lib/matchCriteria.js');
const { formatCardBasement, homeCardSnapshot } = await import('../src/lib/homeCardPresentation.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/HomeModal.jsx');
const board = read('src/components/HomesBoard.jsx');
const detail = read('src/components/HomeDetail.jsx');
const facts = read('src/components/HomeFacts.jsx');
const criteria = read('src/components/MatchCriteria.jsx');
const factsLib = read('src/lib/homeFacts.js');
const detailPage = read('src/app/(app)/homes/[homeId]/page.js');
const persistence = read('src/lib/supabase/collaboration.js');
const MIGRATION = 'supabase/migrations/2026-10-17-home-facts-details.sql';

const buy = () => applySearchChoice(normalizePriorities({}), 'home_buy');
const rent = () => applySearchChoice(normalizePriorities({}), 'home_rent');
// A snapshot from before the structured fields existed: heating etc. only as listing facts.
const LEGACY_SNAPSHOT = {
  fields: { address: '1 Main St, Town, MI 48000', price: '335000', beds: '5', garageSpaces: '2', basementNotes: 'Unfinished', latitude: 1, longitude: 2, propertyTaxAnnual: 4000, propertyTaxYear: 2025 },
  listingFacts: [{ key: 'garageType', label: 'Garage', value: 'Attached', group: 'parking' }, { key: 'heating', label: 'Heating', value: 'Forced air', group: 'utilities' }],
  descriptionFeatures: [{ id: 'deck', label: 'Deck' }],
};
// A snapshot from today's importer: the same facts also arrive as fields.
const SNAPSHOT = {
  ...LEGACY_SNAPSHOT,
  fields: { ...LEGACY_SNAPSHOT.fields, heating: 'Forced air', garageType: 'attached', basementCondition: 'unfinished', listingId: 'MLS-1' },
};
const rowsOf = (home, priorities = buy(), options) => Object.fromEntries(homeFactSections(home, priorities, options).flatMap((section) => section.rows.map((row) => [`${section.key}.${row.key}`, row])));

/* ------------------------------- pure helpers ------------------------------- */

test('imported detail count counts what the importer supplied once, never identity or coordinates', () => {
  // price, beds, garageSpaces, basementNotes, propertyTaxAnnual + 2 facts + 1 feature
  assert.equal(importedDetailCount(LEGACY_SNAPSHOT), 8);
  // + heating, garageType, basementCondition, listingId fields; the two listing facts they restate count once.
  assert.equal(importedDetailCount(SNAPSHOT), 10);
  assert.equal(importedDetailCount(null), 0);
  assert.equal(importedDetailCount({ fields: { address: 'x', latitude: 1 } }), 0);
});

test('lot size: supported units normalize to acres; a bare number is acres; anything else is kept as typed', () => {
  assert.equal(normalizeLotSizeInput('10,890 sq ft'), '0.25 acres');
  assert.equal(normalizeLotSizeInput('43560 sqft'), '1 acre');
  assert.equal(normalizeLotSizeInput('0.5'), '0.5 acres');
  assert.equal(normalizeLotSizeInput('2 ac'), '2 acres');
  assert.equal(normalizeLotSizeInput('1 hectare'), '2.47 acres');
  assert.equal(normalizeLotSizeInput('2023.4 sq m'), '0.5 acres');
  assert.equal(normalizeLotSizeInput('irregular'), 'irregular');
  assert.equal(normalizeLotSizeInput('   '), '');
});

test('garage spaces: 0 is a real None, empty is Unknown, 3+ highlights larger counts without rewriting them', () => {
  assert.equal(garageSpacesLabel('0'), 'None');
  assert.equal(garageSpacesLabel('2'), '2 spaces');
  assert.equal(garageSpacesLabel('3+'), '3+ spaces');
  assert.equal(garageSpacesLabel(''), null);
  assert.equal(garageSpacesChoice('4'), '3+');
  assert.equal(garageSpacesChoice('0'), '0');
  assert.equal(garageSpacesChoice('Tandem'), null);
  assert.equal(garageSpacesChoice(''), null);
});

test('Home Facts groups: Basic details, Home details, School details, Garage, Basement; Unknown is never No', () => {
  const home = { ...emptyHome(), price: '335000', beds: '5', garageSpaces: '2', basementNotes: 'Unfinished', heating: 'Forced air', garageType: 'attached', basementCondition: 'unfinished', listingId: 'MLS-1', listingImport: SNAPSHOT };
  assert.deepEqual(homeFactSections(home, buy()).map((section) => section.title), ['Basic details', 'Home details', 'School details', 'Garage', 'Basement']);
  const rows = rowsOf(home);
  assert.equal(rows['garage.garageType'].value, 'Attached');
  assert.equal(rows['garage.garageType'].provenance, 'listing');
  assert.equal(rows['garage.garageSpaces'].value, '2 spaces');
  assert.equal(rows['details.heating'].provenance, 'listing');
  assert.equal(rows['basic.listingId'].value, 'MLS-1');
  assert.equal(rows['basement.basementCondition'].value, 'Unfinished');
  assert.equal(rows['basement.basementStyle'].value, null);
  assert.equal(rows['basement.basementStyle'].provenance, 'unknown');
  for (const key of ['schools.schoolDistrict', 'schools.elementarySchool', 'schools.middleSchool', 'schools.highSchool']) assert.equal(rows[key].value, null);
  // None is an answer, shown as None — distinct from Unknown.
  const none = rowsOf({ ...emptyHome(), garageType: 'none', garageSpaces: '0', basementStyle: 'none', basementCondition: 'none' });
  assert.equal(none['garage.garageType'].value, 'None');
  assert.equal(none['garage.garageSpaces'].value, 'None');
  assert.equal(none['basement.basementStyle'].value, 'None');
  // A buyer correction is never labeled From listing.
  assert.equal(rowsOf({ ...home, garageType: 'detached' })['garage.garageType'].provenance, 'you');
  // A manual home (no snapshot) claims no provenance for what a person typed.
  assert.equal(rowsOf({ ...emptyHome(), heating: 'Boiler' })['details.heating'].provenance, null);
});

test('a home imported before the structured fields shows the listing’s value as a hint, never as a saved value', () => {
  const legacy = { ...emptyHome(), basementNotes: 'Unfinished', garageSpaces: '2', listingImport: LEGACY_SNAPSHOT };
  const rows = rowsOf(legacy);
  assert.equal(rows['details.heating'].value, null);
  assert.equal(rows['details.heating'].hint, 'Listing says: Forced air');
  assert.equal(rows['garage.garageType'].value, null);
  assert.equal(rows['garage.garageType'].hint, 'Listing says: Attached');
  assert.equal(rows['basement.basementStyle'].hint, 'Noted: Unfinished');
  // Once someone answers, the hint goes away.
  assert.equal(rowsOf({ ...legacy, heating: 'Boiler' })['details.heating'].hint, null);
  // Free-text school notes saved earlier stay visible.
  assert.equal(rowsOf({ ...emptyHome(), schoolsNotes: 'Anchor Bay' })['schools.schoolsNotes'].value, 'Anchor Bay');
});

test('Home details: property type, layout (with First-Floor Primary) and condition read from the existing Match fields', () => {
  const rows = rowsOf({ ...emptyHome(), propertyType: 'condo', homeLayout: ['Ranch / Single Story'], primaryBedroomLocation: 'Main Floor', homeCondition: ['Move-In Ready'] });
  assert.equal(rows['details.propertyType'].value, 'Condominium');
  assert.equal(rows['details.homeLayout'].value, 'Ranch · First-Floor Primary');
  assert.equal(rows['details.homeCondition'].value, 'Move-in Ready');
  // A saved type outside the three offered stays visible as it is.
  assert.equal(rowsOf({ ...emptyHome(), propertyType: 'townhome' })['details.propertyType'].value, 'Townhome');
});

test('apartments get no garage / basement / layout facts; rentals keep rental rows and drop purchase costs', () => {
  assert.deepEqual(homeFactSections({ ...emptyHome() }, buy(), { apartment: true }).map((section) => section.key), ['basic', 'schools']);
  assert.equal(homeFactsAvailability(rent()).layout, false);
  const rows = Object.values(rowsOf({ ...emptyHome(), price: '2400', hoaFeeMonthly: 100, propertyTaxAnnual: 3000, petsAllowed: true }, rent()));
  assert.ok(rows.some((row) => row.label === 'Pets allowed' && row.value === 'Yes'));
  assert.equal(rows.some((row) => /HOA|Property taxes|Est\. monthly/.test(row.label)), false);
});

test('the property header shows what is known, names what is Unknown, and marks listing provenance in one quiet line', () => {
  const header = homeFactsHeader({ ...emptyHome(), price: '335000', beds: '5', lotSize: '8712 sq ft', listingImport: SNAPSHOT }, buy());
  assert.equal(header.price, '$335,000');
  assert.deepEqual(header.facts.map((fact) => fact.text), ['5 beds', '0.20 acres lot']);
  assert.deepEqual(header.missing, ['baths', 'square footage']);
  assert.equal(fromListingLine(header.fromListing), 'From listing: price · beds');
});

test('saving a group writes only what changed, normalized; Unknown is null on the new fields', () => {
  const home = { ...emptyHome(), lotSize: '8712 sq ft', garageSpaces: '4', heating: 'Forced air' };
  // Untouched legacy values are never rewritten.
  assert.deepEqual(homeFactsPatch(home, 'header', homeFactsDraft(home, 'header')), {});
  assert.deepEqual(homeFactsPatch(home, 'garage', homeFactsDraft(home, 'garage')), {});
  assert.deepEqual(homeFactsPatch(home, 'header', { ...homeFactsDraft(home, 'header'), lotSize: '10890 sq ft', price: '$335,000' }), { lotSize: '0.25 acres', price: '335000' });
  assert.deepEqual(homeFactsPatch(home, 'details', { ...homeFactsDraft(home, 'details'), heating: '  ', roof: 'Metal' }), { heating: null, roof: 'Metal' });
  assert.deepEqual(homeFactsPatch(home, 'garage', { garageType: 'none', garageSpaces: '0' }), { garageType: 'none', garageSpaces: '0' });
  // Every group edits shared home fields only.
  const shared = persistence.match(/const SHARED_FIELDS = \[([\s\S]*?)\];/)[1];
  for (const field of Object.values(HOME_FACT_GROUP_FIELDS).flat()) assert.match(shared, new RegExp(`'${field}'`), `${field} is a shared home field`);
  for (const personal of ['checks', 'ratings', 'pros', 'cons', 'reaction', 'status']) assert.equal(Object.values(HOME_FACT_GROUP_FIELDS).flat().includes(personal), false);
});

test('Match scoring is unchanged: the new Home Facts details never move a Match', () => {
  let priorities = addCriterion(buy(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Finished basement', kind: 'check' }, 'nice');
  priorities = { ...priorities, budget: { value: '400000', tier: 'must' }, homeCondition: { values: ['Move-In Ready'], tier: 'important' } };
  const home = { ...emptyHome(), price: '335000', garageSpaces: '2', homeCondition: ['Move-In Ready'], checks: { 'features:Finished basement': 'no' } };
  const withDetails = { ...home, garageType: 'none', basementStyle: 'walkout', basementCondition: 'finished', heating: 'x', cooling: 'x', exterior: 'x', roof: 'x', listingId: 'x', schoolDistrict: 'x', elementarySchool: 'x', middleSchool: 'x', highSchool: 'x' };
  assert.deepEqual(computeMatch(withDetails, priorities), computeMatch(home, priorities));
  // The new "3+" spaces choice still reads as 3 for Garage, in JS and in the SQL Compare scorer.
  assert.equal(computeMatch({ ...home, garageSpaces: '3+' }, priorities).allSelected.find((item) => item.key === 'exterior:Garage').met, true);
  assert.match(read('supabase/migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql'), /regexp_replace\(v_home\.garage_spaces, '\[\^0-9\.\]', '', 'g'\)/);
  // And no scorer (JS or the SQL Compare function) reads the new columns.
  const sqlScorer = read('supabase/migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql');
  for (const column of ['garage_type', 'basement_style', 'basement_condition', 'heating', 'school_district_name']) assert.doesNotMatch(sqlScorer + read('src/lib/matching.js'), new RegExp(`\\b${column}\\b`));
});

test('the welcome says "We found your home." for an import, counts only imported details, and falls back for manual homes', () => {
  const imported = homeFactsWelcome({ listingImport: SNAPSHOT }, 'import');
  assert.equal(imported.title, 'We found your home.');
  assert.match(imported.body, /10 details from the listing/);
  assert.doesNotMatch(imported.body, /verified|accurate|confirmed/i);
  assert.equal(homeFactsWelcome({}, 'manual').title, 'Your home is saved.');
  assert.match(homeFactsWelcome({ listingImport: null }, 'import').body, /stays Unknown/);
  assert.equal(homeFactsWelcome({ listingImport: SNAPSHOT }, null), null);
});

test('import: only explicit, unambiguous listing values become Home Facts fields; nothing is guessed', () => {
  const { fields } = normalizeRentCastFields({ features: { heatingType: 'Forced Air', cooling: true, exteriorType: 'Brick', roofType: 'Asphalt', garageType: 'Detached Garage', basement: 'Finished walkout' } }, { mlsNumber: 'MLS-9', id: 'rentcast-internal-id' });
  assert.equal(fields.heating, 'Forced Air');
  assert.equal(fields.cooling, undefined, 'a bare "has cooling" says nothing about the kind');
  assert.equal(fields.garageType, 'detached');
  assert.equal(fields.basementCondition, 'finished');
  assert.equal(fields.basementStyle, 'walkout');
  assert.equal(fields.listingId, 'MLS-9');
  assert.equal(normalizeRentCastFields({}, { id: 'rentcast-internal-id' }).fields.listingId, undefined, 'RentCast’s own record id is not a listing ID');
  assert.equal(canonicalGarageType('Attached and detached'), null);
  assert.equal(normalizeRentCastFields({ features: { basement: 'Yes' } }, null).fields.basementCondition, undefined);
  // Choice facts accept only canonical tokens, and the import still only fills empty fields.
  assert.equal(createFinding({ concept: 'garageType', value: 'carport', sourceType: 's', sourceProvider: 'p' }), null);
  assert.equal(mergeImportFields({ heating: 'Boiler' }, { heating: 'Forced Air' }).heating, 'Boiler');
});

test('My Homes cards prefer the structured basement and school answers, keeping the earlier note as a fallback', () => {
  assert.equal(formatCardBasement({ basementStyle: 'walkout', basementCondition: 'finished', basementNotes: 'Unfinished' }), 'Finished, Walkout');
  assert.equal(formatCardBasement({ basementStyle: 'none' }), 'No basement');
  assert.equal(formatCardBasement({ basementNotes: 'Finished' }), 'Finished');
  assert.ok(homeCardSnapshot({ schoolDistrict: 'Anchor Bay', schoolsNotes: 'old' }, null).some((fact) => fact.value === 'Anchor Bay'));
});

/* ------------------------------- Match Criteria ------------------------------- */

test('Match Criteria: three tiers, real Yes / No / Unknown radios, rows straight from computeMatch', () => {
  assert.match(criteria, /\{ key: 'must', title: 'Must-Haves'/);
  assert.match(criteria, /\{ key: 'important', title: 'Important'/);
  assert.match(criteria, /\{ key: 'nice', title: 'Nice to Have'/);
  assert.match(criteria, /const rows = match\?\.allSelected \|\| \[\];/);
  assert.match(criteria, /<input type="radio" name=\{name\}/);
  assert.match(criteria, /<legend className="sr-only">/);
  // Read-only viewers see the answer, never a control.
  assert.match(criteria, /canAnswer && \(readOnly\s*\? <span className=\{`flh-mc-readonly/);
  // Answers go where the editor always wrote them: personal checks, or the three shared rental facts.
  assert.match(detail, /const patch = criterionAnswerPatch\(home, item\.key, next, priorities\.searchType\);\s*return patch\.shared \? saveWhole\(\{ \.\.\.home, \.\.\.patch\.shared \}\) : savePersonal\(patch\.personal\);/);
});

test('Garage, Commute and after-tour criteria are never answered in Match Criteria', async () => {
  let priorities = addCriterion(buy(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Finished basement', kind: 'check' }, 'nice');
  const keys = answerableCriteriaKeys(priorities);
  assert.equal(keys.has('exterior:Garage'), false, 'Garage is scored from Home Facts garage spaces');
  assert.equal(keys.has('features:Finished basement'), true);
  assert.equal(criterionAnswer({ checks: { 'features:Finished basement': 'no' } }, 'features:Finished basement', priorities.searchType), 'no');
  assert.equal(criterionAnswer({ petsAllowed: false }, 'features:Pets Allowed', 'rent_home'), 'no');
});

/* ------------------------------- flow guarantees ------------------------------- */

test('Add Home has exactly one action: Add to My Homes (no competing Review details first)', () => {
  assert.doesNotMatch(modal, /Review details first|setReviewing|onReview/);
  assert.equal((modal.match(/'Add to My Homes'\}/g) || []).length, 1);
  // Found, pasted text, nothing found, lookup error and manual entry all end on the one card.
  assert.match(modal, /const quickAdd = importLanding && isNewHome && !vocabulary\.apartment && \['success', 'text-success', 'empty', 'error'\]\.includes\(importPhase\)/);
  // Adding re-checks the exact listing URL, then reuses the one submit() (its
  // synchronous double-save guard and partial-write recovery included).
  assert.match(modal, /const addImportedHome = \(\) => \{\s*const existing = findHomeByListingUrl\(existingHomes, form\.listingUrl\);\s*if \(existing\) \{ setDuplicateHome\(existing\); return; \}\s*submit\(\);/);
  assert.match(modal, /if \(!form\.address\.trim\(\) \|\| savingRef\.current\) return;\s*savingRef\.current = true;/);
  assert.match(modal, /if \(saveErr\?\.partialHomeId && !form\.id\) set\('id', saveErr\.partialHomeId\)/);
  // The Realtor suggestion flow never gets the buyer quick-add; share intake still auto-finds.
  assert.doesNotMatch(read('src/components/RealtorSuggestHome.jsx'), /importLanding/);
  assert.match(board, /existingHomes=\{homes\} importLanding/);
  assert.match(board, /openHomeModal\(validUrl \? \{ \.\.\.emptyHome\(\), listingUrl: rawUrl\.trim\(\) \} : emptyHome\(\), \{ autoFind: validUrl \}\)/);
  assert.match(board, /router\.replace\(`\/homes\/\$\{encodeURIComponent\(existing\.id\)\}`\)/);
});

test('the disappearing home is fixed at the source: the Router Cache is rebuilt before navigating to Home Facts', () => {
  const fn = board.match(/const saveEditedHome = useCallback\(async \(home\) => \{[\s\S]*?\n  \}, \[modalHome, saveHome, router\]\);/)?.[0] || '';
  assert.match(fn, /const isNew = !modalHome\?\.id;/);
  // Navigation only after a real save, and only after an awaited, revalidating
  // Server Action has rebuilt the client cache (a router.refresh() is discarded
  // by the navigation, and one dispatched mid-navigation cancels it).
  assert.match(fn, /const saved = await saveHome\(home, \{ shared, keepModalOpen: isNew \}\);\s*if \(isNew && saved\?\.id\) \{[\s\S]*?await refreshMyHomes\(\)\.catch\(\(\) => \{\}\);\s*await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\);\s*router\.push\(`\/homes\/\$\{encodeURIComponent\(saved\.id\)\}\?added=\$\{home\.listingImport \? 'import' : 'manual'\}`\);/);
  assert.doesNotMatch(fn.replace(/\/\/[^\n]*/g, ''), /router\.refresh\(\)/);
  const action = read('src/app/(app)/homes/actions.js');
  assert.match(action, /^'use server';/);
  assert.match(action, /export async function refreshMyHomes\(\) \{\s*revalidatePath\('\/homes'\);\s*\}/);
  // The welcome survives any later re-render without ?added=.
  assert.match(detail, /const \[welcomeKind\] = useState\(justAdded\);/);
  assert.match(detail, /justAdded=\{welcomeKind\}/);
});

test('the detail route only accepts the two welcome markers and HomeDetail clears it from the address bar', () => {
  assert.match(detailPage, /const JUST_ADDED = new Set\(\['import', 'manual'\]\);/);
  assert.match(detailPage, /justAdded=\{justAdded\}/);
  assert.match(detail, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/);
});

test('Home Facts saves shared facts through the canonical shared-home path and keeps opinions out', () => {
  assert.match(detail, /onSaveFacts=\{\(patch\) => saveWhole\(\{ \.\.\.home, \.\.\.patch \}\)\}/);
  assert.match(detail, /saveHomePersonalAndShared\(createClient\(\), next, userId, searchId\)/);
  for (const personal of ['pros', 'cons', 'reaction', 'ratings', 'checks', 'PostTourModal']) assert.doesNotMatch(facts.replace(/\/\/[^\n]*/g, ''), new RegExp(`\\b${personal}\\b`));
  for (const personal of ['pros', 'cons', 'reaction', 'ratings']) assert.doesNotMatch(factsLib, new RegExp(`home\\??\\.${personal}\\b`));
  // Read-only viewers (Realtors) never get edit controls.
  assert.match(facts, /\{!readOnly && editing !== 'header' && <button/);
  assert.match(facts, /\{!readOnly && !editing && <button type="button" className="flh-hf-edit"/);
  // One save at a time per group, with the error kept beside the form.
  assert.match(facts, /if \(savingRef\.current\) return;\s*savingRef\.current = true;/);
});

test('Home Facts: no standalone imported-facts panel, no school disclaimer, and an orange Next: Match Criteria', () => {
  assert.doesNotMatch(facts, /All listing details|See imported details|<details/);
  assert.doesNotMatch(facts + factsLib, /FLH doesn’t pull school information|school rating|GreatSchools|assigned to/i);
  assert.match(facts, /nextLabel = 'Next: Match Criteria'/);
  assert.match(facts, /className="hh-btn flh-hf-next-button"/);
  assert.match(detail, /onNext=\{\(\) => nextFromFacts\(\)\}/);
});

test('the workspace reads Home Facts / Match Criteria / Tour Feedback', () => {
  assert.match(detail, /key: 'facts', label: 'Home Facts'/);
  assert.match(detail, /key: 'match', label: 'Match Criteria'/);
  assert.match(detail, /key: 'tour', label: 'Tour Feedback'/);
  assert.doesNotMatch(detail + criteria + facts, /Check the Match/);
  assert.match(detail, /<aside className="flh-workspace-nav">[\s\S]*Back to My Homes[\s\S]*flh-workspace-identity[\s\S]*<nav aria-label=/);
  assert.match(detail, /aria-current=\{section === item\.key \? 'page' : undefined\}/);
  assert.match(detail, /window\.history\.replaceState\(null, '', `\$\{url\.pathname\}\$\{url\.search\}`\)/);
  assert.match(detail, /useState\(SECTION_KEYS\.has\(initialSection\) \? initialSection : 'facts'\)/);
  const panel = (key) => detail.match(new RegExp(`\\{section === '${key}' && <>([\\s\\S]*?)\\n      </>\\}`))?.[1] || '';
  assert.match(panel('facts'), /<HomeFacts /);
  assert.doesNotMatch(panel('facts'), /pros|cons|PostTour|RealtorContributions/);
  assert.match(panel('match'), /<MatchCriteria /);
  assert.match(panel('match'), /title="Location & Commute"/);
  // Tour Feedback is the redesigned panel carried over from #151; it never answers Match criteria.
  assert.match(panel('tour'), /<TourFeedback/);
  assert.match(panel('tour'), /onSaveNotes=\{\(draft\) => saveWhole\(\{ \.\.\.home, \.\.\.draft \}\)\}/);
  assert.match(panel('tour'), /<RealtorContributions /);
  assert.doesNotMatch(panel('tour'), /answerCriterion|MatchCriteria/);
  assert.doesNotMatch(read('src/components/TourFeedback.jsx'), /CheckTheMatch|matchReview|answerPatch/);
  assert.match(detail, /section === 'match' && <div className="flh-mobile-only flh-detail-action-bar">/);
});

test('desktop sidebar becomes a compact section switcher on phones', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-home-detail\.flh-workspace \{[^}]*grid-template-columns: 228px minmax\(0,1fr\)/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*\.flh-workspace-nav ul \{ grid-template-columns: repeat\(3,minmax\(0,1fr\)\);/);
});

test('a missing new column fails visibly instead of silently reading without Pass B facts', () => {
  assert.match(persistence, /return \(error\?\.code === '42703' \|\| error\?\.code === 'PGRST204'\) && PASS_B_DATABASE_COLUMNS\.some/);
  assert.match(persistence, /school_district_name: factOrNull\(home\.schoolDistrict\)/);
  // The locked legacy column is never read or written.
  assert.doesNotMatch(persistence, /'school_district'|school_district:/);
});

test('the Home Facts QA preview is development-only and never part of a production build', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(new URL('../src/app/dev/home-facts/page.js', import.meta.url)), false, 'no production-visible page.js');
  assert.ok(existsSync(new URL('../src/app/dev/home-facts/page.dev.js', import.meta.url)));
  assert.match(read('next.config.mjs'), /pageExtensions: developmentOnly \? \['dev\.js', 'js', 'jsx', 'ts', 'tsx'\] : \['js', 'jsx', 'ts', 'tsx'\]/);
  assert.match(read('src/app/dev/home-facts/page.dev.js'), /if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/);
  for (const file of ['src/components/HomeDetail.jsx', 'src/components/HomesBoard.jsx', 'src/components/HomeModal.jsx', 'src/components/HomeFacts.jsx', 'src/components/MatchCriteria.jsx']) assert.doesNotMatch(read(file), /HomeFactsPreview/);
});

/* ------------------------------- real Postgres ------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.homefacts@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.homefacts@example.com' });
  ids.realtor = db.createUser({ email: 'realtor.homefacts@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  for (const [email, role, user] of [['cobuyer.homefacts@example.com', 'co_buyer', ids.coBuyer], ['realtor.homefacts@example.com', 'realtor', ids.realtor]]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, email, role);
    assert.equal((await acceptInvitation(db.clientFor(user), invitation.token)).success, true);
  }
});
after(() => db?.drop());

const viewOf = async (user, homeId) => (await getHomesForUser(db.clientFor(user), user, ids.search)).find((home) => home.id === homeId);
const rlsDenied = (error) => /row-level security|permission denied|expected one row|0 rows|JSON object requested/i.test(error?.message || String(error));

dbTest('Home Facts details persist for everyone; a co-buyer edit reaches the owner; None and Unknown stay distinct', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), {
    ...emptyHome(), address: '51613 Sass Rd, New Baltimore, MI 48047', listingUrl: 'https://example.com/listing/1',
    price: '335000', garageSpaces: '2', heating: 'Forced air', garageType: 'attached', basementCondition: 'unfinished', listingId: 'MLS-1',
    checks: { 'features:Finished basement': 'no' }, listingImport: SNAPSHOT,
  }, ids.owner, ids.search);
  const fresh = await viewOf(ids.owner, added.id);
  assert.deepEqual([fresh.heating, fresh.garageType, fresh.basementCondition, fresh.listingId], ['Forced air', 'attached', 'unfinished', 'MLS-1']);
  assert.equal(fresh.basementStyle, null, 'never set stays Unknown (null)');
  assert.deepEqual(fresh.listingImport, SNAPSHOT);

  // Exactly what a Home Facts group save sends: the whole home plus the patch.
  const coBuyerView = await viewOf(ids.coBuyer, added.id);
  const patch = {
    ...homeFactsPatch(coBuyerView, 'garage', { garageType: 'none', garageSpaces: '0' }),
    ...homeFactsPatch(coBuyerView, 'basement', { basementStyle: 'none', basementCondition: 'none' }),
    ...homeFactsPatch(coBuyerView, 'schools', { ...homeFactsDraft(coBuyerView, 'schools'), schoolDistrict: 'Anchor Bay', highSchool: 'Anchor Bay High' }),
    ...homeFactsPatch(coBuyerView, 'header', { ...homeFactsDraft(coBuyerView, 'header'), lotSize: '10890 sq ft' }),
  };
  await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), { ...coBuyerView, ...patch }, ids.coBuyer, ids.search);
  const ownerView = await viewOf(ids.owner, added.id);
  assert.deepEqual([ownerView.garageType, ownerView.garageSpaces, ownerView.basementStyle, ownerView.basementCondition], ['none', '0', 'none', 'none']);
  assert.deepEqual([ownerView.schoolDistrict, ownerView.highSchool, ownerView.middleSchool], ['Anchor Bay', 'Anchor Bay High', null]);
  assert.equal(ownerView.lotSize, '0.25 acres');
  // Shared fact edits never touch anyone's personal answers; the adder and snapshot are preserved.
  assert.deepEqual(ownerView.checks, { 'features:Finished basement': 'no' });
  assert.deepEqual(ownerView.listingImport, SNAPSHOT);
  assert.equal(db.admin(`select user_id from public.homes where id = '${added.id}'`)[0].user_id, ids.owner);

  // Clearing back to Unknown stores null, not 'none' or ''.
  await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...ownerView, ...homeFactsPatch(ownerView, 'garage', { garageType: '', garageSpaces: '' }) }, ids.owner, ids.search);
  const cleared = db.admin(`select garage_type, garage_spaces from public.homes where id = '${added.id}'`)[0];
  assert.deepEqual(cleared, { garage_type: null, garage_spaces: '' });

  // The database refuses anything but the canonical choices.
  await assert.rejects(saveHomePersonalAndShared(db.clientFor(ids.owner), { ...ownerView, basementStyle: 'crawlspace' }, ids.owner, ids.search), (error) => /homes_basement_style_check/.test(error?.message));
});

dbTest('Match Criteria answers stay personal: the co-buyer’s Yes never changes the owner’s answer', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '3 Answer Ln', checks: { 'features:Finished basement': 'no' } }, ids.owner, ids.search);
  const coBuyerView = await viewOf(ids.coBuyer, added.id);
  await saveHomePersonalState(db.clientFor(ids.coBuyer), { ...coBuyerView, checks: { 'features:Finished basement': true } }, ids.coBuyer, ids.search);
  assert.deepEqual((await viewOf(ids.owner, added.id)).checks, { 'features:Finished basement': 'no' });
  assert.deepEqual((await viewOf(ids.coBuyer, added.id)).checks, { 'features:Finished basement': true });
});

dbTest('a Realtor viewing the search can read Home Facts but cannot write them', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '2 Realtor Way', garageSpaces: '1', heating: 'Boiler' }, ids.owner, ids.search);
  await assert.rejects(saveHomePersonalAndShared(db.clientFor(ids.realtor), { ...added, garageType: 'detached', heating: 'Heat pump' }, ids.realtor, ids.search), rlsDenied);
  assert.deepEqual(db.admin(`select garage_type, heating from public.homes where id = '${added.id}'`)[0], { garage_type: null, heating: 'Boiler' });
});

// The saved-home flow end to end at the persistence layer, with exactly the
// payload Add to My Homes sends: the merged form plus the listing snapshot.
dbTest('import → Add to My Homes: one home, nothing lost, even when the save is interrupted and retried', async () => {
  const { findHomeByListingUrl } = await import('../src/lib/listingUrl.js');
  const listingUrl = 'https://www.zillow.com/homedetails/51613-Sass-Rd/1_zpid/';
  const form = { ...mergeImportFields({ ...emptyHome(), listingUrl, address: SNAPSHOT.fields.address }, SNAPSHOT.fields), listingImport: SNAPSHOT };

  // 1. The personal-state write fails after the shared row was inserted.
  let interrupted = false;
  const owner = db.clientFor(ids.owner);
  const flaky = { ...owner, from: (table) => {
    if (table === 'home_member_state' && !interrupted) { interrupted = true; return { upsert: async () => ({ error: new Error('network interrupted') }) }; }
    return owner.from(table);
  } };
  let partialHomeId = null;
  await assert.rejects(saveHomePersonalAndShared(flaky, form, ids.owner, ids.search), (error) => { partialHomeId = error.partialHomeId; return !!partialHomeId; });

  // 2. HomeModal adopts partialHomeId; the retry updates that row instead of inserting another.
  const saved = await saveHomePersonalAndShared(owner, { ...form, id: partialHomeId }, ids.owner, ids.search);
  assert.equal(saved.id, partialHomeId);
  assert.equal(db.admin(`select count(*)::int as n from public.homes where listing_url = '${listingUrl}'`)[0].n, 1, 'exactly one home');

  // 3. What /homes and /homes/{id} load, with zero edits: the home, every imported value, the snapshot.
  const loaded = await viewOf(ids.owner, saved.id);
  for (const field of ['price', 'beds', 'garageSpaces', 'basementNotes', 'heating', 'garageType', 'basementCondition', 'listingId']) assert.equal(String(loaded[field]), String(SNAPSHOT.fields[field]), field);
  assert.deepEqual(loaded.listingImport, SNAPSHOT);
  assert.equal(rowsOf(loaded)['details.heating'].provenance, 'listing');
  assert.match(homeFactsWelcome(loaded, 'import').body, /10 details/);

  // 4. Pasting or sharing the same link again finds the saved home, for the co-buyer too.
  assert.equal(findHomeByListingUrl(await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search), listingUrl)?.id, saved.id);
});

dbTest('production path: preflight on a pre-migration database, then the migration — additive, re-runnable, no row changed', async () => {
  const PREFLIGHT = read('supabase/home-facts-details-preflight.sql').replace(/;\s*$/, '');
  const VERIFY = read('supabase/home-facts-details-verification.sql').replace(/;\s*$/, '');
  const legacy = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => step.file !== MIGRATION) });
  try {
    const owner = legacy.createUser({ email: 'owner.legacy.facts@example.com' });
    const search = legacy.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
    await legacy.clientFor(owner).from('homes').insert({ user_id: owner, search_id: search, address: '12 Legacy Ct', garage_spaces: '4', basement_notes: 'Finished, walkout', schools_notes: 'Anchor Bay', listing_import: LEGACY_SNAPSHOT }).select('id').single();
    const snapshot = () => legacy.admin('select json_agg(h order by h.id) as homes from (select id, address, garage_spaces, basement_notes, schools_notes, school_district, listing_import, updated_at from public.homes) h')[0];
    const before = snapshot();

    const report = legacy.admin(PREFLIGHT);
    assert.deepEqual(report.filter((row) => row.check === 'required' && row.ok !== true), []);
    const info = (prefix) => report.find((row) => row.item.startsWith(prefix))?.detail;
    assert.equal(info('new columns already present'), '0');
    assert.equal(info('homes (all rows stay Unknown'), '1');
    assert.equal(info('homes whose listing snapshot reported'), '1');
    assert.deepEqual(snapshot(), before, 'the preflight writes nothing');

    assert.equal(legacy.applyFile(MIGRATION).error, null);
    assert.deepEqual(snapshot(), before, 'the migration rewrites no home');
    assert.equal(legacy.applyFile(MIGRATION).error, null, 'the migration is re-runnable');
    assert.deepEqual(legacy.admin(PREFLIGHT).filter((row) => row.check === 'required' && row.ok !== true), []);
    const verification = legacy.admin(VERIFY);
    assert.deepEqual(verification.filter((row) => row.ok !== true), []);
    assert.equal(verification.find((row) => row.section === 7).detail, '0');
  } finally {
    legacy.drop();
  }
});
