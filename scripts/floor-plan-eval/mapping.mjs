// Deterministic, per-person mapping from a shared extraction to ONE
// participant's own selected criteria. Runs locally; nothing here is ever sent
// to a vision provider (no priorities, no custom criteria).
//
// Suggestion categories:
//   suggested_yes       printed (or symbol-defined) evidence of an as-drawn
//                       feature, linked to a criterion the person selected and
//                       has not answered. The only category offering "Yes".
//   possibly_relevant   linked to the person's criterion, but the evidence is
//                       inferred, the plan marks it optional/alternate/unclear,
//                       the floor isn't named, or the link to a custom criterion
//                       is semantic. Never offered as Yes.
//   also_noticed        no selected criterion. Information only.
//   already_answered    the person already answered; plan evidence is shown,
//                       nothing is offered.
//
// Answers ("Unknown is neutral", co-buyer independence):
//   yes            → that person's checks[key] = true   (suggested_yes only)
//   mark_no        → that person's checks[key] = 'no'   (explicit buyer assertion)
//   not_right      → no answer; records that the AI's evidence/interpretation is wrong
//   leave_unknown  → no answer
// Nothing is ever pre-set to No, and absence from a plan is never evidence.
import { getItemlistCategories, isExperientialCriterion } from '../../src/lib/constants.js';
import { SHARED_BOOLEAN_FACT_FIELDS, selectedOrderedItems } from '../../src/lib/matching.js';
import { CONFIGURATION, DERIVED_CONCEPTS, EVIDENCE, SYMBOL_DEFINED_CONCEPTS } from './vocabulary.mjs';

const DERIVED = new Set(DERIVED_CONCEPTS);

// Catalog criteria each concept may answer, including stored legacy labels.
// A criterion not listed here can only be reached through the custom-criterion
// rules below.
export const CONCEPT_CRITERIA = Object.freeze({
  walk_in_closet: ['features:Walk-In Closet'],
  walk_in_pantry: ['features:Walk-in Pantry', 'features:Pantry'],
  pantry: ['features:Pantry'],
  mudroom: ['features:Mudroom'],
  office: ['features:Home office', 'features:Home Office'],
  primary_ensuite: ['features:Primary ensuite', 'features:Primary Ensuite'],
  formal_dining: ['features:Formal Dining Room'],
  eat_in_kitchen: ['features:Eat-in Kitchen'],
  kitchen_island: ['features:Kitchen Island'],
  double_vanity: ['features:Double Vanity'],
  soaking_tub: ['features:Soaking Tub'],
  fireplace: ['features:Fireplace'],
  bonus_room: ['features:Additional Living Space'],
  rec_room: ['features:Additional Living Space'],
  guest_suite: ['features:Guest / In-Law Suite'],
  finished_basement: ['features:Finished basement', 'features:Finished Basement'],
  basement: ['features:Basement'],
  screened_porch: ['exterior:Screened-in Porch'],
  front_porch: ['exterior:Front porch'],
  patio_deck: ['exterior:Patio / deck', 'exterior:Patio / Deck / Outdoor Living'],
  attached_garage: ['exterior:Attached garage', 'exterior:Attached Garage'],
  pool: ['exterior:Pool'],
  first_floor_bedroom: ['features:First-Floor Bedroom'],
  first_floor_primary: ['features:First-Floor Primary'],
  laundry_first_floor: ['features:First-floor laundry', 'features:First-Floor Laundry'],
  laundry_second_floor: ['features:Second-Floor Laundry'],
});

