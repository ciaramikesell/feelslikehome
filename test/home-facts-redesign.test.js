// Home Facts redesign + post-import landing. See docs/home-facts-redesign.md.
//
// Pure helpers are tested directly; the flow guarantees (nothing saved before
// the buyer chooses to add, duplicates re-checked, navigation only after a real
// save) are pinned in source; and the shared-fact writes Home Features makes are
// exercised against real Postgres as owner, co-buyer, and Realtor.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  importedDetailCount, garageSpacesLabel, parseBasement, composeBasement, homeFeatureSummary, homeFeatureAvailability,
  listingDetailGroups, homeFactsWelcome, homeFeaturesDraft, HOME_FEATURE_FIELDS,
} = await import('../src/lib/homeFacts.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { emptyHome, normalizePriorities } = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/HomeModal.jsx');
const board = read('src/components/HomesBoard.jsx');
const detail = read('src/components/HomeDetail.jsx');
const facts = read('src/components/HomeFacts.jsx');
const factsLib = read('src/lib/homeFacts.js');
const detailPage = read('src/app/(app)/homes/[homeId]/page.js');
const persistence = read('src/lib/supabase/collaboration.js');

const buy = () => applySearchChoice(normalizePriorities({}), 'home_buy');
const SNAPSHOT = {
  fields: { address: '1 Main St, Town, MI 48000', price: '335000', beds: '5', garageSpaces: '2', basementNotes: 'Unfinished', latitude: 1, longitude: 2, propertyTaxAnnual: 4000, propertyTaxYear: 2025 },
  listingFacts: [{ key: 'garageType', label: 'Garage', value: 'Attached', group: 'parking' }, { key: 'heating', label: 'Heating', value: 'Forced air', group: 'utilities' }],
  descriptionFeatures: [{ id: 'deck', label: 'Deck' }],
};

/* ------------------------------- pure helpers ------------------------------- */

test('imported detail count only counts details the importer supplied, never identity or coordinates', () => {
  // price, beds, garageSpaces, basementNotes, propertyTaxAnnual + 2 facts + 1 feature
  assert.equal(importedDetailCount(SNAPSHOT), 8);
  assert.equal(importedDetailCount(null), 0);
  assert.equal(importedDetailCount({ fields: { address: 'x', latitude: 1 } }), 0);
});

test('garage spaces: 0 is a real "No garage", empty is Unknown, legacy text is kept verbatim', () => {
  assert.equal(garageSpacesLabel('0'), 'No garage');
  assert.equal(garageSpacesLabel('2'), '2-car garage');
  assert.equal(garageSpacesLabel(''), null);
  assert.equal(garageSpacesLabel(null), null);
});

test('basement finish and walkout compose into the existing descriptive text and parse back', () => {
  assert.equal(composeBasement({ finish: 'Finished', walkout: true }), 'Finished, walkout');
  assert.equal(composeBasement({ finish: 'No basement', walkout: true }), 'No basement');
  assert.equal(composeBasement({ finish: null, walkout: false }), '');
  assert.deepEqual(parseBasement('Finished, walkout'), { finish: 'Finished', walkout: true, custom: null });
  assert.deepEqual(parseBasement('Partially finished'), { finish: 'Partially finished', walkout: false, custom: null });
  assert.deepEqual(parseBasement('Walkout'), { finish: null, walkout: true, custom: null });
  assert.deepEqual(parseBasement(''), { finish: null, walkout: false, custom: null });
  // Free text typed earlier is never silently treated as one of the choices.
  assert.equal(parseBasement('Finished with a bedroom and bath').custom, 'Finished with a bedroom and bath');
});

test('Home Features summarize the four categories from stored fields; empty is Unknown, never No', () => {
  const home = { ...emptyHome(), garageSpaces: '2', basementNotes: 'Unfinished', homeLayout: ['Two Story'], primaryBedroomLocation: 'Main Floor', homeCondition: [], listingImport: SNAPSHOT };
  const rows = Object.fromEntries(homeFeatureSummary(home, buy()).map((row) => [row.key, row]));
  assert.deepEqual(Object.keys(rows), ['garage', 'basement', 'layout', 'condition']);
  assert.equal(rows.garage.value, '2-car garage');
  assert.equal(rows.garage.detail, 'Listing says: Attached');
  assert.equal(rows.garage.provenance, 'listing');
  assert.equal(rows.basement.provenance, 'listing');
  assert.equal(rows.layout.value, 'Two-Story · First-floor primary');
  assert.equal(rows.condition.value, null);
  assert.equal(rows.condition.provenance, 'unknown');
  // A buyer correction is "Added by you", not "From listing".
  assert.equal(homeFeatureSummary({ ...home, garageSpaces: '3' }, buy())[0].provenance, 'you');
});

