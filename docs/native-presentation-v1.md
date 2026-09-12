# Native Presentation V1

Phase 2 of the native iOS effort, building on the Capacitor/iOS foundation
(`docs/capacitor-ios-foundation.md`, PR #69). That phase made the app
installable as a real iOS app; this phase makes the installed experience feel
native where it obviously should, without redesigning anything that already
works. Not the Share Extension / Universal Links phase — see §6 below for
what's being prepared, not built, there.

North star: **same product, complete on either device, designed for the
screen you're using.** The responsive mobile web app is left alone; only
places where "installed app" genuinely differs from "a website" changed.

## 1. Native boot experience

`src/app/page.js` (root) and `src/app/(app)/layout.js` are both async Server
Components that resolve a Supabase session (and, for `(app)`, onboarding
status and the active search) before redirecting or rendering. Nothing about
that logic changed — no auth/business logic was duplicated.

What's new: `src/app/loading.js` and `src/app/(app)/loading.js`, each
rendering `NativeBootScreen` (`src/components/NativeBootScreen.jsx`). These
are Next.js's own `loading.js` convention — they're the fallback Next.js
already shows for the Suspense boundary it wraps around an async Server
Component's segment, so there's no artificial delay or fake timer: the boot
screen only appears for however long the real session/data resolution
actually takes.

`NativeBootScreen` renders nothing on ordinary web (`isNativeApp()` always
resolves `false` during SSR, and only flips after hydration confirms the
native shell — the same hydration-gated pattern the app already uses for
viewport-specific presentation, e.g. `CardContextDisclosure` in
`HomesBoard.jsx`). Inside the native shell it shows a centered `BrandMark` +
`Wordmark` on `var(--paper)` (the app's existing warm cream), with safe-area
padding top and bottom. A secondary line ("Finding your way home…") fades in
only if the real resolution is still in flight ~900ms in — never a delay
gating anything, just a threshold for when a bare brand mark starts to want a
word of reassurance.

**Known limitation, needs Xcode/device verification:** because the gate is
hydration-based, a cold native launch could in theory show a brief blank
frame before hydration completes and the boot screen appears, rather than
the boot screen being present from the very first paint. This mirrors an
existing, accepted tradeoff already made elsewhere in this codebase for
platform-gated UI; verify on a real device that it isn't perceptible in
practice. If it is, the fix would be a synchronous inline detection script —
deliberately not added here, since it would duplicate `isNativeApp()`'s logic
outside `src/lib/platform.js`, against this project's explicit
centralization rule.

## 2. Native auth presentation

`src/components/auth/AuthShell.jsx` wraps all four auth pages and is, in
effect, this app's only "marketing homepage" — there is no separate public
marketing route. Inside the native shell that two-column pitch (headline,
benefits list, testimonial-style copy) is exactly the kind of thing a
signed-out native user shouldn't see; they've already installed the app.

`AuthShell` is now a client component that defaults to the existing
marketing layout and swaps, post-hydration, to a simplified presentation when
`isNativeApp()` is true: brand mark + wordmark, the tagline "You found the
homes. We'll help you choose." (reused verbatim from `HowToUseModal` in
`AppShell.jsx`, not a new phrase), then the same `.afh-panel` used everywhere
else holding the actual sign-in/sign-up/forgot-password form — i.e. the
existing Supabase auth flows, completely untouched. No new auth provider, no
second backend, no Sign in with Apple.

Desktop and mobile-Safari are unaffected: `isNativeApp()` is `false` for both
at every point in their lifecycle, so they only ever render the original
two-column layout.

## 3. Installed-app chrome

Reviewed `AppShell.jsx` (header, desktop tabs, mobile bottom nav) against the
native shell. Findings:

- The PWA install prompt and its service-worker registration were already
  gated off inside the native shell in the prior phase (`InstallPrompt.jsx`,
  `if (isNativeApp()) return;`) — nothing further needed there.
- Primary navigation, route meanings, and the mobile bottom nav are unchanged
  for both native and mobile web.
- One real gap: a native WebView has no browser chrome pushing content below
  the status bar/notch the way mobile Safari's own UI does, so the app header
  could sit flush against it. `AppShell` now applies one `hh-native` class to
  its root (set the same hydration-gated way as everywhere else) and
  `globals.css` adds `.hh-native .hh-app-header { padding-top: max(10px,
  env(safe-area-inset-top)); }` inside the existing `@media (max-width:
  700px)` block. This is the only chrome change — nothing was hidden or made
  sparser beyond what was already true.

## 4. Reusable Sheet/modal primitive

New `src/components/Sheet.jsx`: mobile-first bottom sheet, desktop dialog,
same component either way. No new dependency — plain React + the existing
CSS variable system (`.hh-sheet*` in `globals.css`).

- **Mobile/native (`≤700px`):** pinned to the bottom edge, full width,
  rounded top corners only, `max-height: calc(90vh - env(safe-area-inset-top))`,
  `padding-bottom: env(safe-area-inset-bottom)`, a small drag-handle grabber
  for the native-sheet look, slide-up entrance (skipped under
  `prefers-reduced-motion`).
- **Desktop (`>700px`):** centered dialog, matching the existing
  `.hh-modal` visual language (radius, shadow, padding).
- **Accessibility:** focuses the first focusable element on open, traps Tab
  within the sheet, restores focus to whatever was focused before on close,
  and closes on Escape.
- **Backdrop tap** closes by default (`dismissOnBackdrop`, opt-outable per
  use).
- **Scrolling:** the page's own scroll is locked while a sheet is open
  (`document.body.style.overflow = 'hidden'`); the sheet's own body scrolls
  independently via `overflow-y: auto`, so the two never fight.
- **Stacking:** `z-index: 55` — above `.hh-mobile-nav` (40) and the
  first-run tour backdrop (39), and intentionally distinct from the older
  `.hh-modal-backdrop` (50) it doesn't replace everywhere yet.
- **Sizes:** `compact` / `default` / `large` — for a short decision, a
  form-sized panel, and (later) a longer workflow, respectively.

Three `size`/`showClose`/`dismissOnBackdrop` props and `title`/`ariaLabel`
cover everything used so far; nothing more elaborate was built ahead of an
actual second use case.

### Migrated as proof (exactly two, both simple confirmations)

- `ArchiveConfirmModal.jsx` — now renders through `Sheet` (`size="compact"`),
  same markup/copy/behavior inside.
- The generic `ConfirmModal` inside `HomesBoard.jsx` (used for the "delete
  permanently" confirmation in Archive) — same treatment.

Everything else — `HomeModal.jsx` (Add/Edit Home), `PostTourModal.jsx`, the
Sort `<select>` and filter chips in `HomesBoard.jsx` — was deliberately left
on its current presentation. Sort and Filters turned out not to be modals at
all today (a plain `<select>` and toggle chips), so converting them to a
sheet would have meant designing new picker UI for something that already
works, which is exactly the "opportunistic redesign" this phase was told to
avoid; that's a reasonable candidate for its own focused pass later, not a
side effect of building the primitive. `HomeModal.jsx` was explicitly kept
off-limits per the task's own scope note.

## 5. Native presentation gating

Every native-only branch added in this phase goes through the same one
helper, `isNativeApp()` in `src/lib/platform.js` — no new detection helpers
were introduced, and no direct `Capacitor` import appears anywhere outside
that file. The three call sites added: `NativeBootScreen.jsx`,
`AuthShell.jsx`, and `AppShell.jsx` (for the `hh-native` class). All three
follow the same hydration-gated `useState(false)` + `useEffect` pattern
already established for platform/viewport-specific presentation elsewhere in
this codebase. None of it touches routing, data fetching, or auth/business
logic — those remain the plain server-side redirects and Supabase calls they
already were.

## 6. Home Detail — audit findings, no redesign

Compared `HomeDetail.jsx`'s current structure against the target hierarchy
(Home/Apartment identity → photo → price → facts → Match/lifecycle → Why it
Matches → commutes → Your relationship with this home (tour action +
post-tour reflection) → collaborator perspective → notes → listing link).
It already matches, in this order:

`hh-detail-hero` (photo, `identity.primary`/`option`/`supporting`, price,
core facts, Match %, lifecycle status, original-listing link) → Property
facts → Location & commute → "Why this home is a match" breakdown → "Your
relationship with this home" (Want to tour / Favorite / Archive, overall
feeling, liked/disliked, record-your-take) → collaborator perspective →
property notes.

No rebuild was warranted or performed. The one chrome/safe-area issue found
— the shared app header needing top-safe-area padding inside the native
shell — is fixed once at the shell level (§3) and automatically covers this
page along with every other page inside `(app)`, since Home Detail renders
as `AppShell`'s `children`. No Home-Detail-specific change was needed.

## 7. Compare / Map / My Search

Not touched. None of the changes in this phase (boot screen, `AuthShell`,
`hh-native` header padding, the `Sheet` primitive and its two migrations)
reach these three screens — verified by checking that neither `ConfirmModal`
nor `Sheet` is imported anywhere in `CompareBoard.jsx`, the Map page, or the
Search page, and that `hh-native`/`hh-sheet*` CSS is purely additive. Their
own native passes remain future work.

## 8. Share-to-FLH preparation

**Proposed flow, once the Share Extension exists:** Zillow/Realtor/
Apartments.com/Safari → Share → Feels Like Home → the extension opens (or
hands off to) the main app at `/homes?url=<encoded listing URL>` → the user
lands on Add Home, already looking up that address, and reviews/confirms the
contender before it's saved.

**What already exists to reuse:** `HomeModal.jsx`'s existing "Find a home"
bar already accepts a pasted listing URL and does exactly this lookup today
— `extractAddressFromListingUrl` / `extractApartmentIdentityFromListingUrl`
(`src/lib/listingUrl.js`) parse the URL string-only (no fetching the listing
page), then `/api/import-listing` (RentCast) enriches from the derived
address. `findInput` already initializes from `initial.listingUrl` if one is
passed in. `HomesBoard.jsx` already has the exact routing precedent needed
— `?add=1` and `?home=<id>` both auto-open Add/Edit Home from a URL param
once, then clear the URL via `router.replace('/homes')`.

**Route status:** confirmed no `/add` route and no `url` query-param handling
existed anywhere before this phase.

**What was actually implemented — flagged explicitly, not silent scope:**
because reusing the existing pattern above is a small, entirely web-safe,
zero-production-risk addition (no schema change, no new dependency, purely
additive query-param handling), it was implemented now rather than deferred:

- `HomesBoard.jsx` gained a third auto-open effect, `?url=<listing URL>` on
  `/homes`, opening Add Home pre-filled with that `listingUrl`.
- `HomeModal.jsx` gained one prop, `autoFindOnMount`, which — only when true,
  only once, on mount — runs the exact same `handleFind()` the user would
  trigger by pasting the URL themselves.

This is **not** `/add?url=` — it's `/homes?url=` (`/add` doesn't exist as a
route in this app; `/homes` already is the Add Home surface). It is
web-reachable today (paste a listing URL as a query param, or link to it from
anywhere) with no Apple entitlements, Associated Domains, or Universal Links
involved — those remain fully out of scope for this phase, un-implemented,
as instructed. When the Share Extension is eventually built, it can target
this exact URL and this exact flow needs no further changes.

