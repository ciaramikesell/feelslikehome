// My Homes Visual Refresh (Phase 1): the approved header, toolbar, card and
// Archived destination — presentation only. These tests pin what the redesign
// must preserve (data, Match, permissions, lifecycle) as much as what it adds.
// The real-Postgres section skips unless FLH_TEST_PGHOST is set
// (docs/database-tests.md); browser QA lives in scripts/qa/my-homes-visual-qa.mjs.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { PRIMARY_TABS, MOBILE_PRIMARY_TABS, emptyHome, normalizePriorities } from '../src/lib/constants.js';
import { EMPTY_FILTERS, activeFilterLabels, applyContenderFilters, singleFilterCounts, sortContenders, SORT_MENU } from '../src/lib/homesCollection.js';
import { computeMatch, selectHomeCardCriteria } from '../src/lib/matching.js';
import { homeCardSnapshot } from '../src/lib/homeCardPresentation.js';
import { archiveHome, restoreHome } from '../src/lib/lifecycle.js';

register('./support/aliasHooks.mjs', import.meta.url);

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const shell = read('src/components/AppShell.jsx');
const board = read('src/components/HomesBoard.jsx');
const card = board.match(/function HomeCard\([\s\S]*?\n\}\n\nfunction CardGrid/)?.[0] || '';
const ui = read('src/components/ui.jsx');
const css = read('src/app/globals.css');
const refreshCss = css.slice(css.indexOf('My Homes Visual Refresh (Phase 1)'), css.indexOf('/* ── Onboarding V2 shell (Phase 1)'));
const homesPage = read('src/app/(app)/homes/page.js');
const archivePage = read('src/app/(app)/archive/page.js');

/* --------------------------------- header --------------------------------- */