test('Home Features never apply to apartments, and layout is purchase-only', () => {
  assert.deepEqual(homeFeatureAvailability(buy(), { apartment: true }), { garage: false, basement: false, layout: false, condition: false });
  const rent = applySearchChoice(normalizePriorities({}), 'home_rent');
  assert.equal(homeFeatureAvailability(rent).layout, false);
  assert.equal(homeFeatureAvailability(buy()).layout, true);
});

test('the Home Features draft only ever contains existing shared home fields', () => {
  assert.deepEqual(Object.keys(homeFeaturesDraft({ ...emptyHome(), pros: 'x', checks: { a: true } })).sort(), [...HOME_FEATURE_FIELDS].sort());
  const sharedFields = persistence.match(/const SHARED_FIELDS = \[([\s\S]*?)\];/)[1];
  for (const field of [...HOME_FEATURE_FIELDS, 'schoolsNotes']) assert.match(sharedFields, new RegExp(`'${field}'`), `${field} is a shared home field`);
});

test('editing a Home Feature keeps updating the existing Match evaluation (Unknown never counts as a miss)', () => {
  let priorities = addCriterion(buy(), { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  priorities = { ...priorities, homeCondition: { values: ['Move-In Ready'], tier: 'important' } };
  const garage = (home) => computeMatch(home, priorities).allSelected.find((item) => item.key === 'exterior:Garage');
  const condition = (home) => computeMatch(home, priorities).allSelected.find((item) => item.key === 'homeCondition');
  const unknown = { ...emptyHome() };
  assert.equal(garage(unknown).evaluated, false);
  assert.equal(condition(unknown).evaluated, false);
  assert.equal(garage({ ...unknown, garageSpaces: '0' }).met, false);
  assert.equal(garage({ ...unknown, garageSpaces: '2' }).met, true);
  assert.equal(condition({ ...unknown, homeCondition: ['Move-In Ready', 'Renovation Potential'] }).met, true);
});

test('All listing details: imported-only facts are read-only "From listing"; core rows show Unknown; nothing is invented', () => {
  const home = { ...emptyHome(), price: '335000', beds: '5', garageSpaces: '2', listingImport: SNAPSHOT };
  const groups = listingDetailGroups(home, buy());
  const rows = groups.flatMap((group) => group.rows);
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
  assert.equal(byLabel.Heating.value, 'Forced air');
  assert.equal(byLabel.Heating.readOnly, true);
  assert.equal(byLabel.Heating.provenance, 'listing');
  assert.equal(byLabel['Asking price'].provenance, 'listing');
  assert.equal(byLabel['Year built'].value, null);
  assert.equal(byLabel['Year built'].provenance, 'unknown');
  // Garage type is summarized in Home Features, so it is not repeated here.
  assert.equal(rows.some((row) => row.label === 'Garage'), false);
  // No school, rating, or neighborhood quality data exists, so none appears.
  assert.equal(rows.some((row) => /school|rating|crime|walk/i.test(row.label)), false);
  // A manual home (no snapshot) claims no provenance for what a person typed.
  const manual = listingDetailGroups({ ...emptyHome(), beds: '3' }, buy()).flatMap((group) => group.rows);
  assert.equal(manual.find((row) => row.label === 'Bedrooms').provenance, null);
});

test('rentals keep rental rows and never show purchase financial rows', () => {
  const rent = applySearchChoice(normalizePriorities({}), 'home_rent');
  const rows = listingDetailGroups({ ...emptyHome(), price: '2400', hoaFeeMonthly: 100, petsAllowed: true }, rent).flatMap((group) => group.rows);
  assert.ok(rows.some((row) => row.label === 'Monthly rent'));
  assert.ok(rows.some((row) => row.label === 'Pets allowed' && row.value === 'Yes'));
  assert.equal(rows.some((row) => /HOA|Property taxes|Est\. monthly/.test(row.label)), false);
});

test('the welcome is calm, counts only imported details, and falls back for manual homes', () => {
  const imported = homeFactsWelcome({ listingImport: SNAPSHOT }, 'import');
  assert.equal(imported.title, 'Welcome home (at least for now).');
  assert.match(imported.body, /We found 8 details about this property\./);
  assert.doesNotMatch(imported.body, /verified|accurate|confirmed/i);
  assert.match(homeFactsWelcome({}, 'manual').body, /stays Unknown/);
  assert.match(homeFactsWelcome({ listingImport: null }, 'import').body, /saved to My Homes/);
  assert.equal(homeFactsWelcome({ listingImport: SNAPSHOT }, null), null);
});

/* ------------------------------- flow guarantees ------------------------------- */

test('Add Home: a found listing is shown first and nothing is saved until Add to My Homes', () => {
  assert.match(modal, /const quickAdd = importLanding && isNewHome && !vocabulary\.apartment && importPhase === 'success' && !reviewing && !!importResult;/);
  assert.match(modal, /Not saved yet — this \{vocabulary\.singularLower\} is added only when you choose Add to My Homes\./);
  // Adding re-checks the exact listing URL, then reuses the one submit() (its
  // synchronous double-save guard and partial-write recovery included).
  assert.match(modal, /const addImportedHome = \(\) => \{\s*const existing = findHomeByListingUrl\(existingHomes, form\.listingUrl\);\s*if \(existing\) \{ setDuplicateHome\(existing\); return; \}\s*submit\(\);/);
  assert.match(modal, /if \(saveErr\?\.partialHomeId && !form\.id\) set\('id', saveErr\.partialHomeId\)/);
  assert.match(modal, /onReview=\{\(\) => setReviewing\(true\)\}/);
  // The Realtor suggestion flow never gets the buyer quick-add.
  assert.doesNotMatch(read('src/components/RealtorSuggestHome.jsx'), /importLanding/);
  assert.match(board, /existingHomes=\{homes\} importLanding/);
});

test('a new home lands on Home Facts only after it is actually saved', () => {
  const fn = board.match(/const saveEditedHome = useCallback\(async \(home\) => \{[\s\S]*?\n  \}, \[modalHome, saveHome, router\]\);/)?.[0] || '';
  assert.match(fn, /const isNew = !modalHome\?\.id;/);
  assert.match(fn, /const saved = await saveHome\(home, \{ shared \}\);\s*if \(isNew && saved\?\.id\) router\.push\(/);
  assert.match(fn, /\?added=\$\{home\.listingImport \? 'import' : 'manual'\}/);
  assert.match(board, /router\.refresh\(\);\s*return saved;/);
  // Share intake and duplicate routing are unchanged.
  assert.match(board, /router\.replace\(`\/homes\/\$\{encodeURIComponent\(existing\.id\)\}`\)/);
  assert.match(board, /openHomeModal\(validUrl \? \{ \.\.\.emptyHome\(\), listingUrl: rawUrl\.trim\(\) \} : emptyHome\(\), \{ autoFind: validUrl \}\)/);
});

test('the detail route only accepts the two welcome markers and HomeDetail clears it from the address bar', () => {
  assert.match(detailPage, /const JUST_ADDED = new Set\(\['import', 'manual'\]\);/);
  assert.match(detailPage, /justAdded=\{justAdded\}/);
  assert.match(detail, /window\.history\.replaceState\(window\.history\.state, '', window\.location\.pathname\)/);
});

test('Home Facts saves shared facts through the canonical shared-home path and keeps opinions out', () => {
  assert.match(detail, /onSaveFacts=\{\(patch\) => saveWhole\(\{ \.\.\.home, \.\.\.patch \}\)\}/);
  assert.match(detail, /saveHomePersonalAndShared\(createClient\(\), next, userId, searchId\)/);
  for (const personal of ['pros', 'cons', 'reaction', 'ratings', 'checks', 'PostTourModal']) assert.doesNotMatch(facts.replace(/\/\/[^\n]*/g, ''), new RegExp(`\\b${personal}\\b`));
  for (const personal of ['pros', 'cons', 'reaction', 'ratings']) assert.doesNotMatch(factsLib, new RegExp(`home\\??\\.${personal}\\b`));
  // Notes, your take, and the Match breakdown all remain in the workspace.
  assert.match(detail, /<PostTourModal/);
  assert.match(detail, /<TourFeedback/);
  assert.match(detail, /matchRef=\{matchSection\}/);
  // Read-only viewers (Realtors) never get edit controls.
  assert.match(facts, /\{!readOnly && !editingFeatures && <button/);
  assert.match(facts, /\{!readOnly && !editing && <button/);
});

test('School details never claim imported or inferred school data', () => {
  assert.match(facts, /FLH doesn’t pull school information from listings\./);
  assert.doesNotMatch(factsLib + facts, /school rating|assigned to|in-district|GreatSchools/i);
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

dbTest('an imported home is saved once with its listing snapshot; a co-buyer edits Home Features and School details for everyone', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), {
    ...emptyHome(), address: '51613 Sass Rd, New Baltimore, MI 48047', listingUrl: 'https://example.com/listing/1',
    price: '335000', garageSpaces: '2', basementNotes: 'Unfinished', checks: { 'features:Finished basement': 'no' },
    listingImport: SNAPSHOT,
  }, ids.owner, ids.search);
  assert.equal(db.admin(`select count(*)::int as n from public.homes where search_id = '${ids.search}'`)[0].n, 1);
  assert.deepEqual((await viewOf(ids.owner, added.id)).listingImport, SNAPSHOT);

  // Exactly what Home Features + School details send: the whole home plus the patch.
  const coBuyerView = await viewOf(ids.coBuyer, added.id);
  await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), {
    ...coBuyerView, garageSpaces: '0', basementNotes: 'Finished, walkout', homeLayout: ['Ranch / Single Story'],
    primaryBedroomLocation: 'Main Floor', homeCondition: ['Move-In Ready', 'Renovation Potential'], schoolsNotes: 'Anchor Bay School District',
  }, ids.coBuyer, ids.search);

  const ownerView = await viewOf(ids.owner, added.id);
  assert.equal(ownerView.garageSpaces, '0');
  assert.equal(ownerView.basementNotes, 'Finished, walkout');
  assert.deepEqual(ownerView.homeLayout, ['Ranch / Single Story']);
  assert.equal(ownerView.primaryBedroomLocation, 'Main Floor');
  assert.deepEqual(ownerView.homeCondition, ['Move-In Ready', 'Renovation Potential']);
  assert.equal(ownerView.schoolsNotes, 'Anchor Bay School District');
  // Shared fact edits never touch anyone's personal answers, and the snapshot is preserved.
  assert.deepEqual(ownerView.checks, { 'features:Finished basement': 'no' });
  assert.deepEqual(ownerView.listingImport, SNAPSHOT);
  assert.equal(db.admin(`select user_id from public.homes where id = '${added.id}'`)[0].user_id, ids.owner);
  // Clearing back to Unknown persists as empty, not as a negative value.
  await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...ownerView, garageSpaces: '', homeCondition: [] }, ids.owner, ids.search);
  const cleared = await viewOf(ids.coBuyer, added.id);
  assert.equal(cleared.garageSpaces, '');
  assert.deepEqual(cleared.homeCondition, []);
});

dbTest('a Realtor viewing the search cannot write Home Features', async () => {
  const added = await saveHomePersonalAndShared(db.clientFor(ids.owner), { ...emptyHome(), address: '2 Realtor Way', garageSpaces: '1' }, ids.owner, ids.search);
  await assert.rejects(
    saveHomePersonalAndShared(db.clientFor(ids.realtor), { ...added, garageSpaces: '4' }, ids.realtor, ids.search),
    (error) => /row-level security|permission denied|expected one row|0 rows|JSON object requested/i.test(error?.message || String(error)),
  );
  assert.equal(db.admin(`select garage_spaces from public.homes where id = '${added.id}'`)[0].garage_spaces, '1');
});

/* ------------------------------- home workspace ------------------------------- */

test('the home workspace has one shared navigation for Home Facts, Check the Match and Tour Feedback', () => {
  assert.match(detail, /key: 'facts', label: 'Home Facts'/);
  assert.match(detail, /key: 'match', label: 'Check the Match'/);
  assert.match(detail, /key: 'tour', label: 'Tour Feedback'/);
  // Property context (photo, address, back) stays with the navigation.
  assert.match(detail, /<aside className="flh-workspace-nav">[\s\S]*Back to My Homes[\s\S]*flh-workspace-identity[\s\S]*<nav aria-label=/);
  assert.match(detail, /aria-current=\{section === item\.key \? 'page' : undefined\}/);
  // Switching never reloads or stacks history; ?section= survives refresh.
  assert.match(detail, /window\.history\.replaceState\(window\.history\.state, '', `\$\{url\.pathname\}\$\{url\.search\}`\)/);
  assert.match(detailPage, /initialSection=\{initialSection\}/);
  assert.match(read('src/app/(app)/people/[searchId]/homes/[homeId]/page.js'), /initialSection=\{initialSection\}/);
  // Unknown or missing sections fall back to Home Facts.
  assert.match(detail, /useState\(SECTION_KEYS\.has\(initialSection\) \? initialSection : 'facts'\)/);
});

test('each area reuses its existing sections: no Match or Tour Feedback rebuild, and pros/cons stay out of Home Facts', () => {
  const panel = (key) => detail.match(new RegExp(`\\{section === '${key}' && <>([\\s\\S]*?)\\n      </>\\}`))?.[1] || '';
  const facts = panel('facts');
  const match = panel('match');
  const tour = panel('tour');
  assert.match(facts, /<HomeFacts /);
  assert.doesNotMatch(facts, /pros|cons|PostTour|hh-detail-match-groups|RealtorContributions/);
  assert.match(match, /<CheckTheMatch/);
  assert.match(match, /matchRef=\{matchSection\}/);
  assert.match(match, /title="Location & Commute"/);
  assert.doesNotMatch(match, /pros|cons|RealtorContributions/);
  assert.match(tour, /<TourFeedback/);
  assert.match(tour, /onSaveNotes=/);
  assert.match(tour, /<RealtorContributions /);
  // The phone action bar (Want to tour / Favorite) only sits on Check the Match:
  // Home Facts editing stays clear, and Tour Feedback has the same actions inline.
  assert.match(detail, /section === 'match' && <div className="flh-mobile-only flh-detail-action-bar">/);
});

test('desktop sidebar becomes a compact section switcher on phones', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-home-detail\.flh-workspace \{[^}]*grid-template-columns: 228px minmax\(0,1fr\)/);
  assert.match(css, /\.flh-workspace-nav nav button\.is-active \{ background: rgba\(185,83,50,\.09\); color: var\(--brick\); \}/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*\.flh-workspace-nav ul \{ grid-template-columns: repeat\(3,minmax\(0,1fr\)\);/);
});

