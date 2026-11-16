// Home Facts → Match: criteria a shared Home Fact answers exactly.
//
// A criterion's answer, in order:
//   1. the buyer's own explicit Yes (`true`) or No (`'no'`) in their checks —
//      always an override, and only ever written by the buyer;
//   2. otherwise, an exact reading of a shared Home Fact (below);
//   3. otherwise Unknown, which Match never counts.
// The fact reading is computed on every read and never written into anyone's
// checks, so a corrected Home Fact updates every buyer who hasn't overridden it.
// Historical `false` in checks is Unknown (it predates explicit No), so it is
// not an override.
//
// The database scorer (resolve_cobuyer_compare_perspectives, newest migration)
// carries the same table; test/home-fact-match-parity.test.js pins the two.
// Only exact readings: a partial, missing or ambiguous fact is Unknown, never No.
//
// Facts only ever come from the shared home fields (homes.*): what a person
// saved, or what the importer filled when the home was added. A suggestion a
// buyer hasn't used yet (listing_import.offeredFacts, pasted text) is never
// read here, so it can't answer anything until someone accepts it.
//
// Context: Garage depends on the buyer's own qualifier (Any / Attached /
// Detached, priorities.exterior.garagePreference). It stays ONE criterion,
// counted once; the qualifier only decides which garage type fulfils it.

// Criterion keys, under every label they are stored as (today's purchase label,
// and the rental / investment / pre-unification label).
export const HOME_FACT_CRITERIA = Object.freeze({
  garage: Object.freeze(['exterior:Garage']),
  finishedBasement: Object.freeze(['features:Finished basement', 'features:Finished Basement']),
  walkoutBasement: Object.freeze(['features:Walkout basement', 'features:Walkout Basement']),
  firstFloorLaundry: Object.freeze(['features:First-floor laundry', 'features:First-Floor Laundry']),
  secondFloorLaundry: Object.freeze(['features:Second-Floor Laundry']),
  firstFloorPrimary: Object.freeze(['features:First-Floor Primary']),
  noHoa: Object.freeze(['location:No HOA']),
  centralAir: Object.freeze(['features:Central air', 'features:Central Air']),
});

// The buyer's garage qualifier, as stored on their own priorities document.
// Absent or unrecognized is 'any' (the established default).
export const GARAGE_PREFERENCES = Object.freeze(['any', 'attached', 'detached']);
export function garagePreferenceOf(priorities) {
  const value = priorities?.exterior?.garagePreference;
  return GARAGE_PREFERENCES.includes(value) ? value : 'any';
}
// The per-buyer context a fact reading needs. Only Garage uses it.
export const homeFactContext = (priorities) => ({ garagePreference: garagePreferenceOf(priorities) });

const CONCEPT_BY_KEY = new Map(Object.entries(HOME_FACT_CRITERIA).flatMap(([concept, keys]) => keys.map((key) => [key, concept])));

export function homeFactConcept(key) {
  return CONCEPT_BY_KEY.get(key) || null;
}

// Garage spaces as a count: exactly one number is the count ('2', '3+', '2 car',
// '2.5'); 'none', 'no' or 'no garage' is 0; anything else is Unknown — blank,
// no number ('Attached'), several numbers ('1-2', '1.2.3', '2 + 1 carport') or a
// negation beside a number ('No garage, 2 carport'), so text is never misread as
// a count. The database scorer reads it with the same rules.
const GARAGE_NUMBER = /[0-9]+(?:\.[0-9]+)?|\.[0-9]+/g;
export function garageSpacesCount(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^(?:none|no|no garage)$/i.test(text)) return 0;
  const numbers = text.match(GARAGE_NUMBER) || [];
  if (numbers.length !== 1 || /\b(?:no|none|not|without)\b/i.test(text)) return null;
  return Number(numbers[0]);
}

const isSet = (value) => value !== null && value !== undefined && value !== '';

// Garage, from both garage facts (Garage type and Garage spaces):
//   explicit absence  type None, or 0 spaces (or 'none' / 'no garage');
//   explicit presence type Attached / Detached, or a count above 0.
// Both at once is a contradiction and answers nothing. Garage type holds one
// value; a listing naming both kinds is imported as Unknown type, so a home
// with both is never recorded as one kind only (rentcast canonicalGarageType).
//   Any       presence Yes · absence No · otherwise Unknown
//   Attached  type Attached Yes · type Detached No · absence No · otherwise Unknown
//   Detached  type Detached Yes · type Attached No · absence No · otherwise Unknown
// A count with no type says there is a garage, not which kind: Unknown for
// Attached / Detached, never No.
export function garageReading(home, garagePreference = 'any') {
  const type = home?.garageType;
  const spaces = garageSpacesCount(home?.garageSpaces);
  const absent = type === 'none' || spaces === 0;
  const kind = type === 'attached' || type === 'detached' ? type : null;
  const present = kind !== null || (spaces !== null && spaces > 0);
  if (absent && present) return undefined;
  if (absent) return 'no';
  if (!present) return undefined;
  const preference = GARAGE_PREFERENCES.includes(garagePreference) ? garagePreference : 'any';
  if (preference === 'any') return true;
  if (!kind) return undefined;
  return kind === preference ? true : 'no';
}

