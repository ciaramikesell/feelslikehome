import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePriorities, getItemlistCategories, MOBILE_PRIMARY_TABS } from '../src/lib/constants.js';
import { computeMatch, selectPriorityItem, mustHaveStatus, hasNoMustHaveMisses, matchFactualSummary, selectHomeCardCriteria, criterionLabel } from '../src/lib/matching.js';
import { evaluateCommute } from '../src/lib/commute.js';
import {
  EMPTY_FILTERS, SORT_OPTIONS, MATCH_THRESHOLDS, activeFilterLabels, activeFilterCount, applyContenderFilters,
  contenderCountLabel, showMatchingLabel, singleFilterCounts, sortContenders, sortLabel,
} from '../src/lib/homesCollection.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const homesVocabulary = { singularLower: 'home', pluralLower: 'homes', plural: 'Homes' };

function select(priorities, categoryKey, label, tier, kind = 'check') {
  const def = getItemlistCategories(priorities.searchType).find((category) => category.key === categoryKey);
  return { ...priorities, [categoryKey]: selectPriorityItem(priorities[categoryKey], def, { label, kind }, tier) };
}

// Purchase search: two Must Haves, one Important, budget Important.
let buyer = normalizePriorities({ searchType: 'purchase', budget: { value: '500000', tier: 'important' } });
buyer = select(buyer, 'features', 'Home office', 'must');
buyer = select(buyer, 'exterior', 'Fenced yard', 'must');
buyer = select(buyer, 'features', 'Central air', 'important');

const homes = [
  { id: 'all-met', createdAt: '2026-01-01', price: '450000', address: '1 Oak St, Troy, MI', status: 'Saved', isFavorite: true, checks: { 'features:Home office': true, 'exterior:Fenced yard': true, 'features:Central air': true } },
  { id: 'must-missed', createdAt: '2026-01-02', price: '480000', address: '2 Elm St, Troy, MI', status: 'Want to Tour', checks: { 'features:Home office': 'no', 'exterior:Fenced yard': true, 'features:Central air': true } },
  { id: 'must-unknown', createdAt: '2026-01-03', price: '520000', address: '3 Pine St, Novi, MI', status: 'Saved', checks: { 'exterior:Fenced yard': true } },
  { id: 'nothing-known', createdAt: '2026-01-04', price: '', address: '4 Ash St, Novi, MI', status: 'Saved', checks: {} },
  // Historical boolean false is Unknown, never a miss.
  { id: 'legacy-false', createdAt: '2026-01-05', price: '400000', address: '5 Birch St, Troy, MI', status: 'Saved', isFavorite: true, checks: { 'features:Home office': false, 'exterior:Fenced yard': true } },
];
const evaluate = (home) => computeMatch(home, buyer);
const ids = (list) => list.map((home) => home.id);

/* ------------------------------------ canonical Must Haves ------------------------------------ */

test('mustHaveStatus reads Must Haves straight from computeMatch: only a confirmed miss is missing', () => {
  assert.deepEqual(Object.fromEntries(homes.map((home) => {
    const { total, met, missed, neutral, unknown } = mustHaveStatus(evaluate(home));
    return [home.id, { total, met, missed, neutral, unknown }];
  })), {
    'all-met': { total: 2, met: 2, missed: 0, neutral: 0, unknown: 0 },
    'must-missed': { total: 2, met: 1, missed: 1, neutral: 0, unknown: 0 },
    'must-unknown': { total: 2, met: 1, missed: 0, neutral: 0, unknown: 1 },
    'nothing-known': { total: 2, met: 0, missed: 0, neutral: 0, unknown: 2 },
    'legacy-false': { total: 2, met: 1, missed: 0, neutral: 0, unknown: 1 },
  });
});

test('No Must-Haves missing agrees with Home Detail and the factual summary for every home', () => {
  const kept = new Set(ids(applyContenderFilters(homes, { noMustMissing: true }, evaluate)));
  assert.deepEqual([...kept], ['all-met', 'must-unknown', 'nothing-known', 'legacy-false']);
  for (const home of homes) {
    const match = evaluate(home);
    const status = mustHaveStatus(match);
    // The same answer from the filter, the Home Detail panel's counts, and the hero sentence.
    assert.equal(kept.has(home.id), status.missed === 0, home.id);
    assert.equal(hasNoMustHaveMisses(match), status.missed === 0, home.id);
    const clause = matchFactualSummary(match)?.mustClause || '';
    assert.equal(/missing/.test(clause), status.missed > 0, `${home.id}: ${clause}`);
  }
});

