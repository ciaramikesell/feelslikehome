#!/usr/bin/env node
// Floor-plan extraction benchmark runner.
//
// Offline (default, free, no network):
//   node scripts/floor-plan-eval/run.mjs
//   node scripts/floor-plan-eval/run.mjs --providers replay:oracle,replay:flawed --repeats 2
//
// Paid (ONLY with an approved run; see README "Paid run plan"):
//   FLH_FPA_PAID_RUN=<runId> node scripts/floor-plan-eval/run.mjs --paid --enable <ids> --manifest scripts/floor-plan-eval/runs/approved-run.json
//
// Only the committed synthetic fixtures can be sent: each image's sha256 must
// match fixtures/manifest.json, and each normalized image must pass the
// independent metadata check, before any adapter sees it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';
import { createAdapter, PaidRunNotApprovedError, validateRunManifest } from './adapters/index.mjs';
import { attemptBound, Ledger, overshootReserveUsd } from './budget.mjs';
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
  const args = { providers: null, repeats: null, fixtures: null, out: null, paid: false, manifest: null, label: null, estimate: false, enable: null, check: false };
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
    else if (a === '--check') args.check = true;
    else if (a === '--enable') args.enable = next().split(',').map((x) => x.trim()).filter(Boolean);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

// Loads, verifies and normalizes every selected fixture once. Only files
// under fixtures/images/ that match the committed CC0 manifest can be used.
const FIXTURE_FILE = /^images\/[A-Za-z0-9-]+\.(?:png|jpg)$/;
export async function prepareFixtures({ fixtureIds = null } = {}) {
  const manifest = readJson(path.join(here, 'fixtures', 'manifest.json'));
  if (manifest.license !== 'CC0-1.0') throw new Error('fixtures/manifest.json is not the committed CC0 fixture set');
  const selected = manifest.fixtures.filter((f) => !fixtureIds || fixtureIds.includes(f.id));
  if (fixtureIds && selected.length !== fixtureIds.length) throw new Error('unknown fixture id in --fixtures');
  const prepared = [];
  for (const fixture of selected) {
    if (!FIXTURE_FILE.test(fixture.file)) throw new Error(`${fixture.id}: fixture path "${fixture.file}" is outside fixtures/images — refusing to use it`);
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

// Errors worth one retry: rate limiting, server errors, connection problems,
// timeouts. A provider-side spend limit is never retried: it ends the run.
const isSpendLimit = (error) => /usage limits|spend(?:ing)? (?:limit|cap)|enforced_spend_limit|billing/i.test(String(error?.message || ''));
const isRetryable = (error) => !isSpendLimit(error) && (error?.status === 429 || error?.status >= 500 || error?.status === undefined);

function redact(text, env) {
  let out = String(text);
  for (const value of Object.values(env || {})) if (typeof value === 'string' && value.length >= 12) out = out.split(value).join('[redacted]');
  return out.slice(0, 300);
}

export async function runBenchmark(options = {}) {
  const args = { providers: ['replay:oracle', 'replay:flawed'], repeats: 1, paid: false, ...options };
  const env = args.env || process.env;
  const config = args.config || readJson(path.join(here, 'providers.config.json'));
  const manifest = typeof args.manifest === 'string' ? readJson(args.manifest) : args.manifest || null;
  const providers = args.paid ? (manifest?.providers || []) : args.providers;
  const repeats = args.paid ? manifest?.repeats : args.repeats;
  const adapters = providers.map((id) => createAdapter(id, { paid: args.paid, manifest, env, config, enable: args.enable, clientFactories: args.clientFactories }));
  const prepared = await prepareFixtures({ fixtureIds: args.paid ? manifest?.fixtures || null : args.fixtures });

  // Preflight: every planned call once, at its upper bound, plus the overshoot
  // reserve, must fit the approved cap — so a run without failures completes.
  // The cap itself is guaranteed by the ledger, attempt by attempt: retries
  // and failures can end a run early, never push it over the cap.
  const cfgOf = (adapter) => config.providers.find((p) => p.id === adapter.id);
  const paidConfigs = adapters.filter((a) => a.paid).map(cfgOf);
  const bound = (adapter) => attemptBound(cfgOf(adapter)).usd;
  const attemptsPerCall = 2; // first attempt + at most one retry
  const worstCaseUsd = adapters.filter((a) => a.paid).reduce((sum, a) => sum + bound(a) * prepared.length * repeats, 0);
  const reserveUsd = overshootReserveUsd(paidConfigs);
  if (args.paid && worstCaseUsd + reserveUsd > manifest.maxTotalUsd) {
    throw new Error(`worst-case cost $${worstCaseUsd.toFixed(2)} (+ $${reserveUsd.toFixed(2)} overshoot reserve) exceeds the approved cap $${manifest.maxTotalUsd}; reduce fixtures, repeats or providers`);
  }

  const startedAt = new Date().toISOString();
  const runId = args.paid ? manifest.runId : `offline-${startedAt.replace(/[:.]/g, '-')}`;
  const ledger = args.paid ? new Ledger({ dir: args.ledgerDir || path.join(here, 'runs', 'ledger'), runId, capUsd: manifest.maxTotalUsd, reserveUsd }) : null;
  const priorUsd = ledger ? ledger.committedUsd : 0;
  let budgetStopped = false;
  let abortReason = null;
  const results = {};
  try {
    for (const adapter of adapters) {
      const calls = [];
      outer: for (const p of prepared) {
        for (let repeat = 1; repeat <= repeats; repeat += 1) {
          const call = { fixtureId: p.fixture.id, repeat, privacyClean: p.privacy.normalizedClean, attempts: 0 };
          for (let attempt = 1; attempt <= attemptsPerCall; attempt += 1) {
            let entry = null;
            if (adapter.paid) {
              if (!ledger.canReserve(bound(adapter))) { budgetStopped = true; break outer; }
              entry = ledger.reserve({ provider: adapter.id, fixtureId: p.fixture.id, repeat, attempt }, bound(adapter));
            }
            call.attempts = attempt;
            try {
              const response = await adapter.analyze({ fixtureId: p.fixture.id, image: p.image, systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT, schema: EXTRACTION_SCHEMA });
              Object.assign(call, {
                latencyMs: response.latencyMs, measured: response.measured, usage: response.usage, rawUsage: response.rawUsage,
                stopReason: response.stopReason, refusal: response.refusal, truncated: response.truncated, servedModel: response.servedModel, requestId: response.requestId,
                responseText: response.text, pricingTier: response.pricingTier ?? null, error: undefined,
              });
              if (adapter.paid) {
                const cost = measuredCallUsd({ provider: adapter.provider, model: adapter.model, usage: response.usage });
                call.costUsd = cost.usd;
                call.costBasis = cost.basis;
                ledger.settle(entry, { measuredUsd: cost.usd, status: 'ok' });
                const tier = String(response.pricingTier ?? 'standard').toLowerCase();
                if (!['standard', 'unspecified'].includes(tier) || response.fastMode) {
                  abortReason = `${adapter.id} ${p.fixture.id}: provider reported billing tier "${response.pricingTier}"${response.fastMode ? ' (fast mode)' : ''}, not standard`;
                }
                if (cost.usd > bound(adapter)) {
                  abortReason = `${adapter.id} ${p.fixture.id}: measured $${cost.usd.toFixed(4)} exceeded the modeled bound $${bound(adapter).toFixed(4)}`;
                }
              }
              call.score = scoreResponse(p.gt, response.text);
              break;
            } catch (error) {
              call.error = redact(error?.message || error, env);
              call.score = { fixtureId: p.fixture.id, schemaValid: false, schemaErrors: ['no response'] };
              if (entry) ledger.settle(entry, { status: 'failed' }); // full reservation stays charged
              if (adapter.paid && isSpendLimit(error)) { abortReason = `${adapter.id}: provider spend limit reached`; break; }
              if (!isRetryable(error)) break;
            }
          }
          calls.push(call);
          if (abortReason) break outer;
        }
      }
      results[adapter.id] = { ...aggregate(calls), calls };
      if (budgetStopped || abortReason) break;
    }
  } finally {
    ledger?.close();
  }

  const run = {
    runId, label: args.label || (args.paid ? `paid run ${runId}` : 'offline replay'), startedAt, pipelineVersion: PIPELINE_VERSION,
    fixtureCount: prepared.length, repeats, paid: args.paid, maxTotalUsd: manifest?.maxTotalUsd ?? null, worstCaseUsd, reserveUsd,
    priorUsd, spentUsd: ledger ? ledger.committedUsd - priorUsd : 0, committedUsd: ledger ? ledger.committedUsd : 0,
    budgetStopped, abortReason, privacy: prepared.map((p) => p.privacy),
  };
  return { run, results, report: buildReport({ run, results }) };
}

// Cost estimate for a planned paid run. Creates no adapter, reads no key,
// loads no SDK. "Typical" assumes the normalized image's own token estimate,
// a 3,500-token prompt and 4,000 output tokens (JSON + thinking); "bound" is
// every call once at the per-attempt upper bound the ledger reserves.
export async function estimateRun({ providers, repeats = 1, fixtures = null }) {
  const config = readJson(path.join(here, 'providers.config.json'));
  const prepared = await prepareFixtures({ fixtureIds: fixtures });
  const configs = providers.map((id) => {
    const cfg = config.providers.find((p) => p.id === id);
    if (!cfg) throw new Error(`unknown provider "${id}"`);
    return cfg;
  });
  const rows = configs.map((cfg) => {
    const imageTokens = (p) => (cfg.provider === 'anthropic' ? p.privacy.estimatedClaudeImageTokens : 1120);
    const typicalUsd = prepared.reduce((s, p) => s + worstCaseCallUsd({ provider: cfg.provider, model: cfg.model, imageTokens: imageTokens(p), maxOutputTokens: 4000 }), 0) * repeats;
    return { id: cfg.id, model: cfg.model, calls: prepared.length * repeats, typicalUsd, boundUsd: attemptBound(cfg).usd * prepared.length * repeats, perAttemptBoundUsd: attemptBound(cfg).usd, priceVerified: priceFor(cfg.provider, cfg.model).verified };
  });
  const reserveUsd = overshootReserveUsd(configs);
  const totalBoundUsd = rows.reduce((s, r) => s + r.boundUsd, 0);
  return { rows, reserveUsd, totalTypicalUsd: rows.reduce((s, r) => s + r.typicalUsd, 0), totalBoundUsd, requiredCapUsd: totalBoundUsd + reserveUsd };
}

// Readiness check for an approved paid run. Sends NO request to any provider:
// it evaluates the gates, key presence (never values), SDK availability,
// fixtures and privacy, the budget preflight, the ledger, and DNS resolution
// of the API hosts, then stops.
const API_HOSTS = Object.freeze({ anthropic: 'api.anthropic.com', google: 'generativelanguage.googleapis.com' });
const SDK_MODULES = Object.freeze({ anthropic: '@anthropic-ai/sdk', google: '@google/genai' });

export async function checkReadiness({ manifest: manifestArg, enable = [], env = process.env, ledgerDir = path.join(here, 'runs', 'ledger'), skipNetwork = false }) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const config = readJson(path.join(here, 'providers.config.json'));
  const manifest = typeof manifestArg === 'string' ? readJson(manifestArg) : manifestArg;
  const problems = validateRunManifest(manifest);
  add('manifest is a complete approval', problems.length === 0, problems.join('; '));
  if (!manifest) return checks;
  const smoke = manifest.repeats === 1 && manifest.fixtures?.length === 1 && manifest.maxTotalUsd <= 0.5;
  add('manifest is the smoke run (1 fixture, 1 repeat, cap ≤ $0.50)', smoke, `fixtures=${JSON.stringify(manifest.fixtures)} repeats=${manifest.repeats} cap=$${manifest.maxTotalUsd}`);
  add('FLH_FPA_PAID_RUN matches the manifest runId', env.FLH_FPA_PAID_RUN === manifest.runId);
  const configs = [];
  for (const id of manifest.providers || []) {
    const cfg = config.providers.find((p) => p.id === id);
    if (!cfg) { add(`${id}: known provider`, false); continue; }
    configs.push(cfg);
    add(`${id}: key present in ${cfg.apiKeyEnv}`, Boolean(env[cfg.apiKeyEnv]), 'value not read or printed');
    try {
      createAdapter(id, { paid: true, manifest, env, config, enable });
      add(`${id}: approval gate passes`, true);
    } catch (error) {
      add(`${id}: approval gate passes`, false, error instanceof PaidRunNotApprovedError ? error.reasons.join('; ') : error.message);
    }
    try {
      await import(SDK_MODULES[cfg.provider]);
      add(`${id}: ${cfg.sdk} importable`, true);
    } catch {
      add(`${id}: ${cfg.sdk} importable`, false, `npm install --no-save ${cfg.sdk}`);
    }
    if (!skipNetwork) try {
      await dns.lookup(API_HOSTS[cfg.provider]);
      add(`${id}: ${API_HOSTS[cfg.provider]} resolves (DNS only, no request)`, true);
    } catch (error) {
      add(`${id}: ${API_HOSTS[cfg.provider]} resolves (DNS only, no request)`, false, `${error.code || error.message}: allow this host in the environment's network settings`);
    }
  }
  try {
    const prepared = await prepareFixtures({ fixtureIds: manifest.fixtures || null });
    add('fixtures match the CC0 manifest and normalize without metadata', prepared.every((p) => p.privacy.normalizedClean), prepared.map((p) => p.fixture.id).join(', '));
    const boundUsd = configs.reduce((sum, cfg) => sum + attemptBound(cfg).usd * prepared.length * manifest.repeats, 0);
    const reserveUsd = overshootReserveUsd(configs);
    add('budget preflight fits the cap', boundUsd + reserveUsd <= manifest.maxTotalUsd, `bound $${boundUsd.toFixed(4)} + reserve $${reserveUsd.toFixed(4)} ≤ $${manifest.maxTotalUsd}`);
  } catch (error) {
    add('fixtures match the CC0 manifest and normalize without metadata', false, error.message);
  }
  // Node's built-in fetch (used by both SDKs) ignores HTTPS_PROXY unless
  // NODE_USE_ENV_PROXY=1 (Node ≥ 22.21). NO_PROXY keeps api.anthropic.com direct.
  if (env.HTTPS_PROXY && configs.some((cfg) => cfg.provider === 'google')) {
    add('NODE_USE_ENV_PROXY=1 so Gemini traffic uses the environment proxy', env.NODE_USE_ENV_PROXY === '1', 'prefix the run command with NODE_USE_ENV_PROXY=1');
  }
  const ledgerFile = path.join(ledgerDir, `${manifest.runId}.json`);
  const committed = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).committedUsd : 0;
  add('ledger: nothing committed yet for this runId', committed === 0, `$${committed}`);
  add('ledger: no lock held', !fs.existsSync(path.join(ledgerDir, `${manifest.runId}.lock`)));
  return checks;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  if (args.check) {
    const checks = await checkReadiness({ manifest: args.manifest, enable: args.enable || [] });
    for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    console.log(checks.every((c) => c.ok) ? 'READY (no request was sent)' : 'NOT READY (no request was sent)');
    process.exit(0);
  }
  if (args.estimate) {
    const estimate = await estimateRun({ providers: args.providers || ['sonnet-5-5', 'haiku-5-5', 'gemini-3-flash'], repeats: args.repeats || 3, fixtures: args.fixtures });
    for (const r of estimate.rows) console.log(`${r.id.padEnd(16)} ${String(r.calls).padStart(3)} calls  typical $${r.typicalUsd.toFixed(2)}  bound $${r.boundUsd.toFixed(2)} ($${r.perAttemptBoundUsd.toFixed(4)}/attempt)${r.priceVerified ? '' : '  (price UNVERIFIED)'}`);
    console.log(`total            typical $${estimate.totalTypicalUsd.toFixed(2)}  bound $${estimate.totalBoundUsd.toFixed(2)}  + overshoot reserve $${estimate.reserveUsd.toFixed(2)}  = cap needed $${estimate.requiredCapUsd.toFixed(2)}`);
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
