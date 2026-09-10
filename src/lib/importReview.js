import { getItemlistCategories } from './constants.js';

const SHARED_CRITERIA = new Set([
  'exterior:Garage', 'features:Pets Allowed', 'features:Utilities Included', 'features:In-Unit Laundry',
]);

const RULES = {
  'features:Basement': { yes: [/(?:\bfinished\b|\bwalkout\b)?\s*\bbasement\b/i], no: [/\bno basement\b/i, /\bslab[^.\n]{0,30}\bno basement\b/i], blockers: [/\bcrawlspace\b/i] },
  'features:Finished Basement': { yes: [/\bfinished basement\b/i], no: [/\bunfinished basement\b/i] },
  'features:Walkout Basement': { yes: [/\bwalk[ -]?out basement\b/i, /\bbasement[^.\n]{0,35}(?:exterior (?:door|egress)|separate entrance)\b/i], no: [/\bno walk[ -]?out(?: basement)?\b/i] },
  'features:Fireplace': { yes: [/\b(?:wood[- ]burning|gas|electric)?\s*fireplaces?\b/i, /\b[1-9]\d*\s+fireplaces?\b/i], no: [/\bno fireplaces?\b/i, /\bfireplaces?\s*[:\-]?\s*0\b/i] },
  'features:Central Air': { yes: [/\bcentral (?:air|a\/?c|air conditioning)\b/i], no: [/\bno central (?:air|a\/?c)\b/i, /\bwindow units? only\b/i] },
  'features:Home Office': { yes: [/\b(?:dedicated|private|separate) (?:home )?(?:office|study|den)\b/i, /\bhome office\b/i], no: [/\bno (?:home )?(?:office|study|den)\b/i], blockers: [/\b(?:office potential|potential office|space for (?:an )?office)\b/i] },
  'features:Primary Ensuite': { yes: [/\b(?:primary|master)[^.\n]{0,35}\b(?:en[ -]?suite|private (?:full )?bath)\b/i], no: [/\bno (?:primary|master) en[ -]?suite\b/i] },
  'features:First-Floor Laundry': { yes: [/\b(?:first|main)[ -]floor laundry\b/i, /\blaundry (?:on|located on) (?:the )?(?:first|main) floor\b/i], no: [/\blaundry (?:only )?(?:in|on) (?:the )?(?:basement|second|upper) floor\b/i] },
  'features:Dishwasher': { yes: [/\bdishwasher\b/i], no: [/\bno dishwasher\b/i, /\bdishwasher (?:not included|excluded)\b/i] },
  'features:Mudroom': { yes: [/\b(?:dedicated )?mudroom\b/i], no: [/\bno mudroom\b/i] },
  'features:Pantry': { yes: [/\b(?:walk[ -]?in|kitchen|butler'?s?) pantry\b/i], no: [/\bno pantry\b/i] },
  'features:Walk-In Closet': { yes: [/\bwalk[ -]?in closets?\b/i], no: [/\bno walk[ -]?in closets?\b/i] },
  'features:Additional Living Space': { yes: [/\b(?:bonus|family|recreation|rec) room\b/i, /\bsecond living (?:room|area|space)\b/i], no: [/\bno additional living space\b/i] },
  'exterior:Fenced Yard': { yes: [/\bfully fenced (?:back)?yard\b/i], no: [/\b(?:unfenced|no fence|no fenced yard)\b/i], blockers: [/\b(?:partially fenced|partial fence|fence allowed)\b/i] },
  'exterior:Patio / Deck / Outdoor Living': { yes: [/\bprivate (?:patio|deck|terrace)\b/i], no: [/\bno (?:patio|deck|terrace|outdoor space)\b/i], blockers: [/\b(?:community|shared) (?:patio|deck|terrace)\b/i] },
  'exterior:Attached Garage': { yes: [/\battached garage\b/i], no: [/\bdetached garage only\b/i, /\bno garage\b/i] },
  'exterior:Driveway / Off-Street Parking': { yes: [/\bdriveway\b/i, /\b(?:private|assigned) off[ -]street parking\b/i], no: [/\b(?:street parking only|no off[ -]street parking)\b/i] },
  'exterior:Parking': { yes: [/\b(?:included|assigned|on[ -]site) parking\b/i], no: [/\bno parking\b/i], blockers: [/\bnearby (?:street )?parking\b/i] },
  'exterior:Elevator': { yes: [/\b(?:building |an )?elevator\b/i], no: [/\b(?:no elevator|walk[ -]?up)\b/i] },
  'features:Separate Utilities': { yes: [/\b(?:separately metered utilities|separate utility meters|tenants? pay(?:s)? (?:their )?own utilities)\b/i], no: [/\butilities (?:are )?not separately metered\b/i] },
};

const MARKETING_OR_AMBIGUOUS = /\b(?:possible|potential|space for|ready for|nearby|community|photo)\b/i;

export function derivePriorityCheckPatch(text, priorities, currentChecks = {}) {
  const patch = {};
  const catalog = new Map(getItemlistCategories(priorities?.searchType).flatMap((category) =>
    [...category.coreItems, ...category.suggestedItems, ...(category.specificItems || [])]
      .map((item) => [`${category.key}:${item.label}`, item])));

  Object.entries(RULES).forEach(([key, rule]) => {
    const [category, label] = key.split(':');
    if (SHARED_CRITERIA.has(key) || catalog.get(key)?.kind !== 'check') return;
    if (!priorities?.[category]?.tiers || priorities[category].tiers[label] === 'dontcare' || !priorities[category].tiers[label]) return;
    if (currentChecks[key] === true || currentChecks[key] === 'no') return;
    const positiveContexts = String(text).split(/[.\n]/).filter((part) => rule.yes.some((pattern) => pattern.test(part)));
    const yes = positiveContexts.some((part) => !rule.no.some((pattern) => pattern.test(part))
      && !rule.blockers?.some((pattern) => pattern.test(part)) && !MARKETING_OR_AMBIGUOUS.test(part));
    const no = rule.no.some((pattern) => pattern.test(text));
    const blocked = rule.blockers?.some((pattern) => pattern.test(text));
    if (yes && !no && !blocked) patch[key] = true;
    else if (no && !yes && !blocked) patch[key] = 'no';
  });
  return patch;
}

function stableId(type, text) {
  let hash = 2166136261;
  for (const char of `${type}|${text.toLowerCase()}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `suggestion-${(hash >>> 0).toString(36)}`;
}

const SUGGESTION_RULES = [
  ['hoa', /\bHOA\s*[:\-]?\s*([^.;\n]{3,80})/i, (m) => `HOA: ${m[1].trim()}`],
  ['roof', /\broof (?:was )?(?:replaced|installed|new)\s*(?:in\s*)?((?:19|20)\d{2})\b/i, (m) => `Roof: replaced in ${m[1]}`],
  ['hvac', /\b(furnace|boiler|HVAC) (?:was )?(replaced|installed|updated)\s*(?:in\s*)?((?:19|20)\d{2})\b/i, (m) => `HVAC: ${m[1].toLowerCase()} ${m[2].toLowerCase()} in ${m[3]}`],
  ['water-heater', /\bwater heater (?:was )?(replaced|installed|updated)\s*(?:in\s*)?((?:19|20)\d{2})\b/i, (m) => `Water heater: ${m[1].toLowerCase()} in ${m[2]}`],
  ['systems', /\b(electrical|plumbing) (?:was )?(replaced|updated)\s*(?:in\s*)?((?:19|20)\d{2})\b/i, (m) => `${m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()}: ${m[2].toLowerCase()} in ${m[3]}`],
  ['windows', /\bwindows? (?:were |was )?(replaced|installed|updated)\s*(?:in\s*)?((?:19|20)\d{2})\b/i, (m) => `Windows: ${m[1].toLowerCase()} in ${m[2]}`],
  ['water-sewer', /\b(city water(?:\s+and\s+(?:city )?sewer)?|well(?: water)?(?:\s+and\s+septic)?)\b/i, (m) => `Water/Sewer: ${m[1].toLowerCase()}`],
  ['financing', /\b(seller financing|assumable (?:mortgage|loan)|seller offering [^.\n]{0,45}(?:rate buydown|closing credit)|\d[- ]\d rate buydown)\b/i, (m) => `Financing: ${m[1].toLowerCase()}`],
  ['possession', /\b(possession|occupancy)\s*[:\-]?\s*(at closing|immediate|negotiable|\d+ days? after closing)\b/i, (m) => `Possession: ${m[2].toLowerCase()}`],
  ['assessment', /\b(?:special assessment)\s*[:\-]?\s*([^.;\n]{3,80})/i, (m) => `Special assessment: ${m[1].trim()}`],
  ['appliances', /\b(appliances|refrigerator|washer(?: and|\s*\/) dryer)\s+(included|excluded)\b/i, (m) => `Appliances: ${m[1].toLowerCase()} ${m[2].toLowerCase()}`],
  ['rental-fee', /\b(security deposit|pet (?:fee|deposit)|application fee)\s*[:\-]?\s*\$([\d,]+)\b/i, (m) => `Rental terms: ${m[1].toLowerCase()} $${m[2]}`],
  ['pet-terms', /\b(pets? (?:limited to|restricted to)[^.;\n]{3,55}|(?:breed|weight) restrictions?[^.;\n]{0,45})/i, (m) => `Pet terms: ${m[1].trim().toLowerCase()}`],
  ['utilities', /\b(tenant pays (?:electric(?:ity)?|gas|water|trash)(?:\s+and\s+(?:electric(?:ity)?|gas|water|trash))*)\b/i, (m) => `Utilities: ${m[1].toLowerCase()}`],
  ['lease', /\b(\d+)[ -]month lease\b/i, (m) => `Lease term: ${m[1]} months`],
  ['parking-terms', /\bparking\s*[:\-]\s*([^.;\n]{3,70})/i, (m) => `Parking: ${m[1].trim()}`],
  ['furnished', /\b(fully furnished|partially furnished|unfurnished)\b/i, (m) => `Furnished status: ${m[1].toLowerCase()}`],
  ['renovation', /\b(?:addition|renovation|remodel)\s*[:\-]?\s*([^.;\n]{3,60})\s+(?:in\s+)?((?:19|20)\d{2})\b/i, (m) => `Renovation: ${m[1].trim()} in ${m[2]}`],
];

const equivalent = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function extractEnrichmentSuggestions(text, home = {}, { acceptedIds = [] } = {}) {
  const notes = [home.notes, home.pros, home.cons, home.basementNotes, home.schoolsNotes].map(equivalent).join(' ');
  const accepted = new Set(acceptedIds);
  const found = [];
  for (const [type, regex, format] of SUGGESTION_RULES) {
    const match = String(text).match(regex);
    if (!match) continue;
    const normalizedText = format(match).replace(/\s+/g, ' ').trim();
    const id = stableId(type, normalizedText);
    if (accepted.has(id) || notes.includes(equivalent(normalizedText))) continue;
    if (type === 'water-sewer' && /\bcity water\b/i.test(text) && /\bwell(?: water)?\b/i.test(text)) continue;
    if (type === 'financing' && /\bno seller financing\b/i.test(text)) continue;
    if (type === 'hoa' && home.hoaFeeMonthly !== '' && home.hoaFeeMonthly != null && /\$|fee|dues/i.test(normalizedText)) continue;
    if (type === 'parking-terms' && home.garageSpaces !== '' && /garage/i.test(normalizedText)) continue;
    found.push({ id, type, text: normalizedText });
  }
  return found.slice(0, 6);
}

export function appendSuggestionToNotes(notes, suggestion) {
  const current = String(notes || '').trim();
  if (!suggestion?.text || equivalent(current).includes(equivalent(suggestion.text))) return current;
  return current ? `${current}\n${suggestion.text}` : suggestion.text;
}

export function appendAllSuggestions(notes, suggestions = []) {
  return suggestions.reduce((value, suggestion) => appendSuggestionToNotes(value, suggestion), notes || '');
}
