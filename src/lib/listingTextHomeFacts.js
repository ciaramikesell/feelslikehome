// Smart Listing Details Paste: shared Home Facts suggested from listing text a
// buyer pasted. Pure: no network, no storage, no Match scoring.
//
// listingTextAnswers.js reads the same text for a buyer's own Yes / No answers.
// This module reads it for facts about the property itself — the shared fields
// Home Facts shows and #167 already turns into Match answers:
//
//   basementCondition, basementStyle, laundryLocation, primaryBedroomLocation,
//   garageType, garageSpaces, hoaFeeMonthly,
//   schoolDistrict, elementarySchool, middleSchool, highSchool
//
// Every result is a CANDIDATE: nothing is written until the buyer chooses Use,
// and then only into a field that is still empty (null, undefined or ''). A
// real answer — '0' garage spaces, 'none' basement, $0 HOA, anything a person
// typed — is never replaced and never offered a suggestion.
//
// The text decides only when it is explicit (same sentence guards as the
// personal answers: negation, hedges, future / possible work, community or
// nearby amenities). A fact the text never mentions stays Unknown. Two
// different values for one field are a conflict, and nothing is suggested.

import {
  LISTING_TEXT_CONCEPTS, isHedgedMention, isUnclearMention, listingEvidenceExcerpt, listingTextScopes, readListingRule,
} from './listingTextAnswers.js';
import { homeFactConcept, homeFactAnswer } from './homeFactCriteria.js';

const isEmpty = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

export const HOME_FACT_SUGGESTION_FIELDS = Object.freeze([
  'basementCondition', 'basementStyle', 'laundryLocation', 'primaryBedroomLocation', 'garageType', 'garageSpaces',
  'hoaFeeMonthly', 'schoolDistrict', 'elementarySchool', 'middleSchool', 'highSchool',
]);

export const HOME_FACT_SUGGESTION_LABELS = Object.freeze({
  basementCondition: 'Basement condition', basementStyle: 'Basement style', laundryLocation: 'Laundry',
  primaryBedroomLocation: 'Primary bedroom', garageType: 'Garage type', garageSpaces: 'Garage spaces',
  hoaFeeMonthly: 'HOA fee', schoolDistrict: 'School district', elementarySchool: 'Elementary school',
  middleSchool: 'Middle school', highSchool: 'High school',
});

const VALUE_LABELS = Object.freeze({
  basementCondition: { finished: 'Finished', unfinished: 'Unfinished', partially_finished: 'Partially finished', none: 'No basement' },
  basementStyle: { walkout: 'Walkout' },
  laundryLocation: { first_floor: 'First floor', second_floor: 'Second floor', basement: 'Basement' },
  primaryBedroomLocation: { 'Main Floor': 'Main floor', Upstairs: 'Upstairs' },
  garageType: { attached: 'Attached', detached: 'Detached' },
});

const SCHOOL_FIELDS = new Set(['schoolDistrict', 'elementarySchool', 'middleSchool', 'highSchool']);
export const isSchoolSuggestion = (suggestion) => SCHOOL_FIELDS.has(suggestion?.field);

/* ---------------------------- Concept-based facts ---------------------------- */
// Readers built on the personal-answer concepts. Each turns one concept's
// explicit Yes / No (and the sentence that said it) into a canonical value, or
// nothing when the sentence doesn't name that value outright.

const UPSTAIRS = /\b(?:upstairs|second[ -]floor|2nd[ -]floor|upper[ -]level|second level|2nd level)\b/i;

// "Partially finished basement": its own rule, because "partially" is a hedge
// for the finished-basement concept. Hedges around it still apply.
const PARTIAL_BASEMENT = { yes: [/\b(?:partially|partly) finished (?:basement|lower[ -]level)\b/i, /\b(?:basement|lower[ -]level)(?: is)? (?:partially|partly) finished\b/i], allowHedgeInMatch: true, blockers: [/\bcrawl ?space\b/i] };
// "Detached garage" (the attached rule already exists as a personal concept).
const CAR = '(?:\\d(?:\\.5)?|one|two|three|four|single|double|triple)[ -]car';
const DETACHED_GARAGE = { yes: [new RegExp(`\\bdetached (?:(?:oversized )?${CAR} )?garage\\b`, 'i'), new RegExp(`\\b${CAR} detached garage\\b`, 'i')], blockers: [/\bcarport\b/i] };
const ATTACHED_GARAGE = { ...LISTING_TEXT_CONCEPTS.attachedGarage, yes: [new RegExp(`\\battached (?:(?:oversized )?${CAR} )?garage\\b`, 'i'), new RegExp(`\\b${CAR} attached garage\\b`, 'i')], no: [], blockers: [/\bcarport\b/i] };
// "No basement" / "Basement: none" — the absence stated outright.
const NO_BASEMENT = { yes: [], mention: LISTING_TEXT_CONCEPTS.basement.mention, blockers: [/\bcrawl ?space\b/i, /\bunit\b/i, /\bapartment\b/i, /\bstorage\b/i] };

