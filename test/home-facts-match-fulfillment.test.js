// Home Facts → Match fulfillment (PR #187; src/lib/homeFactCriteria.js and
// 2026-11-16-home-facts-match-fulfillment.sql): the Garage qualifier read
// against the home's garage type, Central Air from Cooling, and No HOA from a
// confirmed HOA status. Unknown is never No; the buyer's own Yes / No always
// wins; nothing is written. The real-Postgres side is
// test/home-facts-match-fulfillment-db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  centralAirReading, garagePreferenceOf, garageReading, homeFactAnswer, homeFactContext, HOME_FACT_CRITERIA, HOME_FACT_LINKS, noHoaReading, resolveCriterionAnswer,
} from '../src/lib/homeFactCriteria.js';
import { computeMatch, garageAnswerDetail } from '../src/lib/matching.js';
import { normalizePriorities, TIER_META } from '../src/lib/constants.js';
import { addCriterion, setGaragePreference } from '../src/lib/searchProfile.js';
import { criterionResolution } from '../src/lib/matchCriteria.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const MIGRATION = read('supabase/migrations/2026-11-16-home-facts-match-fulfillment.sql');
const PREVIOUS = read('supabase/migrations/2026-11-02-home-facts-match-parity.sql');

/* ---------------------------------- Garage ---------------------------------- */

const TYPES = [undefined, 'none', 'attached', 'detached'];
const SPACES = ['', '0', '2', 'Attached'];
// [type][spaces] → [any, attached, detached]
const GARAGE_EXPECTED = {
  undefined: { '': [undefined, undefined, undefined], 0: ['no', 'no', 'no'], 2: [true, undefined, undefined], Attached: [undefined, undefined, undefined] },
  none: { '': ['no', 'no', 'no'], 0: ['no', 'no', 'no'], 2: [undefined, undefined, undefined], Attached: ['no', 'no', 'no'] },
  attached: { '': [true, true, 'no'], 0: [undefined, undefined, undefined], 2: [true, true, 'no'], Attached: [true, true, 'no'] },
  detached: { '': [true, 'no', true], 0: [undefined, undefined, undefined], 2: [true, 'no', true], Attached: [true, 'no', true] },
};

test('Garage over every type × spaces × qualifier: presence / absence / kind, contradictions Unknown, never inferred from a missing field', () => {
  for (const type of TYPES) for (const spaces of SPACES) {
    const expected = GARAGE_EXPECTED[String(type)][spaces === '' ? '' : spaces];
    ['any', 'attached', 'detached'].forEach((preference, i) => {
      const home = { garageType: type, garageSpaces: spaces };
      assert.equal(garageReading(home, preference), expected[i], `${type} / "${spaces}" / ${preference}`);
      assert.equal(homeFactAnswer(home, 'exterior:Garage', { garagePreference: preference }), expected[i]);
    });
  }
  // Without a context (or an unrecognized qualifier) Garage reads as Any — the established default.
  assert.equal(homeFactAnswer({ garageType: 'detached' }, 'exterior:Garage'), true);
  assert.equal(garageReading({ garageType: 'detached' }, 'carport'), true);
  assert.equal(garagePreferenceOf({ exterior: { garagePreference: 'carport' } }), 'any');
  assert.equal(garagePreferenceOf({}), 'any');
  assert.deepEqual(homeFactContext({ exterior: { garagePreference: 'attached' } }), { garagePreference: 'attached' });
});

function garageBuyer(preference, tier = 'must') {
  let priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '500000', tier: 'important' };
  priorities = addCriterion(priorities, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, tier);
  return setGaragePreference(priorities, preference);
}
const rows = (match, key) => match.allSelected.filter((item) => item.key === key);

