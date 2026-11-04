// Suggested Match answers from listing text a buyer pasted. Pure: no network,
// no storage. Nothing here writes an answer; a buyer confirms each suggestion
// (applyListingAnswer) before it becomes their own Yes or No.
//
// Two steps:
//   1. classifyListingText(text) reads the text once, independent of anyone's
//      priorities, and returns the explicit evidence it found per concept
//      ("fireplace": yes / no, with the sentence that says so). This is listing
//      evidence, so it can be kept on the shared import snapshot.
//   2. suggestListingAnswers(text, priorities, checks) maps that evidence onto
//      the viewing buyer's own selected check criteria, under exactly the key
//      Match reads, and leaves out anything they already answered.
//
// The text decides only when it is explicit. Per sentence:
//   - affirmative ("Private in-ground pool")        → suggest Yes
//   - explicit negation ("No fireplace", "Does not
//     have a finished basement", "Unfenced yard")   → suggest No
//   - hedged, hypothetical or optional ("Room for a
//     pool", "Optional first-floor guest suite",
//     "Decorative fireplace only", "Partially
//     fenced")                                      → nothing (Unknown)
//   - shared or community ("Community pool")         → nothing (Unknown)
//   - Yes and No both stated                         → nothing (conflict)
// A concept the text never mentions is Unknown, never No.

import { foldLegacyCheckAliases, getItemlistCategories, isExperientialCriterion } from './constants.js';
import { SHARED_BOOLEAN_FACT_FIELDS, visibleOrderedItems } from './matching.js';

const FLOOR1 = '(?:first|1st|main|ground|entry)[ -]?(?:floor|level)';
const UPPER = '(?:second|2nd|upper)[ -]?(?:floor|level)';
// "basement" naming a room or unit in it, not the basement itself.
const NOT_BASEMENT_ITSELF = '(?![ -](?:bedroom|bath|bathroom|apartment|unit|entrance|access|door|window|stairs|storage|laundry))';
const BASEMENT = `(?:basement|lower[ -]level)${NOT_BASEMENT_ITSELF}`;
const PRIMARY = "(?:primary|master|owner'?s?)(?: bed(?:room)?| suite| retreat| bedroom suite)?";
// Up to a few words between a room and its floor ("primary suite with private
// bath on the main level"), never across "and" ("primary suite and laundry on
// the main level" doesn't place the suite).
const GAP = '(?:(?!\\band\\b)[^.,;\\n]){0,40}?';
const BEDROOM = '(?:bedroom(?: suite)?|guest (?:bed)?room|guest suite)s?';
const YARD = '(?:back ?yard|yard|rear yard|front yard|side yard|lot)';
const LAUNDRY = '\\blaundry(?: room| area| closet)?(?: is)?(?: located)?';
const ELSEWHERE = `(?:basement|lower[ -]level|${UPPER}|upstairs)`;
const rx = (source) => new RegExp(source, 'i');

