import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { normalizePriorities, emptyHome } from '../src/lib/constants.js';
import { computeMatch, mustHaveStatus, weightedPrioritySummary } from '../src/lib/matching.js';
import { applyPostTourVerdict, hasOutstandingWantToTour, hasToured, toggleFavorite } from '../src/lib/lifecycle.js';
import { POST_TOUR_EVALUATIONS, postTourEvaluationLabel, postTourSummary, reactionLabel } from '../src/lib/postTour.js';
import { compareGlance, mustGlanceText, uniqueBest } from '../src/lib/compare.js';
import { driveTimeCell, evaluateCommute } from '../src/lib/commute.js';
import { currentUserWantsToTour } from '../src/lib/homesCollection.js';

register('./support/alias-hooks.mjs', import.meta.url);
const { saveHomePersonalAndShared, saveHomePersonalState, getHomesForUser } = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const priorities = normalizePriorities({
  searchType: 'purchase',
  features: { customItems: [{ label: 'Home office', kind: 'check' }, { label: 'Fireplace', kind: 'check' }], tiers: { 'Home office': 'must', Fireplace: 'important' } },
  exterior: { customItems: [{ label: 'Fenced yard', kind: 'check' }], tiers: { 'Fenced yard': 'must' } },
});

/* ----------------------------- canonical post-tour model ----------------------------- */

test('postTourSummary reads the participant’s own reaction and Big 4 impressions, ignoring anything else', () => {
  const home = { status: 'Want to Tour', touredAt: '2026-09-20', reaction: 'considering', ratings: { 'tour-v2:curb_appeal': 'positive', 'tour-v2:layout': 'neutral', 'tour-v2:privacy': 'negative', 'tour-v2:neighborhood': 'bogus', 'homeFeel:Natural Light': 4 } };
  const take = postTourSummary(home);
  assert.equal(take.verdictLabel, 'Still considering');
  assert.deepEqual([take.liked, take.neutral, take.disliked].map((group) => group.map((item) => item.label)), [['Curb Appeal'], ['Layout'], ['Privacy']]);
  assert.equal(take.impressions.length, 3);
  assert.equal(take.needsTake, false);
  assert.deepEqual(POST_TOUR_EVALUATIONS.map((item) => item.label), ['Curb Appeal', 'Layout', 'Privacy', 'Neighborhood']);
  assert.deepEqual(['love', 'considering', 'not_for_me', 'weird'].map(reactionLabel), ['Love it', 'Still considering', 'Rule this one out', null]);
  // A toured home without a saved reaction is flagged, never guessed.
  assert.equal(postTourSummary({ status: 'Toured', ratings: {} }).needsTake, true);
  assert.equal(postTourEvaluationLabel('tour-v2:layout'), 'Layout');
});

test('post-tour answers never change Match, Must Haves, or the weighted aggregate', () => {
  const base = { ...emptyHome(), checks: { 'features:Home office': true, 'exterior:Fenced yard': 'no' } };
  const toured = applyPostTourVerdict(base, 'love', { ratings: { 'tour-v2:curb_appeal': 'negative', 'tour-v2:layout': 'positive' }, noteEntry: 'Great light' }, 'now');
  const before = computeMatch(base, priorities);
  const after = computeMatch(toured, priorities);
  assert.deepEqual(after, before);
  assert.deepEqual(mustHaveStatus(after), mustHaveStatus(before));
  assert.deepEqual(weightedPrioritySummary(after).evaluated, weightedPrioritySummary(before).evaluated);
  // Checks (property answers) are untouched by a tour take.
  assert.deepEqual(toured.checks, base.checks);
});

/* ------------------------------ Tour lists ------------------------------ */

