import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/* -------------------------------------------------------------------------
 * PR #87: Neighborhood Map visual refresh.
 *
 * Source-pattern based, matching this repo's existing test convention (no
 * Next.js/React runtime harness is available in this sandbox) and the same
 * approach used for #86's My Search suite. These verify structural/copy
 * invariants and cannot execute the map against real Google Maps/fixture
 * data the way a rendered-DOM test would.
 * ------------------------------------------------------------------------- */

test('page identity: title "Neighborhood Map", unchanged supporting copy, nav label stays "Map"', async () => {
  const page = await source('src/app/(app)/map/page.js');
  const constants = await source('src/lib/constants.js');
  assert.match(page, /title="Neighborhood Map" subtitle="See your homes and the places that matter to this search\."/);
  assert.match(constants, /\{ key: 'map', label: 'Map', href: '\/map' \}/);
});

test('desktop composition: the map stage takes the wide primary share, the rail is the narrow supporting column', async () => {
  const css = await source('src/app/globals.css');
  assert.match(css, /\.hh-map-layout \{ display: grid; grid-template-columns: minmax\(0, 3fr\) minmax\(230px, 1fr\)/);
});

test('home marker treatment is unchanged: terracotta fill, selected halo/ring + elevated size, not color-only', async () => {
  const css = await source('src/app/globals.css');
  assert.match(css, /\.hh-map-marker \{ width: 34px; height: 34px;[^}]*background: var\(--brick\)/);
  assert.match(css, /\.hh-map-marker\.selected \{ width: 40px; height: 40px;[^}]*box-shadow: 0 0 0 3px var\(--brick\)/);
});

test('Mapped homes rail: unchanged heading, a truthful mapped-only count badge, vocabulary-aware (never a hard-coded "8 Homes")', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /<h2 className="hh-serif">Mapped homes<\/h2>/);
  assert.match(map, /\{eligible\.length > 0 && <span className="hh-map-rail-count">\{eligible\.length\} \{eligible\.length === 1 \? vocabulary\.singular : vocabulary\.plural\}<\/span>\}/);
  assert.doesNotMatch(map, /8 Homes/);
});

test('bidirectional selection: marker click and rail row/place card click share one selection state; panning is skipped when the target is already visible', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /marker\.addListener\('click', \(\) => setSelection\(\{ type: 'home', id: home\.id \}\)\)/);
  assert.match(map, /marker\.addListener\('click', \(\) => setSelection\(\{ type: 'destination', id: destination\.id \}\)\)/);
  assert.match(map, /onClick=\{\(\) => setSelection\(\{ type: 'home', id: home\.id \}\)\}/);
  assert.match(map, /onClick=\{\(\) => setSelection\(\{ type: 'destination', id: destination\.id \}\)\}/);
  // The guard: only pan when the selected marker isn't already in the
  // current viewport bounds -- not an aggressive re-center on every click.
  assert.match(map, /if \(!bounds \|\| !bounds\.contains\(selectedItem\.mapPosition\)\) mapRef\.current\.panTo\(selectedItem\.mapPosition\);/);
});

test('selected-home preview stays compact: unchanged truthful fields, no full Match snapshot, no property-intelligence blocks, no Realtor commentary', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /selected\.photoUrl \? <img src=\{selected\.photoUrl\} alt="" \/> : <div className="hh-map-preview-photo-fallback">/);
  assert.match(map, /formatHomePrice\(selected\.price, priorities\.searchType\)/);
  assert.match(map, /selected\.beds && `\$\{selected\.beds\} beds`/);
  assert.doesNotMatch(map, /Garage|Basement|Schools|realtorContributions|realtor/i);
  assert.doesNotMatch(map, /\bpros\b|\bcons\b/i);
});

test('Match remains participant-specific: the same trust guard as before, never averaged/combined/household', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /const matchTrustworthy = !match\?\.allSelected\?\.some\(\(c\) => c\.key === 'location:Commute'\);/);
  assert.match(map, /\{matchTrustworthy && match\?\.pct !== null && match\?\.pct !== undefined && <span className="hh-map-match">\{match\.pct\}% Match<\/span>\}/);
  assert.doesNotMatch(map, /couple match|combined match|household match|average.*match/i);
});

test('View home links to the canonical Home Detail route -- no duplicate detail experience inside Map', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /<Link href=\{`\/homes\/\$\{encodeURIComponent\(selected\.id\)\}`\}>View \{vocabulary\.singularLower\}<\/Link>/);
});

test('Directions reuses the existing canonical address/coordinates -- no new geocoding path introduced for it', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /href=\{`https:\/\/maps\.apple\.com\/\?daddr=\$\{encodeURIComponent\(selected\.address\)\}`\} target="_blank" rel="noreferrer">Directions<\/a>/);
});

