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
});

const CONCEPT_BY_KEY = new Map(Object.entries(HOME_FACT_CRITERIA).flatMap(([concept, keys]) => keys.map((key) => [key, concept])));

export function homeFactConcept(key) {
  return CONCEPT_BY_KEY.get(key) || null;
}

// Garage spaces as a count: digits read as the number ('3+' is 3); 'none', 'no'
// or 'no garage' is 0; anything else (blank, 'Attached', '1.2.3') is Unknown.
// The database scorer reads it with the same rules.
export function garageSpacesCount(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^(?:none|no|no garage)$/i.test(text)) return 0;
  const digits = text.replace(/[^0-9.]/g, '');
  if (!/^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/.test(digits)) return null;
  return Number(digits);
}

const isSet = (value) => value !== null && value !== undefined && value !== '';

// One basement field says there is none while the other describes a basement.
const BASEMENT_CONDITIONS = new Set(['finished', 'unfinished', 'partially_finished']);
const BASEMENT_STYLES = new Set(['traditional', 'gardenview', 'walkout']);
function basementContradiction(home) {
  return (home?.basementStyle === 'none' && BASEMENT_CONDITIONS.has(home?.basementCondition))
    || (home?.basementCondition === 'none' && BASEMENT_STYLES.has(home?.basementStyle));
}

// The fact-based answer for one concept: true (Yes), 'no' (No) or undefined.
function readConcept(concept, home) {
  const condition = home?.basementCondition;
  const style = home?.basementStyle;
  switch (concept) {
    case 'garage': {
      const spaces = garageSpacesCount(home?.garageSpaces);
      return spaces === null ? undefined : spaces > 0 ? true : 'no';
    }
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
    // A monthly fee above $0 means there is an HOA. A $0 fee does not prove
    // there isn't one, and no fee recorded is Unknown.
    case 'noHoa': {
      if (!isSet(home?.hoaFeeMonthly)) return undefined;
      const fee = Number(home.hoaFeeMonthly);
      return Number.isFinite(fee) && fee > 0 ? 'no' : undefined;
    }
    default: return undefined;
  }
}

export function homeFactAnswer(home, key) {
  const concept = homeFactConcept(key);
  return concept ? readConcept(concept, home) : undefined;
}

/**
 * The answer Match uses for a check criterion, and where it came from.
 * `checks` are the buyer's own checks, already alias-folded.
 * @returns {{ value: true|'no'|undefined, source: 'answer'|'home_facts'|null, fact: true|'no'|undefined }}
 */
export function resolveCriterionAnswer(home, key, checks = {}) {
  const fact = homeFactAnswer(home, key);
  const own = checks?.[key];
  if (own === true || own === 'no') return { value: own, source: 'answer', fact };
  if (fact !== undefined) return { value: fact, source: 'home_facts', fact };
  return { value: undefined, source: null, fact };
}

// Where each concept's fact lives on Home Facts: [field id, short label].
export const HOME_FACT_LINKS = Object.freeze({
  garage: ['hf-garageSpaces', 'Garage'],
  finishedBasement: ['hf-basementCondition', 'Basement'],
  walkoutBasement: ['hf-basementStyle', 'Basement'],
  firstFloorLaundry: ['hf-laundryLocation', 'Laundry'],
  secondFloorLaundry: ['hf-laundryLocation', 'Laundry'],
  firstFloorPrimary: ['hf-layout', 'Layout'],
  noHoa: ['hf-hoaFeeMonthly', 'HOA'],
});