// Each concept: `yes` patterns state it; `no` patterns state its absence
// outright; `mention` is any reference, used to read a negation right before it
// ("no pool", "does not have a finished basement"). `shareable` concepts can be
// a community amenity, so community / shared wording makes them Unknown.
export const LISTING_TEXT_CONCEPTS = Object.freeze({
  fireplace: { yesLabel: 'Fireplace', noLabel: 'No fireplace', shareable: true,
    yes: [/\bfireplaces?\b/i], mention: /\bfireplaces?\b/i, blockers: [/\boutdoor\b/i] },
  centralAir: { yesLabel: 'Central air', noLabel: 'No central air',
    yes: [/\bcentral (?:air|a\/?c|air conditioning|cooling)\b/i],
    no: [/\bwindow (?:a\/?c )?units? only\b/i],
    mention: /\b(?:central (?:air|a\/?c|air conditioning|cooling)|air conditioning|a\/c)\b/i },
  homeOffice: { yesLabel: 'Home office', noLabel: 'No home office',
    yes: [/\bhome office\b/i, /\b(?:dedicated|private|separate) (?:home )?(?:office|study)\b/i],
    mention: /\b(?:home office|office|study)\b/i, blockers: [/\bflex\b/i, /\bused as\b/i] },
  primaryEnsuite: { yesLabel: 'Primary ensuite', noLabel: 'No primary ensuite',
    yes: [/\b(?:primary|master|owner'?s?)\b[^.,;\n]{0,40}?\b(?:en[ -]?suite|private (?:full )?bath(?:room)?|attached (?:full )?bath(?:room)?)\b/i],
    mention: /\ben[ -]?suite\b/i, blockers: [/\bjack[ -]and[ -]jill\b/i, /\bshared bath/i, /\bhall bath/i] },
  firstFloorLaundry: { yesLabel: 'First-floor laundry', noLabel: 'Laundry not on the first floor', shareable: true,
    yes: [rx(`\\b${FLOOR1} laundry\\b`), rx(`${LAUNDRY} on (?:the )?${FLOOR1}\\b`)],
    no: [rx(`${LAUNDRY} (?:in|on) (?:the )?${ELSEWHERE}\\b`), rx(`\\b${ELSEWHERE} laundry\\b`)],
    mention: rx(`\\b${FLOOR1} laundry\\b`) },
  secondFloorLaundry: { yesLabel: 'Second-floor laundry', noLabel: 'No second-floor laundry', shareable: true,
    yes: [rx(`\\b(?:${UPPER}|upstairs) laundry\\b`), rx(`${LAUNDRY} (?:on (?:the )?${UPPER}|upstairs)\\b`)],
    mention: rx(`\\b(?:${UPPER}|upstairs) laundry\\b`) },
  firstFloorBedroom: { yesLabel: 'Bedroom on the main level', noLabel: 'No bedroom on the main level',
    yes: [rx(`\\b${BEDROOM}${GAP} on (?:the )?${FLOOR1}\\b`), rx(`\\b${FLOOR1} ${BEDROOM}\\b`),
      rx(`\\b${PRIMARY}${GAP} on (?:the )?${FLOOR1}\\b`), rx(`\\b${FLOOR1} ${PRIMARY}\\b`)],
    no: [rx(`\\ball(?: \\w+)? bedrooms(?: are)? (?:located )?(?:upstairs|on (?:the )?${UPPER})\\b`)],
    mention: rx(`\\b${FLOOR1} ${BEDROOM}\\b`), blockers: [/\bflex\b/i, /\bused as\b/i] },
  firstFloorPrimary: { yesLabel: 'Primary bedroom on the main level', noLabel: 'Primary bedroom not on the main level',
    yes: [rx(`\\b${PRIMARY}${GAP} on (?:the )?${FLOOR1}\\b`), rx(`\\b${FLOOR1} ${PRIMARY}\\b`)],
    no: [rx(`\\b${PRIMARY}(?: is)? (?:located )?(?:upstairs|on (?:the )?${UPPER})\\b`),
      rx(`\\ball(?: \\w+)? bedrooms(?: are)? (?:located )?(?:upstairs|on (?:the )?${UPPER})\\b`)],
    mention: rx(`\\b${FLOOR1} ${PRIMARY}\\b`) },
  guestBedroom: { yesLabel: 'Guest bedroom', noLabel: 'No guest bedroom',
    yes: [/\bguest (?:bed)?room\b/i, /\bguest suite\b/i], mention: /\bguest (?:bed)?room\b|\bguest suite\b/i,
    blockers: [/\bflex\b/i, /\bused as\b/i] },
  guestSuite: { yesLabel: 'Guest or in-law suite', noLabel: 'No guest or in-law suite',
    yes: [/\bguest suite\b/i, /\b(?:mother[ -])?in[ -]law (?:suite|apartment|quarters|unit)\b/i, /\bguest (?:quarters|apartment)\b/i],
    mention: /\bguest suite\b|\bin[ -]law (?:suite|apartment|quarters|unit)\b/i, blockers: [/\bflex\b/i, /\bused as\b/i] },
  finishedBasement: { yesLabel: 'Finished basement', noLabel: 'Basement not finished',
    yes: [/\bfinished (?:basement|lower[ -]level)\b/i, /\bbasement(?: is)? (?:fully |completely )?finished\b/i, /\bfinished walk[ -]?out (?:basement|lower[ -]level)\b/i],
    no: [/\bunfinished (?:basement|lower[ -]level)\b/i, /\bbasement(?: is)? unfinished\b/i, /\bbasement (?:is not|isn't|is not yet|isn't yet) finished\b/i],
    mention: rx(`\\b(?:finished )?${BASEMENT}`), blockers: [/\bcrawl ?space\b/i] },
  walkoutBasement: { yesLabel: 'Walkout basement', noLabel: 'No walkout basement',
    yes: [/\bwalk[ -]?out (?:basement|lower[ -]level)\b/i, /\b(?:basement|lower[ -]level)[^.,;\n]{0,30}\bwalks? out\b/i,
      /\bbasement[^.,;\n]{0,35}\b(?:exterior (?:door|entrance|egress)|separate (?:exterior )?entrance)\b/i],
    mention: rx(`\\bwalk[ -]?out\\b|\\b${BASEMENT}`), blockers: [/\bcrawl ?space\b/i] },
  basement: { yesLabel: 'Basement', noLabel: 'No basement',
    yes: [rx(`\\bbasement${NOT_BASEMENT_ITSELF}`)], mention: rx(`\\bbasement${NOT_BASEMENT_ITSELF}`),
    blockers: [/\bcrawl ?space\b/i, /\bunit\b/i, /\bapartment\b/i, /\bstorage\b/i] },
  walkInPantry: { yesLabel: 'Walk-in pantry', noLabel: 'No pantry',
    yes: [/\bwalk[ -]?in pantry\b/i], mention: /\bpantry\b/i },
  pantry: { yesLabel: 'Pantry', noLabel: 'No pantry',
    yes: [/\b(?:walk[ -]?in|kitchen|butler'?s?) pantry\b/i], mention: /\bpantry\b/i },
  mudroom: { yesLabel: 'Mudroom', noLabel: 'No mudroom', yes: [/\bmud ?room\b/i], mention: /\bmud ?room\b/i },
  walkInCloset: { yesLabel: 'Walk-in closet', noLabel: 'No walk-in closet',
    yes: [/\bwalk[ -]?in closets?\b/i], mention: /\bwalk[ -]?in closets?\b/i },
  dishwasher: { yesLabel: 'Dishwasher', noLabel: 'No dishwasher',
    yes: [/\bdishwasher\b/i], no: [/\bdishwasher(?: is)? (?:not included|excluded)\b/i], mention: /\bdishwasher\b/i },
  additionalLivingSpace: { yesLabel: 'Additional living space', noLabel: 'No additional living space',
    yes: [/\b(?:bonus|family|recreation|rec) room\b/i, /\bsecond living (?:room|area|space)\b/i],
    no: [/\bno additional living space\b/i], mention: /\badditional living space\b/i },
  separateUtilities: { yesLabel: 'Separately metered utilities', noLabel: 'Utilities not separately metered',
    yes: [/\b(?:separately metered utilities|separate utility meters|tenants? pay(?:s)? (?:their )?own utilities)\b/i],
    no: [/\butilities (?:are )?not separately metered\b/i] },
  patioDeck: { yesLabel: 'Patio or deck', noLabel: 'No patio or deck', shareable: true,
    yes: [/\b(?:deck|patio|terrace)s?\b/i], mention: /\b(?:deck|patio|terrace|outdoor space)s?\b/i,
    blockers: [/\bpatio (?:doors?|slider|home|furniture)\b/i] },
  pool: { yesLabel: 'Private pool', noLabel: 'No pool', shareable: true,
    // A bare "pool" is often a community amenity, so Yes needs it to be the home's own.
    yes: [/\b(?:private|in-?ground|above-?ground|backyard|heated|salt-?water|plunge|own) (?:swimming )?pool\b/i],
    mention: /\b(?:swimming )?pool\b(?! table| hall)/i, blockers: [/\bpool table\b/i, /\bcar ?pool\b/i] },
  fencedYard: { yesLabel: 'Fenced yard', noLabel: 'Yard not fenced', shareable: true,
    yes: [rx(`\\b(?:(?:fully|completely|entirely|privacy)[ -])?fenced(?:[ -]in)? ${YARD}\\b`), rx(`\\b${YARD}(?: is)? (?:fully |completely |entirely )?fenced\\b`)],
    no: [/\bunfenced\b/i, /\b(?:back ?yard|yard)(?: is)? not fenced\b/i],
    mention: /\bfenc(?:e|ed|ing)\b/i, blockers: [/\b(?:invisible|electric|underground|wireless) (?:pet )?fenc/i] },
  privacyFence: { yesLabel: 'Privacy fence', noLabel: 'No privacy fence', shareable: true,
    yes: [/\bprivacy[ -]fenc(?:e|ed|ing)\b/i], mention: /\bprivacy[ -]fenc(?:e|ed|ing)\b/i },
  attachedGarage: { yesLabel: 'Attached garage', noLabel: 'No attached garage',
    yes: [/\battached (?:\d[ -]car )?garage\b/i, /\b\d[ -]car attached garage\b/i], no: [/\bdetached garage only\b/i],
    mention: /\bgarage\b(?! door| opener| sale)/i },
  driveway: { yesLabel: 'Driveway or off-street parking', noLabel: 'Street parking only',
    yes: [/\bdriveway\b/i, /\b(?:private|assigned|deeded|dedicated) off[ -]street parking\b/i],
    no: [/\bstreet parking only\b/i, /\bonly street parking\b/i], mention: /\bdriveway\b|\boff[ -]street parking\b/i },
  parking: { yesLabel: 'Parking included', noLabel: 'No parking',
    yes: [/\b(?:included|assigned|on[ -]?site|deeded|reserved|dedicated|covered) parking\b/i, /\bparking (?:is )?included\b/i],
    mention: /\bparking\b/i, blockers: [/\bnearby\b/i] },
  elevator: { yesLabel: 'Elevator', noLabel: 'No elevator (walk-up)',
    yes: [/\belevators?\b/i], no: [/\bwalk[ -]?up\b/i], mention: /\belevators?\b/i },
});

// Which concept answers a selected criterion. Labels are compared without case,
// so the current canonical label ('Fenced yard'), its older purchase alias
// ('Fenced Yard') and the rental / investment catalog label all map to the same
// concept; the suggestion is keyed by the label the buyer actually selected.
// `invert` turns the concept's answer around ('Unfenced Yard').
const CRITERION_CONCEPTS = Object.freeze({
  features: {
    fireplace: 'fireplace', 'central air': 'centralAir', 'home office': 'homeOffice', 'primary ensuite': 'primaryEnsuite',
    'first-floor laundry': 'firstFloorLaundry', 'second-floor laundry': 'secondFloorLaundry',
    'first-floor bedroom': 'firstFloorBedroom', 'first-floor primary': 'firstFloorPrimary',
    'guest bedroom': 'guestBedroom', 'guest / in-law suite': 'guestSuite', 'guest suite': 'guestSuite',
    'finished basement': 'finishedBasement', 'walkout basement': 'walkoutBasement', basement: 'basement',
    'walk-in pantry': 'walkInPantry', pantry: 'pantry', mudroom: 'mudroom', 'walk-in closet': 'walkInCloset',
    dishwasher: 'dishwasher', 'additional living space': 'additionalLivingSpace', 'separate utilities': 'separateUtilities',
  },
  exterior: {
    'patio / deck': 'patioDeck', 'patio / deck / outdoor living': 'patioDeck', pool: 'pool',
    'fenced yard': 'fencedYard', 'privacy fencing': 'privacyFence', 'unfenced yard': { concept: 'fencedYard', invert: true },
    'attached garage': 'attachedGarage', 'driveway / off-street parking': 'driveway', parking: 'parking', elevator: 'elevator',
  },
});

export function criterionConcept(categoryKey, label) {
  const entry = CRITERION_CONCEPTS[categoryKey]?.[String(label || '').trim().toLowerCase()];
  if (!entry) return null;
  return typeof entry === 'string' ? { concept: entry, invert: false } : entry;
}

/* -------------------------------- Reading text ------------------------------- */

// Wording that makes a statement hypothetical, optional, uncertain, partial,
// past, or not functional. Any of it near a mention leaves that mention Unknown.
const HEDGE = /\b(?:could|would|might|may (?:be|have|need|include|require|not)|can be|can accommodate|possible|possibly|possibility|potential(?:ly)?|option(?:al|s)?|opportunity|room for|space for|ready for|plans? (?:for|to)|planned|proposed|future|imagine|envision|dream|bring your|make it your own|if desired|with approval|subject to|allowed|permitted|buyer to verify|verify|unverified|reportedly|believed|appears?|seems?|as[ -]is|decorative|non[ -]?functional|inoperable|non[ -]?working|sealed|faux|cosmetic|partial(?:ly)?|partly|semi[ -]|rough(?:ed)?[ -]in|stubbed|plumbed for|pre[ -]?wired for|hook[ -]?ups?|convert(?:ed|ible)?|conversion|former(?:ly)?|previously|used to|removed|virtual(?:ly)? staged|rendering|flex)\b|\b(?:fireplace|pool|fence|deck|patio|basement|office|laundry|bath(?:room)?)[ -]ready\b/i;
// Community or shared wording: the amenity may not be the home's own. Amenity
// words reach across the whole sentence ("Amenities: clubhouse, heated pool");
// proximity words only within their own clause ("Quiet neighborhood, fenced
// yard" still says the yard is fenced).
const SHARED = /\b(?:community|shared|common area|subdivision|hoa|association|clubhouse|amenit(?:y|ies)|residents?|complex)\b/i;
const NEARBY = /\b(?:neighborhood|nearby|access to|walk(?:ing)? (?:distance )?to|close to|steps (?:from|to|away)|across the street|down the street|minutes? (?:from|to|away))\b/i;
const NEGATION = /\b(?:no|not|never|without|lacks?|lacking|none|nor|neither)\b|n't\b/i;
// A negation that governs the mention right after it: "no fireplace", "does not
// have a finished basement", "without a fenced yard". Only connecting words may
// sit between them, so "no carpet in the basement" is not "no basement".
const FILLER = "(?:a|an|any|the|have|has|had|include|includes|included|feature|features|offer|offers|come|comes|with|there|is|are|been|real|actual|working|functional|dedicated|separate|private|true|its|own|primary|master|owner'?s?)";
const TIGHT_NEGATION = new RegExp(`(?:\\bno|\\bnot|n't|\\bwithout|\\blacks?|\\blacking|\\bnever|\\bnor)(?:\\s+${FILLER})*\\s+$`, 'i');
// "Fireplace: none", "Pool - no", "Fireplaces: 0".
const TRAILING_NEGATION = /^\s*(?:[:\-–—]\s*)?(?:none|no|n\/a|not included|not available|0)\b/i;
// Contrast words end the reach of a negation or hedge ("No HOA, but a private pool").
const SCOPE_BREAK = /\b(?:but|however|although|though|whereas|while|except)\b/i;
const CLAUSE_BREAK = /[,:()–—]|\s-\s/;

function sentenceScopes(text) {
  return String(text || '')
    .split(/\n+|(?<=[.!?])\s+|[;•·|]/)
    .flatMap((sentence) => sentence.split(SCOPE_BREAK))
    .map((scope) => scope.trim())
    .filter(Boolean);
}

// The rest of the clause a match sits in ("Fireplace is decorative only"), and
// the part of its clause before it.
function clauseBefore(scope, start) {
  const before = scope.slice(0, start);
  const parts = before.split(new RegExp(CLAUSE_BREAK.source, 'g'));
  return parts[parts.length - 1];
}

function clauseAfter(scope, end) {
  const rest = scope.slice(end);
  const cut = rest.search(CLAUSE_BREAK);
  return cut < 0 ? rest : rest.slice(0, cut);
}

function matches(pattern, scope) {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...scope.matchAll(global)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

// Is a mention at [start, end) made uncertain by its surroundings? The text
// before it anywhere in the scope, or after it in the same clause.
function hedged(scope, { start, end }, rule) {
  const before = scope.slice(0, start);
  const after = clauseAfter(scope, end);
  const around = `${clauseBefore(scope, start)}${scope.slice(start, end)}${after}`;
  if (HEDGE.test(before) || HEDGE.test(after) || HEDGE.test(scope.slice(start, end))) return true;
  if (rule.shareable && (SHARED.test(before) || SHARED.test(after) || NEARBY.test(clauseBefore(scope, start)) || NEARBY.test(after))) return true;
  return (rule.blockers || []).some((pattern) => pattern.test(around));
}

function readScope(scope, rule) {
  const found = { yes: false, no: false };
  for (const pattern of rule.no || []) {
    if (matches(pattern, scope).some((m) => !hedged(scope, m, rule))) found.no = true;
  }
  if (rule.mention) {
    for (const m of matches(rule.mention, scope)) {
      if (hedged(scope, m, rule)) continue;
      if (TIGHT_NEGATION.test(scope.slice(0, m.start)) || TRAILING_NEGATION.test(scope.slice(m.end))) found.no = true;
    }
  }
  for (const pattern of rule.yes) {
    for (const m of matches(pattern, scope)) {
      // Any negation earlier in the sentence, or later in the clause, makes the
      // statement unclear ("No HOA, finished basement"; "Fireplace does not work").
      if (NEGATION.test(scope.slice(0, m.start)) || NEGATION.test(clauseAfter(scope, m.end)) || TRAILING_NEGATION.test(scope.slice(m.end))) continue;
      if (hedged(scope, m, rule)) continue;
      found.yes = true;
    }
  }
  return found;
}

function excerpt(scope) {
  const text = scope.replace(/\s+/g, ' ').trim();
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/**
 * Explicit evidence per concept, independent of anyone's priorities.
 * @returns {{ concept: string, answer: 'yes'|'no'|'conflict', evidence: string[] }[]}
 */
export function classifyListingText(text) {
  const scopes = sentenceScopes(text);
  return Object.entries(LISTING_TEXT_CONCEPTS).map(([concept, rule]) => {
    const yes = []; const no = [];
    for (const scope of scopes) {
      const found = readScope(scope, rule);
      if (found.yes && !found.no) yes.push(excerpt(scope));
      else if (found.no && !found.yes) no.push(excerpt(scope));
      else if (found.yes && found.no) { yes.push(excerpt(scope)); no.push(excerpt(scope)); }
    }
    if (!yes.length && !no.length) return null;
    const answer = yes.length && no.length ? 'conflict' : yes.length ? 'yes' : 'no';
    return { concept, answer, evidence: [...new Set(answer === 'no' ? no : answer === 'yes' ? yes : [...yes, ...no])] };
  }).filter(Boolean);
}

/* ------------------------------ Buyer suggestions ----------------------------- */

const PARKING_KEYS = new Set(['exterior:Parking', 'exterior:Driveway / Off-Street Parking']);

function stableId(parts) {
  let hash = 2166136261;
  for (const char of parts.join('|')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `listing-answer-${(hash >>> 0).toString(36)}`;
}

// A buyer's existing Yes or No under this key (or an older alias of it).
// Historical `false` is Unknown, exactly as Match reads it.
export function hasRecordedAnswer(checks, key, searchType) {
  const value = foldLegacyCheckAliases(checks || {}, searchType)[key];
  return value === true || value === 'no';
}

// The viewing buyer's selected criteria whose answer is a personal check:
// selected, check-kind, not in-person, not a shared home fact (Pets, Utilities,
// In-Unit Laundry), not Garage (scored from garage spaces), never a criterion
// the buyer typed themselves.
function personalCheckCriteria(priorities) {
  return getItemlistCategories(priorities?.searchType).flatMap((category) => visibleOrderedItems(category, priorities)
    .filter((item) => item.kind === 'check' && item.source !== 'custom' && !isExperientialCriterion(category.key, item.label))
    .map((item) => ({ categoryKey: category.key, label: item.label, key: `${category.key}:${item.label}` }))
    .filter(({ key }) => !SHARED_BOOLEAN_FACT_FIELDS[key] && key !== 'exterior:Garage'));
}

/**
 * Suggested answers for the viewing buyer. Never includes a criterion they
 * already answered, didn't select, or that Match reads from a shared fact.
 * @returns {{ id, key, categoryKey, label, concept, answer: true|'no', evidence: string,
 *   sourceType: 'listing_text', sourceProvider: 'user_paste' }[]}
 */
export function suggestListingAnswers(text, priorities, checks = {}) {
  if (!priorities || !String(text || '').trim()) return [];
  const evidence = new Map(classifyListingText(text).filter((item) => item.answer !== 'conflict').map((item) => [item.concept, item]));
  const suggestions = [];
  for (const criterion of personalCheckCriteria(priorities)) {
    const mapping = criterionConcept(criterion.categoryKey, criterion.label);
    const found = mapping && evidence.get(mapping.concept);
    if (!found || hasRecordedAnswer(checks, criterion.key, priorities.searchType)) continue;
    const yes = (found.answer === 'yes') !== mapping.invert;
    suggestions.push({
      id: stableId([criterion.key, yes ? 'yes' : 'no', found.evidence[0]]),
      key: criterion.key, categoryKey: criterion.categoryKey, label: criterion.label, concept: mapping.concept,
      answer: yes ? true : 'no', evidence: found.evidence[0],
      sourceType: 'listing_text', sourceProvider: 'user_paste',
    });
  }
  // A garage or driveway is parking: text that mentions one never suggests No
  // for Parking or Off-street parking ("2-car garage. Street parking only.").
  const hasParkingStructure = sentenceScopes(text).some((scope) => (/\bgarage\b/i.test(scope) && !/\b(?:no|without(?: a)?) garage\b/i.test(scope))
    || (/\bdriveway\b/i.test(scope) && !/\b(?:no|without(?: a)?) driveway\b/i.test(scope)));
  return suggestions.filter((item) => !(hasParkingStructure && PARKING_KEYS.has(item.key) && item.answer === 'no'));
}

/**
 * The buyer confirmed a suggestion: their own checks with that answer, or the
 * same checks unchanged when they already hold an answer for it. Only this
 * buyer's checks object is read or returned; nothing else is touched.
 */
export function applyListingAnswer(checks, suggestion, searchType) {
  const current = checks || {};
  if (!suggestion?.key || (suggestion.answer !== true && suggestion.answer !== 'no')) return current;
  if (hasRecordedAnswer(current, suggestion.key, searchType)) return current;
  return { ...current, [suggestion.key]: suggestion.answer };
}

// Undo a confirmation made in this session: only while the answer is still the
// one the suggestion wrote, so a later change by the buyer is never reverted.
export function undoListingAnswer(checks, suggestion) {
  const current = checks || {};
  if (!suggestion?.key || current[suggestion.key] !== suggestion.answer) return current;
  const next = { ...current };
  delete next[suggestion.key];
  return next;
}

/**
 * The listing evidence to keep on the shared import snapshot
 * (homes.listing_import.descriptionFeatures). Derived from the text alone, so it
 * says nothing about which criteria any buyer selected or how they answered.
 */
export function listingTextEvidence(text) {
  return classifyListingText(text).filter((item) => item.answer !== 'conflict').map((item) => {
    const rule = LISTING_TEXT_CONCEPTS[item.concept];
    return {
      id: `listing-text-${item.concept}`,
      label: item.answer === 'yes' ? rule.yesLabel : rule.noLabel,
      concept: item.concept,
      stated: item.answer,
      sourceType: 'listing_text',
      sourceProvider: 'user_paste',
      evidence: item.evidence[0],
    };
  });
}

/**
 * Rerunning extraction after the buyer confirmed suggestions in this session.
 * `confirmed` maps a check key to the answer a Confirm wrote ({ key: true|'no' });
 * it holds only answers that came from a suggestion and that the buyer hasn't
 * since changed by hand (an entry whose current value differs is ignored).
 *
 * Each confirmed answer is checked against the new text:
 *   - the new text suggests the same answer → kept, shown as confirmed (Undo works)
 *   - it suggests the other answer, a conflict, or says nothing → cleared back to
 *     Unknown and reported in `cleared`; any new suggestion is shown for review
 * Manual answers (anything not in `confirmed`) and every other check are left
 * exactly as they are, and still never receive a suggestion.
 * @returns {{ suggestions, checks, confirmed, decisions, cleared: string[] }}
 */
export function resuggestListingAnswers(text, priorities, checks = {}, confirmed = {}) {
  const current = checks || {};
  const live = Object.entries(confirmed || {}).filter(([key, answer]) => current[key] === answer);
  // Re-read the text as if the suggestion-derived answers were still Unknown.
  const base = { ...current };
  for (const [key] of live) delete base[key];
  const suggestions = suggestListingAnswers(text, priorities, base);
  const nextChecks = { ...base };
  const nextConfirmed = {};
  const decisions = {};
  const cleared = [];
  for (const [key, answer] of live) {
    const same = suggestions.find((item) => item.key === key && item.answer === answer);
    if (same) {
      nextChecks[key] = answer;
      nextConfirmed[key] = answer;
      decisions[same.id] = 'confirmed';
    } else cleared.push(key);
  }
  return { suggestions, checks: nextChecks, confirmed: nextConfirmed, decisions, cleared };
}
