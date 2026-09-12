import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

const appShell = read('src/components/AppShell.jsx');
const globalsCss = read('src/app/globals.css');
const savedHomesMap = read('src/components/SavedHomesMap.jsx');
const priorityBoard = read('src/components/PriorityBoard.jsx');
const mySearchPanel = read('src/components/MySearchPanel.jsx');
const inviteCoBuyer = read('src/components/InviteCoBuyer.jsx');
const coBuyerManagement = read('src/components/CoBuyerManagement.jsx');
const commuteDestinations = read('src/components/CommuteDestinations.jsx');

/* --------------------------------- Map layout --------------------------------- */

test('the map route gets a dedicated flex frame instead of a hard-coded mobile height', () => {
  assert.match(appShell, /pathname === '\/map' \? 'hh-map-frame' : ''/);
  // The old hard-coded value is only mentioned in an explanatory comment now
  // (the "used to be" rationale) — never inside an actual declaration.
  assert.doesNotMatch(globalsCss, /height: calc\(100dvh - 200px\)/);
});

test('the map frame fills the viewport using the flex box model, not a guessed header height', () => {
  const block = globalsCss.match(/@media \(max-width: 700px\) \{\s*\n\s*\.hh-map-page-intro[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(block, 'expected the map mobile breakpoint block');
  assert.match(block, /\.hh-root:has\(\.hh-map-frame\) \{ padding-bottom: 0; \}/);
  assert.match(block, /\.hh-map-frame \{ display: flex; flex-direction: column; height: calc\(100dvh - 78px - env\(safe-area-inset-bottom\)\); \}/);
  assert.match(block, /\.hh-map-frame \.hh-map-layout \{ flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: stretch;/);
  assert.match(block, /\.hh-map-frame \.hh-map-stage \{ flex: 1; min-height: 0; height: auto; \}/);
});

test('regression: the flex map frame does not inherit the base grid rule\'s align-items: start, which collapses stage width to content size', () => {
  // The base (desktop) .hh-map-layout rule sets align-items: start for its
  // grid — that property name is shared with flexbox but means something
  // different there (don't stretch cross-axis), which silently collapsed
  // .hh-map-stage to ~0 width the first time this was tried (its only
  // children are absolutely positioned, so it has no content width to fall
  // back on). The mobile override must set its own align-items explicitly.
  const block = globalsCss.match(/\.hh-map-frame \.hh-map-layout \{[^}]*\}/)?.[0] || '';
  assert.match(block, /align-items: stretch/);
});

test('map preview: photo fallback, Match trust guard, and a Directions link are present', () => {
  assert.match(savedHomesMap, /selected\.photoUrl \? <img src=\{selected\.photoUrl\} alt="" \/> : <div className="hh-map-preview-photo-fallback">/);
  assert.match(savedHomesMap, /const matchTrustworthy = !match\?\.allSelected\?\.some\(\(c\) => c\.key === 'location:Commute'\);/);
  assert.match(savedHomesMap, /\{matchTrustworthy && match\?\.pct !== null && match\?\.pct !== undefined && <span className="hh-map-match">/);
  assert.match(savedHomesMap, /maps\.apple\.com\/\?daddr=\$\{encodeURIComponent\(selected\.address\)\}/);
  assert.match(savedHomesMap, /target="_blank" rel="noreferrer">Directions<\/a>/);
});

test('touch targets on the map preview actions meet the ~44px guidance', () => {
  assert.match(globalsCss, /\.hh-map-preview-actions a \{[^}]*min-height: 40px;/);
});

test('regression guard: fit/bounds and marker-click-select logic in SavedHomesMap are untouched by this pass', () => {
  assert.match(savedHomesMap, /map\.fitBounds\(bounds, 56\)/);
  assert.match(savedHomesMap, /marker\.addListener\('click', \(\) => setSelection\(\{ type: 'home', id: home\.id \}\)\)/);
  assert.match(savedHomesMap, /mapRef\.current\.panTo\(selectedItem\.mapPosition\)/);
  assert.match(savedHomesMap, /map\.setCenter\(\(eligible\[0\] \|\| eligibleDestinations\[0\]\)\.mapPosition\); map\.setZoom\(14\);/);
});

/* ------------------------------ My Search: priorities ------------------------------ */

test('PriorityBoard extracts a shared TierItemsList so desktop and the mobile Sheet never drift apart', () => {
  assert.match(priorityBoard, /function TierItemsList\(\{ tier, items, activeItem, setActiveItem, setTier, priorities, setSchoolsNote, onItemDragStart, onItemDragEnd \}\)/);
  const usages = priorityBoard.match(/<TierItemsList\b/g) || [];
  assert.equal(usages.length, 2, 'expected TierItemsList used once for the desktop column and once inside the mobile Sheet');
});

test('mobile compact tier summary is gated on viewport and never active during onboarding', () => {
  assert.match(priorityBoard, /const \[mobileCompact, setMobileCompact\] = useState\(false\);/);
  assert.match(priorityBoard, /if \(onboarding\) return;/);
  assert.match(priorityBoard, /window\.matchMedia\('\(max-width: 700px\)'\)/);
  // The desktop/onboarding 3-column grid markup must still exist verbatim —
  // this is an added mobile branch, not a replacement.
  assert.match(priorityBoard, /className="hh-priority-tiers" aria-label="Selected preferences by importance"/);
  assert.match(priorityBoard, /className={`hh-tier-group hh-tier-\$\{tier\}/);
});

test('tapping a tier summary row opens that tier in a Sheet, reusing the exact TIER_META/TIER_DESCRIPTIONS copy', () => {
  assert.match(priorityBoard, /className="hh-tier-summary-row"/);
  assert.match(priorityBoard, /onClick={\(\) => setOpenTierSheet\(tier\)}/);
  assert.match(priorityBoard, /import Sheet from '@\/components\/Sheet'/);
  assert.match(priorityBoard, /title={TIER_META\[openTierSheet\]\.label}/);
  assert.match(priorityBoard, /{TIER_DESCRIPTIONS\[openTierSheet\]}/);
});

test('touch targets on the tier summary rows meet the ~44px guidance', () => {
  assert.match(globalsCss, /\.hh-tier-summary-row \{[^}]*min-height: 52px;/);
});

/* --------------------------- My Search: Sheet migrations --------------------------- */

test('InviteCoBuyer, CoBuyerManagement, and the Places editor all use the shared Sheet primitive now', () => {
  for (const [name, source] of [['InviteCoBuyer', inviteCoBuyer], ['CoBuyerManagement', coBuyerManagement], ['CommuteDestinations', commuteDestinations]]) {
    assert.match(source, /import Sheet from '@\/components\/Sheet'/, `${name} should import Sheet`);
    assert.doesNotMatch(source, /hh-modal-backdrop/, `${name} should no longer use the old ad hoc modal backdrop`);
  }
});

test('regression: an initially-open empty Places editor can be dismissed and does not reopen solely because destinations are still empty', () => {
  // The bug: Sheet's `open` (and the Add button's visibility) were derived
  // live from `destinations.length === 0 && !startCollapsedWhenEmpty` in
  // three places, not just used to seed initial state. cancel() clears
  // `adding`/`editingId`, but that derived expression is unaffected by
  // either — with zero destinations and startCollapsedWhenEmpty false, it
  // stayed permanently true, so the Sheet could never actually close (and
  // the reopen button stayed hidden the whole time, since it was gated by
  // the same expression negated).
  //
  // The fix: that expression seeds `adding`'s *initial* value only — the
  // Sheet's `open`, the error placement, and the Add button's visibility
  // must all depend solely on live editing state afterward.
  assert.match(commuteDestinations, /const \[adding, setAdding\] = useState\(destinations\.length === 0 && !startCollapsedWhenEmpty\);/);

  const emptyCheckOccurrences = (commuteDestinations.match(/destinations\.length === 0 && !startCollapsedWhenEmpty/g) || []).length;
  assert.equal(emptyCheckOccurrences, 1, 'the empty-state check must appear exactly once — seeding initial state — and nowhere else as a live gate');

  assert.match(commuteDestinations, /<Sheet\s*\n\s*open={editingId !== null \|\| adding}\s*\n\s*onClose={cancel}/);
  assert.match(commuteDestinations, /{!adding && \(\s*\n\s*<button type="button" className="hh-btn hh-btn-ghost" onClick={\(\) => { setDraft\(blank\); setError\(''\); setAdding\(true\); }}>/);
  assert.match(commuteDestinations, /const cancel = \(\) => \{ setEditingId\(null\); setAdding\(false\); setDraft\(blank\); setError\(''\); \};/);
});

test('save/delete behavior and Google Places/API surface in CommuteDestinations are untouched by the dismissal fix', () => {
  assert.match(commuteDestinations, /createCommuteDestination\(supabase, searchId, userId, values\)/);
  assert.match(commuteDestinations, /updateCommuteDestination\(supabase, editingId, values\)/);
  assert.match(commuteDestinations, /deleteCommuteDestination\(createClient\(\), destination\.id\)/);
  assert.doesNotMatch(commuteDestinations, /google|places\.googleapis/i);
});

test('the collaboration philosophy copy survives the Sheet migration verbatim', () => {
  assert.match(inviteCoBuyer, /aren&apos;t hidden from the people in this search/);
  assert.match(inviteCoBuyer, /don&apos;t combine them into one score or let another person change/);
});

/* ------------------------------ My Search: Searching Together ------------------------------ */

test('Searching Together is one consolidated section (alone vs. together, collaborator context, and the one appropriate action), positioned after Places that matter', () => {
  assert.match(mySearchPanel, /function SearchingTogetherCard\(/);
  assert.match(mySearchPanel, /You&apos;re searching with a collaborator\./);
  assert.match(mySearchPanel, /You&apos;re searching alone\./);
  assert.doesNotMatch(mySearchPanel, /function CollaboratorContextCard/);

  const placesIdx = mySearchPanel.indexOf('title="Places that matter"');
  const togetherIdx = mySearchPanel.indexOf('<SearchingTogetherCard');
  assert.ok(placesIdx !== -1 && togetherIdx !== -1 && placesIdx < togetherIdx, 'Searching Together must render after Places that matter');
});

test('regression guard: no Couple Match / merged-opinion language was introduced', () => {
  assert.doesNotMatch(mySearchPanel, /couple match/i);
  assert.doesNotMatch(mySearchPanel, /combined score|merge.*opinion|average.*match/i);
});

test('regression guard: My Search IA order is Basics, then What matters, then Places, then Searching Together', () => {
  const order = ['<BasicsCard', '<WhatMattersCard', 'title="Places that matter"', '<SearchingTogetherCard']
    .map((needle) => mySearchPanel.indexOf(needle));
  assert.ok(order.every((i) => i !== -1), 'expected all four sections to be present');
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `expected section ${i} to follow section ${i - 1} in source order`);
});
