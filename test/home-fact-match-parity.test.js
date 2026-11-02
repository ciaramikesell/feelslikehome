// Home Facts → Match parity (src/lib/homeFactCriteria.js and
// 2026-11-02-home-facts-match-parity.sql). For each fact-backed check
// criterion: the buyer's own Yes / No overrides, else an exact shared Home Fact
// answers, else Unknown. Nothing here writes; the real-Postgres side is
// test/home-fact-match-parity-db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { garageSpacesCount, homeFactAnswer, HOME_FACT_CRITERIA, resolveCriterionAnswer } from '../src/lib/homeFactCriteria.js';
import { computeMatch } from '../src/lib/matching.js';
import { normalizePriorities, PURCHASE_LEGACY_ALIAS_KEYS, TIER_META } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';
import { answerableCriteriaKeys, criterionAnswerPatch, criterionResolution } from '../src/lib/matchCriteria.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const MIGRATION = read('supabase/migrations/2026-11-02-home-facts-match-parity.sql');
const PREVIOUS = read('supabase/migrations/2026-10-18-lot-size-units-match-parity.sql');

const CONDITIONS = [undefined, 'none', 'unfinished', 'partially_finished', 'finished'];
const STYLES = [undefined, 'none', 'traditional', 'gardenview', 'walkout'];

test('Finished basement over every condition × style: exact readings only; contradictions answer nothing', () => {
  const expected = {
    // style:      undefined   none    traditional  gardenview  walkout
    undefined: [undefined, 'no', undefined, undefined, undefined],
    none: ['no', 'no', undefined, undefined, undefined],
    unfinished: ['no', 'no', 'no', 'no', 'no'],
    partially_finished: [undefined, undefined, undefined, undefined, undefined],
    finished: [true, undefined, true, true, true],
  };
  for (const condition of CONDITIONS) STYLES.forEach((style, i) => {
    assert.equal(homeFactAnswer({ basementCondition: condition, basementStyle: style }, 'features:Finished basement'), expected[String(condition)][i], `${condition} / ${style}`);
  });
});

test('Walkout basement over every condition × style: Traditional and Gardenview never mean "no walkout"', () => {
  const expected = {
    undefined: [undefined, 'no', undefined, undefined, true],
    none: ['no', 'no', undefined, undefined, undefined],
    unfinished: [undefined, undefined, undefined, undefined, true],
    partially_finished: [undefined, undefined, undefined, undefined, true],
    finished: [undefined, undefined, undefined, undefined, true],
  };
  for (const condition of CONDITIONS) STYLES.forEach((style, i) => {
    assert.equal(homeFactAnswer({ basementCondition: condition, basementStyle: style }, 'features:Walkout basement'), expected[String(condition)][i], `${condition} / ${style}`);
  });
});

test('laundry location answers its own floor Yes and nothing No; First-Floor Primary; No HOA never from $0', () => {
  for (const [location, first, second] of [[undefined, undefined, undefined], [null, undefined, undefined], ['first_floor', true, undefined], ['second_floor', undefined, true], ['basement', undefined, undefined]]) {
    assert.equal(homeFactAnswer({ laundryLocation: location }, 'features:First-floor laundry'), first, String(location));
    assert.equal(homeFactAnswer({ laundryLocation: location }, 'features:Second-Floor Laundry'), second, String(location));
  }
  for (const [location, answer] of [['Main Floor', true], ['Upstairs', 'no'], ['', undefined], ['No Preference', undefined], [null, undefined]]) {
    assert.equal(homeFactAnswer({ primaryBedroomLocation: location }, 'features:First-Floor Primary'), answer, String(location));
  }
  for (const [fee, answer] of [[null, undefined], ['', undefined], [0, undefined], ['0', undefined], [450, 'no'], ['125.50', 'no'], ['abc', undefined]]) {
    assert.equal(homeFactAnswer({ hoaFeeMonthly: fee }, 'location:No HOA'), answer, String(fee));
  }
});

test('garage spaces: digits are a count, "none" is 0, anything else is Unknown (no more "Attached" read as 0)', () => {
  for (const [value, count] of [['2', 2], ['3+', 3], ['0', 0], [' 1 ', 1], ['2 car', 2], ['none', 0], ['No garage', 0], ['', null], [null, null], ['Attached', null], ['yes', null], ['1.2.3', null]]) {
    assert.equal(garageSpacesCount(value), count, String(value));
  }
  assert.equal(homeFactAnswer({ garageSpaces: '2' }, 'exterior:Garage'), true);
  assert.equal(homeFactAnswer({ garageSpaces: '0' }, 'exterior:Garage'), 'no');
  assert.equal(homeFactAnswer({ garageSpaces: 'Attached' }, 'exterior:Garage'), undefined);
});

