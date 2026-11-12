// Home Facts → Match (src/lib/homeFactCriteria.js) together with the two
// features merged before it:
//   #165 suggested answers from pasted text (src/lib/listingTextAnswers.js)
//   #164 Filter My Homes (src/lib/homeFilters.js)
// A fact-derived answer is never a personal answer: it doesn't block or count as
// a suggestion's "already answered", it is never written, and an answer the
// buyer confirms overrides it exactly like a manual one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { garageSpacesCount, homeFactAnswer, HOME_FACT_CRITERIA } from '../src/lib/homeFactCriteria.js';
import { computeMatch } from '../src/lib/matching.js';
import { normalizePriorities } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';
import { criterionAnswerPatch, criterionResolution } from '../src/lib/matchCriteria.js';
import { applyListingAnswer, resuggestListingAnswers, suggestListingAnswers, undoListingAnswer } from '../src/lib/listingTextAnswers.js';
import { applyHomeFilters, filterableCriteria } from '../src/lib/homeFilters.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const BASEMENT = 'features:Finished basement';
const GARAGE = 'exterior:Garage';
const LAUNDRY = 'features:First-floor laundry';
const buyer = [[BASEMENT, 'must'], [GARAGE, 'important'], [LAUNDRY, 'nice']]
  .reduce((p, [key, tier]) => addCriterion(p, { categoryKey: key.split(':')[0], label: key.split(':')[1], kind: 'check' }, tier), normalizePriorities({ searchType: 'purchase' }));
const item = (home, key, priorities = buyer) => computeMatch(home, priorities).allSelected.find((entry) => entry.key === key);
const state = (entry) => (entry.evaluated ? (entry.met ? true : 'no') : undefined);

/* ----------------------------- Garage text, exact ----------------------------- */

test('garage spaces: one number is the count; several numbers or a negation beside a number is Unknown', () => {
  const cases = [
    ['2', 2], ['3+', 3], ['2 car', 2], ['2-car attached', 2], ['2.5', 2.5], ['.5', 0.5], ['0', 0], ['0.0', 0], ['00', 0],
    ['none', 0], ['No', 0], ['no garage', 0], [' NO GARAGE ', 0],
    ['1-2', null], ['1.2.3', null], ['2 + 1 carport', null], ['No garage, 2 carport', null], ['not 2', null], ['without 1', null],
    ['Attached', null], ['yes', null], ['', null], ['   ', null], [null, null], [undefined, null],
  ];
  for (const [value, count] of cases) assert.equal(garageSpacesCount(value), count, JSON.stringify(value));
  assert.equal(homeFactAnswer({ garageSpaces: '0.0' }, GARAGE), 'no');
  assert.equal(homeFactAnswer({ garageSpaces: 'No garage, 2 carport' }, GARAGE), undefined, 'never a 2-car garage');
  assert.equal(homeFactAnswer({ garageSpaces: '1-2' }, GARAGE), undefined, 'never a 12-car garage');
  // The SQL scorer and the preflight use the same rule.
  for (const file of ['supabase/migrations/2026-11-02-home-facts-match-parity.sql', 'supabase/home-facts-match-parity-preflight.sql']) {
    const sql = read(file);
    assert.match(sql, /!~\* '\\m\(no\|none\|not\|without\)\\M'/, file);
    assert.match(sql, /regexp_matches\([a-z_.]+garage_spaces, '\[0-9\]\+\(\\\.\[0-9\]\+\)\?\|\\\.\[0-9\]\+', 'g'\)\) = 1/, file);
  }
});

/* --------------------- Overrides in either direction, and clearing --------------------- */