test('a toured home leaves "Want to tour" but stays on the Tour page’s Toured list', () => {
  const toured = applyPostTourVerdict({ ...emptyHome(), status: 'Want to Tour' }, 'love', {}, 'now');
  assert.equal(toured.status, 'Want to Tour'); // status is never rewritten by a take
  assert.equal(hasOutstandingWantToTour(toured), false);
  assert.equal(currentUserWantsToTour(toured), false);
  assert.equal(hasToured(toured), true);
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /const touredHomes = useMemo\(\s*\(\) => activeHomes\.filter\(hasToured\)/);
  assert.match(board, /mode === 'tour' \? \(tourView === 'toured' \? touredHomes : tourHomes\)/);
  // Canonical tour intent still drives the Want to tour list.
  assert.match(board, /currentUserWantsToTour\(h\) \|\| h\.coBuyerWantsToTour/);
  // No scheduling capability is implied.
  assert.doesNotMatch(board, /Plan tour|Schedule tour|Ready to schedule/i);
});

/* ------------------------------ state round trip ------------------------------ */

function fakeSupabase() {
  const tables = { homes: [], home_member_state: [], realtor_suggestions: [] };
  let nextId = 1;
  const keyOf = (table, row) => (table === 'home_member_state' ? `${row.home_id}|${row.user_id}` : row.id);
  function builder(table) {
    const state = { filters: [], upserted: null };
    const api = {
      upsert(row) {
        const stored = { ...row };
        if (table === 'homes' && !stored.id) stored.id = `home-${nextId++}`;
        const index = tables[table].findIndex((existing) => keyOf(table, existing) === keyOf(table, stored));
        if (index >= 0) tables[table][index] = { ...tables[table][index], ...stored };
        else tables[table].push(stored);
        state.upserted = tables[table].find((existing) => keyOf(table, existing) === keyOf(table, stored));
        return api;
      },
      select() { return api; },
      single() { return Promise.resolve({ data: structuredClone(state.upserted), error: null }); },
      eq(column, value) { state.filters.push((row) => (row[column] ?? false) === value); return api; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return api; },
      order() { return api; },
      then(resolve, reject) { return Promise.resolve({ data: structuredClone(state.upserted ? [] : tables[table].filter((row) => state.filters.every((f) => f(row)))), error: null }).then(resolve, reject); },
    };
    return api;
  }
  return { tables, from: builder };
}

test('Want to Tour → Post-Tour round-trips through the one participant-owned state every screen reads', async () => {
  const supabase = fakeSupabase();
  await saveHomePersonalAndShared(supabase, { ...emptyHome(), address: '1 Main St', listingUrl: 'https://example.com/1', checks: { 'features:Home office': true } }, 'buyer', 'search-1');
  let [home] = await getHomesForUser(supabase, 'buyer', 'search-1');
  const matchBefore = computeMatch(home, priorities);
  // A co-buyer's own state for the same home.
  supabase.tables.home_member_state.push({ home_id: home.id, user_id: 'cobuyer', status: 'Saved', is_favorite: true, reaction: 'not_for_me', ratings: { 'tour-v2:layout': 'negative' }, checks: {} });

  // My Homes / Home Detail: Want to Tour (same status write both use).
  await saveHomePersonalState(supabase, { ...home, status: 'Want to Tour' }, 'buyer', 'search-1');
  [home] = await getHomesForUser(supabase, 'buyer', 'search-1');
  assert.equal(currentUserWantsToTour(home), true); // Tour list, My Homes tag, Home Detail button

  // Tour → Post-Tour.
  await saveHomePersonalState(supabase, applyPostTourVerdict(home, 'love', { ratings: { 'tour-v2:privacy': 'positive' } }, '2026-09-28T12:00:00Z'), 'buyer', 'search-1');
  [home] = await getHomesForUser(supabase, 'buyer', 'search-1');
  assert.equal(hasToured(home), true);
  assert.equal(currentUserWantsToTour(home), false);
  assert.equal(postTourSummary(home).verdictLabel, 'Love it');
  assert.deepEqual(postTourSummary(home).liked.map((item) => item.label), ['Privacy']);
  // Match is unchanged, and the co-buyer's own take and favorite are untouched.
  assert.deepEqual(computeMatch(home, priorities), matchBefore);
  const cobuyer = supabase.tables.home_member_state.find((row) => row.user_id === 'cobuyer');
  assert.deepEqual([cobuyer.reaction, cobuyer.is_favorite, cobuyer.ratings], ['not_for_me', true, { 'tour-v2:layout': 'negative' }]);
  assert.equal(supabase.tables.homes.length, 1);

  // Map favorite uses the same personal-state path.
  await saveHomePersonalState(supabase, toggleFavorite(home), 'buyer', 'search-1');
  [home] = await getHomesForUser(supabase, 'buyer', 'search-1');
  assert.equal(home.isFavorite, true);
  assert.equal(supabase.tables.home_member_state.find((row) => row.user_id === 'cobuyer').is_favorite, true);
});