test('header: utility row (My Search, Account | How it works, Sign out), centered wordmark, no house mark', () => {
  assert.match(shell, /<nav className="hh-utility-nav" aria-label="Account and search">/);
  const utility = shell.slice(shell.indexOf('hh-utility-nav'), shell.indexOf('hh-brand-lockup'));
  const order = ['>\n                My Search', 'hh-account-entry-label">Account', 'How it works', 'Sign out'].map((needle) => utility.indexOf(needle));
  assert.ok(order.every((index) => index > -1), `missing utility: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'utility order');
  assert.match(shell, /<p className="hh-brand-wordmark" aria-hidden="true">Feels Like <span>Home<\/span><\/p>/);
  assert.match(shell, /<p className="hh-brand-tagline">THE HOME MATCHMAKER<\/p>/);
  assert.doesNotMatch(shell, /BrandMark/);
  assert.match(refreshCss, /\.hh-brand-wordmark \{ margin: 0; color: var\(--ink\); font: 700 48px\/1 var\(--font-wordmark\);/);
  assert.match(refreshCss, /\.hh-brand-wordmark span \{ color: var\(--brick\); \}/);
  assert.match(css, /family=Cormorant\+Garamond:wght@600;700&family=DM\+Sans/);
  // Sign out is visible on phones too (it was desktop-only before).
  assert.doesNotMatch(shell, /hh-desktop-only[^"]*" onClick=\{signOut\}/);
});

test('header preserves search switching, collaboration state, and the Realtor workspace links', () => {
  assert.match(shell, /hasBuyerSearch && accessibleSearches && accessibleSearches\.length > 1 && \(\s*<SearchSwitcher userId=\{userId\} searches=\{accessibleSearches\} activeSearchId=\{activeSearchId\} \/>/);
  assert.match(shell, /\(isRealtorWorkspace \|\| hasRealtorRelationships\) && <Link href="\/realtor"/);
  assert.match(shell, /\(isRealtorWorkspace \|\| hasRealtorRelationships\) && <Link href="\/people"/);
  assert.match(shell, /isRealtorWorkspace && <Link href="\/homes"/);
  // My Search and the primary tabs exist only with a buyer search.
  assert.match(shell, /\{hasBuyerSearch && <Link\s+href="\/search"/);
  assert.match(shell, /\{hasBuyerSearch && <nav className="hh-tabs" aria-label="Primary navigation">/);
  // Search switching still remounts every page's client state per search.
  assert.match(shell, /<Fragment key=\{activeSearchId \|\| workspace\}>\{children\}<\/Fragment>/);
  assert.doesNotMatch(shell, /Our Search/);
});

test('primary navigation: Homes, Want to Tour, Compare, Map, Archived (muted, last); phone bottom bar unchanged', () => {
  assert.deepEqual(PRIMARY_TABS.map(({ label, href }) => [label, href]), [['Homes', '/homes'], ['Want to Tour', '/tour'], ['Compare', '/compare'], ['Map', '/map'], ['Archived', '/archive']]);
  assert.deepEqual(PRIMARY_TABS.filter((tab) => tab.muted).map((tab) => tab.key), ['archive']);
  assert.deepEqual(MOBILE_PRIMARY_TABS.map(({ key }) => key), ['homes', 'tour', 'compare', 'map', 'search']);
  assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(refreshCss, /\.hh-tab\.is-muted \{ color: #8f8278; \}/);
  // Hairlines reach the window edges without horizontal scroll (ink overflow).
  assert.match(refreshCss, /border-image: linear-gradient\(rgba\(138,124,110,\.24\), rgba\(138,124,110,\.24\)\) 1 \/ 1px 0 \/ 0 100vmax;/);
  // Phones: tabs scroll sideways; focused editor routes still hide them.
  assert.match(refreshCss, /\.hh-tabs \{ justify-content: flex-start; gap: 24px;/);
  assert.match(css, /\.hh-focused-route \.hh-tabs,/);
});

test('no Favorites filter or navigation reappears anywhere in the shell or My Homes', () => {
  for (const source of [shell, board, read('src/lib/constants.js'), read('src/lib/homesCollection.js')]) {
    assert.doesNotMatch(source, /key: 'favorites'|href="\/favorites"|href: '\/favorites'|label: 'Favorites'/);
  }
  assert.ok(!existsSync(new URL('../src/components/HomesFilterSheet.jsx', import.meta.url)));
  assert.ok(!existsSync(new URL('../src/components/DecisionNav.jsx', import.meta.url)));
  assert.deepEqual(activeFilterLabels({ favorites: true }), []);
  // Stored favorites stay readable: the /favorites route and Home Detail heart remain.
  assert.match(read('src/app/(app)/favorites/page.js'), /mode="favorites"/);
  assert.match(read('src/components/HomeDetail.jsx'), /savePersonal\(toggleFavorite\(home\)\)/);
});

/* --------------------------------- toolbar --------------------------------- */

test('toolbar: search then Sort By, Add on the right; chips then the collaboration line, sharing the outer edges', () => {
  const toolbar = board.slice(board.indexOf('className="hh-homes-toolbar"'), board.indexOf('{saveError && <div className="hh-save-error"', board.indexOf('className="hh-homes-toolbar"')));
  const order = ['className="hh-homes-search"', 'className="hh-homes-sort"', 'className="hh-btn hh-homes-add"', 'className="hh-homes-toolbar-row is-secondary"', 'className="hh-filter-chips"', 'collaborationSlot &&'].map((needle) => toolbar.indexOf(needle));
  assert.ok(order.every((index) => index > -1), `toolbar order ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(board, /\{ key: 'all', label: 'All' \},\n    \{ key: 'match90', label: '90%\+ Matches' \},\n    \{ key: 'noMustMissing', label: 'No Must-Haves Missing' \},\n    \{ key: 'wantToTour', label: 'Want to Tour' \},\n  \];/);
  assert.match(refreshCss, /\.hh-homes-add\.hh-btn \{ flex: 0 0 auto; height: 46px; margin-left: auto;/);
  assert.match(refreshCss, /\.hh-homes-search \{ flex: 1 1 auto; max-width: 650px;/);
  // Phones: full-width search, Sort + Add together, sideways-scrolling chips, 16px inputs.
  assert.match(refreshCss, /\.hh-homes-search \{ flex: 1 1 100%; max-width: none; height: 48px; \}/);
  assert.match(refreshCss, /\.hh-homes-sort \{ flex: 1 1 0; min-width: 0; height: 46px; \}/);
  assert.match(refreshCss, /\.hh-homes-add\.hh-btn \{ flex: 1 1 0; margin-left: 0;/);
  assert.match(refreshCss, /\.hh-homes-search input \{ font-size: 16px; \}/);
});

test('invitation keeps the existing flow; a collaborative search shows status, never a second invite path', () => {
  const line = read('src/components/CoBuyerHomesLine.jsx');
  assert.match(line, /Searching together\?\{' '\}/);
  assert.match(line, /Invite collaborator <span aria-hidden="true">→<\/span>/);
  assert.match(line, /<InviteCoBuyer searchId=\{searchId\} userId=\{userId\} embedded onClose=\{\(\) => setInviteOpen\(false\)\} \/>/);
  assert.match(line, /if \(!isOwner\) return null;/);
  assert.match(homesPage, /isOwner=\{isOwner\} isCollaborative=\{isCollaborative\}/);
});

const priorities = (() => {
  let p = normalizePriorities({ searchType: 'purchase', budget: { value: '400000', tier: 'must' }, bedsMin: { value: '3', tier: 'must' } });
  p = { ...p, features: { ...p.features, tiers: { ...p.features.tiers, 'Home office': 'important' } } };
  return p;
})();
const homes = [
  { ...emptyHome(), id: 'a', createdAt: '2026-01-03', address: '25992 Briar Towne Blvd, Chesterfield, MI 48051', price: '319900', beds: '3', status: 'Want to Tour' },
  { ...emptyHome(), id: 'b', createdAt: '2026-01-02', address: '21223 Briar Ct, Saint Clair Shores, MI 48081', price: '324980', beds: '5', isFavorite: true },
  { ...emptyHome(), id: 'c', createdAt: '2026-01-01', address: '20680 Vernier Cir, Grosse Pointe Woods, MI 48236', price: '479000', beds: '2' },
];
const evaluate = (home) => computeMatch(home, priorities);

test('search, sort and filter keep their behavior through the new toolbar', () => {
  assert.deepEqual(applyContenderFilters(homes, EMPTY_FILTERS, evaluate, 'vernier').map((h) => h.id), ['c']);
  assert.deepEqual(applyContenderFilters(homes, { wantToTour: true }, evaluate).map((h) => h.id), ['a']);
  assert.deepEqual(applyContenderFilters(homes, { noMustMissing: true }, evaluate).map((h) => h.id), ['a', 'b']);
  assert.deepEqual(sortContenders(homes, 'newest', evaluate).map((h) => h.id), ['a', 'b', 'c']);
  assert.deepEqual(sortContenders(homes, 'priceDesc', evaluate).map((h) => h.id), ['c', 'b', 'a']);
  assert.equal(SORT_MENU[0].key, 'newest');
  assert.deepEqual(Object.keys(singleFilterCounts(homes, evaluate)), ['all', 'match90', 'noMustMissing', 'wantToTour']);
  assert.match(board, /const \[sortBy, setSortBy\] = useState\('newest'\);/);
});

/* ---------------------------------- card ---------------------------------- */

test('card order: identity → photo → divider → price/specs → Match → facts → divider → commute → actions', () => {
  const order = ['className="hh-card-identity"', 'hh-home-card-photo', 'className="hh-card-divider"', 'className="hh-card-pricing"', '{match ? (', 'className="hh-property-facts"', 'commuteDestinations.length > 0 && (', 'className="hh-home-card-actions"'].map((needle) => card.indexOf(needle));
  assert.ok(order.every((index) => index > -1), `card order ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // Second divider sits between facts and commute.
  assert.ok(card.lastIndexOf('className="hh-card-divider"') > card.indexOf('className="hh-property-facts"'));
  assert.match(card, /<span className="hh-card-price-row">|<p className="hh-card-price-row">/);
  assert.match(card, /\{factLine\.length > 0 && <p className="hh-card-factline">\{factLine\.join\(' · '\)\}<\/p>\}/);
  assert.match(refreshCss, /\.hh-card-identity \.hh-address \{[^}]*overflow-wrap: anywhere;/);
});

test('Match panel: house/check mark + percentage, Must Haves, one compact summary line; removed headings stay gone', () => {
  assert.match(card, /<MatchSummary match=\{match\} \/>/);
  assert.match(ui, /export function MatchMark\(\{ size = 24 \}\)/);
  assert.match(ui, /<MatchMark size=\{24\} \/>\s*<span className="hh-match-score-value" style=\{\{ color: matchColor\(match\.pct\) \}\}><strong>\{match\.pct\}%<\/strong> Match<\/span>/);
  // The brand asset itself is unchanged and still used elsewhere.
  assert.match(ui, /export function BrandMark\(\{ size = 34 \}\)/);
  assert.doesNotMatch(board, /Personalized Match|Personalized Criteria|<strong>Must Haves<\/strong>/);
  for (const label of ['`${criteriaSummary.matches.length} match`', '`${criteriaSummary.mismatches.length} don’t match`', '`${criteriaSummary.unknown.length} unknown`']) assert.ok(card.includes(label), label);
  // Color is never the only signal: symbols plus screen-reader state text.
  assert.match(card, /<span className="sr-only">\{!item\.evaluated \? ' \(unknown\)' : neutral \? ' \(neutral\)' : item\.met \? ' \(met\)' : ' \(missing\)'\}<\/span>/);
  // Status colors keep their meanings.
  assert.match(card, /style=\{\{ background: matchTint\(match\.pct\), borderLeftColor: matchColor\(match\.pct\) \}\}/);
  assert.match(refreshCss, /\.hh-must-summary \.is-negative \{ color: var\(--negative\); \}/);
  assert.match(refreshCss, /\.hh-must-summary \.is-unknown, \.hh-must-summary \.is-neutral \{ color: var\(--unknown\); \}/);
});

test('Match, Unknown semantics and weights are unchanged by the card (same canonical helpers)', () => {
  assert.match(card, /const match = computeMatch\(home, priorities, commuteEvaluation\);/);
  assert.match(card, /const cardCriteria = selectHomeCardCriteria\(match\);/);
  const unknownHome = { ...emptyHome(), id: 'u' };
  const match = computeMatch(unknownHome, priorities);
  assert.equal(match.pct, null, 'nothing known never becomes 0%');
  const { criteriaSummary, mustHaves } = selectHomeCardCriteria(match);
  assert.ok(mustHaves.every((item) => !item.evaluated));
  assert.equal(criteriaSummary.mismatches.length, 0);
  assert.match(ui, /Not enough information yet/);
});

test('missing photo, missing price and Unknown facts render honestly — nothing invented', () => {
  assert.match(card, /<span>No photo yet<\/span>/);
  assert.match(card, /\{price \|\| 'Price not added'\}/);
  assert.match(card, /\{propertyFacts\.length > 0 && \(/);
  assert.deepEqual(homeCardSnapshot({ ...emptyHome(), homeCondition: ['Unknown'] }, ''), []);
  assert.deepEqual(homeCardSnapshot({ ...emptyHome(), garageSpaces: '2', garageType: 'attached', schoolDistrict: "L'anse Creuse", homeLayout: ['Two Story'] }, 'Two Story').map((f) => [f.label, f.value]), [['Garage', '2 Car Attached'], ['Schools', "L'anse Creuse"], ['Style', 'Two Story']]);
  // Listing only when there is a listing URL.
  assert.match(card, /\{home\.listingUrl && \(\s*<a href=\{home\.listingUrl\} target="_blank" rel="noreferrer" className="hh-card-text-action"/);
});

test('actions: Listing, Archive, Edit, then Want to Tour — orange to add, sage when already selected', () => {
  const actions = card.slice(card.indexOf('className="hh-home-card-actions"'));
  const order = ['Listing <ArrowUpRight', 'onArchiveRequest(home)}>Archive', 'onEdit(home)}>Edit', 'onWantToTour(home)'].map((needle) => actions.indexOf(needle));
  assert.ok(order.every((index) => index > -1), `actions ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(actions, /\{isPreTour && mode !== 'archive' && \(\s*<button type="button" className="hh-btn hh-card-primary-action" aria-pressed="false" onClick=\{\(\) => onWantToTour\(home\)\}>/);
  assert.match(actions, /\{onTourList && mode === 'homes' && \(\s*<button type="button" className="hh-btn hh-card-primary-action is-selected" aria-pressed="true"[^>]*onClick=\{\(\) => onRemoveFromTour\(home\)\}>/);
  assert.match(refreshCss, /\.hh-card-primary-action\.is-selected \{ border-color: var\(--flh-sage-strong\); background: var\(--flh-sage-strong\); \}/);
  // The actions persist exactly as before (same lifecycle writes).
  assert.match(board, /const next = \{ \.\.\.home, status: 'Want to Tour' \};/);
  assert.match(board, /saveHome\(\{ \.\.\.home, status: 'Saved' \}, \{ shared: false, optimistic: true \}\)/);
  // Rows align across a grid row; narrow cards give the primary action its own row.
  assert.match(refreshCss, /margin-top: auto; padding-top: 4px; \}/);
  assert.match(refreshCss, /@container \(max-width: 276px\)/);
  // Touch targets on phones.
  assert.match(refreshCss, /\.hh-card-text-action \{ min-height: 44px; \}/);
});

test('responsive grid: four at 1440, two at 1024 and 768, one on phones; 40 → 32 → 16px insets', () => {
  assert.match(refreshCss, /\.hh-root \{ padding-inline: 40px; overflow-x: clip; \}/);
  assert.match(refreshCss, /\.hh-homes-grid \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(refreshCss, /@media \(max-width: 1099px\) \{ \.hh-root \{ padding-inline: 32px; \} \.hh-homes-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
  assert.match(refreshCss, /@media \(max-width: 700px\) \{\n  \.hh-root \{ padding-inline: 16px; \}/);
  assert.match(refreshCss, /\.hh-homes-grid \{ grid-template-columns: minmax\(0, 1fr\); gap: 16px; \}/);
  // The old phone-only compact card and its !important overrides are gone.
  assert.doesNotMatch(css, /\.hh-home-card-photo \{ height: 220px !important; \}/);
  assert.doesNotMatch(css, /is-contender \.hh-home-card-surface/);
});

test('empty states keep their truthful copy and paths', () => {
  assert.match(board, /"You found the homes\. We'll help you choose\."/);
  assert.match(board, /'Try a different search or filter\.'/);
  assert.match(board, /Clear filters/);
  assert.match(board, /title="Nothing archived\."/);
  assert.match(board, /title="Nothing on the tour list yet\."/);
});

/* -------------------------------- Archived -------------------------------- */

test('Archived reuses the existing archive view and lifecycle — no second archive system', () => {
  assert.match(archivePage, /<HomesBoard mode="archive"/);
  assert.match(archivePage, /getHomesForUser\(supabase, user\.id, search\.id\)/);
  assert.match(archivePage, /<PageIntro title="Archived"/);
  assert.match(board, /onClick=\{\(\) => onRestore\(home\)\}><Undo2 size=\{13\} aria-hidden="true" \/> Restore<\/button>/);
  const archived = archiveHome({ ...homes[0], ratings: { light: 4 }, notes: 'Keep' }, 'Busy street');
  assert.equal(archived.status, 'Archived');
  assert.deepEqual(archived.ratings, { light: 4 });
  const restored = restoreHome(archived);
  assert.equal(restored.status, 'Saved');
  assert.equal(restored.notes, 'Keep');
  // No new routes, migrations or archive tables were introduced.
  assert.ok(!existsSync(new URL('../src/app/(app)/archived', import.meta.url)));
  assert.ok(!readdirSync(new URL('../supabase/migrations', import.meta.url)).some((name) => /archiv|my-homes-visual/i.test(name)));
});

/* ---------------------------- real Postgres ---------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('Want to Tour, Archive and Restore stay per-participant; a Realtor cannot act for a buyer', async () => {
  const { acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalState, setActiveSearch } = await import('../src/lib/supabase/collaboration.js');
  const owner = db.createUser({ email: 'owner.refresh@example.com' });
  const coBuyer = db.createUser({ email: 'cobuyer.refresh@example.com' });
  const realtor = db.createUser({ email: 'realtor.refresh@example.com' });
  const search = db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
  for (const [user, email, role] of [[coBuyer, 'cobuyer.refresh@example.com', 'co_buyer'], [realtor, 'realtor.refresh@example.com', 'realtor']]) {
    const invitation = await createInvitation(db.clientFor(owner), search, owner, email, role);
    await acceptInvitation(db.clientFor(user), invitation.token);
  }
  await setActiveSearch(db.clientFor(coBuyer), coBuyer, search);
  const homeId = randomUUID();
  db.exec(`insert into public.homes (id, user_id, search_id, address) values ('${homeId}', '${owner}', '${search}', '25992 Briar Towne Blvd, Chesterfield, MI 48051')`);

  const ownerView = async () => (await getHomesForUser(db.clientFor(owner), owner, search)).find((home) => home.id === homeId);
  const coBuyerView = async () => (await getHomesForUser(db.clientFor(coBuyer), coBuyer, search)).find((home) => home.id === homeId);

  // Owner: Want to Tour (the card's orange action).
  await saveHomePersonalState(db.clientFor(owner), { ...(await ownerView()), status: 'Want to Tour' }, owner, search);
  assert.equal((await ownerView()).status, 'Want to Tour');
  assert.notEqual((await coBuyerView()).status, 'Want to Tour', "the co-buyer's card is not selected by the owner's choice");

  // Owner archives: it leaves the owner's My Homes, stays on the co-buyer's.
  await saveHomePersonalState(db.clientFor(owner), archiveHome(await ownerView(), 'Busy street'), owner, search);
  assert.equal((await ownerView()).status, 'Archived');
  assert.equal((await ownerView()).rejectionReason, 'Busy street');
  assert.equal((await coBuyerView()).status, 'Saved');

  // Restore from Archived.
  await saveHomePersonalState(db.clientFor(owner), restoreHome(await ownerView()), owner, search);
  assert.equal((await ownerView()).status, 'Saved');

  // A Realtor cannot write a buyer's personal state.
  await assert.rejects(
    saveHomePersonalState(db.clientFor(realtor), { ...(await ownerView()), status: 'Want to Tour' }, realtor, search),
    (error) => /row-level security/.test(error?.message || ''),
  );
  assert.equal(db.admin(`select count(*)::int as n from public.home_member_state where home_id = '${homeId}' and user_id = '${realtor}'`)[0].n, 0);
});
