# Share intake web contract (`/homes?url=`)

Phase 1 of the native sharing sequence (harden the web contract → Universal
Links/deep linking → iOS Share Extension). This document is the audit trail
and the resulting contract; #74/#75 should be able to treat everything below
as stable.

## 1. Audit findings (pre-#73 state)

- The `url` query param was read in exactly one place: a `useEffect` in
  `HomesBoard.jsx`, gated by `mode === 'homes'` and a `useRef` one-shot guard
  (`autoOpenedRef`) shared with the existing `?add=1`/`?home=` auto-open
  effects.
- `searchParams.get('url')` truthiness (`!sharedUrl`) was the only gate —
  `null` (absent) and `''` (present but empty) were treated identically:
  neither did anything. A malformed or non-URL value (no `http(s)://`
  prefix) was **not** rejected — it was stuffed into `listingUrl` and fed to
  `HomeModal`'s `autoFindOnMount`, which runs the exact same code path as a
  user pasting text into the Find bar: `handleFind()` would treat it as a
  plain address/property-name search, potentially firing an unwanted
  RentCast lookup on garbage text. **Bug: malformed/garbage `url` values
  were not validated before being treated as a real listing URL.**
- `extractAddressFromListingUrl` / `extractApartmentIdentityFromListingUrl`
  (`src/lib/listingUrl.js`) are string-only parsers — never fetch the
  target URL, return `null` gracefully on any unrecognized shape, and are
  already well-tested. No changes were needed here.
- The apartment partial-identity flow already existed and already matched
  this task's target copy **verbatim**: "We found the property." / "We just
  need the street address." (`HomeModal.jsx`, `importPhase === 'identity'`).
  The unsupported-URL fallback already showed "We couldn't get much from
  that link, but you can still add the property." while preserving
  `listingUrl` on the form. Neither needed to change.
- `lookupAddress()` already handles importer failure gracefully: a failed
  RentCast call does **not** set `lastLookupAddress`, so the exact same
  address remains retryable; error copy always offers manual entry
  ("you can enter details manually below"); already-entered fields are
  never overwritten by `mergeImportFields`. No changes needed.
- **Bug: signed-out auth loses the destination entirely.** `(app)/layout.js`
  called `redirect('/auth/sign-in')` and `redirect('/onboarding')` with no
  query param carrying the page the user was actually trying to reach. A
  signed-out user opening `/homes?url=<shared listing>` would be dropped on
  a bare sign-in screen with the shared URL gone for good — the single
  biggest risk item 3 of this task calls "critical."
- An existing `?redirect=` convention **already existed** and was already
  wired correctly end-to-end: `sign-in/page.js` and `sign-up/page.js` both
  read `redirect`, `sign-up` forwards it through Supabase's
  `emailRedirectTo` into `/auth/callback?next=`, and the callback route
  redirects to `next` after exchanging the code. The only missing link was
  the very first hop — nothing upstream of sign-in ever populated
  `redirect` for the auth-gate case.
- **No duplicate-detection logic existed anywhere in the app.** Adding a
  home always creates a new record; there is no address- or URL-based check
  before insert. Building full fuzzy duplicate detection was out of scope
  (would need new schema/backend work this PR is not permitted to add) —
  see §9 for the conservative, additive check that was built instead.
- `router.replace('/homes')` (not `push`) was already used to consume the
  `url`/`add`/`home` params — no history-stacking issue, already correct.
- No native-only branch existed or was needed — the intake effect runs
  identically regardless of `isNativeApp()`.

## 2. Canonical intake states

| State | Trigger | Behavior |
|---|---|---|
| A. No URL | `/homes` | Unchanged — ordinary Homes screen. |
| B. Empty/malformed | `/homes?url=`, garbage text, non-`http(s)` scheme | Opens a bare, empty Add Home form. No `listingUrl` set, no auto-lookup, no fabricated data. |
| C. Supported URL | `/homes?url=<encoded, parses to a recognized address>` | Opens Add Home pre-filled, runs the existing Find-a-home/RentCast lookup exactly once. |
| D. Partial apartment | Recognized apartment/community URL, no street address derivable | Opens Add Home with `propertyName`/locality pre-filled, `listingUrl` preserved, asks only for the street address ("We found the property." / "We just need the street address."). |
| E. Unsupported URL | Valid `http(s)` URL the parser doesn't recognize | `listingUrl` preserved on the form, falls back to manual entry ("We couldn't get much from that link, but you can still add the property."). |
| F. Duplicate | URL exact-matches an already-saved home's `listingUrl` | Routes straight to that home's existing Detail page — no second contender created, no error shown. |

