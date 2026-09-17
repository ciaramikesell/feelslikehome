/**
 * Canonical, source-neutral facts used by listing import review. These facts are
 * intentionally separate from Match checks: seeing a phrase in listing remarks
 * is evidence to review, never permission to score a buyer's priorities.
 */

const FEATURE_RULES = [
  ['finished-basement', 'Finished basement', /\bfinished basement\b/i],
  ['partially-finished-basement', 'Partially finished basement', /\b(?:partially|partly) finished basement\b/i],
  ['unfinished-basement', 'Unfinished basement', /\bunfinished basement\b/i],
  ['first-floor-laundry', 'First-floor laundry', /\b(?:first|1st)[ -]floor laundry\b/i],
  ['hardwood-floors', 'Hardwood floors', /\bhardwood (?:flooring|floors)\b/i],
  ['fenced-yard', 'Fenced yard', /\b(?:fully )?fenced (?:in )?(?:yard|backyard)\b/i],
  ['fireplace', 'Fireplace', /\bfireplace\b/i],
  ['deck', 'Deck', /\bdeck\b/i],
  ['patio', 'Patio', /\bpatio\b/i],
  ['updated-kitchen', 'Updated kitchen', /\b(?:updated|renovated|remodeled) kitchen\b/i],
  ['updated-bathroom', 'Updated bathroom', /\b(?:updated|renovated|remodeled) bathroom(?:s)?\b/i],
  ['walk-in-closet', 'Walk-in closet', /\bwalk[ -]in closet\b/i],
  ['primary-suite', 'Primary suite', /\b(?:primary|owner(?:'s)?) suite\b/i],
  ['new-roof', 'New roof', /\bnew roof\b/i],
  ['new-furnace', 'New furnace', /\bnew furnace\b/i],
  ['new-hvac', 'New HVAC', /\bnew HVAC\b/i],
  ['central-air', 'Central air', /\bcentral (?:air|a\/c|ac)\b/i],
  ['attached-garage', 'Attached garage', /\battached garage\b/i],
  ['detached-garage', 'Detached garage', /\bdetached garage\b/i],
  ['pool', 'Pool', /\b(?:in-ground|inground|above-ground|swimming) pool\b/i],
  ['finished-attic', 'Finished attic', /\bfinished attic\b/i],
  ['mudroom', 'Mudroom', /\bmud ?room\b/i],
  ['home-office', 'Home office', /\bhome office\b/i],
];

// Reject sentences that make the phrase hypothetical, uncertain, absent, or a
// renovation need. The extractor deliberately gives up rather than guessing.
const UNSAFE_CONTEXT = /\b(?:no|not|without|future|potential|possible|could|would|room for|plans? for|believed|appears?|may|might|needs?|requiring|replace(?:ment)?|converted (?:from|to)|former)\b/i;

function sentences(text) {
  return String(text || '').split(/(?<=[.!?;])\s+|\n+/).map((value) => value.trim()).filter(Boolean);
}

export function extractExplicitDescriptionFeatures(description) {
  const result = [];
  for (const sentence of sentences(description)) {
    if (UNSAFE_CONTEXT.test(sentence)) continue;
    for (const [id, label, pattern] of FEATURE_RULES) {
      if (id === 'finished-basement' && /\b(?:partially|partly) finished basement\b/i.test(sentence)) continue;
      if (!pattern.test(sentence) || result.some((item) => item.id === id)) continue;
      result.push({ id, label, sourceType: 'listing_description', evidence: sentence.slice(0, 240) });
    }
  }
  return result;
}

function present(value) { return value !== null && value !== undefined && value !== ''; }

export function fact(key, label, value, group, options = {}) {
  if (!present(value)) return null;
  return {
    key, label, value, group,
    sourceType: options.sourceType || 'structured_listing',
    sourceProvider: options.sourceProvider || 'rentcast',
    explicitNegative: value === false,
  };
}

export function countListingDetails(fields = {}, facts = [], features = []) {
  const fieldCount = Object.values(fields).filter(present).length;
  return fieldCount + facts.filter(Boolean).length + features.length;
}

export function groupListingFacts(facts = []) {
  const order = ['basics', 'structure', 'parking', 'costs', 'utilities', 'listing'];
  return order.map((key) => ({ key, facts: facts.filter((item) => item?.group === key) })).filter((section) => section.facts.length);
}