export const CONCEPT_NAMES = Object.freeze({
  walk_in_closet: 'Walk-in closet', walk_in_pantry: 'Walk-in pantry', pantry: 'Pantry', mudroom: 'Mudroom',
  office: 'Home office', den_flex: 'Den / flex room', laundry: 'Laundry', primary_ensuite: 'Primary ensuite',
  jack_and_jill_bath: 'Jack-and-Jill bath', formal_dining: 'Formal dining room', eat_in_kitchen: 'Eat-in kitchen',
  kitchen_island: 'Kitchen island', double_vanity: 'Double vanity', soaking_tub: 'Soaking tub', fireplace: 'Fireplace',
  bonus_room: 'Bonus room', rec_room: 'Rec room', guest_suite: 'Guest / in-law suite', finished_basement: 'Finished basement',
  basement: 'Basement', screened_porch: 'Screened porch', front_porch: 'Front porch', patio_deck: 'Patio / deck',
  balcony: 'Balcony', attached_garage: 'Attached garage', detached_garage: 'Detached garage', garage: 'Garage', pool: 'Pool',
  first_floor_bedroom: 'First-floor bedroom', first_floor_primary: 'First-floor primary bedroom',
  laundry_first_floor: 'First-floor laundry', laundry_second_floor: 'Second-floor laundry', other: 'Other feature',
});

// Words a buyer might use for a custom criterion that a plan feature could
// bear on. A hit is only ever "possibly relevant", never a Yes.
export const CUSTOM_CRITERION_LEXICON = Object.freeze({
  walk_in_closet: ['walk in closet', 'closet', 'closets', 'wardrobe', 'closet space', 'clothes storage'],
  walk_in_pantry: ['pantry', 'food storage', 'kitchen storage', 'bulk storage'],
  pantry: ['pantry', 'food storage', 'kitchen storage'],
  mudroom: ['mudroom', 'mud room', 'drop zone', 'entry storage', 'boot', 'boots', 'dog wash', 'pet wash', 'coat closet', 'backpack'],
  office: ['office', 'study', 'work from home', 'wfh', 'workspace', 'remote work', 'desk', 'library', 'zoom room'],
  den_flex: ['flex', 'den', 'hobby', 'craft', 'office', 'study', 'playroom', 'work from home', 'wfh', 'workspace'],
  laundry: ['laundry', 'washer', 'dryer'],
  primary_ensuite: ['ensuite', 'en suite', 'private bath', 'private bathroom', 'primary bath', 'master bath', 'own bathroom'],
  jack_and_jill_bath: ['jack and jill', 'shared bath', 'kids bath', 'kids bathroom'],
  first_floor_primary: ['single level', 'one level', 'single story', 'no stairs', 'aging in place', 'age in place', 'accessible', 'accessibility', 'wheelchair', 'mobility', 'main floor bedroom', 'ground floor bedroom', 'downstairs bedroom', 'aging parent', 'aging parents', 'grandparent', 'grandparents'],
  first_floor_bedroom: ['single level', 'one level', 'no stairs', 'aging in place', 'age in place', 'accessible', 'accessibility', 'wheelchair', 'mobility', 'main floor bedroom', 'ground floor bedroom', 'downstairs bedroom', 'aging parent', 'aging parents', 'grandparent', 'grandparents', 'guest'],
  guest_suite: ['guest', 'in law', 'inlaw', 'mother in law', 'multigenerational', 'multi generational', 'aging parent', 'aging parents', 'grandparent', 'grandparents', 'nanny', 'au pair', 'adu'],
  bonus_room: ['playroom', 'play room', 'bonus', 'media room', 'theater', 'game room', 'rec room', 'family room', 'kids space', 'teen', 'hangout', 'home gym', 'gym'],
  rec_room: ['playroom', 'play room', 'media room', 'theater', 'game room', 'rec room', 'family room', 'kids space', 'teen', 'hangout', 'home gym', 'gym'],
  formal_dining: ['dining room', 'formal dining', 'entertaining', 'dinner party', 'dinner parties', 'hosting'],
  eat_in_kitchen: ['eat in', 'breakfast nook', 'kitchen table'],
  kitchen_island: ['island', 'entertaining', 'hosting'],
  double_vanity: ['double sink', 'double vanity', 'two sinks', 'his and hers'],
  soaking_tub: ['tub', 'bathtub', 'soaking', 'bath tub'],
  fireplace: ['fireplace', 'wood stove', 'hearth'],
  finished_basement: ['basement', 'lower level', 'downstairs living'],
  basement: ['basement', 'lower level', 'storage'],
  screened_porch: ['porch', 'screened', 'sunroom', 'three season', 'outdoor living'],
  front_porch: ['porch', 'outdoor living'],
  patio_deck: ['patio', 'deck', 'outdoor living', 'grill', 'bbq', 'outdoor dining'],
  balcony: ['balcony', 'outdoor space', 'outdoor living'],
  attached_garage: ['garage', 'parking', 'workshop', 'ev charging'],
  detached_garage: ['garage', 'parking', 'workshop'],
  garage: ['garage', 'parking', 'workshop'],
  laundry_first_floor: ['laundry', 'washer', 'dryer', 'no stairs', 'single level'],
  laundry_second_floor: ['laundry', 'washer', 'dryer'],
  pool: ['pool', 'swim', 'swimming'],
});

