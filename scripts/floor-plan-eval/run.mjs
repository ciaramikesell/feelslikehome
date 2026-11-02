#!/usr/bin/env node
// Floor-plan extraction benchmark runner.
//
// Offline (default, free, no network):
//   node scripts/floor-plan-eval/run.mjs
//   node scripts/floor-plan-eval/run.mjs --providers replay:oracle,replay:flawed --repeats 2
//
// Paid (ONLY with an approved run; see README "Paid run plan"):
//   FLH_FPA_PAID_RUN=<runId> node scripts/floor-plan-eval/run.mjs --paid --manifest scripts/floor-plan-eval/runs/approved-run.json
//
// Only the committed synthetic fixtures can be sent: each image's sha256 must
// match fixtures/manifest.json, and each normalized image must pass the
// independent metadata check, before any adapter sees it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapter } from './adapters/index.mjs';
import { inspectImageMetadata } from './metadata.mjs';
import { normalizeImage } from './normalize.mjs';
import { measuredCallUsd, priceFor, worstCaseCallUsd } from './pricing.mjs';
import { SYSTEM_PROMPT, USER_PROMPT } from './prompt.mjs';
import { buildReport } from './report.mjs';
import { EXTRACTION_SCHEMA } from './schema.mjs';
import { aggregate, scoreResponse } from './score.mjs';
import { PIPELINE_VERSION } from './vocabulary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function parseArgs(argv) {
  const args = { providers: null, repeats: null, fixtures: null, out: null, paid: false, manifest: null, label: null, estimate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--providers') args.providers = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--repeats') args.repeats = Number(next());
    else if (a === '--fixtures') args.fixtures = next().split(',').map((s) => s.trim());
    else if (a === '--out') args.out = next();
    else if (a === '--paid') args.paid = true;
    else if (a === '--manifest') args.manifest = next();
    else if (a === '--label') args.label = next();
    else if (a === '--estimate') args.estimate = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

// Loads, verifies and normalizes every selected fixture once.
export async function prepareFixtures({ fixtureIds = null } = {}) {
  const manifest = readJson(path.join(here, 'fixtures', 'manifest.json'));
  const selected = manifest.fixtures.filter((f) => !fixtureIds || fixtureIds.includes(f.id));
  if (fixtureIds && selected.length !== fixtureIds.length) throw new Error('unknown fixture id in --fixtures');
  const prepared = [];
  for (const fixture of selected) {
    const bytes = fs.readFileSync(path.join(here, 'fixtures', fixture.file));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha !== fixture.sha256) throw new Error(`${fixture.id}: image does not match fixtures/manifest.json — refusing to use it`);
    const original = inspectImageMetadata(bytes);
    const normalized = await normalizeImage(bytes); // throws if anything personal survives
    prepared.push({
      fixture,
      gt: readJson(path.join(here, 'fixtures', fixture.groundTruth)),
      image: { buffer: normalized.buffer, mimeType: normalized.mimeType },
      privacy: {
        fixtureId: fixture.id, originalPersonal: [...new Set(original.personal.map((f) => f.kind))], originalGps: original.hasGps,
        normalizedClean: normalized.metadata.clean, normalizedPersonal: normalized.metadata.personal.map((f) => f.kind),
        width: normalized.width, height: normalized.height, estimatedClaudeImageTokens: normalized.estimatedClaudeImageTokens,
      },
    });
  }
  return prepared;
}

function imageTokensFor(adapter, cfg, prepared) {
  if (adapter.provider === 'anthropic') return prepared.privacy.estimatedClaudeImageTokens;
  if (adapter.provider === 'google') return 2240; // ultra-high cap: conservative for a worst case
  return 0;
}