## 9. Production-preservation checklist

- Public/marketing surface for ordinary web: unchanged — `AuthShell`'s
  native branch never activates outside `isNativeApp() === true`.
- Desktop app: unchanged.
- Mobile Safari: unchanged — every new branch in this phase is gated on
  `isNativeApp()`, which is `false` for mobile Safari at every point in its
  lifecycle, same as desktop.
- Existing beta mobile navigation: unchanged (bottom nav, first-run tour).
- Supabase auth, onboarding, Homes data, Match, collaboration,
  import/RentCast, Google/Places: no changes to any of this logic — only
  presentation-layer additions were made.
- No schema/RLS/migration changes.
- No Vercel/DNS/env changes.

## 10. Testing

- `node --test test/*.test.js` — full existing suite, plus new tests for
  `NativeBootScreen`, the native `AuthShell`/`AppShell` gating, and `Sheet`.
- `next build` — production build.
- Ordinary-browser proof: tests assert the native branches are reachable
  only through `isNativeApp()` and that `isNativeApp()` itself resolves
  `false` in this Node/non-Capacitor test environment (already established
  in `capacitor-foundation.test.js`), which is the same condition web/desktop
  browsers run under.
- **Requires Xcode/device, not validated here:** the boot screen's actual
  on-device timing/flash behavior on a cold native launch (§1); the native
  header's safe-area padding against a real notch/Dynamic Island; the
  bottom-sheet's slide-up animation and safe-area padding in the native
  WebView; overall look-and-feel of the simplified native sign-in screen.