const EVIDENCE_WORDS = Object.freeze({
  [EVIDENCE.PRINTED_LABEL]: 'Labeled on plan',
  [EVIDENCE.DRAWN_SYMBOL]: 'Drawn symbol',
  [EVIDENCE.LAYOUT_INFERRED]: 'Looks like — not labeled',
});

const normalizeWords = (text) => ` ${String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)).join(' ')} `;
const containsPhrase = (haystack, phrase) => normalizeWords(haystack).includes(normalizeWords(phrase));

const EVIDENCE_RANK = { [EVIDENCE.PRINTED_LABEL]: 0, [EVIDENCE.DRAWN_SYMBOL]: 1, [EVIDENCE.LAYOUT_INFERRED]: 2 };
const CONFIG_RANK = { [CONFIGURATION.AS_DRAWN]: 0, [CONFIGURATION.UNCLEAR]: 1, [CONFIGURATION.OPTIONAL]: 2 };

// Whether a finding is strong enough to be offered as Yes.
export function isOfferable(finding) {
  if (finding.configuration !== CONFIGURATION.AS_DRAWN) return false;
  if (finding.floorUnknown) return false;
  if (finding.evidenceCategory === EVIDENCE.PRINTED_LABEL) return true;
  return finding.evidenceCategory === EVIDENCE.DRAWN_SYMBOL && SYMBOL_DEFINED_CONCEPTS.has(finding.baseConcept || finding.concept);
}

