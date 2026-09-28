import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePriorities, getItemlistCategories } from '../src/lib/constants.js';
import { computeMatch, selectPriorityItem, mustHaveStatus } from '../src/lib/matching.js';
import { findHomeByListingUrl } from '../src/lib/listingUrl.js';
import { PROVENANCE_LABELS, fieldProvenance, hasImportSnapshot } from '../src/lib/homeProvenance.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/HomeModal.jsx');
const editor = modal.slice(modal.indexOf('function EditHomeEditor'), modal.indexOf('export default function HomeModal'));
const css = read('src/app/globals.css');

function select(priorities, categoryKey, label, tier, kind = 'check') {
  const def = getItemlistCategories(priorities.searchType).find((category) => category.key === categoryKey);
  return { ...priorities, [categoryKey]: selectPriorityItem(priorities[categoryKey], def, { label, kind }, tier) };
}

/* ------------------------------------ provenance ------------------------------------ */

test('provenance is derived only from the stored import snapshot, never guessed', () => {
  const snapshot = { fields: { price: '450000', beds: '3', baths: '2' } };
  assert.deepEqual(PROVENANCE_LABELS, { listing: 'From listing', you: 'Added by you', unknown: 'Unknown' });
  assert.equal(fieldProvenance('$450,000', snapshot, 'price'), 'listing');
  assert.equal(fieldProvenance('3', snapshot, 'beds'), 'listing');
  assert.equal(fieldProvenance('2.5', snapshot, 'baths'), 'you', 'a corrected value is the person’s');
  assert.equal(fieldProvenance('2005', snapshot, 'yearBuilt'), 'you', 'a value the listing never supplied was entered by a person');
  // Empty is Unknown — neutral, with or without a snapshot.
  assert.equal(fieldProvenance('', snapshot, 'sqft'), 'unknown');
  assert.equal(fieldProvenance(null, null, 'sqft'), 'unknown');
  // No snapshot: a filled value's origin is not claimed at all.
  assert.equal(fieldProvenance('450000', null, 'price'), null);
  assert.equal(fieldProvenance('450000', { fields: null }, 'price'), null);
  assert.equal(hasImportSnapshot(snapshot), true);
  assert.equal(hasImportSnapshot({ fields: {} }), false);
  assert.equal(hasImportSnapshot(undefined), false);
});