test('Recenter is a map-workspace control, not device geolocation: it fits already-loaded mapped content, never calls navigator.geolocation', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /const recenter = \(\) => \{/);
  assert.match(map, /Recenter/);
  assert.doesNotMatch(map, /navigator\.geolocation/);
  // Reuses the same fit/center pattern as the initial load, not a new one.
  assert.match(map, /map\.fitBounds\(bounds, 56\)/);
  assert.match(map, /map\.setCenter\(points\[0\]\); map\.setZoom\(14\);/);
});

test('Places That Matter band: exact mandated heading and supporting copy, no coordinate/database-oriented language', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /<h2 className="hh-serif">Places That Matter to This Search<\/h2>/);
  assert.match(map, /<p>See commute times from your homes to the places that matter to you\.<\/p>/);
  assert.doesNotMatch(map, /key coordinates/i);
  assert.doesNotMatch(map, /\bcoordinates\b/i);
});

test('no invented/stale commute values: place cards show the truthful existing max-drive-minutes threshold, never a fabricated calculated duration', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /destination\.maxDriveMinutes != null \? `\$\{destination\.maxDriveMinutes\} min max` : 'Informational only'/);
});

test('collaborator places data path reuses resolveCollaboratorSearchContext -- the same authorized relationship #86 already established, not a second identity path', async () => {
  const page = await source('src/app/(app)/map/page.js');
  assert.match(page, /import \{ createClient \} from '@\/lib\/supabase\/server'/);
  assert.match(page, /resolveCollaboratorSearchContext/);
  // Exactly one auth resolution per request: requireUser, no independent getUser().
  const getUserCalls = (page.match(/\.auth\.getUser\(\)/g) || []).length;
  assert.equal(getUserCalls, 0, 'map/page.js must not call getUser() directly -- only through requireUser()');
  assert.match(page, /const user = await requireUser\(supabase\);/);
  assert.match(page, /return withAuthRecovery\(async \(\) => \{/);
});

test('collaborator places are read-only on Map: no patch/mutation path, no inline edit/remove controls, ever', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.doesNotMatch(map, /deleteCommuteDestination|updateCommuteDestination|createCommuteDestination/);
  assert.doesNotMatch(map, /<input/);
});

test('own places stay owned by the current user: the editable Places path is still searchId+userId scoped in CommuteDestinations, untouched by Map', async () => {
  const destinations = await source('src/components/CommuteDestinations.jsx');
  assert.match(destinations, /createCommuteDestination\(supabase, searchId, userId, values\)/);
  const map = await source('src/app/(app)/map/page.js');
  assert.match(map, /getCommuteDestinations\(supabase, search\.id, user\.id\)/);
});

test('Edit places routes to the canonical My Search editor -- Map never hosts a second Places editor', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /<Link className="hh-btn hh-btn-ghost hh-map-edit-places" href="\/search">Edit places<\/Link>/);
});

test('safe collaborator attribution: the real display name from #86\'s mechanism, never a raw email, never generic "collaborator" database language', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /collaboratorName/);
  assert.doesNotMatch(map, /@gmail|@yahoo|@hotmail|auth\.users/i);
  assert.doesNotMatch(map, /participant state|collaborator record/i);
});

test('Realtor is not treated as a co-buyer here: no Realtor-privileged function, no Realtor Places/Match added to Map', async () => {
  const page = await source('src/app/(app)/map/page.js');
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.doesNotMatch(`${page}\n${map}`, /get_realtor_client_roster|is_search_realtor|getRealtorSearchContext|getRealtorRelationships/);
});

test('unmappable homes are excluded, never placed at a fabricated fallback location, and stay reachable elsewhere in FLH', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  const commute = await source('src/lib/commute.js');
  assert.match(map, /const unresolved = useMemo\(\(\) => homes\.filter\(\(home\) => !home\.mapPosition\), \[homes\]\);/);
  assert.match(map, /couldn't be placed on the map yet/);
  assert.match(map, /<Link key=\{home\.id\} href=\{`\/homes\/\$\{encodeURIComponent\(home\.id\)\}`\}>\{home\.address \|\| 'Address not added'\}/);
  // currentHomeCoordinates only ever returns a real, provenance-matched
  // coordinate or null -- never a search/city/ZIP-centroid fallback.
  assert.match(commute, /if \(!coordinatesAreCurrent\(record, fingerprint\)\) return null;/);
});

test('empty states stay truthful: no homes/places, homes with none mappable, and solo search are all handled without demo data', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /if \(!homes\.length && !places\.length\) return <div className="hh-map-empty">/);
  assert.match(map, /Nothing to show yet — add a place from My Search/);
  assert.match(map, /!eligible\.length && <p className="hh-map-rail-empty">/);
});

test('solo search: no collaboration attribution noise when there is no collaborator place to attribute', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /const isCollaborativeMap = eligibleDestinations\.some\(\(destination\) => destination\.owner === 'collaborator'\);/);
  assert.match(map, /\{isCollaborativeMap && `\$\{attribution\} · `\}/);
});

