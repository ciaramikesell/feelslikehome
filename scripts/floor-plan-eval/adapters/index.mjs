// The only place adapters are created.
// Replay adapters are always allowed.
// A paid adapter is created only when EVERY condition below holds; otherwise
// this throws before any SDK is loaded or any key is read.
import { createAnthropicAdapter } from './anthropic.mjs';
import { createGeminiAdapter } from './gemini.mjs';
import { createReplayAdapter } from './replay.mjs';

export const HARD_CEILING_USD = 50; // no manifest may approve more than this

export class PaidRunNotApprovedError extends Error {
  constructor(providerId, reasons) {
    super(`paid provider "${providerId}" is not approved for this run:\n  - ${reasons.join('\n  - ')}`);
    this.reasons = reasons;
  }
}

export function validateRunManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['no approved run manifest (--manifest runs/approved-run.json)'];
  if (!/^[A-Za-z0-9-]{6,64}$/.test(manifest.runId || '')) problems.push('manifest.runId missing or malformed');
  if (!manifest.approvedBy) problems.push('manifest.approvedBy missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.approvedOn || '')) problems.push('manifest.approvedOn missing (YYYY-MM-DD)');
  if (!(manifest.maxTotalUsd > 0)) problems.push('manifest.maxTotalUsd must be > 0');
  if (manifest.maxTotalUsd > HARD_CEILING_USD) problems.push(`manifest.maxTotalUsd exceeds the hard ceiling of $${HARD_CEILING_USD}`);
  if (!Array.isArray(manifest.providers) || !manifest.providers.length) problems.push('manifest.providers must list provider ids');
  if (!(Number.isInteger(manifest.repeats) && manifest.repeats >= 1 && manifest.repeats <= 5)) problems.push('manifest.repeats must be 1–5');
  if (manifest.fixtureSource !== 'committed-synthetic-fixtures') problems.push('manifest.fixtureSource must be "committed-synthetic-fixtures"');
  return problems;
}

export function createAdapter(providerId, { paid = false, manifest = null, env = process.env, config, enable = null, clientFactories = {} } = {}) {
  if (providerId.startsWith('replay:')) return createReplayAdapter(providerId.slice('replay:'.length));
  const cfg = config?.providers?.find((p) => p.id === providerId);
  if (!cfg) throw new Error(`unknown provider "${providerId}"`);

  const reasons = [];
  if (!paid) reasons.push('--paid was not given');
  reasons.push(...validateRunManifest(manifest));
  if (manifest && !manifest.providers?.includes(providerId)) reasons.push(`manifest does not approve "${providerId}"`);
  if (manifest && env.FLH_FPA_PAID_RUN !== manifest.runId) reasons.push('FLH_FPA_PAID_RUN does not equal manifest.runId');
  // The committed config keeps every provider disabled; an approved run enables
  // one for a single invocation with --enable, so nothing needs editing or committing.
  if (cfg.enabled !== true && !enable?.includes(providerId)) reasons.push(`"${providerId}" is disabled (pass --enable ${providerId} for an approved run)`);
  if (!env[cfg.apiKeyEnv]) reasons.push(`${cfg.apiKeyEnv} is not set`);
  if (cfg.requiresPaidTier && manifest?.geminiPaidTierConfirmed !== true) reasons.push('manifest.geminiPaidTierConfirmed must be true (the free tier may use data to improve products)');
  if (cfg.modelIdVerified === false && !manifest?.confirmedModelIds?.includes(cfg.model)) reasons.push(`model id "${cfg.model}" is unverified; add it to manifest.confirmedModelIds after checking the provider's model list`);
  if (reasons.length) throw new PaidRunNotApprovedError(providerId, reasons);

  if (cfg.provider === 'anthropic') return createAnthropicAdapter(cfg, { clientFactory: clientFactories.anthropic });
  if (cfg.provider === 'google') return createGeminiAdapter(cfg, { clientFactory: clientFactories.google });
  throw new Error(`no adapter for provider "${cfg.provider}"`);
}