test('Add/Edit review wires provenance and the Unknown helper, and the legend only shows with a snapshot', () => {
  assert.match(editor, /const importSnapshot = importResult \|\| form\.listingImport \|\| null;/);
  assert.match(editor, /provenanceOf = \(field\) => fieldProvenance\(form\[field\], importSnapshot, field\)/);
  assert.match(editor, /\{snapshotAvailable && <p className="flh-provenance-legend"/);
  for (const field of ['price', 'beds', 'baths', 'sqft', 'lotSize', 'yearBuilt', 'garageSpaces']) assert.match(editor, new RegExp(`provenance=\\{provenanceOf\\('${field}'\\)\\}`));
  assert.match(editor, /Unknown is neutral\. Leave a field alone when the listing doesn’t support a reliable answer\./);
  // Match answers never carry a "From listing" evidence label.
  const matchSection = editor.slice(editor.indexOf('personalized-matches-heading'), editor.indexOf('shared-notes-heading'));
  assert.doesNotMatch(matchSection, /is-listing|From listing/);
});

test('approved Add/Edit copy: intake, import review, Match review, Edit', () => {
  assert.match(modal, /Bring in a \{vocabulary\.singularLower\} you found\./);
  assert.match(modal, /You found the \{vocabulary\.singularLower\}\. Feels Like Home helps you evaluate it\./);
  assert.match(modal, /`Review this \$\{vocabulary\.singularLower\}`/);
  assert.match(modal, /isNativeApp\(\) && <aside className="flh-share-callout"/);
  assert.match(editor, /'Check what came through\.'/);
  assert.match(editor, /'How this home fits you\.'/);
  assert.match(editor, /'Refine what FLH knows\.'/);
  assert.match(editor, /id="edit-home-title"/);
});

test('"What FLH found" is dismissible and the dismissal persists per device', () => {
  assert.match(modal, /export const WHAT_FLH_FOUND_DISMISS_KEY = 'flh-what-flh-found-dismissed'/);
  assert.match(modal, /localStorage\.setItem\(WHAT_FLH_FOUND_DISMISS_KEY, '1'\)/);
  assert.match(modal, /aria-label="Dismiss What FLH found"/);
  assert.match(editor, /<WhatFlhFoundIntro \/>/);
});

/* ------------------------------ Yes / No / Unknown integrity ------------------------------ */

let buyer = normalizePriorities({ searchType: 'purchase' });
buyer = select(buyer, 'features', 'Home office', 'must');
buyer = select(buyer, 'exterior', 'Fenced yard', 'must');

test('the editor’s three answers map to the canonical check values: true, "no", and absent', () => {
  assert.match(editor, /\[\['yes', 'Yes', true\], \['no', 'No', 'no'\], \['unknown', 'Unknown', undefined\]\]/);
  assert.match(editor, /value === undefined && <span className="flh-provenance is-unknown">Not confirmed<\/span>/);
});

test('Unknown is neutral: an unanswered Must Have is never a miss, a "No" is, and historical false stays Unknown', () => {
  const yes = mustHaveStatus(computeMatch({ checks: { 'features:Home office': true, 'exterior:Fenced yard': true } }, buyer));
  const unknown = mustHaveStatus(computeMatch({ checks: { 'features:Home office': true } }, buyer));
  const no = mustHaveStatus(computeMatch({ checks: { 'features:Home office': true, 'exterior:Fenced yard': 'no' } }, buyer));
  const legacy = mustHaveStatus(computeMatch({ checks: { 'features:Home office': true, 'exterior:Fenced yard': false } }, buyer));
  assert.equal(yes.missed, 0);
  assert.deepEqual([unknown.missed, unknown.unknown], [0, 1]);
  assert.equal(no.missed, 1);
  assert.deepEqual([legacy.missed, legacy.unknown], [0, 1]);
});

test('Match stays participant-specific: two people evaluating one home are never averaged', () => {
  let other = normalizePriorities({ searchType: 'purchase' });
  other = select(other, 'exterior', 'Fenced yard', 'important');
  const home = { checks: { 'features:Home office': 'no', 'exterior:Fenced yard': true } };
  assert.notEqual(computeMatch(home, buyer).pct, computeMatch(home, other).pct);
  // The Add Home preview computes each perspective separately.
  assert.match(editor, /matchPerspectives\.map\(\(perspective\) => \{ const match = computeMatch\(form, perspective\.priorities\);/);
  assert.doesNotMatch(editor, /average|avgMatch/i);
});

/* ------------------------------------ notes ownership ------------------------------------ */

test('pros, cons, and notes remain shared fields and are labeled truthfully', () => {
  const collaboration = read('src/lib/supabase/collaboration.js');
  const personal = collaboration.match(/const PERSONAL_FIELDS = \[([^\]]*)\]/)[1];
  const shared = collaboration.slice(collaboration.indexOf('const SHARED_FIELDS = ['), collaboration.indexOf('];', collaboration.indexOf('const SHARED_FIELDS = [')));
  for (const field of ['pros', 'cons', 'notes']) {
    assert.doesNotMatch(personal, new RegExp(`'${field}'`));
    assert.match(shared, new RegExp(`'${field}'`));
  }
  // Directly editable (no hidden toggle) and never described as private in a shared search.
  assert.match(editor, /id="edit-home-pros"/);
  assert.match(editor, /id="edit-home-cons"/);
  assert.match(editor, /id="edit-home-notes"/);
  assert.doesNotMatch(editor, /notesOpen|NoteSummary/);
  assert.match(editor, /isCollaborative \? 'Pros, cons, and notes are visible to everyone in this search\.'/);
  assert.doesNotMatch(editor, /private notes|only you can see/i);
});

/* ------------------------------------ duplicates ------------------------------------ */

test('manual Add opens the existing home for an exact listing-URL match — no "Add anyway"', () => {
  const find = modal.slice(modal.indexOf('const handleFind = () => {'), modal.indexOf('const handleFallbackAddressLookup'));
  assert.ok(find.indexOf('findHomeByListingUrl(existingHomes, raw)') < find.indexOf('extractAddressFromListingUrl(raw)'), 'duplicate check runs before any lookup');
  assert.match(find, /if \(existing\) \{ setDuplicateHome\(existing\); return; \}/);
  const view = modal.slice(modal.indexOf('function DuplicateHomeView'), modal.indexOf('function EditHomeEditor'));
  assert.match(view, /This \{vocabulary\.singularLower\} is already here/);
  assert.match(view, /Open existing \{vocabulary\.singularLower\}/);
  assert.match(view, /href=\{`\/homes\/\$\{encodeURIComponent\(home\.id\)\}`\}/);
  assert.doesNotMatch(view, /Add anyway/i);
  assert.match(read('src/components/HomesBoard.jsx'), /autoFindOnMount=\{modalAutoFind\} existingHomes=\{homes\}/);
});

test('shared-home duplicate state keeps Match answers personal and says notes are shared', () => {
  const view = modal.slice(modal.indexOf('function DuplicateHomeView'), modal.indexOf('function EditHomeEditor'));
  assert.match(view, /const addedByOther = isCollaborative && home\.userId && userId && home\.userId !== userId;/);
  assert.match(view, /Your Yes \/ No \/ Unknown answers and Match stay your own\. Pros, cons, and notes on it are shared with everyone in this search\./);
  assert.match(view, /isArchivedStatus\(home\.status\)/);
});

test('the original listing URL is preserved exactly and matched exactly', () => {
  const url = 'https://www.zillow.com/homedetails/1-Oak-St/123_zpid/?utm_source=share';
  const homes = [{ id: 'a', listingUrl: url }];
  assert.equal(findHomeByListingUrl(homes, url)?.id, 'a');
  assert.equal(findHomeByListingUrl(homes, 'https://www.zillow.com/homedetails/1-Oak-St/123_zpid/'), null, 'no fuzzy guess');
  assert.match(modal, /lookupAddress\(result\.address, \{ listingUrl: raw \}\)/);
  assert.match(modal, /listingUrl: raw,/);
  assert.match(modal, /href=\{form\.listingUrl\} target="_blank" rel="noreferrer">View original listing/);
});

/* ------------------------------------ scroll trap ------------------------------------ */

test('Add/Edit Home scrolls on narrow viewports: the workspace is the scroll container, header and footer stay reachable', () => {
  const block = css.slice(css.indexOf('.hh-edit-home-backdrop { overflow: hidden; }'));
  assert.ok(block.length, 'expected the phone scroll fix');
  assert.match(block, /\.hh-edit-home-modal \{ display: flex; flex-direction: column; height: 100dvh; max-height: 100dvh; min-height: 0; overflow: hidden; \}/);
  assert.match(block, /\.hh-edit-home-modal > \.hh-workspace-shell \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
  assert.match(block, /\.hh-edit-home-modal > \.hh-edit-home-footer \{ position: static; \}/);
  // The two-step Add is presentation only: both steps render the same form.
  assert.match(css, /\.hh-edit-steps\.is-adding\.is-step-review \[data-step="match"\],\s*\n\s*\.hh-edit-steps\.is-adding\.is-step-match \[data-step="review"\] \{ display: none; \}/);
  assert.match(editor, /ref=\{shellRef\}/);
});

/* ------------------------------------ Map / Post-tour ------------------------------------ */

test('Map lists every saved place, including ones it cannot position yet', () => {
  const map = read('src/components/SavedHomesMap.jsx');
  assert.match(map, /\{places\.length > 0 \? \(/);
  assert.match(map, /\{places\.map\(\(destination\) => \{/);
  assert.match(map, /if \(!destination\.mapPosition\) return \(/);
  assert.match(map, /Not on the map yet/);
});

test('post-tour answers do not change Match, and the modal says so', () => {
  let priorities = normalizePriorities({ searchType: 'purchase' });
  priorities = select(priorities, 'features', 'Home office', 'must');
  const base = { checks: { 'features:Home office': true } };
  const toured = { ...base, reaction: 'love', ratings: { 'tour-v2:curb_appeal': 'negative', 'tour-v2:layout': 'positive' } };
  assert.deepEqual(computeMatch(toured, priorities), computeMatch(base, priorities));
  const postTour = read('src/components/PostTourModal.jsx');
  assert.match(postTour, /It won’t change your Match/);
  assert.match(postTour, /Step 1<\/p><h3>How did it feel in person\?/);
  assert.match(postTour, /Step 2<\/p><h3>Anything you want to remember\?/);
});

/* ------------------------------------ Account ------------------------------------ */

test('Account opens without an active buyer search or finished onboarding', () => {
  const layout = read('src/app/(app)/layout.js');
  assert.match(layout, /const isAccountRoute = requestedPath === '\/account'/);
  assert.match(layout, /const profile = isAccountRoute \? \{ \.\.\.gatedProfile, onboarding_complete: true \} : gatedProfile;/);
  assert.match(layout, /if \(!search\) \{[\s\S]*?workspace="account"/);
  const page = read('src/app/(app)/account/page.js');
  assert.match(page, /if \(profile\?\.onboarding_complete\) \{/);
  assert.match(page, /if \(search\) \{/);
  const shell = read('src/components/AppShell.jsx');
  assert.match(shell, /const hasBuyerSearch = workspace === 'buyer';/);
  assert.match(shell, /<Link href="\/account" className=\{`hh-shell-action hh-account-entry/);
  // The bottom nav keeps its five tabs; Account never takes a slot.
  assert.doesNotMatch(read('src/lib/constants.js').match(/MOBILE_PRIMARY_TABS[\s\S]*?\]\)/)?.[0] || '', /account/i);
});

test('Account claims no plan, tier, or beta entitlement — none exists in the product yet', () => {
  const account = read('src/components/AccountSettings.jsx');
  assert.doesNotMatch(account, /FLH\+|Feels Like Home\+|premium|subscription|beta|trial/i);
  assert.match(account, /updateProfileName\(createClient\(\), userId, first, last\)/);
  assert.match(account, /auth\.signOut\(\)/);
  // No fake delete control: account deletion is not implemented server-side.
  assert.doesNotMatch(account, /delete account/i);
});
