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
| `budget.mjs` | Per-attempt cost bound and the persistent per-run ledger that enforces the cap |
| `adapters/` | `replay` (offline), `anthropic` (Sonnet 5.5, Haiku 5.5), `gemini` (`gemini-3-flash-preview`), and the approval gate in `index.mjs` |
| `providers.config.json` | Model settings and budget bounds; **every provider `enabled: false`** (a run enables one per invocation with `--enable`) |
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

### How the $5 cap is enforced (`budget.mjs`, `run.mjs`)

1. **Per-attempt bound.** Each attempt's cost is bounded from documented limits plus pessimistic allowances, then × 1.1 (US-only inference multiplier and rounding):
   - **Input:** at most the UTF-8 bytes of prompt + schema (9,886 incl. 2,000 for an undocumented structured-output prompt) plus 4,784 image tokens.
   - **Output:** at most `maxOutputTokens` (6,000; for Claude, `max_tokens` is the documented hard ceiling including thinking). Gemini gets 8,192 extra thinking tokens, because whether thoughts count toward `maxOutputTokens` is unverified.
   - **Resulting bound per attempt:** Sonnet 5.5 $0.0983, Haiku 5.5 $0.0049, Gemini 3 Flash $0.0549.
2. **Ledger before every attempt.** The runner reserves that bound in `runs/ledger/<runId>.json` (fsync'd) and only sends the request if committed + bound + overshoot reserve ($0.18) ≤ cap. Otherwise the run stops ("stopped early").
3. **Settlement.** A successful attempt settles to its measured cost. A failed, timed-out or usage-less attempt stays charged at its full bound.
4. **Retries.** There are no SDK retries (Anthropic `maxRetries: 0`; Gemini without `retryOptions` makes one attempt). The runner retries once, only for 429/5xx/connection/timeout errors, and reserves budget for that attempt too. Other client errors are not retried.
5. **Aborts.** A provider spend-limit error ends the run. A measured cost above its bound ends the run; the overshoot reserve exists so that one such attempt still fits.
6. **Re-runs.** The ledger is keyed by `runId`, survives restarts and is locked against a concurrent run. Re-running an approval continues from what it already spent, and a later manifest can lower the cap but never raise it.
7. **Preflight.** Every planned call once at its bound, plus the reserve, must fit the cap before anything is sent. The full run below needs $4.92 of the $5.00.

### Step 0: owner actions and checks (no spend)

1. Approve this plan and the **$5.00** cap (`manifest.maxTotalUsd`).
2. **Gemini facts — confirmed by the project owner from Google's official documentation on 2026-11-02** (Google's docs are unreachable from the preparation environment):
   - model id `gemini-3-flash-preview`;
   - standard paid tier: $0.50 input and $3 output per 1M tokens, the output price including thinking;
   - paid services are not used to improve Google's products;
   - abuse monitoring retains prompts and responses for 55 days;
   - AI Studio project spend caps may overshoot because of billing processing delays.

   Still modeled pessimistically rather than verified: whether thoughts count toward `maxOutputTokens` (8,192 extra allowed), image tokens at `MEDIA_RESOLUTION_HIGH` (4,784 assumed), and the model's maximum output (65,536 assumed for the reserve). Requests pin the standard tier (`serviceTier: "standard"`; Claude `service_tier: "standard_only"`), and a response reporting any other tier, or fast mode, ends the run.
3. Create the accounts, limits and keys in the checklist below yourself. Keys go only into environment variables of the run session. Never commit them or paste them anywhere.
4. Only the 10 committed CC0 fixtures are eligible:
   - the runner refuses any image whose sha256 or path doesn't match `fixtures/manifest.json`;
   - it refuses any normalized image that still carries metadata.

### Step 1: smoke run — the only run being prepared (cap $0.50; preflight needs $0.34)

**Not authorized yet.** It runs only after the owner explicitly authorizes it.

A git-ignored draft manifest is already in place: `scripts/floor-plan-eval/runs/smoke-run.draft.json`. It covers 1 fixture (F01) × 1 repeat × 3 models, with a $0.50 cap. Its `approvedBy` and `approvedOn` are empty and `geminiPaidTierConfirmed` is `false`, so every gate refuses it as it stands. At authorization time those three fields are filled in.

