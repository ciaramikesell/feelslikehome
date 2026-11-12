#!/usr/bin/env node
// No-network check that the adapters work with the REAL provider SDKs: each
// SDK client is constructed with a fake key and a custom fetch that captures
// the HTTP request and returns a canned response. Nothing leaves the machine.
//
//   npm install --no-save @anthropic-ai/sdk@1.3.0 @google/genai@2.32.0
//   node scripts/floor-plan-eval/verify-sdk-shapes.mjs
import { createAnthropicAdapter } from './adapters/anthropic.mjs';
import { createGeminiAdapter } from './adapters/gemini.mjs';
import { SYSTEM_PROMPT, USER_PROMPT } from './prompt.mjs';
import { EXTRACTION_SCHEMA } from './schema.mjs';
import config from './providers.config.json' with { type: 'json' };

const captured = [];
const fakeFetch = (respond) => async (url, init) => {
  const href = String(url?.url ?? url);
  if (!/^https:\/\/(api\.anthropic\.com|generativelanguage\.googleapis\.com)\//.test(href)) throw new Error(`unexpected host ${href}`);
  captured.push({ url: href, body: JSON.parse(init.body) });
  return new Response(JSON.stringify(respond), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_fake' } });
};

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const { GoogleGenAI } = await import('@google/genai');
const cfgOf = (id) => config.providers.find((p) => p.id === id);
const input = { fixtureId: 'x', image: { buffer: Buffer.from('not-really-an-image'), mimeType: 'image/png' }, systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT, schema: EXTRACTION_SCHEMA };

const claudeReply = { id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 7100, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 900 } } };
const claude = createAnthropicAdapter(cfgOf('sonnet-5-5'), { clientFactory: async () => new Anthropic({ apiKey: 'fake', fetch: fakeFetch(claudeReply), maxRetries: 0 }) });
const c = await claude.analyze(input);

const geminiReply = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4300, candidatesTokenCount: 2100, thoughtsTokenCount: 800, totalTokenCount: 7200 }, modelVersion: 'gemini-3-flash', responseId: 'resp_fake' };
const gemini = createGeminiAdapter(cfgOf('gemini-3-flash'), { clientFactory: async () => new GoogleGenAI({ apiKey: 'fake', httpOptions: { fetch: fakeFetch(geminiReply) } }) });
const g = await gemini.analyze(input);

const [a, b] = captured;
const checks = [
  ['anthropic endpoint', a.url.endsWith('/v1/messages')],
  ['anthropic model', a.body.model === 'claude-sonnet-5-5'],
  ['anthropic structured output', a.body.output_config?.format?.type === 'json_schema' && a.body.output_config.format.schema.properties.rooms],
  ['anthropic effort', a.body.output_config?.effort === 'low'],
  ['anthropic inline base64 image', a.body.messages[0].content[0].source.type === 'base64'],
  ['anthropic no tools / batch / files / url image', !a.body.tools && !JSON.stringify(a.body).includes('"file_id"') && !JSON.stringify(a.body).includes('"type":"url"')],
  ['anthropic standard tier only', a.body.service_tier === 'standard_only'],
  ['anthropic usage normalized', c.usage.inputTokens === 7100 && c.usage.outputTokens === 2400 && c.usage.thinkingTokens === 900],
  ['anthropic text', c.text === '{"ok":true}'],
  ['gemini endpoint', /\/models\/gemini-3-flash-preview:generateContent/.test(b.url)],
  ['gemini json schema', b.body.generationConfig?.responseMimeType === 'application/json' && Boolean(b.body.generationConfig?.responseJsonSchema)],
  ['gemini media resolution on the image part', b.body.contents[0].parts[0].mediaResolution?.level === 'MEDIA_RESOLUTION_HIGH'],
  ['gemini thinking level', b.body.generationConfig?.thinkingConfig?.thinkingLevel === 'LOW'],
  ['gemini system instruction', Boolean(b.body.systemInstruction)],
  ['gemini standard paid tier', JSON.stringify(b.body).includes('"serviceTier":"standard"') || JSON.stringify(b.body).includes('"service_tier":"standard"')],
  ['gemini usage normalized', g.usage.inputTokens === 4300 && g.usage.outputTokens === 2100 && g.usage.separateThinkingTokens === 800],
  ['gemini text', g.text === '{"ok":true}'],
];
console.log(`gemini body keys: ${Object.keys(b.body).join(', ')}; generationConfig keys: ${Object.keys(b.body.generationConfig || {}).join(', ')}`);
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed += 1; }
console.log(`requests captured: ${captured.length}; network calls: 0`);
process.exitCode = failed ? 1 : 0;