test('regression: a neutral tour response on a Must Have is not reported as missing anywhere', () => {
  // Before this pass, the filter (mustMet === mustEvaluated) and the Home Detail
  // hero sentence (mustEvaluated - mustMet) both counted a neutral response as a
  // miss, while the card showed it as neutral ("—"). computeMatch defines neutral
  // as evaluated but neither a pass nor a failure.
  let renter = normalizePriorities({ searchType: 'rental' });
  renter = select(renter, 'homeFeel', 'Natural Light', 'must', 'rating');
  const home = { id: 'neutral', ratings: { 'homeFeel:Natural Light': 'neutral' }, checks: {} };
  const match = computeMatch(home, renter);
  assert.equal(match.mustEvaluated, 1);
  assert.equal(match.mustMet, 0);
  assert.deepEqual(mustHaveStatus(match), { all: match.allSelected, total: 1, met: 0, missed: 0, neutral: 1, unknown: 0 });
  assert.ok(hasNoMustHaveMisses(match));
  assert.equal(applyContenderFilters([home], { noMustMissing: true }, (h) => computeMatch(h, renter)).length, 1);
  assert.doesNotMatch(matchFactualSummary({ ...match, pct: 50 }).mustClause, /missing/);
});

test('personalized criteria keep evaluated = match + don’t match, with unknown and neutral as their own groups', () => {
  for (const home of homes) {
    const { criteriaSummary: s } = selectHomeCardCriteria(evaluate(home));
    assert.equal(s.evaluated, s.matches.length + s.mismatches.length);
    assert.equal(s.total, s.evaluated + s.unknown.length + s.neutral.length);
  }
  const { criteriaSummary } = selectHomeCardCriteria(evaluate(homes.find((home) => home.id === 'nothing-known')));
  // Unknown is never a mismatch.
  assert.deepEqual([criteriaSummary.matches.length, criteriaSummary.mismatches.length, criteriaSummary.unknown.length], [0, 0, 2]);
});

/* ------------------------------------ filters and sorting ------------------------------------ */

test('filters combine, count correctly, and clearing restores the whole collection', () => {
  assert.deepEqual(ids(applyContenderFilters(homes, { favorites: true }, evaluate)), ['all-met', 'legacy-false']);
  assert.deepEqual(ids(applyContenderFilters(homes, { wantToTour: true }, evaluate)), ['must-missed']);
  assert.deepEqual(ids(applyContenderFilters(homes, { favorites: true, noMustMissing: true }, evaluate)), ['all-met', 'legacy-false']);
  // Match is computed from known criteria only: an unknown Must Have neither lowers
  // nor raises it (must-unknown's known criteria nearly all match).
  assert.deepEqual(ids(applyContenderFilters(homes, { minMatch: 90 }, evaluate)), ['all-met', 'must-unknown', 'legacy-false']);
  // A home with no computable Match never passes a threshold.
  assert.ok(!ids(applyContenderFilters(homes, { minMatch: 90 }, evaluate)).includes('nothing-known'));
  assert.deepEqual(ids(applyContenderFilters(homes, EMPTY_FILTERS, evaluate)), ids(homes));
  assert.deepEqual(ids(applyContenderFilters(homes, EMPTY_FILTERS, evaluate, 'novi')), ['must-unknown', 'nothing-known']);
  assert.deepEqual(singleFilterCounts(homes, evaluate), { all: 5, match90: 3, noMustMissing: 4, wantToTour: 1, favorites: 2 });
});

test('the active-filter summary and apply button are derived from the actual filter state and count', () => {
  assert.deepEqual(activeFilterLabels(EMPTY_FILTERS), []);
  assert.deepEqual(activeFilterLabels({ minMatch: 90, noMustMissing: true }), ['90%+ Match', 'No Must-Haves missing']);
  assert.equal(activeFilterCount({ favorites: true, wantToTour: true }), 2);
  const count = applyContenderFilters(homes, { noMustMissing: true }, evaluate).length;
  assert.equal(showMatchingLabel(count, homesVocabulary), 'Show 4 matching homes');
  assert.equal(showMatchingLabel(1, homesVocabulary), 'Show 1 matching home');
  assert.equal(showMatchingLabel(0, homesVocabulary), 'No homes match these filters');
  assert.equal(contenderCountLabel(12, homesVocabulary), '12 homes you’re considering');
  assert.equal(contenderCountLabel(1, homesVocabulary), '1 home you’re considering');
});

