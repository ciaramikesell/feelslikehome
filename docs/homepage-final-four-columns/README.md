# Final four-column homepage — founder review

**Latest #204 amendment:** [mobile-website carousel, restored eyebrow, native exclusion, current screenshots and verification](mobile-web-amendment/README.md). The before/after captures below record the initial four-column draft before this founder amendment.

Base: latest main `94bfd86`, merged PR #203. Branch: `ux/homepage-final-four-columns`. The founder’s request authorizes the homepage simplification; the attached [CODEX_BRIEF.md](CODEX_BRIEF.md) supplied its detailed specification and was read in full before changes.

## Before → after

| Area | #203 baseline | Final simplification |
| --- | --- | --- |
| Hero | 610px cottage/copy area | Responsive desktop minimum `clamp(640px, 80svh, 920px)`; about 80% of the tested 900px viewport. Mobile remains content-driven with a bounded image ratio. |
| Transition | Direct cream-to-peach change | One thin gradient rule, hidden from assistive technology. No upper-left vine backdrop; approved cottage photo remains intact. |
| How It Works | Eyebrow, long explanatory paragraph, four interactive labels and one swapping image | Centered serif heading; four illustrations displayed together in borderless editorial columns. 4 columns ≥1200px, 2 at 640–1199px, 1 below 640px. |
| Feature text | Persistent selectors and changing captions | One HTML heading and one short caption per illustration; headings reserve two lines on desktop/tablet to align captions. |
| Collaboration | Separate sage marketing section and example cards | Removed from the public homepage; collaboration is represented by the fourth column. Actual co-buyer/Realtor functionality is unchanged. |
| Interaction | Hover/focus/click/tap preview state | No selector, pagination, swapping image, preview state or fake controls. Account/navigation interactions remain unchanged. |

Exact feature copy:

1. **Set Your Preferences** — Decide what matters most to you.
2. **Import Homes from Anywhere** — Bring your saved listings together.
3. **Compare What Matters** — See how each home fits your priorities.
4. **Search & Decide Together** — Make decisions with your co-buyer and Realtor.

One shared small note remains below the grid: “Illustrative mockups and Match results. Listing-source names do not imply affiliation or direct integration.” No automatic listing feeds, partnerships or combined co-buyer scores are claimed.

## Approved artwork and delivery

All four supplied 1448×1086 PNGs were directly encoded to quality-92 WebP at the original dimensions. No cropping, resizing, sharpening, compositing, regenerated artwork or text overlays. In particular, `04_search_decide_together_APPROVED.png` is the fourth asset: Ciara’s Location/Home Office/Garage hearts filled; Andrew’s Garage/Home Office filled and Finished Basement outlined. Alt text also describes these states.

[Asset provenance, source/output SHA-256 and dimensions](assets.json). Combined WebP source size is 844,366 bytes versus the roughly 7MB source archive. Native lazy loading, intrinsic width/height, 4:3 aspect ratio, contain fitting and responsive Next image sizes reserve layout and serve appropriately sized variants. Titles/captions remain selectable HTML; tiny image labels are also described in alt text. No borders, CSS browser frames or shadows are added to the illustrations.

## Verification

- Production build passed with Next 15.5.29 using the unchanged lockfile.
- Focused public/Realtor landing, desktop-auth entry and native-welcome tests: **43 passed**.
- Full unit run: **1,413 passed**, zero failed; 255 database-dependent checks skipped in unit mode.
- Full PostgreSQL-enabled suite: **1,666 passed**, zero failed; **two optional sanitized live RentCast fixture checks skipped**. Local test databases only.
- Production browser QA: **178/178 assertions passed**. [Assertion log](browser-results.json). All eight requested widths are checked for 4→2→1 grid, one-line desktop hero opening, hero height, image loading/layout stability, uncropped 4:3 imagery, headings/alt semantics, exact copy, no overflow, divider accessibility, CTA/signup-first behavior and Realtor navigation. Desktop/mobile baseline comparisons additionally check unchanged Realtor pixels and social/link metadata.
- Browser captures use Chromium mobile/touch emulation and deterministic fallback fonts (external font requests blocked in both versions). Production font declarations remain unchanged. Physical iPhone and VoiceOver review remain founder QA.
- Retired the obsolete interactive homepage QA runner and replaced it with `scripts/qa/homepage-final-four-columns.mjs`. Earlier homepage documentation remains as a historical record of #203.

Application changes are confined to the public landing, its new static features component, its four illustration assets and homepage-scoped CSS. Root routing, metadata, auth components, native welcome/configuration, Match, schema/RLS, Floor Plans, co-buyer isolation and standalone For Realtors source are unchanged. No deployment or merge is performed.

## Before and after screenshots

| View | Before #203 | Final |
| --- | --- | --- |
| 1440px desktop, full page | [Before](screenshots/before-1440.png) | [After](screenshots/after-1440.png) |
| 390px mobile, full page | [Before](screenshots/before-390.png) | [After](screenshots/after-390.png) |

- [320px final full page](screenshots/after-320.png)
- [375px final full page](screenshots/after-375.png)
- [390px final full page](screenshots/after-390.png)
- [430px final full page](screenshots/after-430.png)
- [768px final full page](screenshots/after-768.png)
- [1024px final full page](screenshots/after-1024.png)
- [1280px final full page](screenshots/after-1280.png)
- [1440px final full page](screenshots/after-1440.png)

[1440px editorial section](screenshots/editorial-1440.png) · [390px editorial section](screenshots/editorial-390.png)

## Founder checklist

- [ ] Review 1440px and 390px before/after: taller hero, subtle divider, no vine backdrop, no separate collaboration marketing.
- [ ] Confirm all four illustrations are visible without selection, with equal prominence and readable HTML headings/captions.
- [ ] Inspect the fourth illustration’s filled/outlined hearts and fictional separate Match values, plus all three comparison Match labels.
- [ ] Review the shared illustrative note and 4/2/1 spacing on desktop/tablet/phone.
- [ ] On physical iPhone and with VoiceOver/large text, check page reading order, navigation and Create a free account.
- [ ] Approve the draft before merge; no automatic deployment authorized.

Reproduce against local production servers and the existing test Supabase stand-in: `node scripts/qa/homepage-final-four-columns.mjs <afterUrl> <before203Url> docs/homepage-final-four-columns`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Chromium is elsewhere. No live account is created by QA.