## 3. URL validation (new: `isLikelyListingUrl`, `src/lib/listingUrl.js`)

A single, shared, exported predicate — `/^https?:\/\//i.test(value.trim())`
— now gates the `/homes?url=` intake effect **and** `HomeModal`'s own
`handleFind()` (previously an inline, unexported regex duplicated only in
`handleFind`). Only a value that passes this check is ever assigned to
`listingUrl` or triggers auto-find; everything else opens a bare Add Home
form. This is intentionally the same narrow definition the address parsers
already assume — no new normalization subsystem, no rewriting of provider
URLs, no guessed schemes. The original string is preserved verbatim
(`.trim()` only) wherever it's stored.

## 4. Duplicate handling (new: `findHomeByListingUrl`, `src/lib/listingUrl.js`)

Exact string match only, against `home.listingUrl` (trimmed) across the
already-loaded homes for the active search. Deliberately the most
conservative signal available:

- **Confident enough to act on**: the same listing URL was already saved.
  Routes to that home's Detail page instead of opening Add Home.
- **Not attempted**: address-based or fuzzy matching. Two different listing
  URLs are never treated as "probably the same home" — per the product rule
  "do not silently merge distinct properties," anything less certain than an
  exact URL match is left alone and a normal Add Home flow proceeds.
- **Known limitation**: this check only sees the client's already-loaded
  `homes` snapshot, not other tabs/sessions saving the same URL in the same
  instant. No realtime dedup subscription exists (and adding one would be
  new infrastructure outside this PR's scope) — a true race between two
  concurrent saves of the same URL can still create two homes. This is
  reported, not silently accepted as solved.

## 5. Auth preservation

- `src/middleware.js` now sets one additional request header,
  `x-pathname` (`pathname + search`), alongside its existing session-refresh
  logic — unchanged otherwise. Layouts don't receive `searchParams` as a
  prop (a page.js-only API), so this is the standard bridge for a layout to
  know the current URL.
- `src/app/(app)/layout.js` reads that header and appends
  `?redirect=<original path+query>` to both the sign-in and the onboarding
  redirect, once validated by `sanitizeRedirectPath` (new,
  `src/lib/safeRedirect.js`).
- `sanitizeRedirectPath` accepts only a same-origin relative path (starts
  with exactly one `/`, no `//`, no backslash, resolves to the same origin
  when parsed against a private sentinel base) — this is also now applied
  at every point that *consumes* a `redirect`/`next` value
  (`sign-in/page.js`, `sign-up/page.js`, `auth/callback/route.js`), closing
  a pre-existing open-redirect gap in that already-present mechanism (none
  of those three previously validated the value at all).
- `Onboarding.jsx`'s `finish()` now reads an optional `redirect` param and
  pushes there instead of the hardcoded `/search?welcome=1` **only when
  present and valid** — the ordinary onboarding completion experience is
  otherwise completely unchanged.
- End-to-end: signed-out user opens `/homes?url=X` → redirected to
  `/auth/sign-in?redirect=%2Fhomes%3Furl%3DX` → signs in (or signs up →
  confirms email → `/auth/callback?next=...`) → lands back on
  `/homes?url=X` → the existing intake effect runs exactly once, same as if
  they'd never left.
- No new auth architecture, no Supabase config change, no middleware
  behavior change beyond the one additive header.

## 6. Idempotence / query-param cleanup

- `autoOpenedRef` (a `useRef`, not persisted) still guarantees the intake
  effect (now covering url/add/home together) fires at most once per
  mount. `router.replace('/homes')` — never `push` — removes `url` from the
  visible location immediately after consumption, so it isn't re-triggered
  by rerenders, and doesn't leave a stray back-button entry.
- Reopening the exact same `/homes?url=` link after a successful save now
  routes to the existing home (§4) instead of creating another.
- **Known, accepted edge case**: a hard refresh in the sub-second window
  between the initial navigation and `router.replace` completing could
  still show the param in the address bar and re-run the effect on reload.
  This is an inherent limitation of client-side query-param consumption
  (not specific to this app) and was not solved with a server-side redirect
  rewrite, which would be a larger architecture change outside this PR's
  scope — flagged rather than silently accepted as solved.

## 7. Mobile / Capacitor compatibility

No native-only branch was introduced or needed. The entire intake path is
plain client-side React state + `router.replace` + fetch — identical in
desktop browser, mobile browser, and the Capacitor WebView. `isNativeApp()`
is not referenced anywhere in this change.
