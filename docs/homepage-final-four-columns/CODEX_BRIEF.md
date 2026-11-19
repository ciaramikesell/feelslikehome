# Feels Like Home — Homepage Final Simplification (Codex)

## Starting point / guardrails
Start from latest `main` after the merged homepage refinement PR #203. Create a focused branch and draft PR. Do not modify unrelated onboarding, auth/signup-first, Match computations, permission models, co-buyer isolation, native welcome, Floor Plans, or Realtor functionality. Do not merge without founder review.

## Asset mapping (use these EXACT approved files)
- `01_set_preferences.png` — Home Office/Must Have, Fenced Yard/Important, Soaking Tub/Nice to Have.
- `02_import_homes.png` — source labels feeding a saved-homes collection; retain the visual as supplied. Third-party names are illustrative, not official integration claims.
- `03_compare_what_matters.png` — three different homes with 92%, 87%, 76% Match badges; these are fictional illustration values, not app-provided scores.
- `04_search_decide_together_APPROVED.png` — FINAL founder-approved Ciara and Andrew graphic: Ciara Location/Home Office/Garage hearts ALL filled; Andrew Garage and Home Office filled; Finished Basement outlined/unfilled. DO NOT substitute any earlier fourth-image variant or regenerate it.

All four PNGs are 1448x1086 (4:3). Convert to optimized responsive WebP/AVIF with appropriate quality and sizes; keep PNGs available as original sources if desired. Avoid text becoming illegible due to overaggressive cropping or resizing. No fake controls or new copy should be added inside illustrations.

## Design direction
Founder wants a much simpler editorial landing page. The page has grown too tall and repetitive. Keep existing warm cream/peach/terracotta/sage branding, serif typography, logo and the approved cottage hero photograph, but remove vine decoration in the upper-left. Avoid additional ornamental clutter and double frames/shadows.

### 1 — Taller hero
Hero occupies roughly 75–85% of desktop viewport height where practical (use responsive min/max height, and avoid cropped or over-tall mobile layouts). Leave breathing room around the cottage image and copy. Keep 'You’ve saved a lot of options.' on ONE line at ordinary desktop widths if possible without shrinking it into a tiny eyebrow. Keep 'Now find the one that Feels Like Home.' with terracotta 'Feels Like Home.' as current brand treatment, and the single Create a free account CTA. No hero description paragraph; do not reintroduce it. Make sure header navigation remains readable and accessible.

### 2 — Delicate transition
A single thin, subtle decorative rule between hero and How It Works, optionally with small restrained ornamental center detail. NO upper-left vine backdrop. Keep ornament subtle, not heavy.

### 3 — How It Works: ALL FOUR VISIBLE SIMULTANEOUSLY
Remove current interactive four-step selector / swapping photo viewer and any associated state/pagination not used elsewhere. No need to click to see the next image. Make 'HOW IT WORKS' a centered, meaningful serif section heading, moderately larger than the former eyebrow. Do not repeat the long intro paragraph. Use four BORDERLESS editorial columns with equal visual prominence and substantial whitespace, each with its own approved image, concise heading, and ONE brief caption beneath:

1. **Set Your Preferences** — 'Decide what matters most to you.' — `01_set_preferences.png`
2. **Import Homes from Anywhere** — 'Bring your saved listings together.' — `02_import_homes.png`
3. **Compare What Matters** — 'See how each home fits your priorities.' — `03_compare_what_matters.png`
4. **Search & Decide Together** — 'Make decisions with your co-buyer and Realtor.' — `04_search_decide_together_APPROVED.png`

No numbered-looking oversized boxes, no card outlines, no double browser frames added by CSS. Illustrations are the visuals; titles and captions are HTML text. Retain legibility in four columns: max content width around 1280–1440px and crop/edit backgrounds only if absolutely necessary; do NOT crop out important feature names, scores, filled hearts, etc. Balance vertical alignment even when headings wrap. Desktop 4 columns, tablet 2 columns, mobile 1 column (if appropriate test compact 2-column layout only when readable). Use native lazy loading and no layout shift. Accessibility: accurate alt text, visible body text, semantic heading structure.

### 4 — Remove redundant collaboration marketing section
The bottom sage section 'Choosing a home doesn’t happen alone' should be removed from the public homepage, including the two co-buyer/Realtor example cards, because the fourth editorial column now communicates collaboration. Do NOT remove actual co-buyer/Realtor functionality or the For Realtors standalone page/navigation. Keep a clean footer and existing primary CTA.

### 5 — Disclaimers and product correctness
Do not repeat legal/illustrative disclaimers beneath each illustration. If product/legal accuracy warrants a single small section-wide note about conceptual mockups and listing-source names without affiliation/direct integration, add one discreet shared note below all four columns. Do not state or imply automatic partnerships or feeds from listing sites; the product imports user-supplied links. Match percentages and example details in artwork are illustrative, not promises of features/scores. Do not blend co-buyer match scores.

### 6 — QA and deliverables
Browser QA with screenshots at 320,375,390,430,768,1024,1280,1440. Verify the 4->2->1 responsive grid, one-line first hero sentence on common desktop, CTA/nav routes, alt/heading semantics, no overflow, no layout shift, clear hearts and Match labels at target sizes, social/link preview metadata unchanged, and no regressions to signup or Realtor navigation. Run production build, focused public landing tests, and full available test suite; report skips. Update any expectations/tests formerly based on clickable preview selection. Document before-and-after, include 1440 desktop and 390 mobile full-page screenshots and a founder checklist. Create a draft PR and report head SHA, Vercel status, and tests. STOP before merging.