test('mobile: Mapped homes stays visible as the accessible non-marker alternative and page sections follow the bounded map', async () => {
  const css = await source('src/app/globals.css');
  const block = css.match(/@media \(max-width: 700px\) \{\s*\n\s*\.hh-map-page-intro[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(block, 'expected the map mobile breakpoint block');
  assert.doesNotMatch(block, /\.hh-map-layout > section \{ display: none; \}/);
  assert.match(block, /\.hh-map-frame \.hh-map-layout > section \{ flex-shrink: 0; max-height: 190px; overflow-y: auto; \}/);
  assert.match(block, /\.hh-map-frame \.hh-map-places-band \{ flex-shrink: 0; margin-top: 18px;/);
  // The route frame remains a full-width flex column; its map stage has a
  // deliberate bounded height, pinned by map-mysearch-mobile-pass.test.js.
  assert.match(block, /\.hh-map-frame \{ display: flex; flex-direction: column; \}/);
});

test('mobile: no horizontal desktop rail forced onto a phone -- place cards become a horizontally-scrollable row, not a fixed grid', async () => {
  const css = await source('src/app/globals.css');
  const block = css.match(/@media \(max-width: 700px\) \{\s*\n\s*\.hh-map-page-intro[\s\S]*?\n\}/)?.[0] || '';
  assert.match(block, /\.hh-map-places-cards \{ flex-wrap: nowrap; overflow-x: auto;/);
});

test('accessibility: Mapped Homes rows and Place cards are real buttons (keyboard/focus-accessible), not marker-only selection', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.match(map, /<button key=\{home\.id\} type="button" className=\{selection\?\.type === 'home' && home\.id === selection\.id \? 'selected' : ''\} onClick=\{\(\) => setSelection\(\{ type: 'home', id: home\.id \}\)\}>/);
  assert.match(map, /className=\{`hh-map-place-card \$\{destination\.owner === 'collaborator' \? 'is-collaborator' : ''\} \$\{selection\?\.type === 'destination'/);
  assert.match(map, /aria-label="Map of your saved homes and places that matter"/);
});

test('accessibility: selection state is never color-only -- markers change size/ring/shape, and rows/cards carry an explicit selected class', async () => {
  const css = await source('src/app/globals.css');
  assert.match(css, /\.hh-map-marker\.selected \{ width: 40px; height: 40px;/);
  assert.match(css, /\.hh-map-destination-marker\.selected \{ width: 34px; height: 34px;/);
  assert.match(css, /\.hh-map-place-card\.selected \{ border-color: var\(--moss\); box-shadow: inset 0 0 0 1px var\(--moss\);/);
});

test('performance: selection changes never trigger a new commute/geocoding request -- Recenter and selection only reuse coordinates already loaded', async () => {
  const map = await source('src/components/SavedHomesMap.jsx');
  assert.doesNotMatch(map, /fetch\(['"`]\/api\/commute/);
  assert.doesNotMatch(map, /geocode/i);
});

test('migration: coordinate fields are added to the existing authorized projection only -- same auth guard, same participant, no RLS change, no Realtor reuse', async () => {
  const migration = await source('supabase/migrations/2026-09-16-map-collaborator-places.sql');
  assert.match(migration, /create or replace function public\.resolve_collaborator_search_context\(p_search_id uuid\)/);
  assert.match(migration, /if not coalesce\(public\.can_access_search\(p_search_id, v_caller\), false\) then/);
  assert.match(migration, /where participant\.user_id <> v_caller/);
  assert.match(migration, /'latitude', d\.latitude, 'longitude', d\.longitude,/);
  assert.match(migration, /'coordinateAddressFingerprint', d\.coordinate_address_fingerprint, 'coordinateStatus', d\.coordinate_status/);
  assert.doesNotMatch(migration, /\bpolicy\b/i);
  assert.doesNotMatch(migration, /grant (all|execute|select).*to (service_role|anon)/i);
  assert.match(migration, /grant execute on function public\.resolve_collaborator_search_context\(uuid\) to authenticated;/);
  const body = migration.slice(migration.indexOf('as $$'));
  assert.doesNotMatch(body, /get_realtor_client_roster|is_search_realtor/);
});

test('cross-search isolation: every clause of the extended projection is still scoped to this search and this one resolved collaborator', async () => {
  const migration = await source('supabase/migrations/2026-09-16-map-collaborator-places.sql');
  assert.match(migration, /smp\.search_id = p_search_id and smp\.user_id = v_collaborator/);
  assert.match(migration, /d\.search_id = p_search_id and d\.user_id = v_collaborator/);
  assert.match(migration, /h\.search_id = p_search_id and hms\.user_id = v_collaborator/);
  assert.match(migration, /where u\.id = v_collaborator/);
});

test('auth-recovery architecture is unchanged by this pass: map/page.js still resolves its user through requireUser/withAuthRecovery, not a bespoke guard', async () => {
  const page = await source('src/app/(app)/map/page.js');
  assert.match(page, /import \{ requireUser, withAuthRecovery \} from '@\/lib\/supabase\/auth'/);
});
