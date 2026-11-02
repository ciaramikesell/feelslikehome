// Property Notes suggestions from pasted listing text: high-signal terms a buyer
// may add to the shared notes (roof year, water/sewer, financing …). Suggested
// Match answers live in listingTextAnswers.js; nothing here touches a buyer's
// Yes / No answers.

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