/* ------------------------------ Compare ------------------------------ */

test('Compare at-a-glance: Unknown never wins or loses, and a failed Must Have is never "best"', () => {
  const homes = [
    { id: 'a', price: '450000', checks: { 'features:Home office': true, 'exterior:Fenced yard': true } },
    { id: 'b', price: 'Contact agent', checks: { 'features:Home office': 'no', 'exterior:Fenced yard': true, 'features:Fireplace': true } },
    { id: 'c', price: '420000', checks: { 'exterior:Fenced yard': true } },
  ];
  const matches = homes.map((home) => computeMatch(home, priorities));
  const glance = compareGlance(homes, matches);
  assert.deepEqual(glance.prices, [450000, null, 420000]);
  assert.equal(glance.bestPrice, 2); // unknown price never "cheapest"
  assert.equal(mustGlanceText(glance.musts[1]), '1 of 2 · 1 missing');
  assert.equal(mustGlanceText(glance.musts[2]), '1 of 2 · 1 unknown');
  assert.equal(glance.bestMust, 0); // the home with a confirmed miss can't be best
  // Match values are exactly computeMatch's — Compare never recomputes them.
  assert.deepEqual(glance.pcts, matches.map((match) => match.pct));
  // Ties and single known values mark nothing.
  assert.equal(uniqueBest([5, 5, null], (a, b) => a > b), -1);
  assert.equal(uniqueBest([null, 7, null], (a, b) => a > b), -1);
});

test('Compare aligns criteria by canonical key, marks a miss distinctly from neutral, and attributes the collaborator', () => {
  const board = read('src/components/CompareBoard.jsx');
  assert.match(board, /if \(!byKey\.has\(c\.key\)\)/);
  assert.doesNotMatch(board, /byLabel/);
  assert.match(board, /c\.met \? '✓' : '✕'/);
  assert.match(board, /reactionLabel\(state\.reaction\)/);
  assert.match(board, /<CollaboratorState state=\{coBuyerPerspective\.state\} name=\{collaboratorName\} \/>/);
  assert.match(board, /postTourEvaluationLabel\(take\.key\)/);
  assert.match(read('src/app/(app)/compare/page.js'), /collaboratorName=\{collaboratorContext\?\.displayName \|\| null\}/);
  // Still exactly one Match calculator, the canonical commute-aware one.
  assert.doesNotMatch(board, /average|combined match|household/i);
  assert.match(read('src/lib/compare.js'), /import \{ mustHaveStatus, parseNum \} from '\.\/matching\.js';/);
});

function latestDefinition(name) {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const file = readdirSync(dir).filter((entry) => entry.endsWith('.sql')).sort()
    .filter((entry) => readFileSync(new URL(entry, dir), 'utf8').includes(`create or replace function public.${name}(`)).at(-1);
  const sql = readFileSync(new URL(file, dir), 'utf8');
  const start = sql.indexOf(`create or replace function public.${name}(`);
  return { file, body: sql.slice(start, sql.indexOf('$$;', start)) };
}

