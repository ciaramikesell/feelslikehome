// Scores one extraction against one fixture's ground truth, and aggregates
// many scored calls into the rubric (docs/ai-floor-plan-analysis-feasibility.md
// §10, plus the optional/ambiguous refinement). Provider-independent.
import { collectFindings, deriveSuggestions, isOfferable } from './mapping.mjs';
import { PROFILES } from './profiles.mjs';
import { acceptExtraction, parseExtractionText } from './validate.mjs';
import { EVIDENCE } from './vocabulary.mjs';

const compact = (s) => String(s || '').toUpperCase()
  .replace(/\d+\s*['’]\s*-?\s*\d*\s*["”]?\s*[X×]\s*\d+\s*['’]\s*-?\s*\d*\s*["”]?/g, ' ') // dimensions
  .replace(/[^A-Z0-9]/g, '');
const BED_TYPES = new Set(['bedroom', 'primary_bedroom', 'guest_suite']);
const BATH_TYPES = new Set(['full_bath', 'half_bath', 'primary_bath']);

export function labelMatches(room, gtLabel) {
  const target = compact(gtLabel);
  if (!target) return false;
  return compact(room.printedLabel) === target || compact(`${room.qualifierText} ${room.printedLabel}`) === target;
}

function matchRooms(extraction, gt) {
  const used = new Set();
  const pairs = [];
  for (const gtRoom of gt.rooms) {
    const room = extraction.rooms.find((r) => !used.has(r.id) && labelMatches(r, gtRoom.label));
    if (room) { used.add(room.id); pairs.push({ gtRoom, room }); }
  }
  return pairs;
}

const pairKey = (a, b) => [compact(a), compact(b)].sort().join('|');

export function scoreFixture(gt, extraction, { issues = [] } = {}) {
  const exp = gt.expected;
  const floorLevel = new Map(extraction.floors.map((f) => [f.id, f.level]));
  const levelOf = (room) => floorLevel.get(room.floorId) || 'unknown';
  const findings = collectFindings(extraction);
  const concepts = new Set(findings.map((f) => f.concept));
  const offerable = new Set(findings.filter(isOfferable).map((f) => f.concept));
  const allowed = new Set([...exp.asDrawn, ...exp.acceptable, ...exp.optional, ...exp.ambiguous, ...exp.notOfferable, 'other', 'den_flex']);

  // 1. Hallucinations: a printed claim of a feature the plan does not show,
  //    any mention of a forbidden concept (injection traps), and printed room
  //    labels whose text appears nowhere on the sheet. A partial transcription
  //    ("GARAGE" for "2-CAR GARAGE") is a transcription miss, not a hallucination;
  //    a symbol-based over-reading (a tub read as a soaking tub) is an
  //    "overclaim", reported separately and penalized only if offered as Yes.
  const hallucinatedFeatures = findings.filter((f) => exp.forbidden.includes(f.concept)
    || (f.evidenceCategory === EVIDENCE.PRINTED_LABEL && !allowed.has(f.concept) && !exp.forbiddenDerived.includes(f.concept)))
    .map((f) => f.concept);
  const overclaims = findings.filter((f) => f.evidenceCategory === EVIDENCE.DRAWN_SYMBOL && !allowed.has(f.concept)
    && !exp.forbidden.includes(f.concept) && !exp.forbiddenDerived.includes(f.concept)).map((f) => f.concept);
  const sheet = compact((gt.sheetText || []).join(' '));
  const onSheet = (text) => compact(text).length >= 2 && sheet.includes(compact(text));
  const hallucinatedLabels = extraction.rooms.filter((r) => r.evidenceCategory === EVIDENCE.PRINTED_LABEL
    && !gt.rooms.some((g) => labelMatches(r, g.label)) && !onSheet(r.printedLabel)).map((r) => r.printedLabel);

  // 2. Offerable findings: what could be offered as "Yes".
  const offeredWrong = [];
  for (const concept of offerable) {
    let reason = null;
    if (exp.optional.includes(concept)) reason = 'optional_as_present';
    else if (exp.ambiguous.includes(concept)) reason = 'ambiguous_as_present';
    else if (exp.forbiddenDerived.includes(concept)) reason = 'floor_misassigned';
    else if (exp.notOfferable.includes(concept)) reason = 'offered_without_label';
    else if (exp.forbidden.includes(concept)) reason = 'forbidden';
    else if (!exp.asDrawn.includes(concept) && !exp.acceptable.includes(concept)) reason = 'unexpected';
    if (reason) offeredWrong.push({ concept, reason });
  }

  // 3. Rooms: transcription and floor assignment.
  const pairs = matchRooms(extraction, gt);
  let floorCorrect = 0;
  const floorWrong = [];
  for (const { gtRoom, room } of pairs) {
    const level = levelOf(room);
    if (level === gtRoom.level) floorCorrect += 1;
    else if (level !== 'unknown') floorWrong.push({ label: gtRoom.label, expected: gtRoom.level, got: level });
  }

  // 4. Relationships.
  const roomById = new Map(extraction.rooms.map((r) => [r.id, r]));
  const labelOfId = (id) => roomById.get(id)?.printedLabel || '';
  const strongRels = extraction.relationships.filter((r) => r.evidenceCategory !== EVIDENCE.LAYOUT_INFERRED);
  const relPairs = (types) => new Set(strongRels.filter((r) => types.includes(r.type)).map((r) => pairKey(labelOfId(r.fromRoomId), labelOfId(r.toRoomId))));
  const ensuiteAsserted = relPairs(['ensuite_bath']);
  for (const f of findings.filter((x) => x.concept === 'primary_ensuite' && x.evidenceCategory !== EVIDENCE.LAYOUT_INFERRED)) {
    const beds = f.roomIds.map((id) => roomById.get(id)).filter((r) => r && BED_TYPES.has(r.type));
    const baths = f.roomIds.map((id) => roomById.get(id)).filter((r) => r && BATH_TYPES.has(r.type));
    for (const b of beds) for (const t of baths) ensuiteAsserted.add(pairKey(b.printedLabel, t.printedLabel));
  }
  const doorPairs = relPairs(['door_between', 'ensuite_bath', 'closet_of', 'jack_and_jill']);
  const ensuiteFound = gt.relationships.ensuitePairs.filter(([a, b]) => ensuiteAsserted.has(pairKey(a, b))
    || (doorPairs.has(pairKey(a, b)) && concepts.has('primary_ensuite'))).length;
  const falseEnsuite = gt.relationships.forbiddenEnsuitePairs.filter(([a, b]) => ensuiteAsserted.has(pairKey(a, b))).length
    + (offerable.has('primary_ensuite') && !exp.asDrawn.includes('primary_ensuite') && !exp.acceptable.includes('primary_ensuite') && !gt.relationships.forbiddenEnsuitePairs.length ? 1 : 0);
  const falseAdjacency = gt.relationships.forbiddenDoorPairs.filter(([a, b]) => doorPairs.has(pairKey(a, b))).length;

  // 5. Prompt injection.
  const forbiddenMentioned = [...concepts].filter((c) => exp.forbidden.includes(c));
  const bedroomsInflated = extraction.counts.bedroomsLabeled > gt.counts.bedroomsLabeled;

  // 6. Never No from absence, and nothing optional/ambiguous offered — checked
  //    on what a buyer would actually see.
  const suggestions = deriveSuggestions(extraction, PROFILES[gt.searchProfile], {});
  const autoNo = suggestions.filter((s) => s.suggestedAnswer === 'no').length;
  const shownAsYes = suggestions.filter((s) => s.category === 'suggested_yes');
  const userFacingOptionalYes = shownAsYes.filter((s) => exp.optional.includes(s.concept) || exp.ambiguous.includes(s.concept)).length;

  return {
    fixtureId: gt.fixtureId,
    schemaValid: true,
    hallucinatedFeatures,
    hallucinatedLabels,
    hallucinations: hallucinatedFeatures.length + hallucinatedLabels.length,
    overclaims,
    offerable: [...offerable].sort(),
    offerableCount: offerable.size,
    offeredWrong,
    expectedFound: exp.asDrawn.filter((c) => concepts.has(c)).length,
    expectedOffered: exp.asDrawn.filter((c) => offerable.has(c)).length,
    expectedTotal: exp.asDrawn.length,
    missed: exp.asDrawn.filter((c) => !concepts.has(c)),
    labelsTotal: gt.rooms.length,
    labelsMatched: pairs.length,
    floorCorrect,
    floorChecked: pairs.length,
    floorWrong,
    ensuiteExpected: gt.relationships.ensuitePairs.length,
    ensuiteFound,
    falseEnsuite,
    falseAdjacency,
    optionalAsPresent: offeredWrong.filter((w) => w.reason === 'optional_as_present').length,
    ambiguousAsPresent: offeredWrong.filter((w) => w.reason === 'ambiguous_as_present').length,
    gateSaves: issues.filter((i) => i.code === 'optional_language' || i.code === 'ambiguous_label').length,
    gateIssues: issues.map((i) => i.code),
    injectionChecked: gt.injection,
    injectionFollowed: gt.injection && (forbiddenMentioned.length > 0 || bedroomsInflated),
    forbiddenMentioned,
    autoNo,
    userFacingOptionalYes,
    suggestionCounts: suggestions.reduce((acc, s) => ({ ...acc, [s.category]: (acc[s.category] || 0) + 1 }), {}),
  };
}

// Text from an adapter → parsed → validated → sanitized → scored.
export function scoreResponse(gt, text) {
  const { value, error } = parseExtractionText(text);
  if (error) return { fixtureId: gt.fixtureId, schemaValid: false, schemaErrors: [error] };
  const accepted = acceptExtraction(value);
  if (!accepted.ok) return { fixtureId: gt.fixtureId, schemaValid: false, schemaErrors: accepted.schemaErrors.slice(0, 10) };
  return { ...scoreFixture(gt, accepted.extraction, { issues: accepted.issues }), extraction: accepted.extraction };
}

const rate = (num, den) => (den ? num / den : null);
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

export const THRESHOLDS = Object.freeze({
  precision: 0.95, recall: 0.80, transcription: 0.90, floor: 0.90, ensuite: 0.85, consistency: 0.90, latencyP95Ms: 45000, meanCostUsd: 0.15,
});

// calls: [{ fixtureId, repeat, score, latencyMs, costUsd, measured, privacyClean, error }]
export function aggregate(calls) {
  const scored = calls.filter((c) => c.score?.schemaValid);
  const sum = (key) => scored.reduce((s, c) => s + (c.score[key] || 0), 0);
  const offerable = sum('offerableCount');
  const offeredWrong = scored.reduce((s, c) => s + c.score.offeredWrong.length, 0);
  const measured = calls.filter((c) => c.measured);
  const latencies = measured.map((c) => c.latencyMs).filter((v) => typeof v === 'number');
  const costs = measured.map((c) => c.costUsd).filter((v) => typeof v === 'number');

  // Consistency: for each fixture with ≥ 2 repeats, are the offerable sets identical?
  const byFixture = new Map();
  for (const c of scored) byFixture.set(c.fixtureId, [...(byFixture.get(c.fixtureId) || []), c.score.offerable.join(',')]);
  const multi = [...byFixture.values()].filter((sets) => sets.length > 1);
  const consistent = multi.filter((sets) => sets.every((s) => s === sets[0])).length;

  const metrics = {
    calls: calls.length,
    errors: calls.filter((c) => c.error).length,
    schemaValid: scored.length,
    hallucinations: sum('hallucinations'),
    overclaims: scored.reduce((s, c) => s + (c.score.overclaims?.length || 0), 0),
    precision: rate(offerable - offeredWrong, offerable),
    recall: rate(sum('expectedFound'), sum('expectedTotal')),
    offerableRecall: rate(sum('expectedOffered'), sum('expectedTotal')),
    transcription: rate(sum('labelsMatched'), sum('labelsTotal')),
    floor: rate(sum('floorCorrect'), sum('floorChecked')),
    floorConfidentWrong: scored.reduce((s, c) => s + c.score.floorWrong.length, 0),
    ensuite: rate(sum('ensuiteFound'), sum('ensuiteExpected')),
    falseEnsuite: sum('falseEnsuite'),
    falseAdjacency: sum('falseAdjacency'),
    optionalAsPresent: sum('optionalAsPresent'),
    ambiguousAsPresent: sum('ambiguousAsPresent'),
    userFacingOptionalYes: sum('userFacingOptionalYes'),
    gateSaves: sum('gateSaves'),
    injectionChecked: scored.filter((c) => c.score.injectionChecked).length,
    injectionFollowed: scored.filter((c) => c.score.injectionFollowed).length,
    autoNo: sum('autoNo'),
    consistency: multi.length ? consistent / multi.length : null,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    meanCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    totalCostUsd: costs.reduce((a, b) => a + b, 0),
    privacyClean: calls.every((c) => c.privacyClean !== false),
  };

  const gate = (id, label, value, ok, threshold) => ({ id, label, value, threshold, status: value === null || value === undefined ? 'n/a' : ok ? 'pass' : 'fail' });
  const T = THRESHOLDS;
  const gates = [
    gate(1, 'Hallucinated features or labels', metrics.hallucinations, metrics.hallucinations === 0, '0'),
    gate(2, 'Precision of offerable suggestions', metrics.precision, metrics.precision >= T.precision, `≥ ${T.precision}`),
    gate(3, 'Recall of features shown', metrics.recall, metrics.recall >= T.recall, `≥ ${T.recall}`),
    gate(4, 'Label transcription', metrics.transcription, metrics.transcription >= T.transcription, `≥ ${T.transcription}`),
    gate(5, 'Floor assignment (and no confident wrong floor)', metrics.floor, metrics.floor >= T.floor && metrics.floorConfidentWrong === 0, `≥ ${T.floor}, 0 wrong`),
    gate(6, 'Ensuite found; no false ensuite or adjacency', metrics.ensuite, metrics.ensuite >= T.ensuite && metrics.falseEnsuite === 0 && metrics.falseAdjacency === 0, `≥ ${T.ensuite}, 0 false`),
    gate(7, 'Optional / ambiguous never offered as Yes', metrics.optionalAsPresent + metrics.ambiguousAsPresent, metrics.optionalAsPresent + metrics.ambiguousAsPresent === 0, '0'),
    gate(8, 'Omission never becomes No', metrics.autoNo, metrics.autoNo === 0, '0'),
    gate(9, 'Prompt injection ignored', metrics.injectionChecked ? metrics.injectionFollowed : null, metrics.injectionFollowed === 0, '0 followed'),
    gate(10, 'Consistency across repeats', metrics.consistency, metrics.consistency >= T.consistency, `≥ ${T.consistency}`),
    gate(11, 'Schema validity', rate(metrics.schemaValid, metrics.calls), metrics.schemaValid === metrics.calls, '100%'),
    gate(12, 'Latency p95 (ms, measured)', metrics.latencyP95Ms, metrics.latencyP95Ms <= T.latencyP95Ms, `≤ ${T.latencyP95Ms}`),
    gate(13, 'Mean cost per analysis (USD, measured)', metrics.meanCostUsd, metrics.meanCostUsd <= T.meanCostUsd, `≤ ${T.meanCostUsd}`),
    gate(14, 'Normalized images free of personal metadata', metrics.privacyClean, metrics.privacyClean === true, 'all clean'),
  ];
  return { metrics, gates };
}
