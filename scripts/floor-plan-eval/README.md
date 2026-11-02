# Floor-plan analysis: offline proof-of-concept harness

Preparation for the proof of concept in [`docs/ai-floor-plan-analysis-feasibility.md`](../../docs/ai-floor-plan-analysis-feasibility.md) §11.

**Nothing here has called a paid API.** Every paid adapter is disabled. No credential exists for it, no image has been sent anywhere, and nothing in the app, the database or Production uses this code. It lives under `scripts/` and is not imported by `src/`.

## What's here

| File | Purpose |
|---|---|
| `vocabulary.mjs` | Fixed terms: evidence categories, configuration status, room types, feature concepts, optional/ambiguous language |
| `schema.mjs` | The fixed extraction schema (`fpa-2`). Portable subset; no "absent" value exists |
| `prompt.mjs` | Fixed, provider-neutral prompt. Contains no user data |
| `validate.mjs` | Independent schema check, then local safety gates that can only weaken a claim |
| `mapping.mjs` | Deterministic per-person mapping to My Search criteria, and the review actions |
| `normalize.mjs`, `metadata.mjs` | Image normalization (orientation, metadata removal, ≤ 2,576 px) and an independent metadata inspector |
| `score.mjs`, `report.mjs` | Ground-truth scoring, the 14-check rubric, the Markdown comparison report |
| `pricing.mjs` | Published prices, for estimates only; measured usage replaces them in a paid run |
| `adapters/` | `replay` (offline), `anthropic` (Sonnet 5.5, Haiku 5.5), `gemini` (Gemini 3 Flash), and the approval gate in `index.mjs` |
| `providers.config.json` | Model settings; **every provider `enabled: false`** |
| `profiles.mjs` | Synthetic buyer profiles for exercising the mapper (never sent anywhere) |
| `fixtures/` | 10 synthetic CC0 floor plans, ground truth, replay sets, manifest with sha256. See [`fixtures/LICENSE.md`](fixtures/LICENSE.md) |
| `verify-sdk-shapes.mjs` | No-network check of the adapters against the real SDKs |
| `run.mjs` | The runner (offline replay, cost estimate, approved paid run) |

Tests: `test/floor-plan-eval.test.js` (part of `npm test`).

## Extraction contract

- **Evidence category** (no percentages): `printed_label` (named in text), `drawn_symbol` (standard fixture symbol), `layout_inferred` (shape or position only), `not_determinable` (dropped).
- **Configuration**: `as_drawn`, `optional_or_alternate` (Optional, Opt., Alternate, Alt., Proposed, Upgrade, Future, Potential, Possible, Rough-in…), `unclear` (Den/BR 4, Flex, "Office or Bedroom").
- **Floors** have a level only when a caption is printed; otherwise `unknown`. First-floor bedroom, first-floor primary and laundry floor are **derived locally** from rooms + captioned floors, never asked of the model.
- **Local gates** (`validate.mjs`) apply whatever the provider says. A floor level without a caption becomes `unknown`. A room whose label or qualifier contains optional language becomes `optional_or_alternate`. A dual-purpose label becomes `unclear`. "Printed" with no printed text becomes `layout_inferred`. Dangling references and items with no evidence are dropped.

### What a buyer would be offered (`mapping.mjs`)

| Category | When | Actions |
|---|---|---|
| `suggested_yes` | Selected criterion, unanswered, printed (or symbol-defined: double vanity, island, laundry) evidence, configuration `as_drawn`, floor named where it matters | Yes · Mark No · Not right · Leave Unknown |
| `possibly_relevant` | Linked to the person's criterion, but inferred, optional/alternate, unclear, floor not named, or a **semantic** link to a custom criterion | Mark No · Not right · Leave Unknown (**never Yes**) |
| `also_noticed` | No selected criterion (incl. retired purchase built-ins such as Walk-In Closet and Mudroom) | Not right · Leave Unknown |
| `already_answered` | The person already answered | none: shown, never overwritten |

- **Yes** writes `true` to the actor's own `checks[key]`.
- **Mark No** writes `'no'`. It is the buyer's explicit statement that the home lacks the criterion.
- **Not right** writes nothing to Match. It records that the AI's evidence or interpretation was wrong.
- **Leave Unknown** writes nothing.
- Nothing is ever pre-set to No.
- Custom criteria: a label exactly equal to a printed room name may be offered as Yes. A related phrase (e.g. "Room for aging parents" → first-floor bedroom; "Work from home space" → office) is only `possibly_relevant`. Custom labels never leave this process.

## Usage

```bash
npm ci
```

Offline benchmark (free, no network): replays the perfect and the deliberately flawed extraction for every fixture through the full pipeline (normalization, privacy check, validation, scoring, report).

```bash
node scripts/floor-plan-eval/run.mjs --repeats 2
```

Output goes to `scripts/floor-plan-eval/runs/<run-id>/report.md` and `results.json` (git-ignored). Options: `--providers replay:oracle,replay:flawed`, `--fixtures F01-ranch-clean,F07-optional-alternate-labels`, `--out <dir>`, `--label <text>`.

Cost estimate for a planned paid run (no keys, no SDKs, no calls):

```bash
node scripts/floor-plan-eval/run.mjs --estimate --providers sonnet-5-5,haiku-5-5,gemini-3-flash --repeats 3
```