test('older labels map to the same facts; unrelated criteria never read a fact', () => {
  assert.equal(homeFactAnswer({ basementCondition: 'finished' }, 'features:Finished Basement'), true);
  assert.equal(homeFactAnswer({ basementStyle: 'walkout' }, 'features:Walkout Basement'), true);
  assert.equal(homeFactAnswer({ laundryLocation: 'first_floor' }, 'features:First-Floor Laundry'), true);
  for (const key of ['features:Fireplace', 'exterior:Pool', 'features:Basement Storage', 'features:Home office']) {
    assert.equal(homeFactAnswer({ basementCondition: 'finished', basementStyle: 'walkout', laundryLocation: 'first_floor', garageSpaces: '2', hoaFeeMonthly: 300 }, key), undefined, key);
  }
});

test('precedence: own Yes / No overrides the fact, historical false and absence fall through, Unknown otherwise', () => {
  const home = { basementCondition: 'finished' };
  const key = 'features:Finished basement';
  assert.deepEqual(resolveCriterionAnswer(home, key, {}), { value: true, source: 'home_facts', fact: true });
  assert.deepEqual(resolveCriterionAnswer(home, key, { [key]: 'no' }), { value: 'no', source: 'answer', fact: true });
  assert.deepEqual(resolveCriterionAnswer(home, key, { [key]: true }), { value: true, source: 'answer', fact: true });
  assert.deepEqual(resolveCriterionAnswer(home, key, { [key]: false }), { value: true, source: 'home_facts', fact: true });
  assert.deepEqual(resolveCriterionAnswer({}, key, { [key]: false }), { value: undefined, source: null, fact: undefined });
  assert.deepEqual(resolveCriterionAnswer({}, key, {}), { value: undefined, source: null, fact: undefined });
});

function buyer() {
  let priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '500000', tier: 'important' };
  for (const [categoryKey, label, tier] of [['exterior', 'Garage', 'must'], ['features', 'Finished basement', 'important'], ['features', 'Walkout basement', 'nice'], ['location', 'No HOA', 'important']]) {
    priorities = addCriterion(priorities, { categoryKey, label, kind: 'check' }, tier);
  }
  return priorities;
}
const row = (match, key) => match.allSelected.find((item) => item.key === key);

test('computeMatch: facts answer, overrides win, weights stay 4 / 2 / 1, and nothing is written into checks', () => {
  assert.deepEqual([TIER_META.must.weight, TIER_META.important.weight, TIER_META.nice.weight], [4, 2, 1]);
  const priorities = buyer();
  const checks = Object.freeze({});
  const home = Object.freeze({ price: '450000', garageSpaces: '0', basementCondition: 'finished', basementStyle: 'traditional', hoaFeeMonthly: 300, checks });
  const match = computeMatch(home, priorities);
  assert.deepEqual([row(match, 'exterior:Garage').met, row(match, 'exterior:Garage').detail, row(match, 'exterior:Garage').source], [false, 'No garage', 'home_facts']);
  assert.deepEqual([row(match, 'features:Finished basement').met, row(match, 'features:Finished basement').source], [true, 'home_facts']);
  assert.equal(row(match, 'features:Walkout basement').evaluated, false, 'Traditional is not "no walkout"');
  assert.deepEqual([row(match, 'location:No HOA').met, row(match, 'location:No HOA').source], [false, 'home_facts']);
  // budget 1×2 + garage 0×4 + finished 1×2 + No HOA 0×2 over 10
  assert.equal(match.pct, 40);
  assert.deepEqual(home.checks, {}, 'derived answers are never copied into checks');

  // The buyer overrides Garage (they know there is a garage): their answer wins, labelled as theirs.
  const overridden = computeMatch({ ...home, checks: { 'exterior:Garage': true } }, priorities);
  assert.deepEqual([row(overridden, 'exterior:Garage').met, row(overridden, 'exterior:Garage').detail, row(overridden, 'exterior:Garage').source], [true, 'Yes', undefined]);
  assert.equal(overridden.pct, 80);
  // Garage spaces unknown: the buyer's own answer counts (it used to be ignored).
  assert.equal(row(computeMatch({ price: '450000', checks: { 'exterior:Garage': 'no' } }, priorities), 'exterior:Garage').met, false);
  // A historical false Garage answer stays Unknown and lets the fact decide.
  assert.equal(row(computeMatch({ price: '450000', checks: { 'exterior:Garage': false } }, priorities), 'exterior:Garage').evaluated, false);
  assert.equal(row(computeMatch({ ...home, checks: { 'exterior:Garage': false } }, priorities), 'exterior:Garage').source, 'home_facts');
});