export async function runBenchmark(options = {}) {
  const args = { providers: ['replay:oracle', 'replay:flawed'], repeats: 1, paid: false, ...options };
  const config = args.config || readJson(path.join(here, 'providers.config.json'));
  const manifest = typeof args.manifest === 'string' ? readJson(args.manifest) : args.manifest || null;
  const providers = args.paid ? (manifest?.providers || []) : args.providers;
  const repeats = args.paid ? manifest?.repeats : args.repeats;
  const adapters = providers.map((id) => createAdapter(id, { paid: args.paid, manifest, env: args.env || process.env, config, clientFactories: args.clientFactories }));
  const prepared = await prepareFixtures({ fixtureIds: args.paid ? manifest?.fixtures || null : args.fixtures });

  // Worst-case preflight for paid adapters: refuse before the first call if the
  // whole run could exceed the approved cap.
  const cfgOf = (adapter) => config.providers.find((p) => p.id === adapter.id);
  const worstCase = (adapter, p) => (adapter.paid ? worstCaseCallUsd({ provider: adapter.provider, model: adapter.model, imageTokens: imageTokensFor(adapter, cfgOf(adapter), p), maxOutputTokens: cfgOf(adapter).maxOutputTokens }) : 0);
  const worstCaseUsd = adapters.reduce((sum, a) => sum + prepared.reduce((s, p) => s + worstCase(a, p), 0) * repeats, 0);
  if (args.paid && worstCaseUsd > manifest.maxTotalUsd) {
    throw new Error(`worst-case cost $${worstCaseUsd.toFixed(2)} exceeds the approved cap $${manifest.maxTotalUsd}; reduce fixtures, repeats or providers`);
  }

  const startedAt = new Date().toISOString();
  const runId = args.paid ? manifest.runId : `offline-${startedAt.replace(/[:.]/g, '-')}`;
  let spent = 0;
  let budgetStopped = false;
  const results = {};
  for (const adapter of adapters) {
    const calls = [];
    for (const p of prepared) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        if (adapter.paid && spent + worstCase(adapter, p) > manifest.maxTotalUsd) { budgetStopped = true; break; }
        const call = { fixtureId: p.fixture.id, repeat, privacyClean: p.privacy.normalizedClean };
        try {
          const response = await adapter.analyze({ fixtureId: p.fixture.id, image: p.image, systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT, schema: EXTRACTION_SCHEMA });
          Object.assign(call, {
            latencyMs: response.latencyMs, measured: response.measured, usage: response.usage, rawUsage: response.rawUsage,
            stopReason: response.stopReason, refusal: response.refusal, truncated: response.truncated, servedModel: response.servedModel, requestId: response.requestId,
            responseText: response.text,
          });
          if (adapter.paid) {
            const cost = measuredCallUsd({ provider: adapter.provider, model: adapter.model, usage: response.usage });
            call.costUsd = cost.usd;
            call.costBasis = cost.basis;
            spent += cost.usd;
          }
          call.score = scoreResponse(p.gt, response.text);
        } catch (error) {
          call.error = String(error?.message || error).slice(0, 300);
          call.score = { fixtureId: p.fixture.id, schemaValid: false, schemaErrors: ['no response'] };
          if (adapter.paid) spent += worstCase(adapter, p); // unknown usage: count the worst case
        }
        calls.push(call);
      }
      if (budgetStopped) break;
    }
    results[adapter.id] = { ...aggregate(calls), calls };
    if (budgetStopped) break;
  }

  const run = {
    runId, label: args.label || (args.paid ? `paid run ${runId}` : 'offline replay'), startedAt, pipelineVersion: PIPELINE_VERSION,
    fixtureCount: prepared.length, repeats, paid: args.paid, maxTotalUsd: manifest?.maxTotalUsd ?? null, worstCaseUsd,
    spentUsd: spent, budgetStopped, privacy: prepared.map((p) => p.privacy),
  };
  return { run, results, report: buildReport({ run, results }) };
}

// Cost estimate for a planned paid run, from the real normalized fixtures.
// Creates no adapter, reads no key, loads no SDK. "Typical" assumes 4,000
// output tokens (JSON + thinking); "worst case" assumes the full output budget.
export async function estimateRun({ providers, repeats = 1, fixtures = null }) {
  const config = readJson(path.join(here, 'providers.config.json'));
  const prepared = await prepareFixtures({ fixtureIds: fixtures });
  const rows = providers.map((id) => {
    const cfg = config.providers.find((p) => p.id === id);
    if (!cfg) throw new Error(`unknown provider "${id}"`);
    const imageTokens = (p) => imageTokensFor({ provider: cfg.provider }, cfg, p);
    const cost = (outputTokens) => prepared.reduce((s, p) => s + worstCaseCallUsd({ provider: cfg.provider, model: cfg.model, imageTokens: imageTokens(p), maxOutputTokens: outputTokens }), 0) * repeats;
    return { id, model: cfg.model, calls: prepared.length * repeats, typicalUsd: cost(4000), worstCaseUsd: cost(cfg.maxOutputTokens), priceVerified: priceFor(cfg.provider, cfg.model).verified };
  });
  return { rows, totalTypicalUsd: rows.reduce((s, r) => s + r.typicalUsd, 0), totalWorstCaseUsd: rows.reduce((s, r) => s + r.worstCaseUsd, 0) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  if (args.estimate) {
    const estimate = await estimateRun({ providers: args.providers || ['sonnet-5-5', 'haiku-5-5', 'gemini-3-flash'], repeats: args.repeats || 3, fixtures: args.fixtures });
    for (const r of estimate.rows) console.log(`${r.id.padEnd(16)} ${String(r.calls).padStart(3)} calls  typical $${r.typicalUsd.toFixed(2)}  worst case $${r.worstCaseUsd.toFixed(2)}${r.priceVerified ? '' : '  (price UNVERIFIED)'}`);
    console.log(`total            typical $${estimate.totalTypicalUsd.toFixed(2)}  worst case $${estimate.totalWorstCaseUsd.toFixed(2)}`);
    process.exit(0);
  }
  const { run, results, report } = await runBenchmark(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== false)));
  const outDir = args.out || path.join(here, 'runs', run.runId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify({ run, results }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'report.md'), report);
  for (const [id, r] of Object.entries(results)) {
    console.log(`${id.padEnd(18)} ${r.gates.map((g) => `${g.id}:${g.status}`).join(' ')}`);
  }
  console.log(`report: ${path.relative(process.cwd(), path.join(outDir, 'report.md'))}`);
}