test('an explicit Yes or No overrides the fact in either direction; clearing returns to the fact; nothing is written', () => {
  const facts = { basementCondition: 'unfinished', garageSpaces: '2', laundryLocation: 'first_floor' };
  const home = { ...facts, checks: {} };
  assert.deepEqual([BASEMENT, GARAGE, LAUNDRY].map((key) => state(item(home, key))), ['no', true, true]);
  // Yes over a No fact, No over a Yes fact.
  const overridden = { ...facts, checks: { [BASEMENT]: true, [GARAGE]: 'no', [LAUNDRY]: 'no' } };
  assert.deepEqual([BASEMENT, GARAGE, LAUNDRY].map((key) => state(item(overridden, key))), [true, 'no', 'no']);
  assert.equal(item(overridden, GARAGE).detail, 'No', 'an own Garage answer is not described from garage spaces');
  // Clearing through Match Criteria removes only the answer; the fact answers again.
  let checks = overridden.checks;
  for (const key of [BASEMENT, GARAGE, LAUNDRY]) checks = criterionAnswerPatch({ ...facts, checks }, key, undefined, 'purchase').personal.checks;
  assert.deepEqual(checks, {});
  assert.deepEqual([BASEMENT, GARAGE, LAUNDRY].map((key) => criterionResolution({ ...facts, checks }, key, 'purchase').source), ['home_facts', 'home_facts', 'home_facts']);
  // Historical false is not an override either way.
  assert.equal(state(item({ ...facts, checks: { [BASEMENT]: false, [GARAGE]: false } }, BASEMENT)), 'no');
  assert.equal(state(item({ ...facts, checks: { [GARAGE]: false } }, GARAGE)), true);
  // Reading never writes into the home's checks.
  const frozen = Object.freeze({ ...facts, checks: Object.freeze({}) });
  computeMatch(frozen, buyer);
  assert.deepEqual(frozen.checks, {});
});

test('a shared fact change moves every participant without an override, and only them', () => {
  const owner = { checks: {} };
  const coBuyer = { checks: { [BASEMENT]: 'no' } };
  for (const [condition, expected] of [[null, undefined], ['finished', true], ['unfinished', 'no'], ['partially_finished', undefined], ['none', 'no']]) {
    assert.equal(state(item({ basementCondition: condition, ...owner }, BASEMENT)), expected, `owner, ${condition}`);
    assert.equal(state(item({ basementCondition: condition, ...coBuyer }, BASEMENT)), 'no', `co-buyer keeps their No, ${condition}`);
  }
});

/* ------------------------ #165: suggested answers from pasted text ------------------------ */

test('#165: a fact-derived answer is not a personal answer — a suggestion is still offered and nothing is written until confirmed', () => {
  const home = { basementCondition: 'unfinished', checks: {} };
  const [suggestion] = suggestListingAnswers('Beautiful finished basement with a wet bar.', buyer, home.checks);
  assert.equal(suggestion.key, BASEMENT);
  assert.equal(suggestion.answer, true);
  // Until the buyer confirms, Match follows the Home Fact and checks stay empty.
  assert.deepEqual(home.checks, {});
  assert.deepEqual([state(item(home, BASEMENT)), item(home, BASEMENT).source], ['no', 'home_facts']);
  // Garage is never suggested: it is answered by garage spaces unless the buyer answers it themselves.
  assert.equal(suggestListingAnswers('Attached 2-car garage.', buyer, {}).some((entry) => entry.key === GARAGE), false);
});

test('#165: a confirmed suggestion is a personal answer that overrides a conflicting Home Fact; undo returns to the fact, a rerun keeps it', () => {
  const facts = { basementCondition: 'unfinished' };
  const text = 'Beautiful finished basement with a wet bar.';
  const [suggestion] = suggestListingAnswers(text, buyer, {});
  const checks = applyListingAnswer({}, suggestion, 'purchase');
  assert.deepEqual(checks, { [BASEMENT]: true });
  const confirmed = item({ ...facts, checks }, BASEMENT);
  assert.deepEqual([state(confirmed), confirmed.source], [true, undefined], 'scores exactly like a manual Yes');
  assert.deepEqual(computeMatch({ ...facts, checks }, buyer), computeMatch({ ...facts, checks: { [BASEMENT]: true } }, buyer));
  // Undo: back to the fact.
  assert.equal(state(item({ ...facts, checks: undoListingAnswer(checks, suggestion) }, BASEMENT)), 'no');
  // Rerun with text that no longer supports it: the confirmed answer is the buyer's and stays (Add Home V3 review).
  const rerun = resuggestListingAnswers('Bright kitchen.', buyer, checks, { [BASEMENT]: true });
  assert.deepEqual(rerun.checks, { [BASEMENT]: true });
  assert.equal(state(item({ ...facts, checks: rerun.checks }, BASEMENT)), true);
  // A manual answer is never touched by a rerun, whatever the fact says.
  const manual = resuggestListingAnswers('No finished basement.', buyer, { [BASEMENT]: true }, {});
  assert.deepEqual(manual.checks, { [BASEMENT]: true });
});

