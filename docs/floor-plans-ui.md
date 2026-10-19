# Floor Plans UI (Stage C — PR 2 of 2)

The user-facing half of Floor Plans, on top of the merged foundation
(`docs/floor-plans-foundation.md`, PR #157). **Behind a server-side flag that
is off unless set.** With the flag off nothing in this PR renders, reads,
signs or uploads anything.

## Feature flag: `FLH_FLOOR_PLANS`

| Value | Result |
|---|---|
| unset, empty, anything else | **off** — My Homes / Realtor cards exactly as before |
| `on`, `true` or `1` (any case) | on |

* Read **on the server, per request** (`src/lib/featureFlags.js`), by the five
  pages that render home cards: My Homes (`homes/(board)/layout.js`), Want to
  Tour, Favorites, Archive, and the Realtor client page
  (`people/[searchId]`). They pass `floorPlans` down; client components never
  read the environment, and the value is not baked into the JS bundle.
* Off means: no `home_floor_plans` read, no `can_edit_home_floor_plans` /
  `is_search_decision_maker` call, no viewer mounted, so no signed-URL request
  and no upload. The card renders the original Notes link unchanged.
  (Proven in browser QA: the flag-off run records every network request and
  finds none.)
* No database or Storage change is needed or made by this PR; the foundation
  is already in Production.

**Turning it on** (each step needs your approval):

1. Vercel → Project → Settings → Environment Variables → add
   `FLH_FLOOR_PLANS` = `on`, scoped to **Preview** only. Redeploy the PR's
   preview (Vercel applies env changes to new deployments only).
2. Device QA on the preview (below), against whichever Supabase project the
   preview uses.
3. Production: add the same variable scoped to **Production**, then redeploy
   Production. **Rollback:** delete the variable (or set `off`) and redeploy;
   plans already uploaded stay stored and private, just hidden.

## What users see

**Cards** (My Homes, Want to Tour, Favorites, Archive): the Notes link stays on
the left; a quiet text action sits on the right, in the same muted style:

| Viewer | No plans | 1–4 plans |
|---|---|---|
| Owner / co-buyer | `Add floor plan` | `Floor plans (n)` |
| Connected Realtor (client page card) | nothing | `Floor plans (n)` |

If the counts cannot be read the action shows `Floor plans` (the viewer then
decides). The single cover photo, Notes, Match, Home Facts and the Add/Edit Home
overlay are untouched.

**Viewer** (`src/components/FloorPlans.jsx`): full-screen on phones and in
short landscape, a large dialog on iPad / desktop.

* One plan or several: counter (`2 of 3`), previous / next buttons, thumbnails,
  swipe left / right, arrow keys. No wrap-around.
* Zoom: pinch, double-tap / double-click, trackpad / wheel, `+` `-` `0` keys
  and Zoom out / Fit / Zoom in buttons (1×–4×). Drag pans while zoomed; the
  image never leaves the stage. At fit, pulling down closes.
* Close: ✕, Escape, pull down. Focus is trapped while open and returns to the
  card action afterwards. Every control is labelled and ≥ 44 px; notices are
  announced (`status` / `alert`); reduced motion respected.
* Landscape iPhone: the thumbnails and actions move to a side rail so the plan
  gets the full height. Safe areas (notch, home indicator) respected.
* Owner / co-buyer: `Add floor plan` (JPEG, PNG or WebP, ≤ 10 MB, several at
  once), `Remove` (asks first: "for everyone on this search"), `n of 4 added`.
  Realtors and removed members get no controls.

**States**: loading; empty (buyers get an explanation and the Add button,
Realtors a one-liner); uploading (`Adding 1 of 2…`); success; file refused
(type / size, before any upload); upload or save failed; limit reached; signed
URL failed (`This floor plan isn't available right now` + Try again); whole
list failed (Try again); feature not migrated (hidden).

## Reuse of the foundation (no new Storage workflow)

All reads and writes go through `src/lib/homeFloorPlans.js`:
`getFloorPlans`, `signFloorPlanUrls`, `addFloorPlan`, `removeFloorPlan`,
`floorPlanFileError`, `FLOOR_PLAN_ACCEPT`. Two small additions there:

* `canEditFloorPlans(supabase, homeId)` — the foundation's
  `can_edit_home_floor_plans` RPC, asked fresh every time the viewer opens or
  reloads, so a removed co-buyer loses the controls; false on error.
* `loadFloorPlanCardState(supabase, { searchId, userId, homeIds })` — counts
  plus `is_search_decision_maker` for the card labels; never throws (a failure
  leaves counts unknown), `null` if the table is missing.

**Over four**: the picker accepts several files; only as many as fit are
uploaded (the rest are reported, never sent). If someone else filled a slot
meanwhile, `addFloorPlan`'s own check refuses before uploading, or — if the
race is lost after the upload — its failed insert deletes the upload. The
viewer stops the batch and reloads the real state. Browser QA checks rows and
bucket objects after every add / remove: no leftover file.

**Signed URLs** (15 min): re-signed 2 minutes before they lapse while the
viewer is open, on return from the background past that point, and once when
an image fails to load; a second failure shows the unavailable state.

Not built (by design): names, labels, ordering, replace, PDFs, external URLs,
a gallery, anything inside Add/Edit Home.

## Tests

* `test/floor-plans-ui.test.js` — flag parsing and gating on every page;
  flag-off renders the original Notes link and mounts nothing; viewer uses
  only the foundation layer (no direct Storage, no replace, no PDF); nothing in
  Add/Edit Home, Match, Home Facts, cover photo; zoom / pan / swipe geometry;
  upload batching; signed-URL refresh; accessibility and touch CSS; and, on
  real Postgres, card state + edit access for owner, co-buyer, Realtor,
  outsider and removed members.
* `scripts/qa/floor-plans-ui-qa.mjs` — browser QA against the local Supabase
  stand-in (real policies, bucket limits, signed-URL expiry), on iPhone- and
  iPad-sized touch viewports with real touch input (CDP). 24 steps: flag off;
  owner zero → one → four (PNG, JPEG, WebP); invalid / oversized files; failed
  upload; over-limit batch; stale viewer at the limit; navigation; swipe,
  pinch, pan, double-tap, Fit; remove; signing failure; expired URL re-signed;
  persistently failing image; iPhone landscape; co-buyer on iPad (portrait and
  landscape); Realtor view-only (UI and API); co-buyer and Realtor revoked
  mid-session; anon; cover photos unchanged. Screenshots:
  `docs/floor-plans-ui-screenshots/`.
* The stand-in (`scripts/qa/supabase-standin.mjs`) gained the private
  `home-floor-plans` bucket (through the harness's two-stage Storage stand-in),
  signed URLs with expiry, QA fault switches (`POST /__qa/floor-plans`), and
  two fixes: scalar RPC results (`true`, as PostgREST returns them) and no
  double response after an error.

## Device QA still needed (real hardware)

Browser QA used Chromium with emulated iPhone / iPad viewports and real touch
events. Not yet proven on devices:

1. **iOS Safari / WKWebView gestures** — pinch inside `touch-action: none`,
   `gesturestart` suppression, double-tap not triggering Safari's own zoom,
   pull-down-to-close not fighting the page's overscroll.
2. **Native app (Capacitor)** — the photo picker from `<input type="file">`,
   HEIC photos converted to JPEG by iOS (HEIC itself is refused by the bucket),
   safe areas under the notch / Dynamic Island and home indicator.
3. **iPad** — Split View / Slide Over widths, Stage Manager resizing,
   rotation while zoomed (the view re-clamps; check it feels right), trackpad
   pinch.
4. **Large real plans** — 8–10 MB scans on cellular: thumbnails load the same
   full-size signed images (at most four), so first open can be slow.
5. **Background > 15 min** — return to an open viewer after the URLs lapsed.
6. **VoiceOver** — dialog announcement, thumbnail labels, live notices.
7. **Hosted Storage** — the stand-in mirrors storage-api v1.25.7; Production's
   Storage version / CDN have not been exercised by this UI (the foundation's
   hosted smoke test is still pending your approval).