// One flat list of findings: the model's features plus the floor-derived
// concepts computed here from rooms and captioned floors.
export function collectFindings(extraction) {
  const floorLevel = new Map(extraction.floors.map((floor) => [floor.id, floor.level]));
  const rooms = new Map(extraction.rooms.map((room) => [room.id, room]));
  const roomText = (ids) => ids.map((id) => rooms.get(id)).filter(Boolean)
    .map((room) => room.printedLabel).filter(Boolean);
  const findings = extraction.features.map((feature) => ({
    concept: feature.concept, baseConcept: feature.concept, roomIds: feature.roomIds, floorId: feature.floorId,
    evidenceCategory: feature.evidenceCategory, configuration: feature.configuration, qualifierText: feature.qualifierText,
    evidence: feature.evidence, uncertainty: feature.uncertainty, labels: roomText(feature.roomIds), floorUnknown: false,
  }));

  const derive = (concept, room, baseConcept, extraUncertainty = '') => {
    const level = floorLevel.get(room.floorId) || 'unknown';
    findings.push({
      concept, baseConcept, roomIds: [room.id], floorId: room.floorId, evidenceCategory: room.evidenceCategory,
      configuration: room.configuration, qualifierText: room.qualifierText,
      evidence: `${room.printedLabel ? `"${room.printedLabel}"` : 'Unlabeled room'} on ${level === 'unknown' ? 'a drawing with no floor name' : `the ${level} floor`}`,
      uncertainty: [level === 'unknown' ? 'The plan does not name this floor' : '', extraUncertainty].filter(Boolean).join('; '),
      labels: room.printedLabel ? [room.printedLabel] : [], floorUnknown: level === 'unknown',
    });
    return level;
  };
  const levelOf = (room) => floorLevel.get(room.floorId) || 'unknown';
  for (const room of extraction.rooms) {
    const level = levelOf(room);
    const relevantLevel = level === 'main' || level === 'unknown';
    if (room.type === 'primary_bedroom' && relevantLevel) derive('first_floor_primary', room, 'bedroom');
    if (['bedroom', 'primary_bedroom', 'guest_suite'].includes(room.type) && relevantLevel) derive('first_floor_bedroom', room, 'bedroom');
    if (room.type === 'laundry') {
      if (relevantLevel) derive('laundry_first_floor', room, 'laundry');
      if (level === 'second') derive('laundry_second_floor', room, 'laundry');
    }
  }
  // Laundry shown only by a W/D symbol inside another room (hall closet, bath).
  for (const feature of extraction.features.filter((f) => f.concept === 'laundry')) {
    const level = floorLevel.get(feature.floorId) || 'unknown';
    const already = findings.some((f) => f.baseConcept === 'laundry' && f.roomIds.some((id) => feature.roomIds.includes(id)) && f.concept !== 'laundry');
    if (already) continue;
    const pseudoRoom = { id: feature.roomIds[0] || '', floorId: feature.floorId, evidenceCategory: feature.evidenceCategory, configuration: feature.configuration, qualifierText: feature.qualifierText, printedLabel: roomText(feature.roomIds)[0] || '' };
    if (level === 'main' || level === 'unknown') derive('laundry_first_floor', pseudoRoom, 'laundry');
    if (level === 'second') derive('laundry_second_floor', pseudoRoom, 'laundry');
  }
  return findings;
}

// Strongest finding per concept: offerable first, then evidence, then configuration.
function strongestByConcept(findings) {
  const best = new Map();
  for (const finding of findings) {
    const current = best.get(finding.concept);
    const score = (f) => [isOfferable(f) ? 0 : 1, EVIDENCE_RANK[f.evidenceCategory] ?? 3, CONFIG_RANK[f.configuration] ?? 3];
    if (!current || score(finding).join() < score(current).join()) best.set(finding.concept, finding);
  }
  return best;
}

// The person's selected, answerable check criteria (what Match scores from
// their own `checks`). Ratings, experiential criteria and shared facts that
// Match reads from the home (pets, utilities, in-unit laundry, garage spaces)
// are excluded.
export function selectedCheckCriteria(priorities) {
  const criteria = [];
  for (const def of getItemlistCategories(priorities?.searchType)) {
    for (const item of selectedOrderedItems(def, priorities || {})) {
      const key = `${def.key}:${item.label}`;
      if (item.kind !== 'check' || isExperientialCriterion(def.key, item.label)) continue;
      if (SHARED_BOOLEAN_FACT_FIELDS[key] || key === 'exterior:Garage') continue;
      criteria.push({ key, categoryKey: def.key, label: item.label, tier: priorities[def.key]?.tiers?.[item.label] || null, custom: item.source === 'custom' });
    }
  }
  return criteria;
}

const CATALOG_KEYS = new Set(Object.values(CONCEPT_CRITERIA).flat());
const isAnswered = (checks, key) => checks?.[key] === true || checks?.[key] === 'no';
const existingAnswer = (checks, key) => (checks?.[key] === true ? 'yes' : checks?.[key] === 'no' ? 'no' : null);

const ACTIONS = Object.freeze({
  suggested_yes: Object.freeze(['yes', 'mark_no', 'not_right', 'leave_unknown']),
  possibly_relevant: Object.freeze(['mark_no', 'not_right', 'leave_unknown']),
  also_noticed: Object.freeze(['not_right', 'leave_unknown']),
  already_answered: Object.freeze([]),
});

