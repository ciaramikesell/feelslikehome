#!/usr/bin/env node
// Add Home V3, phase 5: one-off RentCast validation capture. FOUNDER-RUN ONLY,
// locally, never in CI. See docs/add-home-v3-real-response-validation.md.
//
//   export RENTCAST_API_KEY=…            # in your shell only; never in a file in the repo
//   node scripts/ops/rentcast-capture/capture.mjs --dry-run
//   node scripts/ops/rentcast-capture/capture.mjs \
//     --plan=developer \
//     --allowance-remaining=<n from the RentCast dashboard> \
//     --allowance-source="RentCast app → API dashboard → usage, read <date>" \
//     --allowance-checked-at=<ISO time> \
//     --no-overage-confirmed
//
// Reads .rentcast-capture/targets.json (git-ignored; see targets.example.json).
// Writes raw responses and the request ledger under .rentcast-capture/ only.
// Sends requests one at a time. No retries: any status other than 200 or 404
// stops the whole run. Prints target ids, kinds, statuses and counts, never the
// key, a URL or an address.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MAX_TOTAL_REQUESTS, checkPreflight, classifyResponse, emptyLedger, evidenceHeaders, plannedRequests, reserveRequest, validateTargets,
} from './budget.mjs';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const WORK = join(ROOT, '.rentcast-capture');
const RAW = join(WORK, 'raw');
const LEDGER = join(WORK, 'ledger.json');
const TARGETS = join(WORK, 'targets.json');
const BASE = 'https://api.rentcast.io';
const TIMEOUT_MS = 20000;

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));

function fail(message, problems = []) {
  console.error(`capture: ${message}`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

// Founder-run only: never in CI, a Vercel build or any automated environment.
const AUTOMATED = ['CI', 'GITHUB_ACTIONS', 'VERCEL', 'VERCEL_ENV', 'NOW_BUILDER', 'BUILDKITE', 'CIRCLECI', 'GITLAB_CI'];
if (AUTOMATED.some((name) => process.env[name])) fail('refusing to run in CI or a deployment environment; this capture is founder-run only');

// The working folder must be git-ignored before anything is written to it.
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
if (!/^\/\.rentcast-capture\/$/m.test(gitignore)) fail('.rentcast-capture/ is not in .gitignore; refusing to write raw responses');

if (!existsSync(TARGETS)) fail(`no targets file. Copy scripts/ops/rentcast-capture/targets.example.json to .rentcast-capture/targets.json and fill it in`);
const targets = JSON.parse(readFileSync(TARGETS, 'utf8'));
const targetProblems = validateTargets(targets);
if (targetProblems.length) fail('targets file is invalid', targetProblems);

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : emptyLedger();
const done = new Set(ledger.requests.map((r) => `${r.targetId}:${r.kind}`));
const queue = plannedRequests(targets).filter((r) => !done.has(`${r.targetId}:${r.kind}`));

console.log(`capture: ${ledger.requests.length} of ${MAX_TOTAL_REQUESTS} requests already counted; ${queue.length} planned`);
queue.forEach((r) => console.log(`  planned  ${r.targetId.padEnd(24)} ${r.kind}`));
if (args['dry-run']) { console.log('capture: dry run, nothing sent'); process.exit(0); }
if (ledger.stopped) fail(`an earlier run stopped (${ledger.stopped}). Investigate; no further requests are sent`);

const preflight = checkPreflight({
  apiKeyPresent: typeof process.env.RENTCAST_API_KEY === 'string' && process.env.RENTCAST_API_KEY.trim().length > 0,
  plan: args.plan,
  allowanceRemaining: args['allowance-remaining'],
  allowanceSource: args['allowance-source'],
  allowanceCheckedAt: args['allowance-checked-at'],
  overageConfirmed: args['no-overage-confirmed'] === true,
  planned: queue.length,
  alreadyUsed: ledger.requests.length,
});
if (!preflight.ok) fail('pre-flight failed; no request sent', preflight.problems);

mkdirSync(RAW, { recursive: true });
ledger.preflight = { allowanceRemaining: Number(args['allowance-remaining']), allowanceSource: args['allowance-source'], allowanceCheckedAt: args['allowance-checked-at'] };
const save = () => writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
const apiKey = process.env.RENTCAST_API_KEY.trim();

for (const request of queue) {
  const target = targets.find((t) => t.id === request.targetId);
  reserveRequest(ledger, request);
  save(); // counted before it is sent
  const entry = ledger.requests[ledger.requests.length - 1];
  let status; let headers = {}; let body = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}${request.path}?address=${encodeURIComponent(target.address)}`, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal: controller.signal,
    });
    clearTimeout(timer);
    status = res.status;
    headers = evidenceHeaders(res.headers);
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { unparsedLength: text.length }; }
  } catch (err) {
    status = err?.name === 'AbortError' ? 'timeout' : 'network';
  }
  const { outcome, stop } = classifyResponse(status);
  entry.outcome = outcome; entry.httpStatus = status;
  writeFileSync(join(RAW, `${request.targetId}.${request.kind}.json`), `${JSON.stringify({ targetId: request.targetId, kind: request.kind, path: request.path, mode: target.mode, httpStatus: status, headers, body }, null, 2)}\n`);
  console.log(`  sent     ${request.targetId.padEnd(24)} ${request.kind.padEnd(8)} ${status} (${ledger.requests.length}/${MAX_TOTAL_REQUESTS})`);
  if (stop) {
    ledger.stopped = stop;
    save();
    fail(`stopped on ${stop} (HTTP ${status}); no retry. ${ledger.requests.length} requests counted`);
  }
  save();
}
console.log(`capture: done. ${ledger.requests.length} of ${MAX_TOTAL_REQUESTS} requests counted. Next: node scripts/ops/rentcast-capture/redact.mjs`);
