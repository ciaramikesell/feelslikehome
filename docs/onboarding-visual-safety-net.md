# Onboarding visual safety net

Onboarding V2 is being rebuilt to match the approved Figma designs. This document
describes the tools that make every visual change reviewable *before* it ships.

## Development-only preview

`/dev/onboarding` renders the real `<Onboarding>` component with deterministic
fixtures.

- **No sign-in, and no Supabase reads or writes.** Every write goes through the
  component's `services` prop. The preview passes in-memory stand-ins, and that
  includes feedback submission. In development the middleware skips its session
  refresh for `/dev/`, so the page renders with no Supabase configuration at all.
- **404 in production.** In production builds, which includes Vercel previews
  (they run `NODE_ENV=production`), the middleware answers a real HTTP 404 for
  every `/dev/` path before anything renders. The page itself also calls
  `notFound()`. Tests in `test/onboarding-preview.test.js` guard both.

Query parameters:

| Parameter | Values |
|---|---|
| `step` | `basics`, `what_matters`, `rank` (the steps of the current flow) |
| `state` | `empty`, `populated`, `error` (saving fails, so the real save-error banner appears after the first change) |
| `mode` | `account` (default) or `shared` (an existing co-buyer setting up their own preferences on "Ciara's search") |

The completion screen ("Your search is ready.") is reached by finishing the Rank step.

## Screenshots

```sh
npm run dev
npm run visual:onboarding -- capture visual/before http://localhost:3000
# ...make changes...
npm run visual:onboarding -- capture visual/after http://localhost:3000
npm run visual:onboarding -- compare visual/before visual/after visual/diff
npm run visual:onboarding -- reference figma/basics.png visual/after/basics-populated-390-top.png visual/basics-vs-figma.png
```

### What `capture` produces

- **Widths:** 390, 768, 1024 and 1440 px, at a device scale factor of 1, with
  reduced motion. Captures wait until fonts and images have loaded.
- **Scenarios:**
  - Basics: empty, populated and save error;
  - What Matters;
  - Rank;
  - the completion screen;
  - shared-search setup.
- **Views:** for each scenario and width, three views:
  - `top`: the first screen;
  - `end`: scrolled to the bottom, which shows where a sticky action bar meets the
    last content;
  - `full`: the whole document.

  Full-page captures pin sticky elements to the first viewport, so judge sticky
  actions from `top` and `end` only.
- **Overflow check:** `manifest.json` records horizontal overflow. The run fails
  if any screenshot overflows.

### `compare` and `reference`

- **`compare`** writes per-file pixel diffs, with changes in red, plus a
  `report.json`.
- **`reference`** places a Figma export next to an implementation screenshot for
  human review.
  - It does not score fidelity. A device-frame mockup is not pixel-comparable with
    a browser render.
  - Figma exports are not stored in the repository. Pass their paths in.

Output folders (`visual/` in the example above) are scratch output and are not
committed.
