// Application-side spending guarantee for paid benchmark runs.
//
// For every API attempt the runner first RESERVES an upper bound on that
// attempt's cost in a ledger persisted on disk, and only sends the request if
//     committed + reservation + overshootReserve ≤ cap.
// After the attempt the reservation is SETTLED to the measured cost (if the
// provider returned usage) or kept at the full bound (failure, timeout, no
// usage: the provider may still bill it). A measured cost above its bound
// aborts the run. The ledger is keyed by the approved runId and survives
// restarts, so re-running the same approval cannot reset the budget.
//
// The bound per attempt is built only from documented hard limits where they
// exist and from deliberately pessimistic allowances where they don't:
//   input  ≤ UTF-8 bytes of system prompt + user prompt + schema (a token
//            always covers at least one byte) + PROVIDER_OVERHEAD_TOKENS
//            (undocumented hidden prompt for structured output)
//            + imageTokenBound (Claude: documented 4,784 cap; Gemini: same
//            4,784 used as a pessimistic stand-in for its unverified count)
//   output ≤ maxOutputTokens (Claude: max_tokens is the documented hard
//            ceiling including thinking) + thinkingAllowanceTokens (Gemini:
//            whether thoughts count toward maxOutputTokens is unverified)
//   price  × SAFETY_MULTIPLIER (covers a 1.1× US-only inference multiplier and rounding)
import fs from 'node:fs';
import path from 'node:path';
import { priceFor } from './pricing.mjs';
import { SYSTEM_PROMPT, USER_PROMPT } from './prompt.mjs';
import { EXTRACTION_SCHEMA } from './schema.mjs';

export const SAFETY_MULTIPLIER = 1.1;
export const PROVIDER_OVERHEAD_TOKENS = 2000;

export function promptTokenBound() {
  return Buffer.byteLength(SYSTEM_PROMPT) + Buffer.byteLength(USER_PROMPT) + Buffer.byteLength(JSON.stringify(EXTRACTION_SCHEMA)) + PROVIDER_OVERHEAD_TOKENS;
}

const usd = (cfg, inputTokens, outputTokens) => {
  const price = priceFor(cfg.provider, cfg.model);
  return ((inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1e6) * SAFETY_MULTIPLIER;
};

// Upper bound for one attempt under the modeled limits.
export function attemptBound(cfg) {
  const inputTokens = promptTokenBound() + cfg.imageTokenBound;
  const outputTokens = cfg.maxOutputTokens + (cfg.thinkingAllowanceTokens || 0);
  return { inputTokens, outputTokens, usd: usd(cfg, inputTokens, outputTokens) };
}

// Cost of the single worst attempt if a modeled limit turns out to be wrong
// (e.g. Gemini thinking up to the model's maximum output). Kept free in the
// budget so that one anomalous attempt — which aborts the run — still fits.
export function overshootReserveUsd(configs) {
  return Math.max(0, ...configs.map((cfg) => usd(cfg, attemptBound(cfg).inputTokens * 2, Math.max(cfg.modelMaxOutputTokens || 0, attemptBound(cfg).outputTokens)) - attemptBound(cfg).usd));
}

export class BudgetError extends Error {}

// Persistent per-runId ledger with an exclusive lock file.
export class Ledger {
  constructor({ dir, runId, capUsd, reserveUsd }) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${runId}.json`);
    this.lock = path.join(dir, `${runId}.lock`);
    try {
      this.lockFd = fs.openSync(this.lock, 'wx');
    } catch {
      throw new BudgetError(`run ${runId} is locked (${this.lock}). Another run is in progress, or one crashed: check the ledger before removing the lock.`);
    }
    const previous = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null;
    this.state = previous || { runId, capUsd, entries: [] };
    this.state.capUsd = Math.min(this.state.capUsd, capUsd); // a later manifest can lower, never raise, the cap
    this.reserveUsd = reserveUsd;
    this.persist();
  }

  get committedUsd() {
    return this.state.entries.reduce((sum, e) => sum + (e.settledUsd ?? e.reservedUsd), 0);
  }

  canReserve(amount) {
    return this.committedUsd + amount + this.reserveUsd <= this.state.capUsd + 1e-9;
  }

  reserve(details, amount) {
    if (!this.canReserve(amount)) throw new BudgetError('budget exhausted');
    const entry = { id: this.state.entries.length + 1, at: new Date().toISOString(), ...details, reservedUsd: amount, settledUsd: null, status: 'reserved' };
    this.state.entries.push(entry);
    this.persist();
    return entry;
  }

  settle(entry, { measuredUsd = null, status }) {
    entry.status = status;
    if (measuredUsd !== null) entry.settledUsd = measuredUsd; // otherwise the full reservation stays charged
    this.persist();
  }

  persist() {
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, `${JSON.stringify({ ...this.state, committedUsd: this.committedUsd }, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, this.file);
  }

  close() {
    if (this.lockFd !== undefined) {
      fs.closeSync(this.lockFd);
      fs.rmSync(this.lock, { force: true });
      this.lockFd = undefined;
    }
  }
}