test('only the existing sort modes and Match threshold are offered', () => {
  assert.deepEqual(SORT_OPTIONS.map(({ key }) => key), ['matchDesc', 'newest', 'oldest', 'priceAsc', 'priceDesc', 'matchAsc']);
  assert.equal(sortLabel('matchDesc', { short: true }), 'Best match');
  assert.deepEqual([...MATCH_THRESHOLDS], [90]);
  const byMatch = ids(sortContenders(homes, 'matchDesc', evaluate));
  assert.equal(byMatch.at(-1), 'nothing-known'); // unknown Match sorts last, never as 0%
  assert.deepEqual(ids(sortContenders(homes, 'newest', evaluate)), ['legacy-false', 'nothing-known', 'must-unknown', 'must-missed', 'all-met']);
  assert.deepEqual(ids(sortContenders(homes, 'priceAsc', evaluate)), ['legacy-false', 'all-met', 'must-missed', 'must-unknown', 'nothing-known']);
});

test('My Homes filters, sorts, and counts with the same Match the cards render (including Commute)', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /evaluateCommute\(initialCommuteDestinations, \(destination\) => readCommuteResult\(home, destination\)\)/);
  assert.match(board, /cache\.set\(home, computeMatch\(home, priorities, commuteEvaluation\)\)/);
  assert.match(board, /sortContenders\(applyContenderFilters\(baseList, filters, evaluate, query\), sortBy, evaluate\)/);
  assert.match(board, /singleFilterCounts\(activeHomes, evaluate\)/);
  // The former commute-less pathway is gone.
  assert.doesNotMatch(board, /computeMatch\(h, priorities\)/);
  const observer = read('src/lib/useCommuteObserver.js');
  assert.match(observer, /export function readCommuteResult\(home, destination\)/);
  // A route nobody has requested reads as Unknown, exactly as the card's own state.
  const commuteSearch = { maxDriveMinutes: 30 };
  assert.deepEqual(evaluateCommute([commuteSearch], () => ({ status: 'idle' })), { evaluated: false, met: null, detail: 'Commute time not available yet' });
});

/* ------------------------------------ My Homes presentation ------------------------------------ */

test('My Homes header counts the actual active homes and keeps the Add action', () => {
  const page = read('src/app/(app)/homes/page.js');
  assert.match(page, /const activeCount = homes\.filter\(\(home\) => !isArchivedStatus\(home\.status\)\)\.length;/);
  assert.match(page, /contenderCountLabel\(activeCount, homeVocabulary\(normalizedPriorities\)\)/);
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /aria-label=\{`Add \$\{vocabulary\.singularLower\}`\}/);
  assert.match(board, /placeholder="Search address or neighborhood"/);
  assert.match(board, /<Link href="\/map" className="flh-control-pill">/);
});