test('the Home Facts QA preview is development-only and never part of a production build', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(new URL('../src/app/dev/home-facts/page.js', import.meta.url)), false, 'no production-visible page.js');
  assert.ok(existsSync(new URL('../src/app/dev/home-facts/page.dev.js', import.meta.url)));
  const config = read('next.config.mjs');
  assert.match(config, /const developmentOnly = process\.env\.NODE_ENV !== 'production';/);
  assert.match(config, /pageExtensions: developmentOnly \? \['dev\.js', 'js', 'jsx', 'ts', 'tsx'\] : \['js', 'jsx', 'ts', 'tsx'\]/);
  // Defence in depth: the page itself and the /dev/ middleware still answer 404 in production.
  assert.match(read('src/app/dev/home-facts/page.dev.js'), /if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/);
  assert.match(read('src/middleware.js'), /pathname\.startsWith\('\/dev\/'\)[\s\S]*process\.env\.NODE_ENV === 'production'[\s\S]*status: 404/);
  // Only the dev page imports the fixtures.
  for (const file of ['src/components/HomeDetail.jsx', 'src/components/HomesBoard.jsx', 'src/components/HomeModal.jsx', 'src/components/HomeFacts.jsx']) assert.doesNotMatch(read(file), /HomeFactsPreview/);
});

// The saved-home flow end to end at the persistence layer, with exactly the
// payload Add to My Homes sends: the merged form plus the listing snapshot.
dbTest('import → Add to My Homes: one home, nothing lost, even when the save is interrupted and retried', async () => {
  const { mergeImportFields } = await import('../src/lib/importDomain.js');
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
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${saved.id}' and user_id = '${ids.owner}'`)[0].n, 1);

  // 3. What Home Facts loads for /homes/{id}: every imported value and the snapshot survive.
  const loaded = await viewOf(ids.owner, saved.id);
  for (const field of ['price', 'beds', 'garageSpaces', 'basementNotes']) assert.equal(String(loaded[field]), String(SNAPSHOT.fields[field]), field);
  assert.deepEqual(loaded.listingImport, SNAPSHOT);
  assert.equal(importedDetailCount(loaded.listingImport), 8);
  assert.match(homeFactsWelcome(loaded, 'import').body, /We found 8 details/);
  assert.equal(homeFeatureSummary(loaded, buy())[0].provenance, 'listing');

  // 4. Pasting or sharing the same link again finds the saved home (no second import), for the co-buyer too.
  assert.equal(findHomeByListingUrl(await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search), listingUrl)?.id, saved.id);
});
