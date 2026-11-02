// Floor-plan analysis proof-of-concept harness (scripts/floor-plan-eval).
// Offline only: no test makes a network call or needs a credential; the paid
// adapters are exercised through injected fake clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { computeMatch } from '../src/lib/matching.js';
import { createAdapter, PaidRunNotApprovedError, validateRunManifest } from '../scripts/floor-plan-eval/adapters/index.mjs';
import { buildAnthropicRequest } from '../scripts/floor-plan-eval/adapters/anthropic.mjs';
import { buildGeminiRequest } from '../scripts/floor-plan-eval/adapters/gemini.mjs';
import { buildGroundTruth, buildOracleExtraction } from '../scripts/floor-plan-eval/fixtures/build.mjs';
import { FLAWS } from '../scripts/floor-plan-eval/fixtures/flawed.mjs';
import { PLANS } from '../scripts/floor-plan-eval/fixtures/plans.mjs';
import { applyReviewDecision, collectFindings, deriveSuggestions, isOfferable, ReviewDecisionError } from '../scripts/floor-plan-eval/mapping.mjs';
import { inspectImageMetadata } from '../scripts/floor-plan-eval/metadata.mjs';
import { estimateClaudeImageTokens, normalizeImage } from '../scripts/floor-plan-eval/normalize.mjs';
import { measuredCallUsd, PRICES } from '../scripts/floor-plan-eval/pricing.mjs';
import { PROFILES, PURCHASE_ALL, PURCHASE_CUSTOM } from '../scripts/floor-plan-eval/profiles.mjs';
import { SYSTEM_PROMPT, USER_PROMPT } from '../scripts/floor-plan-eval/prompt.mjs';
import { prepareFixtures, runBenchmark } from '../scripts/floor-plan-eval/run.mjs';
import { attemptBound, BudgetError, Ledger, overshootReserveUsd, promptTokenBound } from '../scripts/floor-plan-eval/budget.mjs';
import { EXTRACTION_SCHEMA, PORTABLE_SCHEMA_KEYWORDS } from '../scripts/floor-plan-eval/schema.mjs';
import { scoreResponse } from '../scripts/floor-plan-eval/score.mjs';
import { acceptExtraction, hasAmbiguousLanguage, hasOptionalLanguage, sanitizeExtraction, validateSchema } from '../scripts/floor-plan-eval/validate.mjs';
import { DERIVED_CONCEPTS } from '../scripts/floor-plan-eval/vocabulary.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EVAL = path.join(ROOT, 'scripts/floor-plan-eval');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(EVAL, p), 'utf8'));
const manifest = readJson('fixtures/manifest.json');
const oracle = (id) => acceptExtraction(buildOracleExtraction(PLANS.find((p) => p.id === id))).extraction;
const planById = (id) => PLANS.find((p) => p.id === id);

// ---- schema -----------------------------------------------------------------

