# First-use refinement, Part B

Base: `1eda8c6` (current main after merging security PR #193 and first-use PR #194). Work is isolated in `ux/home-detail-part-b` in a separate worktree. Dependencies were installed from the current lockfile, including Next.js 15.5.29; neither prior branch nor founder iOS signing files was changed.

Home Detail now leads with the property photo and its controls, followed by price/address/size, a compact **personal Match summary**, then Home Facts. The sticky bar keeps only the view name, save status and Close. The full Match breakdown and tour tools remain available below the facts and impressions.

Schools, Basic Details, Costs & Utilities, Garage, Basement and Laundry use the same visible serif disclosure heading and concise summary. Basic Details starts open; the other optional categories and impressions start closed. Schools remains visible even when nothing is known. Clicking a Match link reveals a collapsed category before focusing its field.

Unanswered fields use a neutral treatment. Only an unknown field linked to this buyer's unanswered priorities receives a terracotta outline and an accessible optional-priority description. The Match summary names unanswered Must-Haves beside the percentage and says how many known priorities support it. Unknown is never scored or displayed as No.

## Interaction semantics

| Control | Storage and behavior |
| --- | --- |
| Property type, garage type/spaces, laundry, HOA status, secondary-bedroom location | Existing scalar values. A pointer/touch selection applies and blurs the native single-select to dismiss its picker. Keyboard selections retain native focus and arrow-key behavior. The Unknown option remains available. Saved values outside the offered choices remain visible; no existing value is rewritten on focus. |
| Home layout | Still `home_layout[]` plus the existing primary-bedroom-location scalar. Multiple characteristics remain supported. Each change autosaves; **Done** dismisses the menu and returns focus to its trigger. |
| Home condition | Still the existing array, including simultaneous saved characteristics. Autosave on each choice, Done to dismiss, Escape to close only this menu. |
| Basement | Still free text with suggestions over the existing style/condition facts. Parsing, ambiguous wording, earlier notes and answer precedence are unchanged. |
| Heating/cooling | Still free text with native suggestions; combined systems are preserved. |
| Schools | Existing district, freeform school details and saved school names; no school lookup or inferred assignment. |
| Photo | Upload/change, URL and remove controls sit directly under the photo. The existing upload validation, caller-owned storage path, save flow and replacement cleanup remain intact. No cropping or repositioning was added. |
| Notes, Pros & Cons | Existing shared fields and conflict handling, now under a disclosure after property facts. No text or save payload was removed. |

Single-value controls do not gain a custom dialog or a Done step. Pointer dismissal applies only after a changed selection; keyboard/assistive selection is not forced to blur. Multi-value selections are never reduced to one value. Closing a category does not discard or reinterpret its fields. Match weights/calculation, provenance, unknown semantics, ownership/privacy, Realtor permissions, import safeguards, Supabase schema/RLS, native configuration, production flags and Floor Plans are unchanged.

## Before and after

The screenshots compare the same fictional local fixtures on base main versus this branch. Normal captures use 320, 375, 390 and 430 CSS px at 844px height. They are Chromium browser captures, not physical iPhone recordings. The single-select image shows the native control; the operating system's picker UI is not represented as a custom app sheet.

| Surface at 390px | Before | After |
| --- | --- | --- |
| Home Detail overview | [Before](screenshots/before/overview-390.png) | [After](screenshots/after/overview-390.png) |
| Photo and controls | [Before](screenshots/before/photo-controls-390.png) | [After](screenshots/after/photo-controls-390.png) |
| Schools | [Before](screenshots/before/schools-390.png) | [After](screenshots/after/schools-390.png) |
| Mostly unknown Home Facts | [Before](screenshots/before/mostly-unknown-390.png) | [After](screenshots/after/mostly-unknown-390.png) |
| Single-value control | [Before](screenshots/before/single-select-390.png) | [After](screenshots/after/single-select-390.png) |
| Multi-value control | [Before](screenshots/before/multi-select-390.png) | [After](screenshots/after/multi-select-390.png) |
| High Match with unanswered Must-Haves | [Before](screenshots/before/match-unanswered-390.png) | [After](screenshots/after/match-unanswered-390.png) |

All four phone widths are in [before](screenshots/before) and [after](screenshots/after). Enlarged-text captures cover 150% and 200% text on phone widths and desktop. Tests use the repository's development Supabase stand-in backed by throwaway local PostgreSQL databases.

## Founder QA checklist

- [ ] Recognize the saved home from its photo, address, price and size without repeated address headers. Scroll with the keyboard open and confirm the compact bar stays clear of content.
- [ ] Use Change/Upload photo, Photo URL and Remove directly below the image. Check failed upload/save recovery. No crop or reposition controls should appear.
- [ ] Find Schools as easily as Garage or Laundry. Open it with touch and keyboard; saved district/details/names remain available.
- [ ] Compare a mostly unknown home with a known one. Unknown feels optional; priority-related unknowns are distinct without looking like validation errors.
- [ ] Choose a property type or garage type: the native picker finishes after one selection. For layout/condition, choose several, tap Done, reopen and verify every saved selection remains.
- [ ] Check a high Match with unanswered Must-Haves. The score must not imply those are confirmed. Open Match details and follow a fact link into a closed category; no answer should be supplied for you.
- [ ] Check 320/375/390/430px and large text, then desktop. On a physical iPhone, verify Dynamic Type, VoiceOver, native picker dismissal, keyboard and photo-picker behavior.

## Validation results

- Unit run: **1,406 passed, 0 failed**; 251 PostgreSQL-dependent checks skipped in that run.
- PostgreSQL-enabled suite: **1,655 passed, 0 failed, 2 skipped** (sanitized live RentCast fixtures are absent).
- Production build: **passed** with the current security-patched lockfile.
- Focused Part B browser QA: **113/113 passed**, covering phone widths and desktop, 150%/200% text, native pointer dismissal versus keyboard focus, Done/Escape, hidden-field links, saved multiple characteristics, existing notes/personal answers, and photo URL/remove/upload through the local stand-in.
- Existing Home Facts/Match fulfillment: **9/9 steps passed**, including independent co-buyer Match, factual overrides, basement ambiguity, narrow screens and the full editor.
- Existing Home Facts completeness: **21/21 steps passed**, including HOA Unknown versus $0, tax-year handling, Townhome, co-buyer edits, Realtor read-only access and apartment floor-plan/unit persistence.
- **56 comparison screenshots** plus enlarged-text captures saved. [Summary](verification.json) · [Focused browser results](browser-results.json).

## Repeating checks

`npm test` and the PostgreSQL-enabled form of the test command in `docs/database-tests.md` cover the existing Home Facts, Match, privacy, authorization and persistence regressions.

Browser commands, with `FLH_TEST_PGHOST`, `FLH_TEST_PGPORT`, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` set as appropriate:

```sh
node scripts/qa/home-detail-part-b.mjs <standin.json> <outputDir> <baseUrl>
node scripts/qa/home-facts-match-fulfillment-e2e.mjs <standin.json> <outputDir> <baseUrl>
node scripts/qa/home-facts-completeness-e2e.mjs <standin.json> <outputDir> <baseUrl>
```

Run these serially when sharing a stand-in: they intentionally change the local QA persona's priorities. The existing regression helpers now open the new category disclosures before testing their editing paths. The completeness test checks the actual selected HOA status and saved database value, rather than mistaking the unselected “No HOA” option for a confirmed answer.

The production build used a temporary copy of the changed source with the same locked dependencies, so it could run without interfering with the screenshot server's `.next` directory. Hosted Supabase and physical native-device behavior were not tested. No production data or settings were changed.