function possibleReasons(finding, relation) {
  const reasons = [];
  if (relation === 'semantic') reasons.push('related_to_your_criterion');
  if (finding.configuration === CONFIGURATION.OPTIONAL) reasons.push('plan_marks_optional');
  if (finding.configuration === CONFIGURATION.UNCLEAR) reasons.push('plan_label_ambiguous');
  if (finding.floorUnknown) reasons.push('floor_not_named');
  if (finding.evidenceCategory === EVIDENCE.LAYOUT_INFERRED) reasons.push('not_labeled');
  if (finding.evidenceCategory === EVIDENCE.DRAWN_SYMBOL && !SYMBOL_DEFINED_CONCEPTS.has(finding.baseConcept || finding.concept)) reasons.push('symbol_only');
  return reasons;
}

function makeSuggestion({ finding, criterion, relation, matchedPhrase, checks }) {
  const offerable = isOfferable(finding);
  let category;
  if (!criterion) category = 'also_noticed';
  else if (isAnswered(checks, criterion.key)) category = 'already_answered';
  else if (offerable && relation !== 'semantic') category = 'suggested_yes';
  else category = 'possibly_relevant';
  const qualifier = finding.configuration === CONFIGURATION.OPTIONAL
    ? `The plan marks this as ${finding.qualifierText ? `“${finding.qualifierText}”` : 'optional or alternate'}; it may not be part of this home`
    : finding.configuration === CONFIGURATION.UNCLEAR ? 'The plan gives this room more than one possible use' : '';
  return {
    id: `${finding.concept}|${criterion?.key || '-'}|${finding.roomIds.join(',')}`,
    suggestedFeature: CONCEPT_NAMES[finding.concept] || finding.concept,
    concept: finding.concept,
    criterionKey: criterion?.key || null,
    criterionLabel: criterion?.label || null,
    criterionTier: criterion?.tier || null,
    relation: criterion ? relation : null,
    matchedPhrase: matchedPhrase || null,
    category,
    reasons: category === 'possibly_relevant' ? possibleReasons(finding, relation) : [],
    evidence: finding.evidence,
    evidenceCategory: finding.evidenceCategory,
    evidenceCategoryLabel: EVIDENCE_WORDS[finding.evidenceCategory] || finding.evidenceCategory,
    configuration: finding.configuration,
    uncertainty: [qualifier, finding.uncertainty].filter(Boolean).join('; '),
    existingAnswer: criterion ? existingAnswer(checks, criterion.key) : null,
    suggestedAnswer: category === 'suggested_yes' ? 'yes' : null, // never 'no'
    confirmationStatus: category === 'already_answered' ? 'answered' : 'pending',
    allowedActions: ACTIONS[category],
  };
}

const CATEGORY_RANK = { suggested_yes: 0, already_answered: 1, possibly_relevant: 2, also_noticed: 3 };
// Of two suggestions for the same criterion, the one to show: offerable first,
// then stronger evidence, then a model-reported concept over a derived one.
function strongest(a, b) {
  if (!a) return b;
  const rank = (s) => [CATEGORY_RANK[s.category], EVIDENCE_RANK[s.evidenceCategory] ?? 3, DERIVED.has(s.concept) ? 1 : 0];
  const [ra, rb] = [rank(a), rank(b)];
  for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? a : b;
  return a;
}