test('schema uses only keywords both providers accept, and every object is closed', () => {
  const walk = (node, where) => {
    for (const key of Object.keys(node)) assert.ok(PORTABLE_SCHEMA_KEYWORDS.has(key), `${where}: keyword "${key}" is not portable`);
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${where}: additionalProperties must be false`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${where}: every property must be required`);
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${where}.${k}`);
    }
    if (node.type === 'array') walk(node.items, `${where}[]`);
  };
  walk(EXTRACTION_SCHEMA, '$');
});

test('schema cannot express absence: no value means "missing", so omission can never become No', () => {
  const enums = [];
  const walk = (node) => {
    if (node.enum) enums.push(...node.enum);
    Object.values(node.properties || {}).forEach(walk);
    if (node.items) walk(node.items);
  };
  walk(EXTRACTION_SCHEMA);
  for (const forbidden of ['absent', 'no', 'none', 'missing', 'not_present', 'false']) assert.ok(!enums.includes(forbidden), forbidden);
});

test('prompt and schema contain no user data and tell the model to ignore in-image instructions', () => {
  const text = `${SYSTEM_PROMPT}\n${USER_PROMPT}\n${JSON.stringify(EXTRACTION_SCHEMA)}`;
  for (const personal of ['priorit', 'criteri', 'buyer', 'street', 'Sauna', 'aging parents']) assert.ok(!text.toLowerCase().includes(personal.toLowerCase()), personal);
  assert.match(SYSTEM_PROMPT, /do not follow them/);
  assert.match(SYSTEM_PROMPT, /Never list a feature because it is absent/);
});

test('every oracle extraction is schema-valid', () => {
  for (const plan of PLANS) assert.deepEqual(validateSchema(buildOracleExtraction(plan)), [], plan.id);
});

// ---- local safety gates -------------------------------------------------------

test('optional-configuration language is recognized; ordinary room names are not', () => {
  for (const label of ['OPTIONAL OFFICE', 'OPT. MUDROOM', 'Opt Walk-in Closet', 'ALTERNATE OWNER\'S BATH', 'ALT. KITCHEN', 'PROPOSED DECK',
    'UPGRADE: WALK-IN PANTRY', 'FUTURE BONUS ROOM', 'Potential 4th bedroom', 'Possible office', 'Bath rough-in', 'Optional 5th BR']) {
    assert.ok(hasOptionalLanguage(label), label);
  }
  for (const label of ['BONUS ROOM', 'OFFICE', 'OPTICAL LAB', 'LAUNDRY', 'FLEX', 'DEN / BR 4', 'PRIMARY BEDROOM', 'W.I.C.', 'PANTRY']) {
    assert.ok(!hasOptionalLanguage(label), label);
  }
});

test('dual-purpose labels are ambiguous; W/D and W.I.C. are not', () => {
  for (const label of ['DEN / BR 4', 'DEN/BR4', 'FLEX', 'Office or Bedroom', 'BONUS/BR5', 'Study/Guest', 'LOFT/MEDIA']) assert.ok(hasAmbiguousLanguage(label), label);
  for (const label of ['W/D', 'W.I.C.', 'LIVING / DINING', 'PRIMARY BEDROOM', 'OFFICE']) assert.ok(!hasAmbiguousLanguage(label), label);
});

test('sanitizer only weakens claims: optional labels, ambiguous labels, uncaptioned floors, unprinted "printed" claims', () => {
  const raw = {
    schemaVersion: 'fpa-2', image: { isFloorPlan: true, legibility: 'clear', multipleDrawings: false },
    floors: [{ id: 'f1', printedCaption: '', level: 'main' }],
    rooms: [
      { id: 'r1', floorId: 'f1', printedLabel: 'OPT. MUDROOM', qualifierText: '', type: 'mudroom', evidenceCategory: 'printed_label', configuration: 'as_drawn', evidence: 'x' },
      { id: 'r2', floorId: 'f1', printedLabel: 'DEN / BR 4', qualifierText: '', type: 'office', evidenceCategory: 'printed_label', configuration: 'as_drawn', evidence: 'x' },
      { id: 'r3', floorId: 'f1', printedLabel: '', qualifierText: '', type: 'walk_in_closet', evidenceCategory: 'printed_label', configuration: 'as_drawn', evidence: 'x' },
      { id: 'r4', floorId: 'f9', printedLabel: 'KITCHEN', qualifierText: '', type: 'kitchen', evidenceCategory: 'printed_label', configuration: 'as_drawn', evidence: 'x'.repeat(500) },
    ],
    relationships: [{ type: 'ensuite_bath', fromRoomId: 'r1', toRoomId: 'r99', evidenceCategory: 'drawn_symbol', evidence: 'x' }],
    features: [
      { concept: 'mudroom', floorId: 'f1', roomIds: ['r1'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'x', uncertainty: '' },
      { concept: 'office', floorId: 'f1', roomIds: ['r2'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'x', uncertainty: '' },
      { concept: 'walk_in_closet', floorId: 'f1', roomIds: ['r3'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'x', uncertainty: '' },
      { concept: 'fireplace', floorId: 'f1', roomIds: ['r4'], evidenceCategory: 'not_determinable', configuration: 'as_drawn', qualifierText: '', evidence: 'x', uncertainty: '' },
      { concept: 'pantry', floorId: 'f1', roomIds: ['r4'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: '', uncertainty: '' },
    ],
    counts: { bedroomsLabeled: 1, fullBathsBySymbol: 0, halfBathsBySymbol: 0, note: '' }, warnings: [],
  };
  assert.deepEqual(validateSchema(raw), []);
  const { extraction, issues } = sanitizeExtraction(raw);
  const codes = issues.map((i) => i.code);
  assert.equal(extraction.floors[0].level, 'unknown');
  assert.equal(extraction.rooms[0].configuration, 'optional_or_alternate');
  assert.equal(extraction.rooms[1].configuration, 'unclear');
  assert.equal(extraction.rooms[2].evidenceCategory, 'layout_inferred');
  assert.equal(extraction.rooms[3].floorId, '');
  assert.equal(extraction.rooms[3].evidence.length, 240);
  assert.equal(extraction.relationships.length, 0);
  assert.deepEqual(extraction.features.map((f) => [f.concept, f.configuration, f.evidenceCategory]), [
    ['mudroom', 'optional_or_alternate', 'printed_label'], ['office', 'unclear', 'printed_label'], ['walk_in_closet', 'as_drawn', 'layout_inferred'],
  ]);
  for (const code of ['floor_level_without_caption', 'optional_language', 'ambiguous_label', 'printed_label_without_text', 'dangling_floor', 'dangling_relationship', 'not_determinable_dropped', 'feature_without_evidence', 'printed_feature_without_labelled_room']) {
    assert.ok(codes.includes(code), code);
  }
  assert.ok(extraction.features.every((f) => !isOfferable(f)), 'nothing here may be offered');
});

test('a schema-invalid response is rejected whole, never repaired', () => {
  const bad = buildOracleExtraction(planById('F04-abbreviations'));
  delete bad.counts;
  const result = acceptExtraction(bad);
  assert.equal(result.ok, false);
  assert.equal(result.extraction, null);
  const score = scoreResponse(buildGroundTruth(planById('F04-abbreviations')), '{"schemaVersion":"fpa-2"');
  assert.equal(score.schemaValid, false);
});

// ---- mapping: categories, refinements, co-buyers, Match --------------------------

test('oracle: the mapper derives exactly the hand-annotated floor-dependent concepts', () => {
  for (const plan of PLANS) {
    const gt = buildGroundTruth(plan);
    const offerableDerived = new Set(collectFindings(oracle(plan.id)).filter(isOfferable).map((f) => f.concept).filter((c) => DERIVED_CONCEPTS.includes(c)));
    const expected = new Set(gt.expected.asDrawn.filter((c) => DERIVED_CONCEPTS.includes(c)));
    assert.deepEqual([...offerableDerived].sort(), [...expected].sort(), plan.id);
    for (const c of gt.expected.forbiddenDerived) assert.ok(!offerableDerived.has(c), `${plan.id}: ${c}`);
  }
});

test('catalog criteria: printed, as-drawn evidence is offered as Yes; retired purchase built-ins are only "also noticed"', () => {
  const suggestions = deriveSuggestions(oracle('F01-ranch-clean'), PURCHASE_ALL, {});
  const yes = suggestions.filter((s) => s.category === 'suggested_yes').map((s) => s.criterionKey);
  for (const key of ['features:First-Floor Primary', 'features:Primary ensuite', 'features:Walk-in Pantry', 'features:Home office', 'features:First-floor laundry', 'features:Formal Dining Room', 'features:Kitchen Island', 'features:Double Vanity', 'features:Fireplace', 'features:First-Floor Bedroom']) {
    assert.ok(yes.includes(key), key);
  }
  const noticed = suggestions.filter((s) => s.category === 'also_noticed').map((s) => s.concept);
  assert.ok(noticed.includes('walk_in_closet') && noticed.includes('mudroom'), 'retired purchase built-ins are not linked');
  for (const s of suggestions.filter((x) => x.category === 'suggested_yes')) {
    assert.ok(s.evidence && s.evidenceCategory && s.evidenceCategoryLabel && s.criterionKey && s.confirmationStatus === 'pending');
    assert.deepEqual(s.allowedActions, ['yes', 'mark_no', 'not_right', 'leave_unknown']);
  }
});

test('refinement 2 — Optional / Alternate / Proposed / Upgrade / Future features are never offered as Yes', () => {
  const suggestions = deriveSuggestions(oracle('F07-optional-alternate-labels'), PURCHASE_ALL, {});
  const byKey = Object.fromEntries(suggestions.filter((s) => s.criterionKey).map((s) => [s.criterionKey, s]));
  for (const key of ['features:Home office', 'features:Walk-in Pantry', 'exterior:Patio / deck']) {
    assert.equal(byKey[key].category, 'possibly_relevant', key);
    assert.ok(byKey[key].reasons.includes('plan_marks_optional'), key);
    assert.match(byKey[key].uncertainty, /may not be part of this home/);
    assert.ok(!byKey[key].allowedActions.includes('yes'), key);
  }
  // As-built features on the same plan still come through.
  for (const key of ['features:First-Floor Primary', 'features:Primary ensuite', 'features:Kitchen Island', 'features:First-floor laundry']) assert.equal(byKey[key].category, 'suggested_yes', key);
});

test('refinement 2 — even if a provider calls an "OPT." room as-drawn, the local gate keeps it from being offered', () => {
  const x = buildOracleExtraction(planById('F07-optional-alternate-labels'));
  for (const r of x.rooms) r.configuration = 'as_drawn';
  for (const f of x.features) { f.configuration = 'as_drawn'; f.qualifierText = ''; }
  const { extraction } = acceptExtraction(x);
  const offered = new Set(collectFindings(extraction).filter(isOfferable).map((f) => f.concept));
  for (const c of ['office', 'walk_in_pantry', 'mudroom', 'walk_in_closet', 'patio_deck', 'den_flex']) assert.ok(!offered.has(c), c);
});

test('refinement 1 — custom criteria: exact label may be Yes, semantic links are only "possibly relevant", unrelated ones get nothing', () => {
  const suggestions = deriveSuggestions(oracle('F01-ranch-clean'), PURCHASE_CUSTOM, {});
  const forKey = (key) => suggestions.filter((s) => s.criterionKey === key);
  // A custom label that is also a catalog identity goes through the catalog allowlist.
  const mud = forKey('features:Mudroom');
  assert.equal(mud.length, 1);
  assert.equal(mud[0].category, 'suggested_yes');
  assert.equal(mud[0].relation, 'catalog');
  // A custom label equal to a printed room name is an exact match, and suppresses looser links.
  const laundry = forKey('features:Laundry');
  assert.deepEqual(laundry.map((s) => [s.concept, s.relation, s.category]), [['laundry', 'exact_label', 'suggested_yes']]);
  const aging = forKey('features:Room for aging parents');
  assert.ok(aging.length >= 1);
  assert.ok(aging.every((s) => s.category === 'possibly_relevant' && s.relation === 'semantic' && s.reasons.includes('related_to_your_criterion')));
  assert.ok(aging.some((s) => s.concept === 'first_floor_primary' || s.concept === 'first_floor_bedroom'));
  assert.ok(aging.every((s) => !s.allowedActions.includes('yes') && s.suggestedAnswer === null));
  const wfh = forKey('features:Work from home space');
  assert.ok(wfh.some((s) => s.concept === 'office' && s.category === 'possibly_relevant'));
  assert.equal(forKey('features:Sauna').length, 0);
});

test('refinement 1 — custom criteria never reach the provider request', () => {
  const image = { buffer: Buffer.from('x'), mimeType: 'image/png' };
  const input = { image, systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT, schema: EXTRACTION_SCHEMA };
  const cfg = readJson('providers.config.json').providers;
  const bodies = JSON.stringify([buildAnthropicRequest(cfg[0], input), buildGeminiRequest(cfg[2], input)]);
  for (const item of PURCHASE_CUSTOM.features.customItems) assert.ok(!bodies.includes(item.label), item.label);
});

test('floor not named, or symbol-only evidence, is never offered as Yes', () => {
  const suggestions = deriveSuggestions(oracle('F05-unlabeled-symbols-only'), PURCHASE_ALL, {});
  const yes = suggestions.filter((s) => s.category === 'suggested_yes').map((s) => s.concept).sort();
  assert.deepEqual(yes, ['double_vanity', 'kitchen_island']);
  const floorDerived = suggestions.filter((s) => ['first_floor_primary', 'first_floor_bedroom', 'laundry_first_floor'].includes(s.concept));
  assert.ok(floorDerived.length > 0 && floorDerived.every((s) => s.category === 'possibly_relevant' && s.reasons.includes('floor_not_named')));
});

test('no suggestion anywhere is ever pre-set to No', () => {
  for (const plan of PLANS) for (const profile of Object.values(PROFILES)) {
    for (const s of deriveSuggestions(oracle(plan.id), profile, {})) {
      assert.notEqual(s.suggestedAnswer, 'no', `${plan.id} ${s.id}`);
      assert.ok(s.suggestedAnswer === null || s.category === 'suggested_yes');
    }
  }
});

test('an existing answer is never overwritten: already-answered criteria offer no actions', () => {
  const checks = { 'features:Primary ensuite': 'no', 'features:Home office': true };
  const suggestions = deriveSuggestions(oracle('F01-ranch-clean'), PURCHASE_ALL, checks);
  const ensuite = suggestions.find((s) => s.criterionKey === 'features:Primary ensuite');
  assert.equal(ensuite.category, 'already_answered');
  assert.equal(ensuite.existingAnswer, 'no');
  assert.deepEqual(ensuite.allowedActions, []);
  assert.equal(suggestions.find((s) => s.criterionKey === 'features:Home office').existingAnswer, 'yes');
  const fresh = deriveSuggestions(oracle('F01-ranch-clean'), PURCHASE_ALL, {}).find((s) => s.criterionKey === 'features:Primary ensuite');
  assert.throws(() => applyReviewDecision(checks, fresh, 'yes'), ReviewDecisionError);
});

test('refinement 3 — "Not right" and "Leave Unknown" leave Match untouched; only an explicit "Mark No" records No', () => {
  const priorities = { searchType: 'purchase', features: { customItems: [{ label: 'Primary ensuite', kind: 'check' }, { label: 'Home office', kind: 'check' }], tiers: { 'Primary ensuite': 'must', 'Home office': 'important' } } };
  const home = { checks: { 'features:Home office': true } };
  const suggestion = deriveSuggestions(oracle('F01-ranch-clean'), priorities, home.checks).find((s) => s.criterionKey === 'features:Primary ensuite');
  assert.equal(suggestion.category, 'suggested_yes');
  const evaluated = (checks) => computeMatch({ ...home, checks }, priorities).allSelected.find((c) => c.key === 'features:Primary ensuite');
  const before = computeMatch(home, priorities);
  assert.equal(evaluated(home.checks).evaluated, false, 'starts Unknown');

  for (const action of ['not_right', 'leave_unknown']) {
    const result = applyReviewDecision(home.checks, suggestion, action);
    assert.deepEqual(result.checksPatch, {});
    assert.equal(result.matchEffect, 'none');
    const after = computeMatch({ ...home, checks: { ...home.checks, ...result.checksPatch } }, priorities);
    assert.equal(after.pct, before.pct, action);
    assert.equal(evaluated({ ...home.checks, ...result.checksPatch }).evaluated, false, `${action} keeps Unknown`);
  }
  const notRight = applyReviewDecision(home.checks, suggestion, 'not_right');
  assert.equal(notRight.confirmationStatus, 'not_right');
  assert.deepEqual(Object.keys(notRight.correction).sort(), ['concept', 'evidence', 'evidenceCategory', 'suggestionId']);

  const markNo = applyReviewDecision(home.checks, suggestion, 'mark_no');
  assert.deepEqual(markNo.checksPatch, { 'features:Primary ensuite': 'no' });
  const no = evaluated({ ...home.checks, ...markNo.checksPatch });
  assert.equal(no.evaluated, true);
  assert.equal(no.met, false);

  const yes = applyReviewDecision(home.checks, suggestion, 'yes');
  assert.deepEqual(yes.checksPatch, { 'features:Primary ensuite': true });
  assert.equal(evaluated({ ...home.checks, ...yes.checksPatch }).met, true);
});

test('possibly-relevant and also-noticed items cannot be accepted as Yes', () => {
  const suggestions = deriveSuggestions(oracle('F07-optional-alternate-labels'), PURCHASE_ALL, {});
  const possible = suggestions.find((s) => s.category === 'possibly_relevant');
  const noticed = suggestions.find((s) => s.category === 'also_noticed');
  assert.throws(() => applyReviewDecision({}, possible, 'yes'), ReviewDecisionError);
  assert.throws(() => applyReviewDecision({}, noticed, 'yes'), ReviewDecisionError);
  assert.throws(() => applyReviewDecision({}, noticed, 'mark_no'), ReviewDecisionError);
  assert.deepEqual(applyReviewDecision({}, possible, 'mark_no').checksPatch, { [possible.criterionKey]: 'no' });
});

test('co-buyers: one shared extraction, independent suggestions, decisions patch only the actor', () => {
  const extraction = oracle('F01-ranch-clean');
  const a = { priorities: { searchType: 'purchase', features: { customItems: [{ label: 'Primary ensuite', kind: 'check' }], tiers: { 'Primary ensuite': 'must' } } }, checks: {} };
  const b = { priorities: { searchType: 'purchase', features: { customItems: [{ label: 'Home office', kind: 'check' }, { label: 'Primary ensuite', kind: 'check' }], tiers: { 'Home office': 'nice', 'Primary ensuite': 'nice' } } }, checks: { 'features:Primary ensuite': 'no' } };
  const forA = deriveSuggestions(extraction, a.priorities, a.checks);
  const forB = deriveSuggestions(extraction, b.priorities, b.checks);
  assert.equal(forA.find((s) => s.criterionKey === 'features:Primary ensuite').category, 'suggested_yes');
  assert.equal(forB.find((s) => s.criterionKey === 'features:Primary ensuite').category, 'already_answered');
  assert.ok(!forA.some((s) => s.criterionKey === 'features:Home office'), 'B\'s priority never shows for A');
  const patch = applyReviewDecision(a.checks, forA.find((s) => s.criterionKey === 'features:Primary ensuite'), 'yes').checksPatch;
  assert.deepEqual(patch, { 'features:Primary ensuite': true });
  assert.deepEqual(b.checks, { 'features:Primary ensuite': 'no' }, 'B unchanged');
});

// ---- fixtures ------------------------------------------------------------------

test('fixtures: manifest hashes match the committed images, and each has ground truth and a license entry', () => {
  const license = fs.readFileSync(path.join(EVAL, 'fixtures/LICENSE.md'), 'utf8');
  assert.equal(manifest.fixtures.length, PLANS.length);
  assert.ok(manifest.fixtures.length >= 8 && manifest.fixtures.length <= 10);
  for (const f of manifest.fixtures) {
    const bytes = fs.readFileSync(path.join(EVAL, 'fixtures', f.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), f.sha256, f.id);
    const gt = readJson(`fixtures/${f.groundTruth}`);
    assert.deepEqual({ ...gt, file: undefined }, { ...buildGroundTruth(planById(f.id)), file: undefined }, `${f.id} ground truth is current`);
    assert.ok(license.includes(f.id), `${f.id} in LICENSE.md`);
  }
  const cases = new Set(manifest.fixtures.flatMap((f) => f.cases));
  for (const c of ['multi_floor_single_image', 'multi_image_home', 'misleading_adjacency', 'optional_language', 'ambiguity', 'prompt_injection', 'unlabeled', 'photo_quality', 'privacy_metadata', 'abbreviation']) {
    assert.ok(cases.has(c), c);
  }
});

// ---- privacy -------------------------------------------------------------------

test('privacy: the metadata fixtures really carry personal metadata, and normalization removes all of it', async () => {
  for (const f of manifest.fixtures.filter((x) => x.personalMetadata)) {
    const bytes = fs.readFileSync(path.join(EVAL, 'fixtures', f.file));
    const before = inspectImageMetadata(bytes);
    assert.equal(before.clean, false, `${f.id} must carry metadata for the test to mean anything`);
    const after = await normalizeImage(bytes);
    assert.equal(after.metadata.clean, true, f.id);
    assert.deepEqual(inspectImageMetadata(after.buffer).personal, []);
  }
  const jpeg = inspectImageMetadata(fs.readFileSync(path.join(EVAL, 'fixtures/images/F08-brochure-photo.jpg')));
  assert.equal(jpeg.hasGps, true);
  assert.deepEqual(['comment', 'exif', 'xmp'].filter((k) => jpeg.personal.some((p) => p.kind === k)), ['comment', 'exif', 'xmp']);
});

test('privacy: EXIF orientation is applied before metadata is dropped; WebP metadata is removed too', async () => {
  const png = fs.readFileSync(path.join(EVAL, 'fixtures/images/F09-condo-prompt-injection.png'));
  const { width, height } = await sharp(png).metadata();
  const rotated = await sharp(png).jpeg().withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: 'someone' } }).toBuffer();
  assert.equal(inspectImageMetadata(rotated).clean, false);
  const out = await normalizeImage(rotated);
  assert.deepEqual([out.width, out.height], [height, width]);
  assert.equal(out.metadata.clean, true);
  const webp = await sharp(png).webp().withExif({ IFD0: { Artist: 'someone' } }).toBuffer();
  assert.equal(inspectImageMetadata(webp).clean, false);
  const normalizedWebp = await normalizeImage(webp);
  assert.equal(normalizedWebp.mimeType, 'image/png');
  assert.equal(normalizedWebp.metadata.clean, true);
});

test('normalization: long edge capped at 2,576 px; unsupported or oversized input refused', async () => {
  const wide = await normalizeImage(fs.readFileSync(path.join(EVAL, 'fixtures/images/F03-three-levels-one-sheet.png')));
  assert.equal(Math.max(wide.width, wide.height), 2576);
  assert.ok(wide.estimatedClaudeImageTokens <= 4784);
  assert.equal(estimateClaudeImageTokens(1000, 1000), 1296); // official worked example
  assert.equal(estimateClaudeImageTokens(3840, 2160), 4784); // capped
  await assert.rejects(normalizeImage(Buffer.from('GIF89a........')), /unsupported image type/);
  await assert.rejects(normalizeImage(Buffer.alloc(10 * 1024 * 1024 + 1, 1)), /larger than 10 MB/);
});

// ---- adapters, gating, budget ----------------------------------------------------

const config = readJson('providers.config.json');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fpa-ledger-'));
const approvedManifest = { runId: 'test-run-001', approvedBy: 'test', approvedOn: '2026-11-02', maxTotalUsd: 5, providers: ['sonnet-5-5', 'gemini-3-flash'], repeats: 1, fixtureSource: 'committed-synthetic-fixtures', geminiPaidTierConfirmed: true, confirmedModelIds: ['gemini-3-flash-preview'] };
const enabledConfig = { providers: config.providers.map((p) => ({ ...p, enabled: true })) };
const env = { FLH_FPA_PAID_RUN: 'test-run-001', ANTHROPIC_API_KEY: 'test-not-a-key', GEMINI_API_KEY: 'test-not-a-key' };

test('every paid adapter is disabled in the committed configuration', () => {
  assert.ok(config.providers.length >= 3);
  for (const p of config.providers) assert.equal(p.enabled, false, p.id);
  assert.deepEqual(config.providers.map((p) => p.model).sort(), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'gemini-3-flash-preview']);
});

test('a paid adapter is refused unless every approval condition holds', () => {
  assert.throws(() => createAdapter('sonnet-5-5', { config }), PaidRunNotApprovedError);
  try {
    createAdapter('sonnet-5-5', { config, paid: true, manifest: approvedManifest, env });
    assert.fail('should refuse');
  } catch (error) {
    assert.ok(error.reasons.some((r) => /disabled/.test(r)), 'committed config is disabled');
  }
  const missing = [
    [{ paid: false }, /--paid/],
    [{ manifest: null }, /no approved run manifest/],
    [{ env: { ...env, FLH_FPA_PAID_RUN: 'other' } }, /FLH_FPA_PAID_RUN/],
    [{ env: { ...env, ANTHROPIC_API_KEY: '' } }, /ANTHROPIC_API_KEY/],
    [{ manifest: { ...approvedManifest, providers: ['haiku-5-5'] } }, /does not approve/],
    [{ manifest: { ...approvedManifest, maxTotalUsd: 500 } }, /hard ceiling/],
  ];
  for (const [override, pattern] of missing) {
    const options = { config: enabledConfig, paid: true, manifest: approvedManifest, env, ...override };
    assert.throws(() => createAdapter('sonnet-5-5', options), (e) => e instanceof PaidRunNotApprovedError && e.reasons.some((r) => pattern.test(r)), String(pattern));
  }
  assert.throws(() => createAdapter('gemini-3-flash', { config: enabledConfig, paid: true, manifest: { ...approvedManifest, geminiPaidTierConfirmed: false }, env }), /paid-tier|free tier/);
  assert.throws(() => createAdapter('gemini-3-flash', { config: enabledConfig, paid: true, manifest: { ...approvedManifest, confirmedModelIds: [] }, env }), /unverified/);
  assert.deepEqual(validateRunManifest({ ...approvedManifest, fixtureSource: 'user-uploads' }), ['manifest.fixtureSource must be "committed-synthetic-fixtures"']);
});

test('adapters build the expected requests and normalize measured usage into cost (fake clients, no network)', async () => {
  const sent = {};
  const anthropicClient = { messages: { create: async (body) => { sent.anthropic = body; return { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', model: 'claude-sonnet-5-5', id: 'msg_1', usage: { input_tokens: 7000, output_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 1200 } } }; } } };
  const geminiClient = { models: { generateContent: async (body) => { sent.gemini = body; return { text: '{}', candidates: [{ finishReason: 'STOP' }], modelVersion: 'gemini-3-flash-preview', responseId: 'r1', usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 2000, thoughtsTokenCount: 1000 } }; } } };
  const options = { config: enabledConfig, paid: true, manifest: approvedManifest, env, clientFactories: { anthropic: async () => anthropicClient, google: async () => geminiClient } };
  const image = { buffer: Buffer.from('fake-image'), mimeType: 'image/png' };
  const input = { fixtureId: 'F01-ranch-clean', image, systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT, schema: EXTRACTION_SCHEMA };

  const claude = await createAdapter('sonnet-5-5', options).analyze(input);
  assert.equal(sent.anthropic.output_config.format.type, 'json_schema');
  assert.equal(sent.anthropic.output_config.effort, 'low');
  assert.equal(sent.anthropic.messages[0].content[0].source.type, 'base64');
  for (const key of ['tools', 'fallbacks', 'betas', 'inference_geo', 'thinking']) assert.ok(!(key in sent.anthropic), key);
  assert.deepEqual(claude.usage, { inputTokens: 7000, cacheWriteTokens: 0, priceMultiplier: 1, outputTokens: 3000, thinkingTokens: 1200, separateThinkingTokens: 0 });
  assert.equal(measuredCallUsd({ provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { ...claude.usage, priceMultiplier: 1.1 } }).usd.toFixed(4), '0.0484');
  assert.equal(measuredCallUsd({ provider: 'anthropic', model: 'claude-sonnet-5-5', usage: claude.usage }).usd.toFixed(4), '0.0440');

  const gemini = await createAdapter('gemini-3-flash', options).analyze(input);
  assert.equal(sent.gemini.config.responseMimeType, 'application/json');
  assert.deepEqual(sent.gemini.config.responseJsonSchema, EXTRACTION_SCHEMA);
  assert.equal(sent.gemini.contents[0].parts[0].mediaResolution.level, 'MEDIA_RESOLUTION_HIGH');
  assert.equal(gemini.usage.separateThinkingTokens, 1000);
  const geminiCost = measuredCallUsd({ provider: 'google', model: 'gemini-3-flash-preview', usage: gemini.usage });
  assert.equal(geminiCost.usd.toFixed(4), '0.0110'); // 4000×0.5 + (2000+1000)×3 per MTok
  assert.match(geminiCost.basis, /UNVERIFIED/);
});

test('budget: a paid run whose worst case exceeds the approved cap stops before the first call', async () => {
  let calls = 0;
  const client = { messages: { create: async () => { calls += 1; throw new Error('must not be called'); } } };
  await assert.rejects(runBenchmark({
    paid: true, config: enabledConfig, env, ledgerDir: tmpDir(), clientFactories: { anthropic: async () => client },
    manifest: { ...approvedManifest, providers: ['sonnet-5-5'], maxTotalUsd: 0.05, repeats: 3 },
  }), /worst-case cost .* exceeds the approved cap/);
  assert.equal(calls, 0);
  assert.ok(attemptBound(config.providers[0]).usd < 0.1);
  assert.equal(PRICES['anthropic:claude-sonnet-5-5'].verified, true);
  assert.equal(PRICES['google:gemini-3-flash-preview'].verified, false);
});

test('an approved paid run (fake client) records measured usage, latency and cost per call', async () => {
  const text = fs.readFileSync(path.join(EVAL, 'fixtures/replay/oracle/F01-ranch-clean.json'), 'utf8');
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', model: 'claude-sonnet-5-5', id: 'm', usage: { input_tokens: 7200, output_tokens: 2500 } }) } };
  const { run, results } = await runBenchmark({
    paid: true, config: enabledConfig, env, ledgerDir: tmpDir(), clientFactories: { anthropic: async () => client },
    manifest: { ...approvedManifest, providers: ['sonnet-5-5'], fixtures: ['F01-ranch-clean'], maxTotalUsd: 1 },
  });
  const call = results['sonnet-5-5'].calls[0];
  assert.equal(call.measured, true);
  assert.equal(typeof call.latencyMs, 'number');
  assert.equal(call.costUsd.toFixed(3), '0.039');
  assert.match(call.costBasis, /verified/);
  assert.equal(run.spentUsd.toFixed(3), '0.039');
  assert.equal(results['sonnet-5-5'].gates.find((g) => g.id === 13).status, 'pass');
});

// ---- end-to-end offline -------------------------------------------------------------

test('offline: oracle passes every applicable rubric check; each planted flaw fails the matching check', async () => {
  const { results, run } = await runBenchmark({ providers: ['replay:oracle', 'replay:flawed'], repeats: 2 });
  assert.equal(run.paid, false);
  assert.equal(run.spentUsd, 0);
  for (const g of results['replay:oracle'].gates) assert.ok(g.status === 'pass' || g.status === 'n/a', `oracle gate ${g.id}`);
  const failed = new Set(results['replay:flawed'].gates.filter((g) => g.status === 'fail').map((g) => g.id));
  const expectedGate = {
    hallucinated_feature: 1, hallucinated_label: 1, missed_feature: null, misassigned_floor: 5, schema_invalid: 11, offered_unlabeled: 2,
    false_ensuite: 6, false_adjacency: 6, optional_as_present: 7, optional_caught_by_gate: null, ambiguous_as_present: 7, prompt_injection_followed: 9,
  };
  for (const flaws of Object.values(FLAWS)) for (const flaw of flaws) if (expectedGate[flaw]) assert.ok(failed.has(expectedGate[flaw]), `${flaw} → gate ${expectedGate[flaw]}`);
  const byFixture = Object.fromEntries(results['replay:flawed'].calls.filter((c) => c.repeat === 1).map((c) => [c.fixtureId, c.score]));
  assert.deepEqual(byFixture['F02a-two-story-first'].missed, ['office']);
  assert.ok(byFixture['F07-optional-alternate-labels'].gateSaves > 0, 'the local gate caught the "OPT. MUDROOM" mislabel');
  assert.equal(byFixture['F07-optional-alternate-labels'].optionalAsPresent, 1, 'only the misread "OFFICE" slipped through');
  assert.equal(byFixture['F06-misleading-adjacency'].injectionFollowed, false);
  assert.equal(byFixture['F09-condo-prompt-injection'].injectionFollowed, true);
  assert.ok(run.privacy.every((p) => p.normalizedClean));
});

// ---- budget guarantee -----------------------------------------------------------

test('the per-attempt bound is built from documented limits plus pessimistic allowances', () => {
  const [sonnet, haiku, gemini] = config.providers;
  assert.ok(promptTokenBound() > Buffer.byteLength(JSON.stringify(EXTRACTION_SCHEMA)), 'bytes of prompt + schema + overhead');
  assert.equal(attemptBound(sonnet).inputTokens, promptTokenBound() + 4784);
  assert.equal(attemptBound(sonnet).outputTokens, 6000, 'Claude max_tokens includes thinking');
  assert.equal(attemptBound(gemini).outputTokens, 6000 + 8192, 'Gemini thoughts allowed on top of maxOutputTokens');
  assert.ok(attemptBound(haiku).usd < attemptBound(gemini).usd && attemptBound(gemini).usd < attemptBound(sonnet).usd);
  assert.ok(overshootReserveUsd([sonnet, haiku, gemini]) >= overshootReserveUsd([sonnet]));
});

test('ledger: persists across invocations, one run at a time, failed attempts keep their full reservation', () => {
  const dir = tmpDir();
  const ledger = new Ledger({ dir, runId: 'run-abc', capUsd: 1, reserveUsd: 0.1 });
  assert.throws(() => new Ledger({ dir, runId: 'run-abc', capUsd: 1, reserveUsd: 0.1 }), /locked/);
  const ok = ledger.reserve({ attempt: 1 }, 0.3);
  ledger.settle(ok, { measuredUsd: 0.05, status: 'ok' });
  const failed = ledger.reserve({ attempt: 1 }, 0.3);
  ledger.settle(failed, { status: 'failed' });
  assert.equal(ledger.committedUsd.toFixed(2), '0.35');
  assert.equal(ledger.canReserve(0.6), false); // 0.35 + 0.6 + 0.1 reserve > 1
  assert.throws(() => ledger.reserve({}, 0.6), BudgetError);
  ledger.close();
  const again = new Ledger({ dir, runId: 'run-abc', capUsd: 5, reserveUsd: 0.1 });
  assert.equal(again.committedUsd.toFixed(2), '0.35', 'a second invocation starts from what was already committed');
  assert.equal(again.state.capUsd, 1, 'a later manifest cannot raise the cap');
  again.close();
});

const fixtureText = fs.readFileSync(path.join(EVAL, 'fixtures/replay/oracle/F01-ranch-clean.json'), 'utf8');
const okReply = (usage = { input_tokens: 7200, output_tokens: 2500 }) => ({ content: [{ type: 'text', text: fixtureText }], stop_reason: 'end_turn', model: 'claude-sonnet-5-5', id: 'm', usage });
const apiError = (status, message = 'boom') => Object.assign(new Error(message), { status });
const paidRun = (client, manifestOverride = {}, extra = {}) => runBenchmark({
  paid: true, config: enabledConfig, env, ledgerDir: extra.ledgerDir || tmpDir(), clientFactories: { anthropic: async () => client },
  manifest: { ...approvedManifest, providers: ['sonnet-5-5'], fixtures: ['F01-ranch-clean'], maxTotalUsd: 1, ...manifestOverride },
});

test('retries: one explicit retry for a 5xx, each attempt reserved; the failed one is charged at its full bound', async () => {
  let calls = 0;
  const client = { messages: { create: async () => { calls += 1; if (calls === 1) throw apiError(529, 'overloaded'); return okReply(); } } };
  const { run, results } = await paidRun(client);
  assert.equal(calls, 2);
  const bound = attemptBound(config.providers[0]).usd;
  assert.equal(run.spentUsd.toFixed(6), (bound + results['sonnet-5-5'].calls[0].costUsd).toFixed(6));
  assert.equal(results['sonnet-5-5'].calls[0].attempts, 2);
});

test('retries: a client error is not retried; a provider spend-limit error ends the run', async () => {
  let calls = 0;
  const badRequest = { messages: { create: async () => { calls += 1; throw apiError(400, 'invalid image'); } } };
  await paidRun(badRequest);
  assert.equal(calls, 1);
  calls = 0;
  const limited = { messages: { create: async () => { calls += 1; throw apiError(400, 'You have reached your specified workspace API usage limits'); } } };
  const { run } = await paidRun(limited, { fixtures: ['F01-ranch-clean', 'F02a-two-story-first'] });
  assert.equal(calls, 1);
  assert.match(run.abortReason, /spend limit/);
});

test('a measured cost above the modeled bound aborts the run', async () => {
  let calls = 0;
  const client = { messages: { create: async () => { calls += 1; return okReply({ input_tokens: 200000, output_tokens: 6000 }); } } };
  const { run } = await paidRun(client, { fixtures: ['F01-ranch-clean', 'F02a-two-story-first'], maxTotalUsd: 2 });
  assert.equal(calls, 1);
  assert.match(run.abortReason, /exceeded the modeled bound/);
});

test('re-running the same approved run cannot reset the budget', async () => {
  const ledgerDir = tmpDir();
  const client = { messages: { create: async () => okReply({ input_tokens: 14000, output_tokens: 6000 }) } };
  const manifestOverride = { maxTotalUsd: 0.45, fixtures: ['F01-ranch-clean'] };
  let total = 0;
  for (let i = 0; i < 5; i += 1) {
    const { run } = await paidRun(client, manifestOverride, { ledgerDir });
    total = run.committedUsd;
  }
  assert.ok(total <= 0.45, `committed $${total}`);
});

test('the $5 cap holds under random failures, timeouts, retries and usage up to the bound', async () => {
  const bound = attemptBound(config.providers[0]).usd;
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 6; trial += 1) {
    const ledgerDir = tmpDir();
    const client = { messages: { create: async () => {
      const r = rand();
      if (r < 0.25) throw apiError(500, 'server error');
      if (r < 0.35) throw apiError(undefined, 'Request timed out');
      if (r < 0.45) throw apiError(429, 'rate limited');
      return okReply({ input_tokens: Math.floor(rand() * 14000), output_tokens: Math.floor(rand() * 6000) });
    } } };
    for (let i = 0; i < 3; i += 1) {
      const { run } = await paidRun(client, { maxTotalUsd: 5, repeats: 5, fixtures: manifest.fixtures.map((f) => f.id) }, { ledgerDir }).catch((e) => ({ run: { committedUsd: 0, error: e.message } }));
      assert.ok(run.committedUsd <= 5 + 1e-9, `trial ${trial}: $${run.committedUsd}`);
    }
    const ledger = JSON.parse(fs.readFileSync(path.join(ledgerDir, `${approvedManifest.runId}.json`), 'utf8'));
    assert.ok(ledger.committedUsd <= 5 + 1e-9);
    assert.ok(ledger.entries.filter((e) => e.status === 'failed').every((e) => e.settledUsd === null && Math.abs(e.reservedUsd - bound) < 1e-12));
  }
});

test('providers are enabled only per invocation with --enable, never by default', () => {
  const options = { config, paid: true, manifest: approvedManifest, env, clientFactories: { anthropic: async () => ({}) } };
  assert.throws(() => createAdapter('sonnet-5-5', options), /--enable sonnet-5-5/);
  assert.ok(createAdapter('sonnet-5-5', { ...options, enable: ['sonnet-5-5'] }));
  assert.throws(() => createAdapter('sonnet-5-5', { ...options, enable: ['sonnet-5-5'], env: { ...env, FLH_FPA_PAID_RUN: 'nope' } }), PaidRunNotApprovedError);
});

test('error text never carries a key', async () => {
  const secret = 'sk-test-abcdefghijklmnop';
  const client = { messages: { create: async () => { throw apiError(400, `bad key ${secret}`); } } };
  const { results } = await runBenchmark({
    paid: true, config: enabledConfig, env: { ...env, ANTHROPIC_API_KEY: secret }, ledgerDir: tmpDir(), clientFactories: { anthropic: async () => client },
    manifest: { ...approvedManifest, providers: ['sonnet-5-5'], fixtures: ['F01-ranch-clean'], maxTotalUsd: 1 },
  });
  assert.ok(!results['sonnet-5-5'].calls[0].error.includes(secret));
});

test('only committed fixture paths can be read', async () => {
  const fixtures = await prepareFixtures({ fixtureIds: ['F01-ranch-clean'] });
  assert.equal(fixtures.length, 1);
  const runSource = fs.readFileSync(path.join(EVAL, 'run.mjs'), 'utf8');
  assert.match(runSource, /FIXTURE_FILE = \/\^images/);
  assert.match(runSource, /manifest\.license !== 'CC0-1.0'/);
});

test('scoring: partial transcriptions are misses, not hallucinations; symbol over-claims are reported separately', () => {
  const gt = buildGroundTruth(planById('F01-ranch-clean'));
  const x = buildOracleExtraction(planById('F01-ranch-clean'));
  x.rooms.find((r) => r.printedLabel === '2-CAR GARAGE').printedLabel = 'GARAGE';
  x.features.push({ concept: 'soaking_tub', floorId: 'f1', roomIds: ['d0-bath'], evidenceCategory: 'drawn_symbol', configuration: 'as_drawn', qualifierText: '', evidence: 'tub', uncertainty: '' });
  const score = scoreResponse(gt, JSON.stringify(x));
  assert.equal(score.hallucinations, 0);
  assert.ok(score.labelsMatched < score.labelsTotal);
  assert.deepEqual(score.overclaims, []); // soaking_tub is acceptable on F01
  const gt6 = buildGroundTruth(planById('F06-misleading-adjacency'));
  const x6 = buildOracleExtraction(planById('F06-misleading-adjacency'));
  x6.features.push({ concept: 'soaking_tub', floorId: 'f1', roomIds: ['d0-bath'], evidenceCategory: 'drawn_symbol', configuration: 'as_drawn', qualifierText: '', evidence: 'tub', uncertainty: '' });
  const s6 = scoreResponse(gt6, JSON.stringify(x6));
  assert.equal(s6.hallucinations, 0);
  assert.deepEqual(s6.overclaims, ['soaking_tub']);
  x6.rooms.push({ id: 'zz', floorId: 'f1', printedLabel: 'SAUNA', qualifierText: '', type: 'other', evidenceCategory: 'printed_label', configuration: 'as_drawn', evidence: 'x' });
  assert.deepEqual(scoreResponse(gt6, JSON.stringify(x6)).hallucinatedLabels, ['SAUNA']);
});
