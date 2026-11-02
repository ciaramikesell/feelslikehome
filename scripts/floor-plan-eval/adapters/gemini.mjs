// Gemini API adapter (generateContent). Inline image with per-part media
// resolution, JSON response constrained by the same schema via
// responseJsonSchema. Request shape checked against @google/genai 2.32.0
// type definitions; the official docs could not be read from the preparation
// environment, so the model id and pricing stay unverified until the paid run
// plan's verification step.
//
// Only constructed through adapters/index.mjs, which refuses unless a paid run
// has been explicitly approved (and the key is confirmed to be paid-tier).
async function defaultClient(cfg) {
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) throw new Error(`${cfg.apiKeyEnv} is not set`);
  let GoogleGenAI;
  try {
    ({ GoogleGenAI } = await import('@google/genai'));
  } catch {
    throw new Error(`@google/genai is not installed. For an approved run: npm install --no-save ${cfg.sdk}`);
  }
  return new GoogleGenAI({ apiKey });
}

export function buildGeminiRequest(cfg, { image, systemPrompt, userPrompt, schema }) {
  return {
    model: cfg.model,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: image.mimeType, data: image.buffer.toString('base64') }, mediaResolution: { level: cfg.mediaResolution } },
        { text: userPrompt },
      ],
    }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      maxOutputTokens: cfg.maxOutputTokens,
      thinkingConfig: { thinkingLevel: cfg.thinkingLevel },
      serviceTier: 'standard', // standard paid tier: never Flex or Priority
      // No retryOptions: the SDK then makes exactly one attempt (checked in
      // @google/genai 2.32.0); the runner owns retries and budget.
      httpOptions: { timeout: cfg.timeoutMs },
    },
  };
}

export function createGeminiAdapter(cfg, { clientFactory = defaultClient } = {}) {
  let client;
  return {
    id: cfg.id,
    provider: 'google',
    model: cfg.model,
    paid: true,
    async analyze(input) {
      client ||= await clientFactory(cfg);
      const started = performance.now();
      const response = await client.models.generateContent(buildGeminiRequest(cfg, input));
      const latencyMs = Math.round(performance.now() - started);
      const usage = response.usageMetadata || {};
      const finishReason = response.candidates?.[0]?.finishReason ?? null;
      return {
        text: response.text ?? '',
        stopReason: finishReason,
        refusal: ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(finishReason) ? { category: finishReason } : null,
        truncated: finishReason === 'MAX_TOKENS',
        servedModel: response.modelVersion ?? cfg.model,
        requestId: response.responseId ?? null,
        latencyMs,
        measured: true,
        // Billing tier the provider reports; the runner aborts on anything but standard.
        pricingTier: usage.serviceTier ?? null,
        fastMode: false,
        usage: {
          // Includes the image and any implicitly cached tokens, all charged at
          // the full standard input rate (pessimistic if a cache discount applied).
          inputTokens: usage.promptTokenCount || 0,
          outputTokens: usage.candidatesTokenCount || 0,
          thinkingTokens: usage.thoughtsTokenCount ?? null,
          separateThinkingTokens: usage.thoughtsTokenCount || 0, // billed at the output rate (verified), reported separately
        },
        rawUsage: usage,
      };
    },
  };
}