// Suggestions for ONE participant. `checks` are that participant's own
// answers for this home; another participant's answers are never read.
export function deriveSuggestions(extraction, priorities, checks = {}) {
  const criteria = selectedCheckCriteria(priorities);
  const byKey = new Map(criteria.map((criterion) => [criterion.key, criterion]));
  const best = strongestByConcept(collectFindings(extraction));
  const suggestions = [];
  const linkedConcepts = new Set();

  // 1. Catalog criteria through the explicit allowlist. One suggestion per
  //    criterion: the strongest of the concepts that answer it.
  const catalog = new Map();
  for (const [concept, finding] of best) {
    for (const key of CONCEPT_CRITERIA[concept] || []) {
      const criterion = byKey.get(key);
      if (!criterion) continue;
      linkedConcepts.add(concept);
      catalog.set(key, strongest(catalog.get(key), makeSuggestion({ finding, criterion, relation: 'catalog', checks })));
    }
  }
  suggestions.push(...catalog.values());

  // 2. Custom (and any non-catalog) criteria: exact label match may be a
  //    Yes; a semantic relationship is only ever "possibly relevant".
  for (const criterion of criteria.filter((c) => !CATALOG_KEYS.has(c.key))) {
    const label = normalizeWords(criterion.label);
    const exact = [];
    const semantic = [];
    for (const [concept, finding] of best) {
      if ([...finding.labels, CONCEPT_NAMES[concept] || ''].some((text) => text && normalizeWords(text) === label)) {
        exact.push(makeSuggestion({ finding, criterion, relation: 'exact_label', checks }));
        linkedConcepts.add(concept);
        continue;
      }
      const phrase = (CUSTOM_CRITERION_LEXICON[concept] || []).find((p) => containsPhrase(criterion.label, p))
        || finding.labels.find((text) => text.length > 3 && containsPhrase(criterion.label, text));
      if (phrase) semantic.push({ concept, suggestion: makeSuggestion({ finding, criterion, relation: 'semantic', matchedPhrase: phrase, checks }) });
    }
    // An exact match answers the criterion; looser links would only add noise.
    if (exact.length) suggestions.push(exact.reduce(strongest));
    else for (const { concept, suggestion } of semantic) { suggestions.push(suggestion); linkedConcepts.add(concept); }
  }

  // 3. Everything else the plan shows: information only.
  for (const [concept, finding] of best) {
    if (linkedConcepts.has(concept) || concept === 'other') continue;
    suggestions.push(makeSuggestion({ finding, criterion: null, relation: null, checks }));
  }

  const order = { suggested_yes: 0, possibly_relevant: 1, already_answered: 2, also_noticed: 3 };
  const tierOrder = { must: 0, important: 1, nice: 2 };
  return suggestions.sort((a, b) => order[a.category] - order[b.category]
    || (tierOrder[a.criterionTier] ?? 3) - (tierOrder[b.criterionTier] ?? 3)
    || a.suggestedFeature.localeCompare(b.suggestedFeature));
}

export class ReviewDecisionError extends Error {}

// Applies one person's review action. Returns the patch for THAT person's
// `checks` (possibly empty) and, for "not_right", a correction record that
// never affects Match.
export function applyReviewDecision(checks, suggestion, action) {
  if (!suggestion.allowedActions.includes(action)) {
    throw new ReviewDecisionError(`"${action}" is not available for a ${suggestion.category} suggestion`);
  }
  const key = suggestion.criterionKey;
  if ((action === 'yes' || action === 'mark_no') && isAnswered(checks, key)) {
    throw new ReviewDecisionError(`${key} is already answered; review never overwrites an answer`);
  }
  switch (action) {
    case 'yes':
      return { checksPatch: { [key]: true }, matchEffect: 'yes', confirmationStatus: 'accepted_yes', correction: null };
    case 'mark_no':
      // The buyer's own assertion that the property lacks this criterion —
      // never inferred from the plan.
      return { checksPatch: { [key]: 'no' }, matchEffect: 'no', confirmationStatus: 'marked_no', correction: null };
    case 'not_right':
      return {
        checksPatch: {}, matchEffect: 'none', confirmationStatus: 'not_right',
        correction: { suggestionId: suggestion.id, concept: suggestion.concept, evidence: suggestion.evidence, evidenceCategory: suggestion.evidenceCategory },
      };
    case 'leave_unknown':
      return { checksPatch: {}, matchEffect: 'none', confirmationStatus: 'left_unknown', correction: null };
    default:
      throw new ReviewDecisionError(`unknown action "${action}"`);
  }
}