// Central Air, from the Cooling text. Yes when it names central air (or a
// provider's bare "Central") with no negation, hedge ("possibly", "maybe",
// "?") or evaporative / swamp cooler; No only when it says there is no cooling at all ("None", "No A/C",
// "No central air"). Window units, a mini-split, a heat pump or anything else
// is Unknown: those can sit beside central air, so they never mean No.
const COOLING_NONE = /^\s*(?:none|no|no cooling|no (?:central )?(?:air|a\/c|ac|air conditioning))\s*$/i;
const COOLING_CENTRAL = /\bcentral\b/i;
const COOLING_DOUBT = /\b(?:no|not|none|without|evaporative|swamp|possibly|possible|maybe|unknown|unclear|unverified|tbd)\b|\?/i;
export function centralAirReading(cooling) {
  if (cooling === null || cooling === undefined) return undefined;
  const text = String(cooling);
  if (!/\S/.test(text)) return undefined;
  if (COOLING_NONE.test(text)) return 'no';
  if (COOLING_CENTRAL.test(text) && !COOLING_DOUBT.test(text)) return true;
  return undefined;
}

// No HOA, from the confirmed HOA status (homes.has_hoa: true / false / null)
// and the monthly fee:
//   status Yes                Has an HOA: No (even with a $0 fee);
//   status No, fee above $0   the two disagree: Unknown;
//   status No                 No HOA: Yes;
//   status Unknown            a fee above $0 is No; $0 or blank is Unknown —
//                             a $0 fee alone never proves there's no HOA.
export function noHoaReading(home) {
  const fee = isSet(home?.hoaFeeMonthly) ? Number(home.hoaFeeMonthly) : null;
  const charged = fee !== null && Number.isFinite(fee) && fee > 0;
  if (home?.hasHoa === true) return 'no';
  if (home?.hasHoa === false) return charged ? undefined : true;
  return charged ? 'no' : undefined;
}

// One basement field says there is none while the other describes a basement.
const BASEMENT_CONDITIONS = new Set(['finished', 'unfinished', 'partially_finished']);
const BASEMENT_STYLES = new Set(['traditional', 'gardenview', 'walkout']);
function basementContradiction(home) {
  return (home?.basementStyle === 'none' && BASEMENT_CONDITIONS.has(home?.basementCondition))
    || (home?.basementCondition === 'none' && BASEMENT_STYLES.has(home?.basementStyle));
}

// The fact-based answer for one concept: true (Yes), 'no' (No) or undefined.
function readConcept(concept, home, context = {}) {
  const condition = home?.basementCondition;
  const style = home?.basementStyle;
  switch (concept) {
    case 'garage': return garageReading(home, context.garagePreference);
    // "None" in either basement field means there is no basement, unless the
    // other field describes one (a contradiction, which answers nothing).
    // Unfinished is not finished either way; partially finished is neither.
    case 'finishedBasement': {
      if (condition === 'unfinished') return 'no';
      if (basementContradiction(home)) return undefined;
      if (condition === 'finished') return true;
      if (condition === 'none' || style === 'none') return 'no';
      return undefined;
    }
    // Only Walkout says Yes, and only "no basement" says No: Traditional or
    // Gardenview does not establish that there is no walkout.
    case 'walkoutBasement': {
      if (basementContradiction(home)) return undefined;
      if (style === 'walkout') return true;
      if (style === 'none' || condition === 'none') return 'no';
      return undefined;
    }
    // Laundry Location records one location, which says where the laundry is,
    // not that there is none elsewhere: it only ever answers Yes.
    case 'firstFloorLaundry': return home?.laundryLocation === 'first_floor' ? true : undefined;
    case 'secondFloorLaundry': return home?.laundryLocation === 'second_floor' ? true : undefined;
    case 'firstFloorPrimary': {
      const location = home?.primaryBedroomLocation;
      return location === 'Main Floor' ? true : location === 'Upstairs' ? 'no' : undefined;
    }
    case 'noHoa': return noHoaReading(home);
    case 'centralAir': return centralAirReading(home?.cooling);
    default: return undefined;
  }
}

// `context` is homeFactContext(priorities): the buyer's own garage qualifier.
// Without it Garage reads as Any, exactly as before the qualifier counted.
export function homeFactAnswer(home, key, context = {}) {
  const concept = homeFactConcept(key);
  return concept ? readConcept(concept, home, context) : undefined;
}

/**
 * The answer Match uses for a check criterion, and where it came from.
 * `checks` are the buyer's own checks, already alias-folded.
 * @returns {{ value: true|'no'|undefined, source: 'answer'|'home_facts'|null, fact: true|'no'|undefined }}
 */
export function resolveCriterionAnswer(home, key, checks = {}, context = {}) {
  const fact = homeFactAnswer(home, key, context);
  const own = checks?.[key];
  if (own === true || own === 'no') return { value: own, source: 'answer', fact };
  if (fact !== undefined) return { value: fact, source: 'home_facts', fact };
  return { value: undefined, source: null, fact };
}

// Where each concept's fact lives on Home Facts: [field id, short label].
export const HOME_FACT_LINKS = Object.freeze({
  garage: ['hf-garageType', 'Garage'],
  finishedBasement: ['hf-basement', 'Basement'],
  walkoutBasement: ['hf-basement', 'Basement'],
  firstFloorLaundry: ['hf-laundryLocation', 'Laundry'],
  secondFloorLaundry: ['hf-laundryLocation', 'Laundry'],
  firstFloorPrimary: ['hf-layout', 'Layout'],
  noHoa: ['hf-hoaFeeMonthly', 'HOA'],
  centralAir: ['hf-cooling', 'Cooling'],
});