test('collaborator different takes include current post-tour impressions — opposites only, never neutral', () => {
  const { file, body } = latestDefinition('resolve_cobuyer_compare_perspectives');
  assert.equal(file, '2026-09-29-tour-v2-different-takes.sql');
  assert.match(body, /'tour-v2:curb_appeal','tour-v2:layout','tour-v2:privacy','tour-v2:neighborhood'/);
  assert.match(body, /\(r\.value #>> '\{\}'\) in \('positive','negative'\) and \(c\.value #>> '\{\}'\) in \('positive','negative'\)/);
  // The Search Basics change from the previous migration is preserved.
  for (const basic of ["'budget'", "'bedsMin'", "'homeLayout'"]) assert.ok(!body.includes(basic), basic);
  assert.match(read('supabase/migrations/2026-09-29-tour-v2-different-takes.sql'), /grant execute on function public\.resolve_cobuyer_compare_perspectives\(uuid, uuid\[\]\) to authenticated;/);
});

/* ------------------------------ Map ------------------------------ */

test('drive-time cells come only from real routes: pending and failed routes keep their row, limits are honest', () => {
  const work = { id: 'w', label: 'Work', maxDriveMinutes: 30 };
  const gym = { id: 'g', label: 'Gym', maxDriveMinutes: null };
  assert.deepEqual(driveTimeCell({ status: 'ok', minutes: 22 }, work), { text: '22 min', tone: 'positive', note: 'Within 30 min' });
  assert.deepEqual(driveTimeCell({ status: 'ok', minutes: 41 }, work), { text: '41 min', tone: 'negative', note: 'Over 30 min' });
  assert.deepEqual(driveTimeCell({ status: 'ok', minutes: 12 }, gym), { text: '12 min', tone: 'quiet', note: 'No limit set' });
  for (const pending of [undefined, { status: 'idle' }, { status: 'loading' }]) assert.equal(driveTimeCell(pending, work).text, 'Calculating…');
  assert.equal(driveTimeCell({ status: 'destination_ambiguous' }, work).text, 'Check address');
  assert.equal(driveTimeCell({ status: 'no_route' }, work).text, 'Not available');
  // A pending route leaves the Commute criterion Unknown (never a miss).
  assert.deepEqual(evaluateCommute([work, gym], () => ({ status: 'loading' })), { evaluated: false, met: null, detail: 'Commute time not available yet' });
});

test('Map renders every saved place and every mapped home, with one canonical Match, and links to the same home', () => {
  const map = read('src/components/SavedHomesMap.jsx');
  // Every own place is a row; every mapped home a column — never only the first.
  assert.match(map, /\{destinations\.map\(\(destination\) => \(\s*<tr key=\{destination\.id\}>/);
  assert.match(map, /\{eligible\.map\(\(home\) => \{ const cell = driveTime\(getCommuteResult\(home, destination\), destination\)/);
  assert.doesNotMatch(map, /destinations\[0\]|destinations\.slice\(0, 1\)/);
  // No traffic-aware claims, no discovery, no geolocation.
  // (The Figma's "Live traffic · leaving at 8:00 AM" is not claimed; routes are traffic-unaware.)
  assert.doesNotMatch(map, /Live traffic ·|leaving at \d|nearby listings|navigator\.geolocation/i);
  assert.match(map, /Typical driving time, no live traffic/);
  // Collaborator places are attributed and not routed.
  assert.match(map, /Drive times are only calculated for your own places/);
  // Favorite writes the participant's own state; Map → Home Detail keeps the home id.
  assert.match(map, /await saveHomePersonalState\(createClient\(\), next, userId, searchId\);/);
  assert.match(map, /<Link href=\{`\/homes\/\$\{encodeURIComponent\(selected\.id\)\}`\}>View \{vocabulary\.singularLower\}<\/Link>/);
  const page = read('src/app/(app)/map/page.js');
  assert.match(page, /userId=\{user\.id\}\s+searchId=\{search\.id\}/);
});

/* ------------------------------ Post-tour UI ------------------------------ */

test('post-tour capture is two steps, participant-owned, notes labeled truthfully, and has no decorative mic', () => {
  const modal = read('src/components/PostTourModal.jsx');
  assert.match(modal, /Step \{step\} of 2/);
  assert.match(modal, /Your quick recap/);
  assert.match(modal, /Your reaction and in-person evaluations belong to you/);
  assert.match(modal, /which everyone in this search can see/);
  assert.doesNotMatch(modal, /Mic|microphone button|SpeechRecognition/);
  assert.match(modal, /keyboard’s dictation/);
  // Every surface reads the same summary.
  for (const path of ['src/components/HomeDetail.jsx', 'src/components/HomesBoard.jsx', 'src/components/CompareBoard.jsx']) assert.match(read(path), /PostTourRecap/);
});