function conceptReading(text, rule) {
  const found = readListingRule(text, rule);
  return found && found.answer !== 'conflict' ? found : null;
}

function conceptCandidates(text) {
  const out = [];
  const add = (field, value, evidence) => out.push({ field, value, evidence });

  const finished = conceptReading(text, LISTING_TEXT_CONCEPTS.finishedBasement);
  if (finished?.answer === 'yes') add('basementCondition', 'finished', finished.evidence[0]);
  // "Not finished" could be partly finished; only "unfinished" says unfinished.
  if (finished?.answer === 'no') {
    const unfinished = finished.evidence.find((sentence) => /\bunfinished\b/i.test(sentence));
    if (unfinished) add('basementCondition', 'unfinished', unfinished);
  }
  const partial = conceptReading(text, PARTIAL_BASEMENT);
  if (partial?.answer === 'yes') add('basementCondition', 'partially_finished', partial.evidence[0]);
  const none = conceptReading(text, NO_BASEMENT);
  if (none?.answer === 'no') add('basementCondition', 'none', none.evidence[0]);

  const walkout = conceptReading(text, LISTING_TEXT_CONCEPTS.walkoutBasement);
  if (walkout?.answer === 'yes') add('basementStyle', 'walkout', walkout.evidence[0]);

  const firstLaundry = conceptReading(text, LISTING_TEXT_CONCEPTS.firstFloorLaundry);
  if (firstLaundry?.answer === 'yes') add('laundryLocation', 'first_floor', firstLaundry.evidence[0]);
  if (firstLaundry?.answer === 'no') {
    for (const sentence of firstLaundry.evidence) {
      if (/\b(?:basement|lower[ -]level)\b/i.test(sentence)) add('laundryLocation', 'basement', sentence);
      else if (/\b(?:second|2nd)[ -]?(?:floor|level)\b/i.test(sentence)) add('laundryLocation', 'second_floor', sentence);
    }
  }
  // "Upstairs laundry" isn't necessarily the second floor; only "second floor" says so.
  const secondLaundry = conceptReading(text, LISTING_TEXT_CONCEPTS.secondFloorLaundry);
  if (secondLaundry?.answer === 'yes') {
    const sentence = secondLaundry.evidence.find((item) => /\b(?:second|2nd)[ -]?(?:floor|level)\b/i.test(item));
    if (sentence) add('laundryLocation', 'second_floor', sentence);
  }

  const primary = conceptReading(text, LISTING_TEXT_CONCEPTS.firstFloorPrimary);
  if (primary?.answer === 'yes') add('primaryBedroomLocation', 'Main Floor', primary.evidence[0]);
  if (primary?.answer === 'no') {
    const sentence = primary.evidence.find((item) => UPSTAIRS.test(item));
    if (sentence) add('primaryBedroomLocation', 'Upstairs', sentence);
  }

  const attached = conceptReading(text, ATTACHED_GARAGE);
  if (attached?.answer === 'yes') add('garageType', 'attached', attached.evidence[0]);
  const detached = conceptReading(text, DETACHED_GARAGE);
  if (detached?.answer === 'yes') add('garageType', 'detached', detached.evidence[0]);
  return out;
}

/* --------------------------------- Garage spaces -------------------------------- */