test('Garage is ONE criterion for every qualifier: counted once, at its own weight, with a readable reason', () => {
  for (const preference of ['any', 'attached', 'detached']) {
    const priorities = garageBuyer(preference);
    for (const type of TYPES) for (const spaces of SPACES) {
      const match = computeMatch({ price: '450000', garageType: type, garageSpaces: spaces, checks: {} }, priorities);
      assert.equal(rows(match, 'exterior:Garage').length, 1, `${preference} ${type} ${spaces}`);
      assert.equal(match.selectedCount, 2);
      const expected = GARAGE_EXPECTED[String(type)][spaces][['any', 'attached', 'detached'].indexOf(preference)];
      // budget 1×2 always; Garage 4× when evaluated.
      assert.equal(match.pct, expected === undefined ? 100 : expected === true ? 100 : Math.round((2 / 6) * 100), `${preference} ${type} ${spaces}`);
    }
  }
  const attached = garageBuyer('attached');
  const miss = rows(computeMatch({ garageType: 'detached', garageSpaces: '2', checks: {} }, attached), 'exterior:Garage')[0];
  assert.deepEqual([miss.met, miss.source, miss.detail], [false, 'home_facts', '2-car detached garage — you want attached']);
  assert.equal(rows(computeMatch({ garageType: 'attached', checks: {} }, attached), 'exterior:Garage')[0].detail, 'Attached garage');
  assert.equal(rows(computeMatch({ garageSpaces: '2', checks: {} }, garageBuyer('any')), 'exterior:Garage')[0].detail, '2-car garage', 'unchanged wording without a type');
  assert.equal(rows(computeMatch({ garageType: 'none', checks: {} }, attached), 'exterior:Garage')[0].detail, 'No garage');
  assert.equal(garageAnswerDetail({ garageSpaces: '0' }, false, 'detached'), 'No garage');
});

test('Garage precedence: the buyer\'s own Yes / No wins over every reading; historical false falls through', () => {
  const context = { garagePreference: 'attached' };
  const detached = { garageType: 'detached', garageSpaces: '2' };
  assert.deepEqual(resolveCriterionAnswer(detached, 'exterior:Garage', {}, context), { value: 'no', source: 'home_facts', fact: 'no' });
  assert.deepEqual(resolveCriterionAnswer(detached, 'exterior:Garage', { 'exterior:Garage': true }, context), { value: true, source: 'answer', fact: 'no' });
  assert.deepEqual(resolveCriterionAnswer(detached, 'exterior:Garage', { 'exterior:Garage': false }, context), { value: 'no', source: 'home_facts', fact: 'no' });
  // Match Criteria resolves with the viewing buyer's own qualifier.
  assert.equal(criterionResolution({ ...detached, checks: {} }, 'exterior:Garage', 'purchase', context).value, 'no');
  assert.equal(criterionResolution({ ...detached, checks: {} }, 'exterior:Garage', 'purchase', { garagePreference: 'detached' }).value, true);
  assert.deepEqual(criterionResolution({ ...detached, checks: {} }, 'exterior:Garage', 'purchase').link, ['hf-garageType', 'Garage']);
});

test('two buyers on one home: each Garage qualifier reads the same shared facts independently', () => {
  const home = Object.freeze({ price: '450000', garageType: 'attached', garageSpaces: '2', checks: Object.freeze({}) });
  const owner = computeMatch(home, garageBuyer('attached'));
  const coBuyer = computeMatch(home, garageBuyer('detached'));
  assert.equal(rows(owner, 'exterior:Garage')[0].met, true);
  assert.equal(rows(coBuyer, 'exterior:Garage')[0].met, false);
  assert.deepEqual(home.checks, {}, 'nothing is written');
});

/* -------------------------------- Central Air -------------------------------- */

const COOLING = [
  [undefined, undefined], [null, undefined], ['', undefined], ['   ', undefined],
  ['Central Air', true], ['central air', true], ['Central', true], ['Central A/C', true], ['Central AC', true], ['Central Air Conditioning', true],
  ['Central Air, Ceiling Fan(s)', true], ['Forced Air, Central', true], ['Central-Air', true],
  ['None', 'no'], ['none', 'no'], ['No', 'no'], [' No Cooling ', 'no'], ['No A/C', 'no'], ['No AC', 'no'], ['No air conditioning', 'no'], ['No central air', 'no'], ['No Air', 'no'],
  ['Window Units', undefined], ['Window Unit(s)', undefined], ['Ductless Mini-Split', undefined], ['Heat Pump', undefined], ['Wall Unit', undefined],
  ['Ceiling Fans', undefined], ['Yes', undefined], ['Central Evaporative', undefined], ['Swamp cooler (central)', undefined],
  ['Not central air', undefined], ['Central air - not working', undefined], ['No central air; window units', undefined], ['Centralized fans', undefined],
  ['Central Air?', undefined], ['Possibly central air', undefined], ['Central air (unverified)', undefined], ['Maybe central', undefined],
];

test('Central Air from Cooling: only an explicit reading; window units / mini-split / heat pump / ambiguous stay Unknown', () => {
  for (const [cooling, expected] of COOLING) {
    assert.equal(centralAirReading(cooling), expected, JSON.stringify(cooling));
    assert.equal(homeFactAnswer({ cooling }, 'features:Central air'), expected);
    assert.equal(homeFactAnswer({ cooling }, 'features:Central Air'), expected, 'the rental / legacy label reads the same fact');
  }
  assert.equal(homeFactAnswer({ cooling: 'Central Air' }, 'features:Fireplace'), undefined);
});

