import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

const homesBoard = read('src/components/HomesBoard.jsx');
const appShell = read('src/components/AppShell.jsx');
const constants = read('src/lib/constants.js');
const globalsCss = read('src/app/globals.css');
const collaboration = read('src/lib/supabase/collaboration.js');
const tourPage = read('src/app/(app)/tour/page.js');
const favoritesPage = read('src/app/(app)/favorites/page.js');
const archivePage = read('src/app/(app)/archive/page.js');

/* ------------------------------ one shared Home card, not three ------------------------------ */

test('a single HomeCard understands all four collection contexts — no WantToTourCard/FavoriteCard/ArchiveCard duplicates', () => {
  assert.match(homesBoard, /function HomeCard\(\{ home, priorities, commuteDestinations, mode,/);
  assert.doesNotMatch(homesBoard, /function WantToTourCard|function FavoriteCard|function ArchiveCard/);
  // Every collection-specific behavior branches on the same `mode` prop, not a
  // parallel component tree.
  for (const mode of ["'tour'", "'favorites'", "'archive'", "'homes'"]) {
    assert.match(homesBoard, new RegExp(`mode === ${mode.replace(/'/g, "\\'")}`), `expected a mode === ${mode} branch`);
  }
});

test('no grid/list toggle was reintroduced', () => {
  assert.doesNotMatch(homesBoard, /list.?view|LayoutList|grid.?list.?toggle/i);
});

/* ------------------------------ shared collection navigation ------------------------------ */

test('My Homes Visual Refresh: Want to Tour and Archived are primary tabs (Archived last, muted); the secondary rail and Favorites nav are gone', () => {
  assert.match(constants, /\{ key: 'tour', label: 'Want to Tour', href: '\/tour' \}/);
  assert.match(constants, /\{ key: 'map', label: 'Map', href: '\/map' \},\n  \{ key: 'archive', label: 'Archived', href: '\/archive', muted: true \},\n\];/);
  assert.doesNotMatch(constants, /label: 'Favorites'/);
  assert.ok(!fs.existsSync('src/components/DecisionNav.jsx'), 'the DecisionNav rail was retired');
  for (const page of [tourPage, favoritesPage, archivePage]) assert.doesNotMatch(page, /DecisionNav/);
  assert.match(appShell, /className=\{`hh-tab \$\{active \? 'active' : ''\} \$\{muted \? 'is-muted' : ''\}`\} aria-current=\{active \? 'page' : undefined\}/);
  assert.match(globalsCss, /\.hh-tab\.active, \.hh-tab\.active:hover \{ color: var\(--brick\);/);
});

test('the /favorites route keeps working for stored favorites (compatibility), with no navigation entry pointing at it', () => {
  assert.match(favoritesPage, /<HomesBoard mode="favorites"/);
  assert.doesNotMatch(appShell, /href="\/favorites"/);
  assert.doesNotMatch(constants, /href: '\/favorites'/);
});

/* ------------------------------ page identity (already matched the spec) ------------------------------ */

test('regression guard: Want to Tour / Favorites / Archive page identity copy matches the product model', () => {
  assert.match(tourPage, /title="Want to Tour" subtitle="Homes that you or your collaborator are thinking about seeing in person\."/);
  assert.match(favoritesPage, /title="Favorites" subtitle="The homes that stand out to you, kept close at hand\."/);
  assert.match(archivePage, /title="Archived" subtitle="Homes you've set aside, with your thoughts saved in case you change your mind\. Restore one anytime\."/);
});

/* ------------------------------ responsive grid (already established by #84) ------------------------------ */

test('the approved responsive Home-card grid: four at 1440, two at 1024, one at 390 (three only in the 1100–1239 band)', () => {
  assert.match(globalsCss, /\.hh-homes-grid \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(globalsCss, /@media \(max-width: 1239px\) \{ \.hh-homes-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \} \}/);
  assert.match(globalsCss, /@media \(max-width: 1099px\) \{ \.hh-root \{ padding-inline: 32px; \} \.hh-homes-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
  assert.match(globalsCss, /\.hh-homes-grid \{ grid-template-columns: minmax\(0, 1fr\); gap: 16px; \}/);
});

/* ------------------------------ empty states: truthful, no discovery language ------------------------------ */

test('empty states point back to My Homes, never a listing-discovery feed', () => {
  assert.match(homesBoard, /Go to My Homes/);
  assert.doesNotMatch(homesBoard, /Browse homes|Discover homes|Find listings|Recommended homes/i);
});

test('the Archive empty state\'s "history intact" claim is true to the actual lifecycle: archiving/restoring only ever touches status + rejectionReason', () => {
  const lifecycle = read('src/lib/lifecycle.js');
  assert.match(lifecycle, /export function archiveHome\(home, reason = home\.rejectionReason \|\| ''\) \{\s*return \{ \.\.\.home, status: 'Archived', rejectionReason: reason \};/);
  assert.match(lifecycle, /export function restoreHome\(home\) \{\s*return \{ \.\.\.home, status: 'Saved', rejectionReason: '' \};/);
});

/* ------------------------------ Archive: "why you archived it" leads, Match recedes ------------------------------ */

test('on an archived card, the archive reason renders before the Match panel and never fabricates a reason', () => {
  const card = homesBoard.match(/function HomeCard\([\s\S]*?\n\}\n\nfunction CardGrid/)?.[0] || '';
  assert.ok(card);
  const reasonIndex = card.indexOf("mode === 'archive' && (");
  const matchIndex = card.indexOf('{match ? (');
  assert.ok(reasonIndex > -1 && matchIndex > -1 && reasonIndex < matchIndex, 'archive reason must precede the Match panel in the card');
  // Falls back to a truthful neutral placeholder, never an invented reason.
  assert.match(card, /\{home\.rejectionReason \|\| 'No reason saved yet\.'\}/);
});

test('Match remains real historical context on archived cards — just visually secondary, never lower-contrast/disabled', () => {
  assert.match(homesBoard, /className=\{`hh-match-panel\$\{mode === 'archive' \? ' is-secondary' : ''\}`\}/);
  assert.match(globalsCss, /\.hh-match-panel\.is-secondary \{ padding: 8px 11px; filter: saturate\(\.7\); \}/);
  assert.match(globalsCss, /\.hh-home-card \.hh-match-panel\.is-secondary \{ padding: 9px 12px; border-left-width: 2px; \}/);
  // No change to Match computation/semantics — this is a purely visual delta.
  assert.doesNotMatch(homesBoard, /computeMatch\(home, priorities, commuteEvaluation, mode/);
});

/* ------------------------------ Archive: Restore is dominant, Delete stays restrained ------------------------------ */

test('regression guard: Restore stays the dominant archive action; permanent delete stays a small, separately-confirmed text action', () => {
  assert.match(homesBoard, /className="hh-btn hh-card-primary-action"[^>]*onClick=\{\(\) => onRestore\(home\)\}>\s*<Undo2 size=\{13\} aria-hidden="true" \/> Restore/);
  assert.match(homesBoard, /className="hh-card-text-action is-danger" onClick=\{\(\) => onRequestDelete\(home\)\}>Delete permanently/);
  assert.match(homesBoard, /title="Delete this home permanently\?"/);
  assert.match(homesBoard, /confirmLabel="Delete permanently"/);
  assert.match(globalsCss, /\.hh-card-primary-action\.hh-btn \{/);
  assert.match(globalsCss, /\.hh-card-text-action \{ display: inline-flex; align-items: center; gap: 3px; min-height: 40px; padding: 0; border: 0; background: none;/);
});

/* ------------------------------ Favorites: no redundant banner, ownership stays participant-scoped ------------------------------ */

test('My Homes Visual Refresh: cards carry no favorite heart or "Your favorite" banner; favoriting stays on Home Detail', () => {
  assert.doesNotMatch(homesBoard, /Your favorite|hh-card-favorite|onToggleFavorite|toggleFavorite/);
  assert.doesNotMatch(globalsCss, /\.hh-lifecycle-status\.is-favorite/);
  assert.match(read('src/components/HomeDetail.jsx'), /aria-label=\{home\.isFavorite \? 'Remove from favorites' : 'Add to favorites'\}/);
});

test('regression guard: Favorites/Want to Tour/Archive ownership stays scoped to the current participant\'s own home_member_state row, never merged', () => {
  assert.match(collaboration, /export async function getHomesForUser\(supabase, userId, searchId\)/);
  assert.match(collaboration, /\.eq\('user_id', userId\)\.in\('home_id', homeIds\)/);
  // Co-buyer signals only ever cross into application code as sanitized
  // booleans from resolve_cobuyer_lifecycle_signals — never raw identity,
  // status text, or timestamps for another participant.
  assert.match(collaboration, /supabase\.rpc\('resolve_cobuyer_lifecycle_signals'/);
  assert.match(collaboration, /coBuyerWantsToTour: Boolean\(row\.co_buyer_wants_to_tour\)/);
  assert.doesNotMatch(collaboration, /auth\.users/);
});

test('regression guard: a Realtor is never counted as a co-buyer participant', () => {
  assert.match(collaboration, /export async function getSearchParticipantIds\(supabase, search\) \{\s*\n\s*const \{ data, error \} = await supabase\.from\('search_members'\)\.select\('user_id'\)\.eq\('search_id', search\.id\)\.eq\('role', 'co_buyer'\);/);
});

/* ------------------------------ Want to Tour: primary action + no Realtor conflation ------------------------------ */

test('regression guard: "I toured this home" remains the dominant Want to Tour action, and post-tour semantics are untouched', () => {
  assert.match(homesBoard, /mode !== 'homes' && \(\s*<button type="button" className="hh-btn hh-card-tour-action"[^>]*onClick=\{\(\) => onOpenPostTour\(home\)\}>\s*<MessageCircle size=\{13\} aria-hidden="true" \/> I toured this home/);
  assert.match(homesBoard, /applyPostTourVerdict/);
});

test('Realtor tour-suggestion provenance (tour_suggestions) is never read or rendered by the collection cards, so it cannot be conflated with participant Want to Tour state', () => {
  assert.doesNotMatch(homesBoard, /tour_suggestions|tourSuggestion/i);
  // The only "suggested" language on a card is accepted-suggestion provenance
  // (already-existing #80 behavior), which is a one-way history label, never
  // a lifecycle toggle.
  assert.match(homesBoard, /\{home\.suggestedBy && <span className="hh-image-provenance">Suggested by \{home\.suggestedBy\}<\/span>\}/);
});

/* ------------------------------ auth boundary: untouched ------------------------------ */

test('regression guard: Want to Tour / Favorites / Archive still load exclusively through requireUser()/withAuthRecovery() — no independent getUser() calls', () => {
  for (const [name, src] of [['tour/page.js', tourPage], ['favorites/page.js', favoritesPage], ['archive/page.js', archivePage]]) {
    assert.match(src, /withAuthRecovery\(async \(\) => \{/, `${name} should still be wrapped in withAuthRecovery`);
    assert.match(src, /const user = await requireUser\(supabase\);/, `${name} should still call requireUser`);
    assert.doesNotMatch(src, /supabase\.auth\.getUser\(\)/, `${name} should not add an independent getUser() call`);
  }
});
