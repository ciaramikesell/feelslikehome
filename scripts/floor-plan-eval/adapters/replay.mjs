// Offline adapter: returns a stored extraction for each fixture. Free, makes
// no network call. Sets "oracle" (perfect) and "flawed" (deliberate errors)
// validate the scorer; a recorded provider run can be replayed the same way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function createReplayAdapter(set, { dir = path.join(fixturesDir, 'replay', set) } = {}) {
  if (!/^[a-z0-9-]+$/.test(set) || !fs.existsSync(dir)) throw new Error(`unknown replay set "${set}"`);
  return {
    id: `replay:${set}`,
    provider: 'replay',
    model: set,
    paid: false,
    async analyze({ fixtureId }) {
      const file = path.join(dir, `${fixtureId}.json`);
      if (!fs.existsSync(file)) throw new Error(`replay set "${set}" has no response for ${fixtureId}`);
      return {
        text: fs.readFileSync(file, 'utf8'),
        stopReason: 'replay',
        refusal: null,
        truncated: false,
        servedModel: `replay:${set}`,
        requestId: null,
        latencyMs: null,
        measured: false,
        usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: null, separateThinkingTokens: 0 },
        rawUsage: null,
      };
    },
  };
}
