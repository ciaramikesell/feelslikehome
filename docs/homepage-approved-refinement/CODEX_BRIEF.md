# Feels Like Home — Public Homepage Refinement

Start from current `main` (after merged #202), create a focused new branch and draft PR. Keep all signed-in onboarding, Match logic, co-buyer permissions, native welcome, and shelved #198 unchanged.

## Approved assets
Use these four exactly as supplied in this archive; they are four cropped panels of the founder-approved 2x2 composition, not prompts to regenerate.

1. `01_set_your_preferences.png`
2. `02_import_homes_from_anywhere.png`
3. `03_compare_what_matters.png`
4. `04_search_decide_together.png`

Optimize for the web (WebP or AVIF) without distorting the image, preserving the shared roughly 4:3 aspect ratio, soft cream styling and consistent framing. Assets are approximately 718px wide and should not be sharpened/upscaled artificially. Use image loading appropriate to this below-the-fold section, reserve space to eliminate layout shifts, and provide descriptive alt text.

## Hero simplification
- Keep approved cottage photo, FLH branding, navigation, and signup-first CTA.
- Set the first sentence **“You’ve saved a lot of options.”** on ONE line at normal desktop widths by adjusting its typography responsively to the available text column. Do not overflow/clip or make it unreasonably tiny. On phones, allow natural wrapping.
- Keep follow-up headline **“Now find the one that Feels Like Home.”** with branded emphasis on “Feels Like Home.”
- REMOVE the shaded descriptive box/paragraph from the hero entirely: “Import the homes you’ve already saved. See how they match what matters to you. Then tour, compare, and choose together.”
- Keep one clear primary CTA: “Create a free account.”

## How It Works section
- REVERSE the desktop columns: preview artwork on the LEFT; copy and interactive feature selection on the RIGHT. On mobile, stack logically, preserving usable controls and focus sequence; preview and content should remain readable.
- Keep the small eyebrow **HOW IT WORKS**.
- REMOVE “Search anywhere. Decide here.”
- Replace with the exact paragraph: **“Import the homes you’ve already saved. See how they match what matters to you. Then tour, compare, and choose together.”** This should be the primary explanatory text for this section and not duplicated in the hero.
- Display four interactive selection labels ONLY, with no persistent supporting copy beneath each selection:
  1. **Set Your Preferences**
  2. **Import Homes from Anywhere**
  3. **Compare What Matters**
  4. **Search & Decide Together**
- Preserve current mouse hover/focus selection, click/tap/Enter/Space activation, selected state persistence, keyboard focus and aria semantics.
- Under the active photo, show a feature-specific caption instead of the repeated disclaimer. Proposed exact captions (founder can adjust copy in review):
  - Set Your Preferences: **“Tell Feels Like Home what matters to you — and how important each priority is to your decision.”**
  - Import Homes from Anywhere: **“Keep the listings you’ve found in one place, no matter where you discovered them.”**
  - Compare What Matters: **“See how each home fits your priorities, with your personal Match clearly broken down.”**
  - Search & Decide Together: **“Compare your own priorities alongside your co-buyer’s, with suggestions from your Realtor.”**
- REMOVE the existing repeated caption: “Illustrative examples. Navigation and details may differ. Listing sites are shown for reference only, without affiliation or direct integration.”
- IMPORTANT: Photos are *illustrative mockups*, not actual integrated listing-site APIs. Because the supplied artwork contains listing-source names/logos and conceptual UI, avoid making any new claim of official partnerships or seamless direct integration. If legal/product accuracy calls for a caveat, propose ONE unobtrusive section-level note outside the active image captions, not a repeated paragraph under every image, and flag it for founder review. Do not modify the founder-approved image pixels without explicit permission.

## QA & delivery
- Check 320, 375, 390, 430, 768, 1024, 1280, 1440px; confirm first hero sentence remains on a single line at standard desktop widths, responsive headline remains tasteful, image left / copy right on desktop, mobile stacks clearly, 4 imagery states fill consistent panel frames, no crop or horizontal overflow, no panel height jumps, and keyboard/mouse/touch selectors all work.
- Verify homepage navigation/CTA and existing signup-first routing unaffected, and For Realtors untouched.
- Run focused tests, available full suite, production build, and browser screenshots at key widths. Note optional database fixture skips distinctly.
- Update founder QA screenshots and document all text changes.
- Create a NEW draft PR, leave unmerged until founder approves.