Keys: the harness reads only its own variable names, `FLH_FPA_ANTHROPIC_API_KEY` and `FLH_FPA_GEMINI_API_KEY`. Any other key in the environment (e.g. a generic `ANTHROPIC_API_KEY`) is never used.

Readiness check — sends nothing to any provider; prints only whether each condition holds, never a key value:

```bash
NODE_USE_ENV_PROXY=1 FLH_FPA_PAID_RUN=fpa2-smoke-20261102 node scripts/floor-plan-eval/run.mjs --check --enable sonnet-5-5,haiku-5-5,gemini-3-flash --manifest scripts/floor-plan-eval/runs/smoke-run.draft.json
```

The run itself, after authorization. `NODE_USE_ENV_PROXY=1` lets Node's fetch use the environment proxy for Gemini; `api.anthropic.com` is in `NO_PROXY` and stays direct.

```bash
npm install --no-save @anthropic-ai/sdk@1.3.0 @google/genai@2.32.0
```

```bash
NODE_USE_ENV_PROXY=1 FLH_FPA_PAID_RUN=fpa2-smoke-20261102 node scripts/floor-plan-eval/run.mjs --paid --enable sonnet-5-5,haiku-5-5,gemini-3-flash --manifest scripts/floor-plan-eval/runs/smoke-run.draft.json
```

Stop and review the report: schema validity, refusals, truncation, the reported billing tier, measured tokens and cost per call, and that measured costs sit well under the bounds.

### Step 2: full benchmark (cap $5.00; preflight needs $4.92; typical ≈ $2.09) — not authorized

Use a new `runId`, `"repeats": 3`, no `fixtures` key (all 10) and `"maxTotalUsd": 5`. That is 90 calls.

| Model | Calls | Typical | Bound (each call once) | Per-attempt bound | Price |
|---|---|---|---|---|---|
| Claude Sonnet 5.5 (effort low) | 30 | $1.58 | $2.95 | $0.0983 | verified 2026-11-02 |
| Claude Haiku 5.5 (effort medium) | 30 | $0.08 | $0.15 | $0.0049 | verified 2026-11-02 |
| Gemini 3 Flash (`gemini-3-flash-preview`; high media resolution, thinking low) | 30 | $0.43 | $1.65 | $0.0549 | standard paid tier, owner-verified 2026-11-02 |
| **Total** | 90 | **$2.09** | **$4.74** + $0.18 reserve | | |

`node scripts/floor-plan-eval/run.mjs --estimate` recomputes these figures from the fixtures and config.

### Step 3: decision and follow-up

Apply the decision rule. Then, each with its own approval:
- an optional Sonnet `medium`-effort arm;
- a ≤ 5-plan real set (own homes, written permission, addresses cropped);
- the implementation sequence in the feasibility study §12.

### Owner account checklist (create these yourself)

**Anthropic (Claude Console)**
- [ ] A dedicated workspace, e.g. `flh-floorplan-poc`. Spend limits can't be set on the Default workspace.
- [ ] A workspace **spend limit of $5/month**: a hard limit, after which requests are rejected (HTTP 400).
- [ ] Optional second ceiling: prepaid credits with **auto-reload off** (requests stop at a zero balance).
- [ ] One API key created **in that workspace**. Put it in the run environment as `FLH_FPA_ANTHROPIC_API_KEY`.
- [ ] No US-only data residency default needed; the harness assumes ×1.1 anyway.
- [ ] Revoke the key after the run.

**Google (Gemini Developer API)**
- [ ] A dedicated Google Cloud project with an **active billing account**, so the paid tier applies and data is not used to improve products.
- [ ] A **project spend cap** in Google AI Studio (e.g. $3). Google documents that it may overshoot because of billing processing delays, so it is a backstop, not a guarantee.
- [ ] A Cloud Billing **budget with alerts** at $1, $2 and $3. Alerts only: they do not stop spending.
- [ ] One API key restricted to the Generative Language API. Put it in the run environment as `FLH_FPA_GEMINI_API_KEY`.
- [ ] Revoke the key after the run.

**Run environment**
- [ ] Set keys as environment variables only: never in files, commits, chat, manifests or command lines that get logged.
- [ ] Keep the approved manifest in `scripts/floor-plan-eval/runs/` (git-ignored).
- [ ] If the run happens in this cloud environment, add the two `FLH_FPA_*` keys as environment secrets in the environment settings; they reach the session as environment variables.
- [ ] Use a fresh `runId` per approval.