test('#165 + #167: the review list and the Match editor read the same answer the buyer owns', () => {
  const modal = read('src/components/HomeModal.jsx');
  // The suggestion list only hides a criterion the buyer answered themselves (hasRecordedAnswer on checks),
  // and the editor's "Home Facts" option clears through setCheckItem, which also ends a suggestion's ownership.
  assert.match(modal, /hasRecordedAnswer\(form\.checks, suggestion\.key, priorities\.searchType\)/);
  assert.match(modal, /const setCheckItem = \(cat, label, value\) => \{\n\s*setConfirmedAnswers\(/);
  assert.match(modal, /const resolutionOf = \(key\) => criterionResolution\(form, key, priorities\.searchType\);/);
  assert.match(modal, /label = id === 'unknown' && resolved\.fact !== undefined \? 'Home Facts' : text/);
});

/* ----------------------------- #164: Filter My Homes ----------------------------- */

test('#164: filters classify fact-derived Yes / No / Unknown, per participant, and Unknown stays Possible', () => {
  const criteria = filterableCriteria(buyer);
  assert.ok([BASEMENT, GARAGE, LAUNDRY].every((key) => criteria.some((entry) => entry.key === key)));
  const shared = [
    { id: 'yes', basementCondition: 'finished', garageSpaces: '2', laundryLocation: 'first_floor' },
    { id: 'no', basementCondition: 'unfinished', garageSpaces: '0', laundryLocation: 'second_floor' },
    { id: 'unknown', basementCondition: 'partially_finished', garageSpaces: 'Attached', laundryLocation: 'basement' },
    { id: 'blank' },
  ];
  // The owner has no answers; the co-buyer overrides two homes.
  const ownerHomes = shared.map((home) => ({ ...home, checks: {} }));
  const coBuyerHomes = shared.map((home) => ({ ...home, checks: home.id === 'no' ? { [BASEMENT]: true, [GARAGE]: true } : home.id === 'yes' ? { [BASEMENT]: 'no' } : {} }));
  const run = (homes, keys) => {
    const result = applyHomeFilters(homes, { criteria: keys }, (home) => computeMatch(home, buyer), { criteria });
    return Object.fromEntries(homes.map((home) => [home.id, result.byId.get(home.id).status]));
  };
  assert.deepEqual(run(ownerHomes, [BASEMENT]), { yes: 'confirmed', no: 'excluded', unknown: 'possible', blank: 'possible' });
  assert.deepEqual(run(ownerHomes, [GARAGE]), { yes: 'confirmed', no: 'excluded', unknown: 'possible', blank: 'possible' });
  // Laundry Location never says No: a second-floor laundry room is Possible for First-floor laundry.
  assert.deepEqual(run(ownerHomes, [LAUNDRY]), { yes: 'confirmed', no: 'possible', unknown: 'possible', blank: 'possible' });
  // The co-buyer's own answers override the facts for the co-buyer only.
  assert.deepEqual(run(coBuyerHomes, [BASEMENT]), { yes: 'excluded', no: 'confirmed', unknown: 'possible', blank: 'possible' });
  assert.deepEqual(run(coBuyerHomes, [GARAGE]), { yes: 'confirmed', no: 'confirmed', unknown: 'possible', blank: 'possible' });
  assert.deepEqual(run(ownerHomes, [BASEMENT, GARAGE, LAUNDRY]), { yes: 'confirmed', no: 'excluded', unknown: 'possible', blank: 'possible' });
  // Filtering wrote nothing.
  assert.ok(ownerHomes.every((home) => Object.keys(home.checks).length === 0));
});

test('every fact-backed criterion key has a filterable, answerable criterion under its selected label', () => {
  for (const keys of Object.values(HOME_FACT_CRITERIA)) {
    for (const key of keys) {
      const [categoryKey, label] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const searchType = label === 'Finished Basement' || label === 'Walkout Basement' ? 'rental' : 'purchase';
      const priorities = addCriterion(normalizePriorities({ searchType }), { categoryKey, label, kind: 'check', source: searchType === 'rental' ? 'custom' : undefined }, 'must');
      const selected = computeMatch({ checks: {} }, priorities).allSelected.map((entry) => entry.key);
      assert.equal(selected.length, 1, key);
      assert.equal(homeFactAnswer({ garageSpaces: '1', basementCondition: 'finished', basementStyle: 'walkout', laundryLocation: label.startsWith('Second') ? 'second_floor' : 'first_floor', primaryBedroomLocation: 'Main Floor' }, selected[0]) === undefined, label === 'No HOA', key);
    }
  }
});