const NUMBER_WORDS = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4, five: 5 };
const toCount = (raw) => (NUMBER_WORDS[String(raw).toLowerCase()] ?? Number(raw));
const GARAGE_COUNT_PATTERNS = [
  // "2-car garage", "two car attached garage", "oversized 2.5 car detached garage"
  new RegExp(`\\b(\\d(?:\\.5)?|one|two|three|four|five|single|double|triple)[ -]car (?:(?:attached|detached|tandem|oversized|heated|insulated|finished|side[ -]entry|rear[ -]entry|tuck[ -]under|built[ -]in) ){0,3}garage\\b`, 'gi'),
  // "Garage spaces: 2", "Garage capacity - 3", "2 garage spaces"
  /\bgarage (?:spaces?|capacity|stalls?)\s*[:\-–]\s*(\d{1,2})\b(?!\s*(?:x|ft|'|"|feet|by))/gi,
  /\b(\d{1,2}) garage (?:spaces?|stalls?)\b/gi,
  // "Garage: 2" / "Garage: 2 car" — a labelled line, never "garage 24x30"
  /(?:^|\n)\s*garage\s*[:\-–]\s*(\d{1,2})\s*(?:car|cars|spaces?|stalls?)?\s*(?=$|\n|[.;,])/gi,
];
// "No garage", "Garage: none" — stated outright, and not a garage-door detail.
const NO_GARAGE = [/\b(?:no|without(?: a)?) garage\b(?![ -](?:door|opener|access|sale|apartment))/i, /\bgarage\s*[:\-–]\s*(?:none|no)\b/i];
const GARAGE_HEDGE = { blockers: [/\bcarport\b/i, /\bconverted\b/i, /\b(?:shared|community|common|deeded|rented|available for rent|for rent)\b/i] };

function garageSpaceCandidates(text) {
  const out = [];
  const raw = String(text || '');
  for (const scope of listingTextScopes(raw)) {
    for (const pattern of GARAGE_COUNT_PATTERNS) {
      for (const m of scope.matchAll(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))) {
        const count = toCount(m[1]);
        if (!Number.isFinite(count) || count <= 0 || count > 10) continue;
        if (isUnclearMention(scope, m.index, m.index + m[0].length, GARAGE_HEDGE)) continue;
        out.push({ field: 'garageSpaces', value: String(count), evidence: listingEvidenceExcerpt(scope) });
      }
    }
    for (const pattern of NO_GARAGE) {
      const m = scope.match(pattern);
      if (!m) continue;
      // The negation is the statement itself, so only hedges and blockers apply.
      if (isHedgedMention(scope, m.index, m.index + m[0].length, GARAGE_HEDGE)) continue;
      out.push({ field: 'garageSpaces', value: '0', evidence: listingEvidenceExcerpt(scope) });
    }
  }
  return out;
}

/* ----------------------------------- HOA fee ---------------------------------- */
// Only a regular HOA fee with an explicit period. "No HOA" is not a $0 fee
// (and $0 is not "no HOA"), a fee without a period is ambiguous, and special
// assessments, transfer or one-time fees are not dues.

const PERIODS = [
  [/^(?:mo|mos|month|months|monthly)$/i, 1, 'month'],
  [/^(?:qtr|quarter|quarterly)$/i, 3, 'quarter'],
  [/^(?:yr|year|yearly|annual|annually|annum)$/i, 12, 'year'],
];
const periodOf = (word) => PERIODS.find(([pattern]) => pattern.test(String(word).replace(/\.$/, '')));
const HOA = "(?:HOA|H\\.O\\.A\\.|homeowners'?(?:'s)? association|homeowner'?s association|association)";
const AMOUNT = '\\$\\s?(\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.(\\d{1,2}))?';
const PERIOD = '(month|months|monthly|mo|mos|quarter|quarterly|qtr|year|yearly|annual|annually|yr|annum)';
const HOA_PATTERNS = [
  // "HOA fee: $250/month", "HOA dues of $1,200 per year", "HOA $85 monthly"
  { re: new RegExp(`\\b${HOA}(?:\\s+(?:fees?|dues|assessments?|charges?))?\\s*(?:is|are|of|:|-|–|=)?\\s*(?:only\\s+|just\\s+)?${AMOUNT}\\s*(?:/|per|a|an|each|every)?\\s*${PERIOD}\\b`, 'gi'), amount: 1, cents: 2, period: 3 },
  // "$250/month HOA", "$600 annual HOA dues"
  { re: new RegExp(`${AMOUNT}\\s*(?:/|per|a|an|each)?\\s*${PERIOD}\\s+${HOA}\\b`, 'gi'), amount: 1, cents: 2, period: 3 },
  // "Annual HOA dues: $600", "Monthly association fee $85"
  { re: new RegExp(`\\b${PERIOD}\\s+${HOA}\\s+(?:fees?|dues|assessments?)\\s*(?:is|are|of|:|-|–|=)?\\s*${AMOUNT}`, 'gi'), amount: 2, cents: 3, period: 1 },
];
const HOA_UNCLEAR = { blockers: [/\b(?:approx(?:imately)?|estimated?|est\.|about|around|roughly|up to|proposed|pending|tbd|to be determined|voluntary|optional|special assessments?|transfer fee|initiation|one[- ]time|capital contribution|working capital|move[- ]in fee|reserve)\b/i] };

function hoaCandidates(text) {
  const out = [];
  for (const scope of listingTextScopes(text)) {
    for (const { re, amount, cents, period } of HOA_PATTERNS) {
      for (const m of scope.matchAll(re)) {
        const match = periodOf(m[period]);
        if (!match) continue;
        if (isUnclearMention(scope, m.index, m.index + m[0].length, HOA_UNCLEAR)) continue;
        const value = Number(`${m[amount].replace(/,/g, '')}${m[cents] ? `.${m[cents]}` : ''}`);
        if (!Number.isFinite(value) || value < 0 || value > 100000) continue;
        const monthly = Math.round((value / match[1]) * 100) / 100;
        out.push({ field: 'hoaFeeMonthly', value: monthly, evidence: listingEvidenceExcerpt(scope), stated: { amount: value, per: match[2] } });
      }
    }
  }
  return out;
}

/* ----------------------------------- Schools ----------------------------------- */
// A district or school the listing NAMES. FLH never checks boundaries, never
// guesses a district from the city or ZIP, and never turns a name, a ranking or
// praise ("top-rated schools") into the buyer's Reputable Schools answer.

const DISTRICT_SUFFIX = '(?:Unified School District|Independent School District|Consolidated School District|Community Unit School District|Union Free School District|Community School District|Public School District|Area School District|City School District|Local School District|School District|Public Schools|Community Schools|Area Schools|City Schools|Local Schools|Consolidated Schools|County Schools|Unified Schools|ISD|USD|CUSD)';
const NAME_WORD = "[A-Z][A-Za-z'’.&-]*";
// The capitalised words right before a district suffix: "Rochester Community Schools".
const DISTRICT_INLINE = new RegExp(`((?:${NAME_WORD}\\s+){1,6})${DISTRICT_SUFFIX}\\b`, 'g');
// "…in the Plymouth-Canton school district" (lowercase suffix after a name).
const DISTRICT_LOWER = new RegExp(`((?:${NAME_WORD}\\s+){1,5})school district\\b`, 'g');
// A labelled line: "School district: Ann Arbor Public Schools".
const LABELLED = [
  ['schoolDistrict', /(?:^|\n|[.!?]\s+)\s*(?:school district|district\s*\(school\)|schools?\s*district)\s*(?:name)?\s*[:\-–]\s*([^\n]+)/gi],
  ['elementarySchool', /(?:^|\n|[.!?]\s+)\s*(?:elementary|grade|primary)(?: school)?\s*[:\-–]\s*([^\n]+)/gi],
  ['middleSchool', /(?:^|\n|[.!?]\s+)\s*(?:middle|junior high|intermediate)(?: school)?\s*[:\-–]\s*([^\n]+)/gi],
  ['highSchool', /(?:^|\n|[.!?]\s+)\s*(?:senior )?high(?: school)?\s*[:\-–]\s*([^\n]+)/gi],
];
// Marketing words that can sit at the front of a capitalised name run.
const LEADING_PRAISE = /^(?:the|in|within|located|award|award-winning|blue|ribbon|blue-ribbon|top|top-rated|top-ranked|highly|highly-rated|acclaimed|sought-after|desirable|popular|great|excellent|renowned|prestigious|coveted|esteemed|exceptional|outstanding|fantastic|amazing|wonderful|beautiful|nationally|ranked|rated|best|premier|preferred|desired|top-notch|stellar|superb|quality|choice|exemplary|attends?|zoned|serves|served|by)$/i;
// Names that aren't a public district the home is assigned to.
const NOT_A_DISTRICT = /\b(?:private|charter|parochial|catholic|christian|lutheran|montessori|academy|preparatory|prep|choice|magnet)\b/i;
const PLACEHOLDER = /^(?:n\/?a|none|unknown|tbd|tba|varies|other|call|contact|see|ask|verify|not (?:listed|available|provided)|-+|\?)\b/i;
// Wording that makes the school relationship uncertain or second-hand.
const SCHOOL_UNCLEAR = {
  blockers: [/\b(?:near(?:by)?|close to|minutes? (?:from|to|away)|walk(?:ing)? (?:distance )?to|steps (?:from|to|away)|access to|across (?:the street )?from|down the street|next to|around the corner|choice|boundar(?:y|ies)|subject to change|may change|buyer to verify|verify|confirm|check with|contact|believed|reportedly|currently assigned|assignment|lottery|tuition|private|charter)\b/i],
};

function cleanName(raw) {
  let text = String(raw || '')
    // A value ends at the next label or the end of its sentence.
    .split(/\s+(?:school district|elementary|middle|junior high|(?:senior )?high)(?: school)?\s*[:\-–]|[.!?](?:\s|$)|\s{2,}/i)[0]
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+(?:grades?|distance|rating|score|enrollment|students)\s*[:\-–].*$/i, '')
    .replace(/\s+(?:rated|rating)\s+\d.*$/i, '')
    .replace(/\s*[-–—|]?\s*\d+(?:\.\d+)?\s*\/\s*10\b.*$/i, '')
    .replace(/\s*\d+(?:\.\d+)?\s*(?:mi|miles?|km)\b.*$/i, '')
    .replace(/[\s.,;:!*]+$/g, '').replace(/^["“'‘\s]+|["”'’\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80 || !/[a-z]/i.test(text) || PLACEHOLDER.test(text)) return null;
  const words = text.split(' ');
  while (words.length > 1 && LEADING_PRAISE.test(words[0])) words.shift();
  text = words.join(' ');
  return text;
}

const DISTRICT_SUFFIX_ONLY = new RegExp(`^(?:${DISTRICT_SUFFIX})$`, 'i');
function districtName(raw, suffix = '') {
  const name = cleanName(`${raw}${suffix}`.trim());
  if (!name || NOT_A_DISTRICT.test(name)) return null;
  // There must be a name left besides the suffix ("Public Schools" alone is no district).
  const base = name.replace(new RegExp(`\\s*${DISTRICT_SUFFIX}$`, 'i'), '').trim();
  if (!base || DISTRICT_SUFFIX_ONLY.test(name) || base.split(' ').every((word) => LEADING_PRAISE.test(word))) return null;
  return name;
}

function schoolCandidates(text) {
  const out = [];
  const raw = String(text || '');
  // Labelled lines first ("School district: …", "Elementary school: …").
  for (const [field, pattern] of LABELLED) {
    for (const m of raw.matchAll(pattern)) {
      const line = m[0].replace(/^[\s.!?]+/, '').trim();
      if (isUnclearMention(line, 0, line.length, SCHOOL_UNCLEAR)) continue;
      const value = field === 'schoolDistrict' ? districtName(m[1]) : cleanName(m[1]);
      if (!value || (field !== 'schoolDistrict' && (NOT_A_DISTRICT.test(value) && !/\b(?:elementary|middle|high|school)\b/i.test(value)))) continue;
      out.push({ field, value, evidence: listingEvidenceExcerpt(line) });
    }
  }
  // District names inside sentences.
  for (const scope of listingTextScopes(raw)) {
    if (/^\s*(?:school district|elementary|middle|junior high|high)(?: school)?\s*[:\-–]/i.test(scope)) continue;
    // School wording must be plain across the whole sentence, not just the clause.
    if (SCHOOL_UNCLEAR.blockers.some((pattern) => pattern.test(scope))) continue;
    const seen = new Set();
    for (const [pattern, suffix] of [[DISTRICT_INLINE, null], [DISTRICT_LOWER, 'School District']]) {
      for (const m of scope.matchAll(pattern)) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (isUnclearMention(scope, start, end, SCHOOL_UNCLEAR)) continue;
        const value = suffix ? districtName(m[1], suffix) : districtName(m[0]);
        if (!value || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        out.push({ field: 'schoolDistrict', value, evidence: listingEvidenceExcerpt(scope) });
      }
    }
  }
  return out;
}

/* ------------------------------ Contrary wording ------------------------------ */
// A description that also says the opposite — even hedged or "as-is" ("the
// basement is unfinished and sold as-is") — is a contradiction, not a lesser
// statement. Any contrary wording anywhere in the text leaves the field Unknown.

const BASEMENT_WORD = '(?:basement|lower[ -]level)';
const FINISHED_PLAIN = new RegExp(`(?<![a-z])(?<!(?:partially|partly) )finished(?: walk[ -]?out)? ${BASEMENT_WORD}|\\b${BASEMENT_WORD}(?: is)? (?:fully |completely )?finished\\b`, 'i');
const UNFINISHED = new RegExp(`\\bunfinished\\b[^.;\\n]{0,30}\\b${BASEMENT_WORD}|\\b${BASEMENT_WORD}\\b[^.;\\n]{0,30}\\bunfinished\\b`, 'i');
const PARTIAL = /\b(?:partially|partly) finished\b/i;
const ANY_BASEMENT_DESCRIPTION = new RegExp(`\\b(?:finished|unfinished|walk[ -]?out|full|daylight)\\b[^.;\\n]{0,20}\\b${BASEMENT_WORD}\\b`, 'i');
// Anything placed in the basement means there is one.
const BASEMENT_PRESENT = /\b(?:in|into|to|from|of|downstairs in) (?:the )?basement\b|\bbasement (?:laundry|bedroom|bath(?:room)?|storage|rec(?:reation)? room|family room|level|stairs|walls?|floor)\b/i;
const NO_BASEMENT_TEXT = /\b(?:no|without(?: a)?) basement\b|\bbasement\s*[:\-–]\s*(?:none|no)\b/i;
const FLOOR1 = '(?:first|1st|main|ground|entry)[ -]?(?:floor|level)';
const LAUNDRY_FIRST = new RegExp(`\\b${FLOOR1} laundry\\b|\\blaundry\\b[^.;\\n]{0,30}\\b${FLOOR1}\\b`, 'i');
const LAUNDRY_BASEMENT = new RegExp(`\\b${BASEMENT_WORD} laundry\\b|\\blaundry\\b[^.;\\n]{0,30}\\b${BASEMENT_WORD}\\b`, 'i');
const LAUNDRY_UPPER = /\b(?:second|2nd|upper)[ -]?(?:floor|level) laundry\b|\bupstairs laundry\b|\blaundry\b[^.;\n]{0,30}\b(?:(?:second|2nd|upper)[ -]?(?:floor|level)|upstairs)\b/i;
const PRIMARY_WORD = "(?:primary|master|owner'?s?)";
const PRIMARY_MAIN = new RegExp(`\\b${PRIMARY_WORD}\\b[^.;\\n]{0,40}\\b${FLOOR1}\\b|\\b${FLOOR1} ${PRIMARY_WORD}\\b`, 'i');
const PRIMARY_UP = new RegExp(`\\b${PRIMARY_WORD}\\b[^.;\\n]{0,40}\\b(?:upstairs|(?:second|2nd|upper)[ -]?(?:floor|level))\\b|\\bupstairs ${PRIMARY_WORD}\\b`, 'i');
const GARAGE_ATTACHED = /\battached\b[^.;\n]{0,20}\bgarage\b/i;
const GARAGE_DETACHED = /\bdetached\b[^.;\n]{0,20}\bgarage\b/i;

const CONTRARY = Object.freeze({
  basementCondition: {
    finished: [UNFINISHED, PARTIAL],
    unfinished: [FINISHED_PLAIN, PARTIAL],
    partially_finished: [FINISHED_PLAIN, UNFINISHED],
    none: [ANY_BASEMENT_DESCRIPTION, BASEMENT_PRESENT],
  },
  laundryLocation: { first_floor: [LAUNDRY_BASEMENT, LAUNDRY_UPPER], basement: [LAUNDRY_FIRST, LAUNDRY_UPPER, NO_BASEMENT_TEXT], second_floor: [LAUNDRY_FIRST, LAUNDRY_BASEMENT] },
  primaryBedroomLocation: { 'Main Floor': [PRIMARY_UP], Upstairs: [PRIMARY_MAIN] },
  garageType: { attached: [GARAGE_DETACHED], detached: [GARAGE_ATTACHED] },
});

// A unit in the basement ("finished basement apartment") says nothing about
// the basement itself, so basement wording beside one answers nothing.
const BASEMENT_UNIT = new RegExp(`\\b${BASEMENT_WORD} (?:apartment|unit|in-law|rental|studio)\\b`, 'i');
const FIELD_BLOCKERS = Object.freeze({ basementCondition: [BASEMENT_UNIT], basementStyle: [BASEMENT_UNIT] });

function saysOtherwise(text, field, value) {
  return [...(CONTRARY[field]?.[value] || []), ...(FIELD_BLOCKERS[field] || [])].some((pattern) => pattern.test(text));
}

/* ------------------------------- Putting it together ----------------------------- */

const comparable = (value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : JSON.stringify(value));

function stableId(field, value) {
  let hash = 2166136261;
  for (const char of `${field}|${comparable(value)}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `home-fact-${(hash >>> 0).toString(36)}`;
}

function displayValue(field, value, stated) {
  if (VALUE_LABELS[field]) return VALUE_LABELS[field][value] || String(value);
  if (field === 'garageSpaces') return value === '0' ? 'No garage' : `${value} ${value === '1' ? 'space' : 'spaces'}`;
  if (field === 'hoaFeeMonthly') {
    const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
    return stated && stated.per !== 'month' ? `${money(value)}/mo (${money(stated.amount)} per ${stated.per})` : `${money(value)}/mo`;
  }
  return String(value);
}

// Values that can't stand together on one home (one says there's no basement,
// the other describes one) — the same contradiction #167 refuses to read.
function contradicts(field, value, home) {
  const condition = field === 'basementCondition' ? value : home?.basementCondition;
  const style = field === 'basementStyle' ? value : home?.basementStyle;
  return (condition === 'none' && !isEmpty(style) && style !== 'none') || (style === 'none' && !isEmpty(condition) && condition !== 'none');
}

/**
 * Every explicit Home Fact in the text, one value per field, regardless of the
 * home. A field read two different ways is left out (conflict).
 * @returns {{ field, value, evidence }[]}
 */
export function readHomeFactsFromText(text) {
  return readWithConflicts(text).facts;
}

// The readings and, separately, the fields the text states more than one way
// (two values, contrary wording, or "no basement" beside a basement
// description). Conflicting fields are never suggested; they are only named.
function readWithConflicts(text) {
  if (!String(text || '').trim()) return { facts: [], conflicts: [] };
  const all = [...conceptCandidates(text), ...garageSpaceCandidates(text), ...hoaCandidates(text), ...schoolCandidates(text)];
  const byField = new Map();
  for (const item of all) {
    const list = byField.get(item.field) || [];
    list.push(item);
    byField.set(item.field, list);
  }
  const facts = [];
  const conflicts = [];
  for (const [field, list] of byField) {
    const values = new Set(list.map((item) => comparable(item.value)));
    if (values.size !== 1 || saysOtherwise(String(text), field, list[0].value)) { conflicts.push(field); continue; }
    facts.push(list[0]);
  }
  // "No basement" beside any basement description answers nothing.
  const condition = facts.find((item) => item.field === 'basementCondition');
  const style = facts.find((item) => item.field === 'basementStyle');
  if (condition && style && contradicts('basementCondition', condition.value, { basementStyle: style.value })) {
    return { facts: facts.filter((item) => item !== condition && item !== style), conflicts: [...conflicts, 'basementCondition', 'basementStyle'] };
  }
  return { facts, conflicts };
}

// What a field already holds, in the words Home Facts uses.
const CURRENT_LABELS = Object.freeze({
  basementCondition: { none: 'No basement' }, basementStyle: { none: 'No basement', traditional: 'Traditional', gardenview: 'Gardenview' },
  garageType: { none: 'No garage' },
});
function currentDisplay(field, value) {
  return CURRENT_LABELS[field]?.[value] || displayValue(field, value);
}

/**
 * Where the pasted text and the home disagree, for a read-only note in the
 * review. Nothing here writes anything, and nothing is guessed:
 *   - 'differs'   the home already has a different value (kept as is);
 *   - 'contradicts' the field is empty but the text's value can't stand with
 *                 the home's other basement field (kept Unknown);
 *   - 'unclear'   the text states the field more than one way (kept Unknown).
 * @returns {{ field, label, kind: 'differs'|'contradicts'|'unclear', listing?: string, current?: string, evidence?: string }[]}
 */
export function homeFactDisagreements(text, home = {}) {
  const { facts, conflicts } = readWithConflicts(text);
  const out = [];
  for (const item of facts) {
    const current = home?.[item.field];
    if (!isEmpty(current) && comparable(current) !== comparable(item.value)) {
      out.push({ field: item.field, label: HOME_FACT_SUGGESTION_LABELS[item.field], kind: 'differs', listing: displayValue(item.field, item.value, item.stated), current: currentDisplay(item.field, current), evidence: item.evidence });
    } else if (isEmpty(current) && contradicts(item.field, item.value, home)) {
      out.push({ field: item.field, label: HOME_FACT_SUGGESTION_LABELS[item.field], kind: 'contradicts', listing: displayValue(item.field, item.value, item.stated), evidence: item.evidence });
    }
  }
  for (const field of new Set(conflicts)) {
    if (isEmpty(home?.[field])) out.push({ field, label: HOME_FACT_SUGGESTION_LABELS[field], kind: 'unclear' });
  }
  return out.sort((a, b) => HOME_FACT_SUGGESTION_FIELDS.indexOf(a.field) - HOME_FACT_SUGGESTION_FIELDS.indexOf(b.field));
}

/**
 * Whether a suggestion starts checked in the review. Every suggestion is
 * already explicit; these two still deserve the buyer's own look first, so
 * they start unchecked: a school or district the listing merely names (FLH
 * hasn't verified it), and an HOA fee converted from a yearly or quarterly
 * amount (the math is shown).
 */
export function isPreselectedHomeFact(suggestion) {
  if (!suggestion) return false;
  if (suggestion.school) return false;
  if (suggestion.field === 'hoaFeeMonthly' && suggestion.converted) return false;
  return true;
}

/**
 * Suggestions for this home: facts the text states, for fields that are still
 * empty and that wouldn't contradict what the home already says. Ordered as
 * Home Facts shows them.
 * @returns {{ id, field, value, label, display, evidence, school: boolean,
 *   sourceType: 'listing_text', sourceProvider: 'user_paste' }[]}
 */
export function suggestHomeFacts(text, home = {}) {
  return readHomeFactsFromText(text)
    .filter((item) => isEmpty(home?.[item.field]) && !contradicts(item.field, item.value, home))
    .sort((a, b) => HOME_FACT_SUGGESTION_FIELDS.indexOf(a.field) - HOME_FACT_SUGGESTION_FIELDS.indexOf(b.field))
    .map((item) => ({
      id: stableId(item.field, item.value),
      field: item.field, value: item.value, label: HOME_FACT_SUGGESTION_LABELS[item.field],
      display: displayValue(item.field, item.value, item.stated), evidence: item.evidence,
      school: SCHOOL_FIELDS.has(item.field),
      converted: item.field === 'hoaFeeMonthly' && !!item.stated && item.stated.per !== 'month',
      sourceType: 'listing_text', sourceProvider: 'user_paste',
    }));
}

/** Use: fill the field only while it is still empty. */
export function applyHomeFactSuggestion(home, suggestion) {
  if (!suggestion?.field || !HOME_FACT_SUGGESTION_FIELDS.includes(suggestion.field)) return home;
  if (!isEmpty(home?.[suggestion.field]) || contradicts(suggestion.field, suggestion.value, home)) return home;
  return { ...home, [suggestion.field]: suggestion.value };
}

/** Undo: only while the field still holds what this suggestion wrote. */
export function undoHomeFactSuggestion(home, suggestion) {
  if (!suggestion?.field || comparable(home?.[suggestion.field]) !== comparable(suggestion.value)) return home;
  return { ...home, [suggestion.field]: suggestion.field === 'garageSpaces' ? '' : null };
}

/**
 * Rerunning extraction on new text after some suggestions were used. `used`
 * maps a suggestion id to the suggestion that was applied in this session.
 * Each used fact still holding its value is re-read against the new text:
 * kept if the new text suggests the same value, otherwise cleared back to
 * Unknown and listed in `cleared` (field labels). Anything a person typed is
 * left alone.
 * @returns {{ home, suggestions, used, cleared: string[] }}
 */
export function resuggestHomeFacts(text, home = {}, used = {}) {
  const live = Object.values(used || {}).filter((item) => comparable(home?.[item.field]) === comparable(item.value));
  let base = { ...home };
  for (const item of live) base = undoHomeFactSuggestion(base, item);
  const suggestions = suggestHomeFacts(text, base);
  let next = base;
  const nextUsed = {};
  const cleared = [];
  for (const item of live) {
    const same = suggestions.find((suggestion) => suggestion.id === item.id);
    if (same) { next = applyHomeFactSuggestion(next, same); nextUsed[same.id] = same; } else cleared.push(item.label);
  }
  return { home: next, suggestions, used: nextUsed, cleared };
}

/* ------------------------- Shared vs personal suggestions ------------------------ */

// A shared Home Fact settles a personal criterion only when Match reads an
// answer from it (#167, homeFactCriteria.js) — not because a suggestion for it
// exists. So a personal suggestion is:
//   'settled'  the home's facts already answer it (a used suggestion, a value
//              from the lookup, or one a person entered) — Match reads that
//              fact, so asking again would be a duplicate;
//   'held'     a shared suggestion that would answer it is still pending —
//              the shared row says so, and only one prompt is shown;
//   'show'     nothing settles it, or the buyer skipped the shared suggestion
//              (Skip leaves the fact Unknown and keeps their own answer open).
// Criteria with no shared field (ensuite, fenced yard, fireplace, the legacy
// Attached Garage …) are always 'show'. Nothing here writes anything.

const factIsPending = (fact, decisions, home) => decisions?.[fact.id] !== 'used' && decisions?.[fact.id] !== 'skipped' && isEmpty(home?.[fact.field]);
const factWouldAnswer = (fact, key, home) => homeFactAnswer(applyHomeFactSuggestion(home, fact), key) !== undefined;

/** @returns {'settled'|'held'|'show'} */
export function personalSuggestionStatus(suggestion, { home = {}, factSuggestions = [], factDecisions = {} } = {}) {
  if (!suggestion?.key || !homeFactConcept(suggestion.key)) return 'show';
  if (homeFactAnswer(home, suggestion.key) !== undefined) return 'settled';
  const pending = factSuggestions.some((fact) => factIsPending(fact, factDecisions, home) && factWouldAnswer(fact, suggestion.key, home));
  return pending ? 'held' : 'show';
}

/** The personal suggestions to show beside the shared ones (see personalSuggestionStatus). */
export function visiblePersonalSuggestions(answerSuggestions = [], context = {}) {
  return answerSuggestions.filter((item) => personalSuggestionStatus(item, context) === 'show');
}

/** The personal suggestions a pending shared suggestion would answer if used — named on its row. */
export function personalSuggestionsAnsweredBy(fact, answerSuggestions = [], home = {}) {
  if (!fact || !isEmpty(home?.[fact.field])) return [];
  return answerSuggestions.filter((item) => homeFactConcept(item.key) && homeFactAnswer(home, item.key) === undefined && factWouldAnswer(fact, item.key, home));
}

/* --------------------------------- Import snapshot -------------------------------- */

/**
 * The import result to persist (homes.listing_import) once suggestions were
 * used: the used values join `fields` — so Home Facts shows them as From
 * listing (homeProvenance) — and their sentences are kept in `pastedFacts`.
 * A provider's own value for a field always stays in `fields`. With no prior
 * import, the snapshot is a pasted-text one.
 */
export function importResultWithHomeFacts(importResult, used = {}, home = {}) {
  const applied = Object.values(used || {}).filter((item) => comparable(home?.[item.field]) === comparable(item.value));
  if (!applied.length) return importResult;
  const base = importResult || { source: 'raw-text', fields: {}, listingFacts: [], descriptionFeatures: [] };
  const factFields = Object.fromEntries(applied.map((item) => [item.field, item.value]));
  return {
    ...base,
    fields: { ...factFields, ...(base.fields || {}) },
    pastedFacts: applied.map(({ field, value, evidence, sourceType, sourceProvider }) => ({ field, value, evidence, sourceType, sourceProvider })),
  };
}

/**
 * Pasted text after a property lookup adds to it: the provider's fields stay
 * (they were filled first, so text only fills what they left empty), the
 * text's evidence joins the provider's, and `pastedFields` names the fields
 * the text supplied. Without a lookup, the text result stands alone.
 */
export function combineImportResults(providerResult, textResult) {
  if (!providerResult) return textResult;
  const providerFields = providerResult.fields || {};
  const textFields = Object.fromEntries(Object.entries(textResult?.fields || {}).filter(([key]) => !(key in providerFields)));
  return {
    ...providerResult,
    fields: { ...textFields, ...providerFields },
    descriptionFeatures: [...(providerResult.descriptionFeatures || []), ...(textResult?.descriptionFeatures || [])],
    suggestions: textResult?.suggestions || [],
    ...(Object.keys(textFields).length ? { pastedFields: Object.keys(textFields) } : {}),
  };
}
