// Published prices, used ONLY as estimates until a run measures real usage.
// `verified` means the figure was confirmed on the provider's official pricing
// page on `checked` (Anthropic: read by the harness author; Google: confirmed
// by the project owner, since Google's docs are unreachable from here).
// All prices are the standard (non-batch, non-priority) paid tier.
export const PRICES = Object.freeze({
  'anthropic:claude-sonnet-5-5': {
    inputPerMTok: 2.0, outputPerMTok: 10.0, verified: true, checked: '2026-11-02',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    notes: 'Thinking tokens bill as output. US-only inference (inference_geo "us") would be ×1.1 — not used. Requests pin service_tier "standard_only".',
  },
  'anthropic:claude-haiku-5-5': {
    inputPerMTok: 0.10, outputPerMTok: 0.50, verified: true, checked: '2026-11-02',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    notes: 'Prompts ≤ 100k tokens. Above that $0.50 / $2.50 (never reached here).',
  },
  'google:gemini-3-flash-preview': {
    inputPerMTok: 0.50, outputPerMTok: 3.0, verified: true, checked: '2026-11-02',
    verifiedBy: 'project owner, from Google\'s official documentation (not readable from the preparation environment)',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    tier: 'standard paid tier (requests pin serviceTier "standard"; not Batch, Flex or Priority)',
    notes: 'Output price includes thinking tokens. Paid services are not used to improve Google products. Abuse monitoring retains prompts and responses for 55 days. Free-tier keys are refused by the run gate (geminiPaidTierConfirmed).',
  },
});

export function priceFor(provider, model) {
  const price = PRICES[`${provider}:${model}`];
  if (!price) throw new Error(`no price recorded for ${provider}:${model}; add it to pricing.mjs before running`);
  return price;
}

// Upper-bound estimate for ONE call, used before a paid run to check the cap:
// image tokens + prompt/schema tokens + the full output budget.
export function worstCaseCallUsd({ provider, model, imageTokens, textTokens = 3500, maxOutputTokens }) {
  const price = priceFor(provider, model);
  return ((imageTokens + textTokens) * price.inputPerMTok + maxOutputTokens * price.outputPerMTok) / 1e6;
}

// Cost from a call's MEASURED usage (normalized by the adapter).
export function measuredCallUsd({ provider, model, usage }) {
  const price = priceFor(provider, model);
  const output = (usage.outputTokens || 0) + (usage.separateThinkingTokens || 0);
  // Cache writes at 2× input (the 1-hour rate, the higher of the two).
  const input = (usage.inputTokens || 0) + 2 * (usage.cacheWriteTokens || 0);
  return {
    usd: ((input * price.inputPerMTok + output * price.outputPerMTok) / 1e6) * (usage.priceMultiplier || 1),
    basis: price.verified ? 'measured tokens × verified published price' : 'measured tokens × UNVERIFIED published price',
  };
}