test('Central Air: one criterion when both labels are selected (purchase folds them); own answers win; weights 4 / 2 / 1', () => {
  assert.deepEqual([TIER_META.must.weight, TIER_META.important.weight, TIER_META.nice.weight], [4, 2, 1]);
  const priorities = normalizePriorities({ searchType: 'purchase', features: { tiers: { 'Central Air': 'nice', 'Central air': 'must' } } });
  const match = computeMatch({ cooling: 'None', checks: {} }, priorities);
  const air = match.allSelected.filter((item) => /Central/i.test(item.key));
  assert.equal(air.length, 1);
  assert.deepEqual([air[0].key, air[0].tier, air[0].met, air[0].source], ['features:Central air', 'must', false, 'home_facts']);
  assert.equal(computeMatch({ cooling: 'None', checks: { 'features:Central air': true } }, priorities).pct, 100);
  // An answer stored under the older label is still the buyer's own override.
  assert.equal(computeMatch({ cooling: 'Central Air', checks: { 'features:Central Air': 'no' } }, priorities).pct, 0);
  assert.equal(computeMatch({ cooling: 'Window Units', checks: {} }, priorities).pct, null, 'Unknown stays out of the score');
  assert.deepEqual(criterionResolution({ cooling: 'Central', checks: {} }, 'features:Central air', 'purchase').link, ['hf-cooling', 'Cooling']);
});

/* ----------------------------------- No HOA ----------------------------------- */

test('No HOA over every HOA status × fee: $0 alone is never proof; a confirmed HOA contradicts even at $0', () => {
  const STATUS = [undefined, null, true, false];
  const FEES = [null, '', 0, '0', 125, '125.50'];
  // status → [fee…]
  const expected = {
    undefined: [undefined, undefined, undefined, undefined, 'no', 'no'],
    null: [undefined, undefined, undefined, undefined, 'no', 'no'],
    true: ['no', 'no', 'no', 'no', 'no', 'no'],
    false: [true, true, true, true, undefined, undefined],
  };
  for (const status of STATUS) FEES.forEach((fee, i) => {
    assert.equal(noHoaReading({ hasHoa: status, hoaFeeMonthly: fee }), expected[String(status)][i], `${status} / ${fee}`);
    assert.equal(homeFactAnswer({ hasHoa: status, hoaFeeMonthly: fee }, 'location:No HOA'), expected[String(status)][i]);
  });
});

/* ----------------------------- Contract and links ----------------------------- */

test('the fact-backed criteria and their Home Facts links', () => {
  assert.deepEqual(HOME_FACT_CRITERIA.centralAir, ['features:Central air', 'features:Central Air']);
  assert.deepEqual(HOME_FACT_LINKS.garage, ['hf-garageType', 'Garage']);
  assert.deepEqual(HOME_FACT_LINKS.finishedBasement, ['hf-basement', 'Basement']);
  assert.deepEqual(HOME_FACT_LINKS.walkoutBasement, ['hf-basement', 'Basement']);
  assert.deepEqual(HOME_FACT_LINKS.centralAir, ['hf-cooling', 'Cooling']);
  // Fenced Yard / Privacy Fence have no structured Home Fact, so neither is answered from one.
  for (const key of ['exterior:Fenced yard', 'exterior:Privacy Fencing', 'exterior:Unfenced Yard']) {
    assert.equal(homeFactAnswer({ garageType: 'attached', cooling: 'Central Air', hasHoa: false }, key), undefined, key);
  }
});

