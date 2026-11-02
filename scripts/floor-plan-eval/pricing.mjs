// Published prices, used ONLY as estimates until a run measures real usage.
// `verified` means the figure was read on the provider's official pricing page
// on `checked`; unverified figures came from search-engine snippets of the
// official page and must be re-read before a paid run (README → Paid run plan).
export const PRICES = Object.freeze({
  'anthropic:claude-sonnet-5-5': {
    inputPerMTok: 2.0, outputPerMTok: 10.0, verified: true, checked: '2026-10-31',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    notes: 'Thinking tokens bill as output. US-only inference (inference_geo "us") would be ×1.1 — not used.',
  },
  'anthropic:claude-haiku-5-5': {
    inputPerMTok: 0.10, outputPerMTok: 0.50, verified: true, checked: '2026-10-31',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    notes: 'Prompts ≤ 100k tokens. Above that $0.50 / $2.50 (never reached here).',
  },
  'google:gemini-3-flash': {
    inputPerMTok: 0.50, outputPerMTok: 3.0, verified: false, checked: '2026-10-31',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'UNVERIFIED (official page was network-blocked). Paid tier only — the free tier may use data to improve products. Thinking tokens assumed billed as output.',
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
  return {
    usd: ((usage.inputTokens || 0) * price.inputPerMTok + output * price.outputPerMTok) / 1e6,
    basis: price.verified ? 'measured tokens × verified published price' : 'measured tokens × UNVERIFIED published price',
  };
}