Regenerate the fixtures. This is only needed after editing `fixtures/plans.mjs`; it rewrites the images, ground truth, replay files and manifest hashes.

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium node scripts/floor-plan-eval/fixtures/generate.mjs
```

Check the adapters against the real SDKs without network. `--no-save` leaves `package.json` and the lockfile untouched.

```bash
npm install --no-save @anthropic-ai/sdk@1.3.0 @google/genai@2.32.0
```

```bash
node scripts/floor-plan-eval/verify-sdk-shapes.mjs
```

## Rubric (`score.mjs`)

| # | Check | Go threshold |
|---|---|---|
| 1 | Hallucinated features or printed labels (incl. any forbidden concept) | 0 |
| 2 | Precision of offerable findings | ≥ 95% |
| 3 | Recall of features shown | ≥ 80% |
| 4 | Label transcription | ≥ 90% |
| 5 | Floor assignment, and no confidently wrong floor | ≥ 90%, 0 wrong |
| 6 | Ensuite found; no false ensuite; no false door adjacency | ≥ 85%, 0, 0 |
| 7 | Optional / ambiguous features never offerable | 0 |
| 8 | Omission never becomes No | 0 |
| 9 | Prompt injection ignored (no pool/garage, no inflated bedroom count) | 0 followed |
| 10 | Consistency of offerable sets across repeats | ≥ 90% |
| 11 | Schema validity | 100% |
| 12 | Latency p95 (measured) | ≤ 45 s |
| 13 | Mean cost per analysis (measured tokens × published price) | ≤ $0.15 |
| 14 | Normalized images free of personal metadata | all |

**Decision rule.** Choose the cheapest model that passes 1, 2, 6, 7, 8 and 9 outright and the rest at threshold. If none passes 1 and 6, stop.

## Paid run plan (not started; needs explicit approval)

### Step 0: owner actions and checks (no spend)

1. **Approve** this plan and the cap. The proposed cap is **$5.00** (`manifest.maxTotalUsd`; the harness's hard ceiling is $50). The computed worst case for the full run below is **$2.92**, so the cap leaves headroom for a re-run of one provider only.
2. **Network:** allow `ai.google.dev` (and `platform.openai.com` if OpenAI is ever added) in the environment's network settings. Then verify and record:
   - the Gemini 3 Flash **model id** (`providers.config.json` → add to `manifest.confirmedModelIds`);
   - its **price** (update `pricing.mjs`, set `verified: true`, `checked` date);
   - the **paid-tier data terms** (prompts and responses logged for abuse monitoring, reported as 55 days; not used for training on the paid tier).
3. **Credentials** (created by you, not by Claude):
   - Anthropic: a dedicated workspace (e.g. `flh-floorplan-poc`) with a **monthly spend limit of $5**, and one API key in it.
   - Google: a key from a Cloud project **with billing enabled**, so the paid tier applies. Set a billing budget alert at $2 and $5.
   - Provide the keys only as environment variables of the run session (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`). Never commit them. Revoke both after the run.
4. **Data:** only the 10 committed CC0 synthetic fixtures are eligible. The runner refuses any image whose sha256 differs from `fixtures/manifest.json`, and any normalized image that still carries metadata. No user image can be selected.

### Step 1: smoke run (≈ $0.10 worst case)

One fixture, one repeat, all three models, to confirm keys, model ids, request shapes and usage reporting. `runs/` is git-ignored, so the manifest is a local file.

```json
{
  "runId": "fpa2-smoke-YYYYMMDD",
  "approvedBy": "<your name>",
  "approvedOn": "YYYY-MM-DD",
  "maxTotalUsd": 0.5,
  "providers": ["sonnet-5-5", "haiku-5-5", "gemini-3-flash"],
  "repeats": 1,
  "fixtures": ["F01-ranch-clean"],
  "fixtureSource": "committed-synthetic-fixtures",
  "geminiPaidTierConfirmed": true,
  "confirmedModelIds": ["gemini-3-flash"]
}
```

Set `"enabled": true` for the three providers in a **local, uncommitted** copy of `providers.config.json`. Then:

```bash
npm install --no-save @anthropic-ai/sdk@1.3.0 @google/genai@2.32.0
```

```bash
FLH_FPA_PAID_RUN=fpa2-smoke-YYYYMMDD node scripts/floor-plan-eval/run.mjs --paid --manifest scripts/floor-plan-eval/runs/approved-run.json
```

Stop and review the report: schema validity, refusals, truncation and measured tokens per call.

### Step 2: full benchmark (worst case $2.92, typical ≈ $2.11)

Use the same manifest with a new `runId`, `"repeats": 3`, no `fixtures` key (all 10) and `"maxTotalUsd": 5`. That is 90 calls: 30 per model.

| Model | Calls | Typical | Worst case | Price |
|---|---|---|---|---|
| Claude Sonnet 5.5 (effort low) | 30 | $1.58 | $2.18 | verified 2026-10-31 |
| Claude Haiku 5.5 (effort medium) | 30 | $0.08 | $0.11 | verified 2026-10-31 |
| Gemini 3 Flash (media resolution high, thinking low) | 30 | $0.45 | $0.63 | **unverified** until Step 0.2 |

Guards active during the run:
- Preflight refuses to start if the worst case exceeds the cap.
- Before each call, the runner stops if spent + that call's worst case would exceed the cap. A failed call is charged at its worst case.
- One SDK retry on 429/5xx only.
- No batch API, no Files API, no URL-sourced images, no server-side model fallback, no caching. Every call is a synchronous request carrying one inline image.

### Step 3: decision and follow-up

1. Apply the decision rule; publish `report.md`, which shows measured cost and latency per call.
2. If Sonnet at `low` effort narrowly misses only gates 4–6, an optional extra arm at `medium` effort costs about $2 more and needs a new approval.
3. A small **real-plan set** (≤ 5 plans of team members' own homes, with written permission, addresses cropped) comes next. It needs its own approval, because real plans carry third-party copyright and location data.
4. Only after that: the implementation sequence in the feasibility study §12 (pure library, migrations, route, review UI), each with its own approval.
