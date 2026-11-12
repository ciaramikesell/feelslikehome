// Add Home V3, phase 1: the simple save (docs/add-home-v3-simple-save.md).
// A found home is saved with one Save Home. Nothing else is required, every
// optional part sits folded below it, a clear saved state follows, an optional
// photo that fails to upload never costs the home, and everything the lookup
// returned is still saved. The real-Postgres part saves exactly the payload
// Save Home sends, as the owner and as the co-buyer.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { DOC_ADDRESS, documentedProperty, documentedSaleListing } from './support/rentcastDocumentedShapes.js';

register('./support/aliasHooks.mjs', import.meta.url);
const { findInputLabel, foundHomeEssentials, foundHomePriceLine, savedHomeSummary } = await import('../src/lib/addHomeSave.js');
const { emptyHome } = await import('../src/lib/constants.js');
const { normalizeRentCastFields } = await import('../src/lib/rentcast.js');
const { mergeImportFields } = await import('../src/lib/importDomain.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { findHomeByListingUrl } = await import('../src/lib/listingUrl.js');
const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/HomeModal.jsx');
const board = read('src/components/HomesBoard.jsx');
const css = read('src/app/globals.css');
const card = modal.match(/function ImportFoundCard[\s\S]*?\n\}/)[0];
const savedView = modal.match(/function SavedHomeView[\s\S]*?\n\}/)[0];
const submit = modal.match(/const submit = async \(options\) => \{[\s\S]*?\n {2}\};/)[0];

/* ------------------------------- pure helpers ------------------------------- */

test('the found card shows the essentials it has, never a placeholder for what it lacks', () => {
  assert.deepEqual(foundHomeEssentials({ beds: '5', baths: '2', sqft: '2080', lotSize: '0.29 acres', yearBuilt: '1993' }), ['5 bd', '2 ba', '2,080 sq ft', '0.29 acres', 'Built 1993']);
  assert.deepEqual(foundHomeEssentials({ beds: '3', baths: '', sqft: '', lotSize: '', yearBuilt: '' }), ['3 bd']);
  assert.deepEqual(foundHomeEssentials(emptyHome()), []);
  // A year that is not a year is left out rather than shown oddly.
  assert.deepEqual(foundHomeEssentials({ yearBuilt: 'unknown', sqft: '0' }), []);
});

test('the price line never presents an inactive listing’s last price as an asking price', () => {
  assert.equal(foundHomePriceLine({ price: '335000' }, 'home_buy'), '$335,000');
  assert.equal(foundHomePriceLine({ price: '' }, 'home_buy', 'inactive'), 'No current asking price');
  assert.equal(foundHomePriceLine({ price: '' }, 'home_buy', 'active'), 'Price unknown');
});

test('the compact Find line names the site for a link and keeps an address as typed', () => {
  assert.equal(findInputLabel('https://www.zillow.com/homedetails/1-Main-St/1_zpid/'), 'zillow.com');
  assert.equal(findInputLabel('https://redfin.com/MI/x/home/1'), 'redfin.com');
  assert.equal(findInputLabel('100 Main St, Springfield, MI'), '100 Main St, Springfield, MI');
  assert.equal(findInputLabel('  '), '');
});

test('the saved state reports the photo actually saved, and a failed optional upload', () => {
  const form = { ...emptyHome(), address: '51613 Sass Rd, New Baltimore, MI 48047', price: '335000', beds: '5' };
  const ok = savedHomeSummary(form, { id: 'h1', photoUrl: 'https://x/storage/v1/object/public/home-photos/u/p.png', searchType: 'home_buy' });
  assert.deepEqual([ok.line1, ok.line2, ok.price, ok.facts, ok.photoFailed], ['51613 Sass Rd', 'New Baltimore, MI 48047', '$335,000', ['5 bd'], false]);
  const failed = savedHomeSummary(form, { id: 'h1', photoUrl: '', photoFailed: true, searchType: 'home_buy' });
  assert.equal(failed.photoUrl, '');
  assert.equal(failed.photoFailed, true);
});