test('compact contender cards use real home data and the canonical Match, and keep existing states', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /mode === 'homes' \? 'is-contender' : ''/);
  // The shared MatchBadge renders only a computable percentage — Unknown is never a number.
  assert.match(board, /\{mode === 'homes' && match\?\.pct != null && <MatchBadge pct=\{match\.pct\} className="hh-contender-match" \/>\}/);
  const system = read('src/components/MobileSystem.jsx');
  assert.match(system, /export function MatchBadge\(\{ pct, size = 'sm', className = '' \}\) \{\n  if \(pct === null \|\| pct === undefined\) return null;/);
  assert.match(board, /const must = mustHaveStatus\(match\);/);
  assert.match(board, /must\.missed > 0 && \{ key: 'must-missed'/);
  assert.match(board, /must\.missed === 0 && must\.unknown > 0 && \{ key: 'must-unknown'/);
  for (const state of ["label: 'Want to tour'", "label: 'Toured'", 'label: coBuyerActivity', 'label: `Suggested by ${home.suggestedBy}`', "label: 'Match not known yet'"]) {
    assert.ok(board.includes(state), state);
  }
  // Favorite stays a one-tap control; click-through to Home Detail is unchanged.
  assert.match(board, /className="hh-card-favorite hh-tooltip" onClick=\{handleFavorite\}/);
  assert.match(board, /href=\{`\/homes\/\$\{encodeURIComponent\(home\.id\)\}`\} className="hh-home-identity-link"/);
});

test('multiple Places That Matter are never collapsed to one', () => {
  const board = read('src/components/HomesBoard.jsx');
  const detail = read('src/components/HomeDetail.jsx');
  const location = read('src/components/HomeDetailLocation.jsx');
  assert.doesNotMatch(board, /commuteDestinations\.slice\(0, 1\)/);
  assert.match(detail, /commuteDestinations\.map\(\(destination\) => destination\.label\)\.join\(' · '\)/);
  assert.match(location, /\{destinations\.map\(\(destination\) => \{/);
  // A pending/failed route keeps its row with an honest status.
  assert.match(location, /state\.status === 'loading' \|\| state\.status === 'idle' \? 'Calculating…' : 'Not available yet'/);
});

/* ------------------------------------ Home Detail ------------------------------------ */

test('Home Detail’s compact Match panel reads only the canonical match and keeps Unknown distinct', () => {
  const panel = read('src/components/DetailMatchPanel.jsx');
  assert.match(panel, /const must = mustHaveStatus\(match\);/);
  assert.match(panel, /const \{ criteriaSummary \} = selectHomeCardCriteria\(match\);/);
  assert.match(panel, /\{summary\.evaluated\}\/\{summary\.total\} evaluated/);
  assert.match(panel, /still unknown/);
  assert.match(panel, /Not enough information yet/);
  assert.match(panel, /Unknown details never count against a home\./);
  assert.doesNotMatch(panel, /computeMatch\(|pct\s*=[^=]/);
  // Partial data: nothing known yields no percentage and every criterion Unknown.
  const match = evaluate(homes.find((home) => home.id === 'nothing-known'));
  assert.equal(match.pct, null);
  assert.equal(mustHaveStatus(match).unknown, 2);
});

test('Home Detail keeps its real actions, gated exactly as before, with a phone action bar above the nav', () => {
  const detail = read('src/components/HomeDetail.jsx');
  const css = read('src/app/globals.css');
  assert.match(detail, /savePersonal\(\{ status: home\.status === 'Want to Tour' \? 'Saved' : 'Want to Tour' \}\)/);
  assert.match(detail, /savePersonal\(toggleFavorite\(home\)\)/);
  assert.match(detail, /setArchiveTarget\(home\)/);
  assert.match(detail, /Original listing/);
  assert.match(detail, /home\.suggestedBy && <span className="hh-provenance">Suggested by \{home\.suggestedBy\}<\/span>/);
  assert.match(css, /\.flh-detail-action-bar \{[^}]*bottom: calc\(62px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.hh-home-detail \{ position: relative; padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\); \}/);
  // Nothing invented: no neighborhood/amenity claims were added.
  assert.doesNotMatch(detail, /Neighborhood snapshot|walkab|parks nearby/i);
});

test('Match stays participant-specific: pages evaluate the signed-in participant’s own priorities', () => {
  for (const path of ['src/app/(app)/homes/page.js', 'src/app/(app)/homes/[homeId]/page.js']) {
    assert.match(read(path), /resolvePriorities\(supabase, search, user\.id\)/);
  }
  // The co-buyer's Match stays a separate, server-resolved perspective.
  assert.match(read('src/components/HomeDetail.jsx'), /coBuyerPerspective\.match\.pct/);
});

/* ------------------------------------ navigation & desktop ------------------------------------ */

test('mobile navigation is unchanged and desktop keeps its toolbar, chips, and full cards', () => {
  assert.deepEqual(MOBILE_PRIMARY_TABS.map(({ key }) => key), ['homes', 'tour', 'compare', 'map', 'search']);
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /className="hh-homes-toolbar"/);
  assert.match(board, /<option value="matchDesc">Match score — highest<\/option>/);
  assert.match(board, /\{ key: 'noMustMissing', label: 'No Must-Haves Missing' \}/);
  assert.match(board, /className=\{`hh-match-panel/);
  assert.match(board, /className="hh-home-card-actions"/);
  const css = read('src/app/globals.css');
  assert.match(css, /\.flh-mobile-only, \.flh-homes-controls, \.hh-homes-count, \.hh-contender-match, \.hh-contender-meta, \.flh-active-filters \{ display: none; \}/);
});

/* ------------------------- Must Have presentation consistency ------------------------- */


// Must Haves from every kind of source: a Location criterion, the buyer's own
// custom priority, a Basics constraint (budget), plus Exterior and Features.
let mixed = normalizePriorities({ searchType: 'purchase', budget: { value: '400000', tier: 'must' } });
mixed = select(mixed, 'location', 'Reputable Schools', 'must');
mixed = { ...mixed, features: selectPriorityItem(mixed.features, { coreItems: [], suggestedItems: [] }, { label: 'Mudroom', kind: 'check', source: 'custom' }, 'must') };
mixed = select(mixed, 'exterior', 'Fenced yard', 'must');
mixed = select(mixed, 'features', 'Home office', 'must');
mixed = select(mixed, 'features', 'Central air', 'important');

const mixedHomes = [
  // Location miss, custom unknown, budget met.
  { id: 'loc-miss', price: '350000', checks: { 'location:Reputable Schools': 'no', 'exterior:Fenced yard': true, 'features:Home office': true } },
  // Custom Must Have missed; Location unknown.
  { id: 'custom-miss', price: '390000', checks: { 'features:Mudroom': 'no', 'exterior:Fenced yard': true } },
  // Budget (a Basics Must Have) missed; everything else unknown.
  { id: 'budget-miss', price: '480000', checks: {} },
  // No confirmed misses; several unknown.
  { id: 'no-miss', price: '399000', checks: { 'location:Reputable Schools': true, 'features:Home office': true } },
];
const evaluateMixed = (home) => computeMatch(home, mixed);
const stateOf = (criterion) => (!criterion.evaluated ? 'unknown' : criterion.met === null ? 'neutral' : criterion.met ? 'met' : 'missing');

test('desktop card preview includes Location, custom, and Basics Must Haves — not only Features/Exterior', () => {
  const preview = selectHomeCardCriteria(evaluateMixed(mixedHomes[0]));
  const shown = [...preview.mustHaves, ...preview.hiddenMustHaves];
  assert.deepEqual(new Set(shown.map((criterion) => criterion.key)), new Set(['budget', 'location:Reputable Schools', 'features:Mudroom', 'exterior:Fenced yard', 'features:Home office']));
  // Bounded preview with explicit overflow, never a dropped category: all 5 fit.
  assert.equal(preview.mustHaves.length, 5);
  assert.equal(preview.mustOverflow, 0);
  // The failed Location Must Have leads the preview.
  assert.equal(preview.mustHaves[0].key, 'location:Reputable Schools');
  assert.deepEqual(shown.map(criterionLabel).sort(), ['Fenced Yard', 'Home Office', 'Mudroom', 'Reputable Schools', 'Within budget']);
});

test('card preview, Home Detail, and the No Must-Haves missing filter agree on every Must Have’s state', () => {
  const kept = new Set(applyContenderFilters(mixedHomes, { noMustMissing: true }, evaluateMixed).map((home) => home.id));
  assert.deepEqual([...kept], ['no-miss']);
  for (const home of mixedHomes) {
    const match = evaluateMixed(home);
    const detail = mustHaveStatus(match); // Home Detail panel + phone card cue
    const card = selectHomeCardCriteria(match); // desktop card preview
    const cardStates = Object.fromEntries([...card.mustHaves, ...card.hiddenMustHaves].map((criterion) => [criterion.key, stateOf(criterion)]));
    const detailStates = Object.fromEntries(detail.all.map((criterion) => [criterion.key, stateOf(criterion)]));
    assert.deepEqual(cardStates, detailStates, home.id);
    const cardShowsMiss = Object.values(cardStates).includes('missing');
    assert.equal(kept.has(home.id), !cardShowsMiss, home.id);
    assert.equal(cardShowsMiss, detail.missed > 0, home.id);
  }
  // Unknown stays distinct from a miss on every surface.
  const unknownHome = mixedHomes.find((home) => home.id === 'no-miss');
  const states = selectHomeCardCriteria(evaluateMixed(unknownHome)).mustHaves.map(stateOf);
  assert.ok(states.includes('unknown'));
  assert.ok(!states.includes('missing'));
});

test('the desktop card renders every previewed Must Have with the shared label and an explicit overflow', () => {
  const board = read('src/components/HomesBoard.jsx');
  assert.match(board, /\{!item\.evaluated \? '\?' : neutral \? '—' : item\.met \? '✓' : '✕'\} \{criterionLabel\(item\)\}/);
  assert.match(board, /`\+ \$\{mustOverflow\} more Must Have\$\{mustOverflow === 1 \? '' : 's'\}`/);
  const matching = read('src/lib/matching.js');
  assert.match(matching, /const isVisibleMustHave = \(criterion\) => criterion\.tier === 'must';/);
  assert.doesNotMatch(matching, /category === 'features' \|\| category === 'exterior'/);
});
