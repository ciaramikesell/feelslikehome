// Claude Messages API adapter. Synchronous request, inline base64 image,
// structured output against the fixed schema, no tools, no batch, no Files
// API, no URL image source, no server-side fallback (a benchmark must know
// which model answered). Request shape checked against @anthropic-ai/sdk 1.3.0.
//
// Only constructed through adapters/index.mjs, which refuses unless a paid run
// has been explicitly approved.
async function defaultClient(cfg) {
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) throw new Error(`${cfg.apiKeyEnv} is not set`);
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error(`@anthropic-ai/sdk is not installed. For an approved run: npm install --no-save ${cfg.sdk}`);
  }
  return new Anthropic({ apiKey, maxRetries: 1, timeout: cfg.timeoutMs });
}

export function buildAnthropicRequest(cfg, { image, systemPrompt, userPrompt, schema }) {
  return {
    model: cfg.model,
    max_tokens: cfg.maxOutputTokens,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.buffer.toString('base64') } },
        { type: 'text', text: userPrompt },
      ],
    }],
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema } },
  };
}

export function createAnthropicAdapter(cfg, { clientFactory = defaultClient } = {}) {
  let client;
  return {
    id: cfg.id,
    provider: 'anthropic',
    model: cfg.model,
    paid: true,
    async analyze(input) {
      client ||= await clientFactory(cfg);
      const started = performance.now();
      const response = await client.messages.create(buildAnthropicRequest(cfg, input));
      const latencyMs = Math.round(performance.now() - started);
      const usage = response.usage || {};
      return {
        text: (response.content || []).filter((block) => block.type === 'text').map((block) => block.text).join(''),
        stopReason: response.stop_reason,
        refusal: response.stop_reason === 'refusal' ? response.stop_details || null : null,
        truncated: response.stop_reason === 'max_tokens',
        servedModel: response.model,
        requestId: response._request_id ?? response.id ?? null,
        latencyMs,
        measured: true,
        usage: {
          // Cache fields are counted at the full input price (conservative; caching is not used).
          inputTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
          outputTokens: usage.output_tokens || 0, // includes thinking
          thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? null,
          separateThinkingTokens: 0,
        },
        rawUsage: usage,
      };
    },
  };
}