test('the helpers are pure: no network, storage or provider calls', () => {
  assert.doesNotMatch(read('src/lib/addHomeSave.js'), /fetch\(|supabase|storage|localStorage|rentcast|import\(/i);
});

/* ------------------------------ the found card ------------------------------ */

test('Save Home is the one action and needs only an address: no paste, review, Match answer, note or photo', () => {
  assert.match(card, /<button type="button" className="hh-btn flh-found-add" onClick=\{onAdd\} disabled=\{saving \|\| !form\.address\.trim\(\)\}>/);
  assert.equal((card.match(/className="hh-btn flh-found-add"/g) || []).length, 1);
  // Saving re-checks the exact listing URL first, then the one submit().
  assert.match(modal, /const addImportedHome = \(\) => \{\s*const existing = findHomeByListingUrl\(existingHomes, form\.listingUrl\);\s*if \(existing\) \{ setDuplicateHome\(existing\); return; \}\s*submit\(\{ quickSave: true \}\);/);
  // Nothing in the save path depends on the reviews: pending suggestions are simply not written.
  assert.doesNotMatch(submit, /factDecisions|answerDecisions|confirmAnswer|useFact|pasteText/);
});

test('everything optional sits below Save Home, folded, and the Smart Paste reviews live inside it', () => {
  const at = (needle) => card.indexOf(needle);
  const order = ['className="hh-btn flh-found-add"', '<details className="hh-details flh-found-more">', '<ListingDetailsPaste paste={paste} />', '<HomeFactReview review={factReview} />', '<ListingAnswerReview review={answerReview} />', '<details className="hh-details flh-found-notes">'].map(at);
  assert.ok(order.every((index) => index > 0), `missing: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(card, /<details[^>]*\bopen\b/, 'nothing optional opens by default');
  // The folded paste says how many suggestions wait, so they are not lost.
  assert.match(card, /Optional\{pending \? ` · \$\{pending\} to review` : ''\}/);
  // The paste's own heading is not repeated under the disclosure's summary.
  assert.match(css, /\.flh-found-more \.flh-listing-paste-heading \{ display: none; \}/);
});

test('the card is recognizable: address with location, price, essentials, and the photo or a neutral placeholder', () => {
  assert.match(card, /<h2 id="found-home-title" className="hh-serif">\{line1 \|\| form\.address\}<\/h2>/);
  assert.match(card, /<MapPin size=\{13\} aria-hidden="true" \/> \{line2\}/);
  assert.match(card, /foundHomePriceLine\(form, priorities\.searchType, importResult\.listing\?\.status\)/);
  assert.match(card, /const facts = foundHomeEssentials\(form\);/);
  assert.match(modal, /\{src \? <img src=\{src\} alt="" \/> : <span className="flh-found-placeholder" aria-hidden="true"><House size=\{30\} \/><\/span>\}/);
  // The lookup's detail count stays truthful (lookup only) and lookup data is not dropped from the save.
  assert.match(card, /const count = found \? importedDetailCount\(lookupResult \|\| importResult\) : 0;/);
  assert.match(submit, /listingImport: listingImportSnapshot\(snapshotSource\)/);
  assert.match(submit, /importedCoordinatePatch\(form, importResult\)/);
});

test('Add photo reuses the staged upload: same handler, types and bucket; nothing is fetched from a listing site', () => {
  const photo = modal.match(/function FoundHomePhoto[\s\S]*?\n\}/)[0];
  assert.match(photo, /<input ref=\{photo\.inputRef\} type="file" accept="image\/jpeg,image\/png,image\/webp" onChange=\{photo\.onChange\} hidden \/>/);
  assert.match(modal, /onChange: handlePhotoFileChange, onRemove: handleRemovePhoto, error: photoError,/);
  // Staged until Save (no upload on selection), into the existing bucket.
  assert.doesNotMatch(photo, /upload|createClient|fetch\(/);
  assert.match(submit, /\.from\(PHOTO_BUCKET\)\s*\.upload\(path, photoFile/);
  assert.doesNotMatch(modal, /og:image|og_image|ogImage/);
});

test('a failed optional photo upload saves the home without it; the full editor still stops and asks', () => {
  assert.match(submit, /const quickSave = options\?\.quickSave === true;/);
  assert.match(submit, /if \(uploadError && quickSave\) \{\s*\/\/ Optional photo: keep going and save the home without it\.\s*photoFailed = true;\s*\} else if \(uploadError\) \{\s*setPhotoError\("We couldn't upload that photo — please try again, or save without it\."\);\s*setSaving\(false\);\s*return;/);
  // A thrown upload (network) is caught like a reported one.
  assert.match(submit, /\} catch \(err\) \{\s*uploadError = err \|\| new Error\('upload failed'\);/);
  // The photo URL saved after a failure is whatever the home already had; the staged file is not claimed.
  assert.match(submit, /let finalPhotoUrl = form\.photoUrl;/);
  assert.match(savedView, /summary\.photoFailed && <p className="flh-saved-photo-note" role="alert">The photo didn’t upload, so the \{vocabulary\.singularLower\} was saved without it\./);
});

/* ------------------------------ the saved state ------------------------------ */

test('after Save Home: a clear saved state, then back to My Homes or into the home — no questionnaire', () => {
  assert.match(submit, /const saved = await onSave\(\{[\s\S]*?\}, quickSave \? \{ landing: 'saved' \} : undefined\);\s*if \(quickSave && saved\?\.id\) \{\s*setSavedHome\(savedHomeSummary\(form, \{ id: saved\.id, photoUrl: finalPhotoUrl, photoFailed,/);
  assert.match(modal, /if \(savedHome\) return <SavedHomeView summary=\{savedHome\}/);
  assert.match(savedView, /Saved to My Homes/);
  assert.match(savedView, />Back to My Homes<\/button>/);
  assert.match(savedView, />View \{vocabulary\.singularLower\} <ArrowRight/);
  assert.match(modal, /onBackToHomes=\{onClose\} onOpenHome=\{\(\) => \(onOpenSavedHome \? onOpenSavedHome\(savedHome\.id\) : onClose\(\)\)\}/);
  // Focus moves to the saved heading so the change is announced.
  assert.match(savedView, /useEffect\(\(\) => \{ headingRef\.current\?\.focus\(\); \}, \[\]\);/);
  // No Match answer, Home Fact or note is asked for in the saved state.
  assert.doesNotMatch(savedView, /checks|Confirm|HomeFactReview|ListingAnswerReview|NoteListFields/);
});

test('My Homes keeps the saved home and the Router Cache fix; the overlay opens only when the buyer asks', () => {
  const fn = board.match(/const saveEditedHome = useCallback\(async \(home, \{ landing = 'overlay' \} = \{\}\) => \{[\s\S]*?\n {2}\}, \[modalHome, saveHome, router, workspace\]\);/)[0];
  assert.match(fn, /await refreshMyHomes\(\)\.catch\(\(\) => \{\}\);\s*await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\);\s*if \(landing === 'saved'\) return saved;\s*\/\/ The new home opens/);
  assert.match(fn, /const saved = await saveHome\(home, \{ shared, keepModalOpen: isNew \}\);/);
  assert.match(board, /const openSavedHome = useCallback\(\(id\) => \{\s*if \(workspace\) workspace\.openedFromBoard\.current = true;\s*router\.push\(`\/homes\/\$\{encodeURIComponent\(id\)\}`, \{ scroll: false \}\);\s*setModalHome\(null\);/);
  assert.match(board, /existingHomes=\{homes\} importLanding onOpenSavedHome=\{openSavedHome\}/);
});

test('entry paths are unchanged: Share Extension / universal link intake, duplicate redirect, Find and lookup', () => {
  assert.match(board, /openHomeModal\(validUrl \? \{ \.\.\.emptyHome\(\), listingUrl: rawUrl\.trim\(\) \} : emptyHome\(\), \{ autoFind: validUrl \}\)/);
  assert.match(board, /const existing = findHomeByListingUrl\(homes, rawUrl\);\s*if \(existing\) \{/);
  assert.match(modal, /if \(autoFindOnMount && findInput\.trim\(\)\) handleFind\(\);/);
  // One lookup per Find, never in the background; the compact line only reopens the input.
  assert.equal((modal.match(/fetch\('\/api\/import-listing'/g) || []).length, 1);
  assert.match(modal, /onClick=\{\(\) => setFindOpen\(true\)\} aria-label="Change the listing link or address">Change<\/button>/);
  assert.match(read('ios/App/ShareExtension/ShareURL.swift'), /homes/);
});

/* ------------------------------- real Postgres ------------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.simplesave@example.com' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.simplesave@example.com' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.simplesave@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

// The payload Save Home sends for a found home with nothing optional touched:
// the lookup merged into an empty home, plus its snapshot.
function savePayload(listingUrl, photoUrl = '') {
  const lookup = normalizeRentCastFields(documentedProperty(), documentedSaleListing(), { requestedAddress: DOC_ADDRESS });
  const importResult = { ...lookup, searchedAddress: DOC_ADDRESS };
  const form = mergeImportFields({ ...emptyHome(), listingUrl, address: DOC_ADDRESS }, lookup.fields);
  return { home: { ...form, photoUrl, listingImport: listingImportSnapshot(importResult, '2026-11-12T00:00:00.000Z') }, lookup };
}

dbTest('Save Home with nothing optional: one home, every looked-up value and the snapshot kept, no Match answer', async () => {
  const listingUrl = 'https://www.zillow.com/homedetails/100-Example-Ln/1_zpid/';
  const { home, lookup } = savePayload(listingUrl);
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.owner), home, ids.owner, ids.search);
  assert.equal(db.admin(`select count(*)::int as n from public.homes where listing_url = '${listingUrl}'`)[0].n, 1);
  const loaded = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).find((item) => item.id === saved.id);
  for (const [field, value] of Object.entries(lookup.fields)) {
    if (['latitude', 'longitude'].includes(field)) continue;
    assert.equal(String(loaded[field]), String(value), field);
  }
  assert.equal(loaded.listingImport.source, 'rentcast');
  assert.deepEqual(loaded.listingImport.listingFacts, lookup.listingFacts);
  assert.deepEqual(loaded.checks || {}, {}, 'no personal Match answer is written');
  assert.equal(loaded.photoUrl, '');
  // The same link again is a duplicate, for the co-buyer too.
  assert.equal(findHomeByListingUrl(await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search), listingUrl)?.id, saved.id);
});

dbTest('a co-buyer saves with the same one action; the owner sees it; personal answers stay apart', async () => {
  const listingUrl = 'https://www.zillow.com/homedetails/100-Example-Ln/2_zpid/';
  const { home } = savePayload(listingUrl, 'https://example.supabase.co/storage/v1/object/public/home-photos/u/front.png');
  const saved = await saveHomePersonalAndShared(db.clientFor(ids.coBuyer), home, ids.coBuyer, ids.search);
  const asOwner = (await getHomesForUser(db.clientFor(ids.owner), ids.owner, ids.search)).find((item) => item.id === saved.id);
  assert.ok(asOwner, 'the owner sees the co-buyer’s saved home');
  assert.equal(asOwner.photoUrl, home.photoUrl);
  assert.deepEqual(asOwner.checks || {}, {});
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${saved.id}' and checks <> '{}'::jsonb`)[0].n, 0);
});
