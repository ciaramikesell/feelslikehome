// Bug fix: a buyer's own typed priority ("Desirable Street", a Location
// Must-Have) showed "— Unknown" in Home Details → Your Match with no Yes / No /
// Unknown control, so it could never be answered.
//
// Root cause: "Add your own" defaults to the first category, Location, whose
// defaultCustomKind was 'rating'. A rating-kind priority is answered only
// after a tour, and only for the catalog's tour criteria (TOUR_CRITERIA), so a
// typed Location priority fell between both: not 'check' (no Yes / No in
// Match), not a tour criterion (not in Tour Feedback). computeMatch read it
// from a 1–5 rating nothing could write — Unknown forever.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const {
  getItemlistCategories, isExperientialCriterion, isYesNoCriterion, normalizePriorities, TIER_META,
} = await import('../src/lib/constants.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');
const { addCustomCriterion, priorityLevels } = await import('../src/lib/searchProfile.js');
const {
  answerableCriteriaKeys, criterionAnswer, criterionAnswerPatch, inPersonCriteria, legacyCriterionRating,
} = await import('../src/lib/matchCriteria.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const KEY = 'location:Desirable Street';
const row = (match, key) => match.allSelected.find((item) => item.key === key);

// Exactly what production holds for the founder's search: a Location custom
// item stored as `rating` before this fix, as a Must-Have, plus a budget so
// there is always one evaluated criterion.
function existingSearch(kind = 'rating', extra = {}) {
  const priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities.preferredPropertyTypes = { values: [], tier: 'dontcare' };
  priorities.budget = { ...priorities.budget, value: '400000', tier: 'important' };
  priorities.location = {
    ...priorities.location,
    customItems: [...(priorities.location.customItems || []), { label: 'Desirable Street', kind, ...extra }],
    tiers: { ...priorities.location.tiers, 'Desirable Street': 'must' },
  };
  return normalizePriorities(priorities);
}
const home = (extra = {}) => ({ price: '350000', checks: {}, ratings: {}, ...extra });

test('reproduction: the stored Desirable Street (kind rating) was unanswerable; it is now a Yes / No row', () => {
  const priorities = existingSearch('rating');
  // The stored document still says rating — nothing is rewritten.
  assert.deepEqual(priorities.location.customItems.find((item) => item.label === 'Desirable Street'), { label: 'Desirable Street', kind: 'rating' });
  assert.equal(priorities.location.tiers['Desirable Street'], 'must');
  assert.equal(isExperientialCriterion('location', 'Desirable Street'), false, 'not an after-tour criterion');
  // Before: answerableCriteriaKeys skipped every non-check item, so the row was
  // read-only "Unknown". Now it is answerable…
  assert.ok(answerableCriteriaKeys(priorities).has(KEY));
  // …and not an in-person (Tour Feedback) criterion, so it is asked exactly once.
  assert.ok(!inPersonCriteria(computeMatch(home(), priorities)).some((item) => item.key === KEY));
  const unknown = row(computeMatch(home(), priorities), KEY);
  assert.deepEqual([unknown.tier, unknown.evaluated, unknown.objective], ['must', false, true]);
});

test('Yes / No score at the Must-Have weight; Unknown stays unscored', () => {
  const priorities = existingSearch('rating');
  assert.equal(TIER_META.must.weight, 4);
  // Unknown: only the budget (Important, 2×, met) counts.
  let match = computeMatch(home(), priorities);
  assert.deepEqual([match.pct, match.evaluatedCount, match.selectedCount], [100, 1, 2]);

  const yes = criterionAnswerPatch(home(), KEY, true, priorities.searchType).personal;
  match = computeMatch(home(yes), priorities);
  assert.deepEqual(yes, { checks: { [KEY]: true } });
  assert.deepEqual([row(match, KEY).met, match.pct, match.evaluatedCount], [true, 100, 2]);

  const no = criterionAnswerPatch(home(yes), KEY, 'no', priorities.searchType).personal;
  match = computeMatch(home(no), priorities);
  assert.equal(criterionAnswer(home(no), KEY, priorities.searchType), 'no');
  assert.deepEqual([row(match, KEY).met, match.pct], [false, 33], 'budget 1×2 + street 0×4 over 6');

  const cleared = criterionAnswerPatch(home(no), KEY, undefined, priorities.searchType).personal;
  match = computeMatch(home(cleared), priorities);
  assert.deepEqual(cleared, { checks: {} });
  assert.deepEqual([row(match, KEY).evaluated, match.pct, match.evaluatedCount], [false, 100, 1], 'Unknown is never No');
});

test('a 1–5 rating stored from before keeps its score until the buyer answers Yes or No', () => {
  const priorities = existingSearch('rating');
  const rated = home({ ratings: { [KEY]: 2, 'tour:overall': 4 } });
  let match = computeMatch(rated, priorities);
  assert.deepEqual([row(match, KEY).score, row(match, KEY).source], [0.4, 'earlier_rating']);
  assert.equal(legacyCriterionRating(rated, KEY), 2);
  // Unknown keeps the rating (nothing is deleted by clearing an answer).
  assert.deepEqual(criterionAnswerPatch(rated, KEY, undefined, priorities.searchType).personal, { checks: {} });
  // Yes replaces it: only that one key leaves ratings.
  const yes = criterionAnswerPatch(rated, KEY, true, priorities.searchType).personal;
  assert.deepEqual(yes, { checks: { [KEY]: true }, ratings: { 'tour:overall': 4 } });
  match = computeMatch({ ...rated, ...yes }, priorities);
  assert.deepEqual([row(match, KEY).score, row(match, KEY).source], [1, undefined]);
  // A check-kind custom priority never read ratings, and still doesn't.
  const checkKind = existingSearch('check');
  assert.equal(row(computeMatch(rated, checkKind), KEY).evaluated, false);
});

test('new custom priorities are created as Yes / No in every pre-tour category; Home Feel keeps rating', () => {
  for (const choice of ['home_buy', 'home_rent', 'apartment_rent']) {
    const base = applySearchChoice(normalizePriorities({}), choice);
    for (const def of getItemlistCategories(base.searchType)) {
      const next = addCustomCriterion(base, def.key, 'Desirable Street');
      const item = next[def.key].customItems.find((entry) => entry.label === 'Desirable Street');
      const expected = def.key === 'homeFeel' ? 'rating' : 'check';
      assert.deepEqual(item, { label: 'Desirable Street', kind: expected, source: 'custom' }, `${choice} ${def.key}`);
      assert.equal(next[def.key].tiers['Desirable Street'], 'important', 'new priorities start Important');
      assert.equal(answerableCriteriaKeys(next).has(`${def.key}:Desirable Street`), def.key !== 'homeFeel', `${choice} ${def.key}`);
    }
  }
  // The very first category offered by "Add your own" is Location.
  assert.equal(getItemlistCategories('purchase')[0].key, 'location');
  assert.equal(getItemlistCategories('purchase')[0].defaultCustomKind, 'check');
});

test('catalog ratings, tour criteria and Home Feel keep their after-tour semantics', () => {
  // Tour criteria (TOUR_CRITERIA) are never Yes / No, whatever their stored kind.
  for (const [category, label] of [['location', 'Immediate Street / Surroundings'], ['homeFeel', 'Natural Light'], ['exterior', 'Noise Level'], ['features', 'Storage']]) {
    assert.equal(isYesNoCriterion(category, { label, kind: 'rating' }), false, label);
    assert.equal(isYesNoCriterion(category, { label, kind: 'check' }), false, label);
  }
  // Catalog ratings the app offered (Commute, Neighborhood, Walkability …) are unchanged.
  for (const label of ['Commute', 'Neighborhood', 'Walkability', 'Parks Nearby', 'Proximity to Family / Friends', 'Schools', 'Overall Location', 'Tenant Appeal']) {
    assert.equal(isYesNoCriterion('location', { label, kind: 'rating' }), false, label);
  }
  // A typed Home Feel priority is judged in person: kept as it was.
  assert.equal(isYesNoCriterion('homeFeel', { label: 'Cozy Vibe', kind: 'rating', source: 'custom' }), false);
  // Typed rating priorities in pre-tour categories, with or without the source flag
  // (the older CriteriaPicker added them without it).
  assert.equal(isYesNoCriterion('location', { label: 'Desirable Street', kind: 'rating' }), true);
  assert.equal(isYesNoCriterion('exterior', { label: 'Sunset View', kind: 'rating', source: 'custom' }), true);
  // Check-kind, or a kind that was never stored, are Yes / No exactly as computeMatch already scored them.
  assert.equal(isYesNoCriterion('features', { label: 'Fireplace', kind: 'check' }), true);
  assert.equal(isYesNoCriterion('features', { label: 'Wine Fridge' }), true);
});

test('an after-tour rating priority still reads its tour response and is not offered as Yes / No', () => {
  const priorities = normalizePriorities({ ...applySearchChoice(normalizePriorities({}), 'home_rent') });
  priorities.homeFeel = { ...priorities.homeFeel, customItems: [{ label: 'Natural Light', kind: 'rating' }], tiers: { 'Natural Light': 'important' } };
  const key = 'homeFeel:Natural Light';
  assert.ok(!answerableCriteriaKeys(priorities).has(key));
  const match = computeMatch(home({ ratings: { [key]: 'positive' } }), priorities);
  assert.deepEqual([row(match, key).evaluated, row(match, key).met, row(match, key).objective], [true, true, false]);
  assert.ok(inPersonCriteria(match).some((item) => item.key === key));
});

test('My Search board identity is preserved: label, category, tier and stored kind', () => {
  const priorities = existingSearch('rating');
  const entry = priorityLevels(priorities).find((level) => level.tier === 'must').items.find((item) => item.key === KEY);
  assert.deepEqual([entry.categoryKey, entry.label, entry.kind, entry.experiential], ['location', 'Desirable Street', 'rating', false]);
});

test('every surface uses the one classifier, and the read-only Match never offers controls', () => {
  const matchCriteria = read('src/lib/matchCriteria.js');
  assert.match(matchCriteria, /if \(!isYesNoCriterion\(category\.key, item\)\) return;/);
  assert.match(read('src/lib/matching.js'), /if \(!isYesNoCriterion\(def\.key, item\)\) \{/);
  assert.match(read('src/components/HomeModal.jsx'), /filter\(\(item\) => isYesNoCriterion\(category\.key, item\)\)/);
  const component = read('src/components/MatchCriteria.jsx');
  assert.match(component, /: readOnly \? <span className=\{`flh-mc2-state is-\$\{tone\}`\}>/);
  // The Realtor's view of a buyer's home renders HomeDetail read-only.
  assert.match(read('src/app/(app)/people/[searchId]/homes/[homeId]/page.js'), /<HomeDetail [^>]*readOnly /);
  // No change to the SQL scorer: it already reads ratings, then checks, for every item.
  assert.match(read('supabase/migrations/2026-11-02-home-facts-match-parity.sql'), /state shape determines rating vs explicit Yes\/No/);
});