test('Match Criteria: fact-backed criteria are answerable; clearing an override returns to the fact, never to a stale alias', () => {
  const priorities = buyer();
  assert.ok(answerableCriteriaKeys(priorities).has('exterior:Garage'));
  const home = { garageSpaces: '2', checks: { 'exterior:Garage': 'no' } };
  assert.deepEqual(criterionResolution(home, 'exterior:Garage', 'purchase'), { value: 'no', source: 'answer', fact: true, link: ['hf-garageSpaces', 'Garage'] });
  const cleared = criterionAnswerPatch(home, 'exterior:Garage', undefined, 'purchase').personal.checks;
  assert.deepEqual(criterionResolution({ ...home, checks: cleared }, 'exterior:Garage', 'purchase'), { value: true, source: 'home_facts', fact: true, link: ['hf-garageSpaces', 'Garage'] });
  // An older-label answer is read for today's label (purchase), and clearing hides it.
  const legacy = { basementCondition: 'finished', checks: { 'features:First-Floor Laundry': 'no' } };
  assert.equal(criterionResolution(legacy, 'features:First-floor laundry', 'purchase').value, 'no');
  const clearedLegacy = criterionAnswerPatch(legacy, 'features:First-floor laundry', undefined, 'purchase').personal.checks;
  assert.equal(criterionResolution({ ...legacy, checks: clearedLegacy }, 'features:First-floor laundry', 'purchase').value, undefined);
  // Pets / Utilities / In-Unit Laundry keep their shared fields; no Home Facts link.
  assert.deepEqual(criterionResolution({ petsAllowed: true }, 'features:Pets Allowed', 'rental'), { value: true, source: 'answer', fact: undefined, link: null });
});

/* ------------------------- JS ↔ SQL scorer contract ------------------------- */

test('the SQL scorer answers exactly the JS fact-backed keys, and folds exactly the JS purchase aliases', () => {
  const sqlFactKeys = [...MIGRATION.matchAll(/when v_key (?:=|in \()\s*('[^)]*?')\)? then case/g)]
    .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((key) => key[1]));
  assert.deepEqual(sqlFactKeys.sort(), Object.values(HOME_FACT_CRITERIA).flat().sort());
  const forward = [...MIGRATION.match(/v_alias := case v_key([\s\S]*?)end;/)[1].matchAll(/when '([^']+)' then '([^']+)'/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(forward.sort(), PURCHASE_LEGACY_ALIAS_KEYS.map((pair) => [...pair]).sort());
  const reverse = [...MIGRATION.match(/v_raw := v_checks -> \(case v_key([\s\S]*?)end\);/)[1].matchAll(/when '([^']+)' then '([^']+)'/g)].map((match) => [match[2], match[1]]);
  assert.deepEqual(reverse.sort(), PURCHASE_LEGACY_ALIAS_KEYS.map((pair) => [...pair]).sort());
});

test('the migration changes only the item-list section of the previous scorer, and keeps its security contract and grants', () => {
  const body = (sql) => sql.slice(sql.indexOf('begin;'));
  const outside = (sql) => {
    const text = body(sql);
    const start = text.indexOf('    -- Item-list priorities.');
    const end = text.indexOf('    -- Only opposing, actually-evaluated experiential reactions are projected.');
    return [text.slice(0, start).replace(/\n {2}v_checks jsonb;\n {2}v_purchase boolean;\n {2}v_alias text;\n {2}v_fact integer;/, ''), text.slice(end)];
  };
  const [prevHead, prevTail] = outside(PREVIOUS);
  const [nextHead, nextTail] = outside(MIGRATION);
  assert.equal(nextTail, prevTail);
  assert.equal(nextHead.replace(/\n {4}v_checks := coalesce\(v_state\.checks, v_legacy_checks\);\n {4}v_purchase := [^\n]+/, ''), prevHead);
  for (const contract of [/security definer/, /set search_path = ''/, /stable\n/, /raise exception 'Authentication required'/, /can_access_search\(p_search_id, v_caller\)/,
    /revoke execute on function public\.resolve_cobuyer_compare_perspectives\(uuid, uuid\[\]\) from anon;/,
    /grant execute on function public\.resolve_cobuyer_compare_perspectives\(uuid, uuid\[\]\) to authenticated;/]) assert.match(MIGRATION, contract);
  // Retired keys and the shared rental facts are untouched.
  const retired = (sql) => sql.match(/in \('purchase', 'buy'\) and v_key = any\(array\[[\s\S]*?\]\)/)[0];
  assert.equal(retired(MIGRATION), retired(PREVIOUS));
  assert.match(MIGRATION, /These shared facts are authoritative/);
});

test('the UI shows where an answer came from and only the buyer\'s click writes', () => {
  const criteria = read('src/components/MatchCriteria.jsx');
  assert.match(criteria, /From Home Facts: <b className=\{`is-\$\{resolved\.value === true \? 'met' : 'missed'\}`\}>\{answerText\(resolved\.value\)\}<\/b>/);
  assert.match(criteria, /Your answer · Home Facts: /);
  assert.match(criteria, /id === 'unknown' && factBacked \? 'Home Facts' : text/);
  assert.match(criteria, /onChange=\{\(next\) => onAnswer\(item, next\)\}/);
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /From Home Facts: \{resolved\.value === true \? 'Yes' : 'No'\}/);
  // No surface copies a resolved (derived) answer into checks.
  for (const source of [criteria, modal, read('src/lib/matchCriteria.js'), read('src/lib/matching.js')]) {
    assert.doesNotMatch(source, /checks[^\n]*resolved\.value|resolved\.value[^\n]*checks/);
  }
  assert.doesNotMatch(read('src/lib/homeFactCriteria.js'), /supabase|fetch\(|checks\[[^\]]+\]\s*=/);
});