test('the migration adds one nullable column and changes only the Home Fact readings of the previous scorer', () => {
  const body = (sql) => sql.slice(sql.indexOf('begin;'));
  const next = body(MIGRATION);
  assert.match(next, /^begin;\n\nalter table public\.homes add column if not exists has_hoa boolean;\ngrant select \(has_hoa\) on public\.homes to authenticated;\ngrant insert \(has_hoa\) on public\.homes to authenticated;\ngrant update \(has_hoa\) on public\.homes to authenticated;\n/);
  assert.doesNotMatch(next, /\bdefault\b|update public\.homes|delete from|drop (?:table|column|policy)|disable row level security|grant [^\n]*\bto (?:anon|public)\b/i);
  // Strip the additions; what's left must be the previous body exactly, but for the fact readings.
  const stripped = next
    .replace(/\nalter table public\.homes add column if not exists has_hoa boolean;\n(?:grant [a-z]+ \(has_hoa\) on public\.homes to authenticated;\n){3}/, '')
    .replace(/\n {2}v_garage_pref text;\n {2}v_garage_spaces numeric;\n {2}v_garage_absent boolean;\n {2}v_garage_present boolean;/, '')
    .replace(/\n {4}-- Garage, read once per home[\s\S]*?v_garage_present := [^\n]+/, '');
  const factSection = /\n {12}v_fact := case[\s\S]*?\n {12}end;/;
  assert.equal(stripped.replace(factSection, '<FACTS>'), body(PREVIOUS).replace(factSection, '<FACTS>'));
  // Every other reading in the fact section is byte-identical.
  const readings = (sql) => sql.match(factSection)[0].split('\n').filter((line) => !/^\s*--/.test(line)).join('\n')
    .split(/\n(?= {14}when v_key)/).filter((part) => !/exterior:Garage|No HOA|Central/.test(part));
  assert.equal(readings(next).length, 6, 'the basement, laundry and primary-bedroom readings');
  assert.deepEqual(readings(next), readings(body(PREVIOUS)));
  for (const contract of [/security definer/, /set search_path = ''/, /stable\n/, /raise exception 'Authentication required'/, /can_access_search\(p_search_id, v_caller\)/,
    /revoke execute on function public\.resolve_cobuyer_compare_perspectives\(uuid, uuid\[\]\) from anon;/,
    /grant execute on function public\.resolve_cobuyer_compare_perspectives\(uuid, uuid\[\]\) to authenticated;/]) assert.match(MIGRATION, contract);
});

test('the SQL readings are the JS readings, clause for clause', () => {
  // Garage: same order of rules as garageReading.
  assert.match(MIGRATION, /when v_garage_absent and v_garage_present then null\n {16}when v_garage_absent then 0\n {16}when not v_garage_present then null\n {16}when v_garage_pref = 'any' then 1\n {16}when v_home\.garage_type = v_garage_pref then 1\n {16}when v_home\.garage_type in \('attached', 'detached'\) then 0\n/);
  assert.match(MIGRATION, /v_garage_absent := coalesce\(v_home\.garage_type = 'none', false\) or coalesce\(v_garage_spaces = 0, false\);/);
  assert.match(MIGRATION, /v_garage_present := coalesce\(v_home\.garage_type in \('attached', 'detached'\), false\) or coalesce\(v_garage_spaces > 0, false\);/);
  // HOA: status first, then the fee.
  assert.match(MIGRATION, /when v_home\.has_hoa then 0\n {16}when not v_home\.has_hoa then case when v_home\.hoa_fee_monthly > 0 then null else 1 end\n {16}when v_home\.hoa_fee_monthly > 0 then 0\n/);
  // Central Air: the same three patterns as centralAirReading.
  const source = read('src/lib/homeFactCriteria.js');
  assert.match(source, /const COOLING_NONE = \/\^\\s\*\(\?:none\|no\|no cooling\|no \(\?:central \)\?\(\?:air\|a\\\/c\|ac\|air conditioning\)\)\\s\*\$\/i;/);
  assert.match(MIGRATION, /v_home\.cooling ~\* '\^\\s\*\(none\|no\|no cooling\|no \(central \)\?\(air\|a\/c\|ac\|air conditioning\)\)\\s\*\$' then 0/);
  const doubt = 'no|not|none|without|evaporative|swamp|possibly|possible|maybe|unknown|unclear|unverified|tbd';
  assert.ok(source.includes(`const COOLING_DOUBT = /\\b(?:${doubt})\\b|\\?/i;`));
  assert.ok(MIGRATION.includes(`when v_home.cooling ~* '\\mcentral\\M' and v_home.cooling !~* '\\m(${doubt})\\M|\\?' then 1`));
});

test('Home Facts never reads an unaccepted suggestion: only shared home fields answer Match', () => {
  const home = { listingImport: { offeredFacts: [{ field: 'garageType', value: 'attached' }, { field: 'cooling', value: 'Central Air' }], fields: { garageType: 'attached', cooling: 'Central Air' } } };
  for (const key of ['exterior:Garage', 'features:Central air', 'location:No HOA']) assert.equal(homeFactAnswer(home, key, { garagePreference: 'attached' }), undefined, key);
  const code = read('src/lib/homeFactCriteria.js').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  assert.doesNotMatch(code, /listingImport|offeredFacts|supabase|fetch\(/);
});
