# UX: Simplify Native My Homes

Independent branch from verified `main` `94bfd86` (PR #203). No dependency on the Home Details refinement or public-homepage PR #204. No merges/deployments, migrations, RLS, native signing/configuration, onboarding, Match or invitation logic changes.

## Result and runtime boundary

At phone widths in the installed Capacitor shell, My Homes now has a compact FLH wordmark/account/search-context header; a real active-search saved-home count; independent Search and Filter actions; a labeled Add a Home action; compact sorting; and an explicit Archived link. The first card leads with a larger full-width photo. Card identity, participant-specific Match, notes and lifecycle actions use their original data and handlers.

The existing `platform.js` first-paint `data-flh-native` marker gates all new CSS, together with the My Homes route and the existing phone breakpoint. AppShell's existing `isNativeApp()` runtime check is reused; viewport width is never enough to enable the redesign. Ordinary phone browsers and desktop keep their existing interface. Wider native tablet layouts keep their existing shell. New native controls default to `display:none` and cannot be reached through the ordinary browser's keyboard or accessibility tree.

The native My Homes top tab row, permanently expanded search row, quick-filter chips and persistent collaboration invitation line are hidden. The existing bottom navigation and its Search destination are untouched. Multi-search switching remains in the compact header, including owner/co-buyer context. Invitations/People management remain available through the existing Search/People surfaces. Archived homes remain available even when no active homes exist.

Search expands a labeled field on tap and focuses it. Escape collapses it and returns focus to the trigger. It uses the original query/filter pipeline. Filter opens the existing accessible sheet, with its original draft/apply/clear behavior. Sorting uses the original sort keys with existing compact labels. Empty searches show the approved message and exactly one visible Add action; sorting/filtering are absent. Tap targets remain at least 44px. Safe-area and bottom-nav clearance remain owned by the existing app contract.

## Audit

Reviewed AppShell utility/header/top tabs/bottom navigation, HomesBoard's query/sort/filter and lifecycle handlers, SearchSwitcher, CoBuyerHomesLine, the Homes layout's empty state, platform detection, and native presentation documentation. Presentation is scoped to native My Homes; routing, data fetching, membership resolution, personal Match projection and all save/archive/restore handlers are unchanged.

## Verification

- Production build: passed (Next 15.5.29).
- Full `npm test` with local PostgreSQL 17: **1,667 passed, 0 failed, 2 skipped** (optional sanitized live RentCast fixture tests).
- `scripts/qa/native-homes-refinement.mjs`: **44 checks passed**, production app in real Chromium with Capacitor's actual iOS bridge JS injected before page load. Covers 320/375/390/430px; populated/empty states; actual count; no duplicate top tabs or overflow; 44px targets; search, focus restoration and no-results; sort; filter application/clearing and focus trap; Add; Archive; card action clearance; Home Details/Close; actual archive/restore; search switching and co-buyer access; every bottom navigation destination.
- Ordinary website before/after screenshot comparison at 390 and 1440px: **zero differing UI pixels in the final run**. Mobile was pixel-identical; desktop had 55 image pixels differing by at most 10/255 from browser image-decoder rounding. The comparison allows tightly bounded image-decoder rounding inside photo edges; it requires exact pixels elsewhere. No screenshot masks hide website controls.
- Existing native welcome/tutorial/deep-link harness: **61/61 passed**. QA-only maintenance updates its stale tutorial selectors/copy and makes its local auth cookie match the configured stand-in host. No welcome/tutorial product code changes. [Results](native-homes-refinement-screenshots/native-welcome-regression-results.json).
- Founder screenshot [index](native-homes-refinement-screenshots/README.md), including native before/after, search open, Filter, Add, empty, Archived and search switching, plus unchanged website references.

First-photo position in the populated QA search:

| Width | Before | After |
|---|---:|---:|
| 320 | 556px | 287px |
| 375 | 505px | 287px |
| 390 | 505px | 287px |
| 430 | 485px | 258px |

All browser QA uses the disposable Supabase HTTP stand-in backed by real PostgreSQL authorization, not Production. Screenshot data is QA-only and the photo is the existing FLH cottage asset. Genuine FLH fonts are served locally to the QA browser because Google Fonts is blocked here; production font loading remains unchanged.

## Founder / physical TestFlight QA

- [ ] On the installed app, check compact header and first card at the phone's normal text size and with larger accessibility text.
- [ ] Open Search, type and clear a query, dismiss the keyboard, and return to the list.
- [ ] Apply/clear filters and try each sort, including Best/Lowest Match and both price directions.
- [ ] Add a home, open/close its details, archive and restore it, and switch between own/shared searches. Verify the count and personal Match follow the active search.
- [ ] Visit every bottom tab. Check bottom safe-area clearance, keyboard/back behavior, cold launch and a real Share Extension/Universal Link.
- [ ] Check an empty search: approved message, one Add button, no sort/filter clutter. Invitations remain discoverable under Search/People.
- [ ] Verify Safari/desktop still show the original website interface.

Physical WKWebView keyboard resizing, notch/Dynamic Island insets, device back/gesture behavior, native lifecycle timing and the real Share Extension handoff require TestFlight/Xcode verification. Linux Chromium bridge emulation does not establish those physical-device results. Review and approve before merging or deploying.
