import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

const homesBoard = read('src/components/HomesBoard.jsx');
const decisionNav = read('src/components/DecisionNav.jsx');
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

test('DecisionNav is the single shared secondary nav for Want to Tour / Favorites / Archive, with the terracotta active treatment', () => {
  assert.match(decisionNav, /label: 'Want to Tour', href: '\/tour'/);
  assert.match(decisionNav, /label: 'Favorites', href: '\/favorites'/);
  assert.match(decisionNav, /label: 'Archive', href: '\/archive'/);
  assert.match(globalsCss, /\.hh-decision-item\.active \{ color: var\(--brick\);/);
  // Not promoted into primary AppShell navigation — it's its own secondary rail.
  assert.match(decisionNav, /className="hh-decision-rail"/);
});

test('Favorites/Archive only appear in the rail once something lives there — Want to Tour always shows', () => {
  assert.match(decisionNav, /if \(i\.key === 'favorites'\) return hasFavorites;/);
  assert.match(decisionNav, /if \(i\.key === 'archive'\) return hasArchived;/);
});

/* ------------------------------ page identity (already matched the spec) ------------------------------ */

test('regression guard: Want to Tour / Favorites / Archive page identity copy matches the product model', () => {
  assert.match(tourPage, /title="Want to Tour" subtitle="Homes that you or your collaborator are thinking about seeing in person\."/);
  assert.match(favoritesPage, /title="Favorites" subtitle="The homes that stand out to you, kept close at hand\."/);
  assert.match(archivePage, /title="Archive" subtitle="Homes you've set aside, with your thoughts saved in case you change your mind\."/);
});

/* ------------------------------ responsive grid (already established by #84) ------------------------------ */

test('regression guard: the #84 responsive Home-card grid philosophy (4/3/2/1) is unchanged', () => {
  assert.match(globalsCss, /\.hh-homes-grid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(globalsCss, /\.hh-homes-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(globalsCss, /\.hh-homes-grid \{ grid-template-columns: repeat\(4, minmax\(300px, 1fr\)\); \}/);
  assert.match(globalsCss, /\.hh-homes-grid \{ grid-template-columns: minmax\(0, 1fr\); gap: 20px; \}/);
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
  // No change to Match computation/semantics — this is a purely visual delta.
  assert.doesNotMatch(homesBoard, /computeMatch\(home, priorities, commuteEvaluation, mode/);
});

/* ------------------------------ Archive: Restore is dominant, Delete stays restrained ------------------------------ */

test('regression guard: Restore stays the dominant archive action; permanent delete stays a small, separately-confirmed text action', () => {
  assert.match(homesBoard, /className="hh-btn hh-card-primary-action"[^>]*onClick=\{\(\) => onRestore\(home\)\}>\s*<Undo2 size=\{13\} \/> Restore/);
  assert.match(homesBoard, /className="hh-card-text-action" onClick=\{\(\) => onRequestDelete\(home\)\}>Delete permanently/);
  assert.match(homesBoard, /title="Delete this home permanently\?"/);
  assert.match(homesBoard, /confirmLabel="Delete permanently"/);
  assert.match(globalsCss, /\.hh-card-primary-action \{/);
  assert.match(globalsCss, /\.hh-card-text-action \{ border: 0; background: none;/);
});

/* ------------------------------ Favorites: no redundant banner, ownership stays participant-scoped ------------------------------ */

test('the Favorites card lets the heart speak for itself — no redundant "Your favorite" banner duplicating an already-accessible control', () => {
  assert.doesNotMatch(homesBoard, /Your favorite/);
  assert.doesNotMatch(globalsCss, /\.hh-lifecycle-status\.is-favorite/);
  // The heart button's own aria-label already announces current state to
  // assistive tech — this is what the banner would have duplicated.
  assert.match(homesBoard, /aria-label=\{isFavorite \? 'Remove from favorites' : 'Add to favorites'\}/);
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
  assert.match(homesBoard, /mode !== 'homes' && \(\s*<button type="button" className="hh-btn"[^>]*onClick=\{\(\) => onOpenPostTour\(home\)\}>\s*<MessageCircle size=\{13\} \/> I toured this home/);
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
