# Phase 2 — the continuous Add/Edit Home overlay

"Everything FLH knows is already filled in. Everything the buyer knows is easy
to add. Nothing feels mandatory."

Add a home → it is saved once → it opens in one large overlay over My Homes:
property header, Home Facts, Your Match, in one scroll, autosaving every
change. Existing homes open the same overlay from their card or Edit. This
replaces the Home Facts → Match Criteria pages from #152 for buyers; Tour
Feedback from #153 is unchanged and stays reachable from the overlay.

## 1. Audit (before this change)

| Area | Finding |
|---|---|
| Intake (URL, manual, iOS share) | One Add card (#152). Exact-URL duplicate checks at Find, Add and share intake; synchronous double-click guard; `partialHomeId` recovery. Kept as is. |
| Navigation | `/homes` and `/homes/[id]` were sibling pages: opening a home unmounted My Homes; returning remounted it from the Router Cache (the root of the disappearing-home bug, fixed in #152 by an awaited revalidating Server Action). |
| Home Facts | Per-group **Edit → form → Save**; every save rewrote the **whole** shared `homes` row from the client's copy (a co-buyer's concurrent edit of another fact could be overwritten). |
| Match Criteria | Separate `?section=match` page, full-width tiers, Yes/No/Unknown radios; answers to `home_member_state.checks` (or the three shared rental booleans). Scored by `computeMatch` (JS) and `resolve_cobuyer_compare_perspectives` (SQL). |
| Tour Feedback | `?section=tour` of the same workspace: reactions, survey, notes/pros/cons, in-person criteria, Realtor notes. Want to Tour cards open `PostTourModal`. |
| Laundry | Only `homes.in_unit_laundry` (rental yes/no, the shared In-Unit Laundry answer) and personal laundry checks. **No structured location → migration needed.** |
| Photos | Upload to Supabase Storage (`home-photos`) or a pasted URL. **The importer never sets a photo** (see §5). |
| Realtor | `/people/[search]/homes/[id]` renders the workspace read-only; RLS + column grants deny writes. |

## 2. Architecture

- `src/app/(app)/homes/(board)/layout.js` is **My Homes** (moved from
  `homes/page.js`): it loads and renders the board inside `HomesWorkspace`, a
  client store shared with the overlay. `(board)/page.js` renders nothing;
  `(board)/[homeId]/page.js` renders `HomeOverlay`. Because the layout stays
  mounted, opening/closing a home never rebuilds My Homes: search, filters,
  sort and scroll survive, cards update live behind the overlay, and there is no
  stale cached board to come back to.
- Real URLs throughout: Back closes the overlay (Close steps back when the board
  opened it, else navigates to `/homes` or the `?from=` page), Forward reopens
  it, reload and direct links render My Homes with the overlay on top.
- Legacy links: `?section=facts|match` open the overlay (match scrolls to Your
  Match), `?section=tour` opens its Tour Feedback view, `/homes?home=<id>`
  redirects to `/homes/<id>`, `?added=` is ignored.
- A `loading.js` shows the overlay frame instantly with what the board knows.
- Each open re-reads the home from the server (`getHomesForUser(…, { homeId })`,
  still constrained to the active search and RLS) and adopts it unless a save is
  in flight.

## 3. Autosave

`src/lib/autosaveQueue.js` (plain JS, tested against real Postgres) +
`src/lib/useHomeAutosave.js`:

- Every change is applied locally at once, then queued. Selects save on change;
  text saves after 900 ms idle, on blur, on Enter, and on Close.
- Shared facts: `saveHomeSharedFields` — an UPDATE of **only the changed
  columns** (same UPDATE policy and column grants as before; refuses personal or
  unknown fields). Personal answers: the caller's own `home_member_state` row.
- Writes are serialized; each write sends the **newest** value when it runs, so
  rapid changes coalesce and an older value never lands last. Responses are not
  copied over local state.
- Status: *Saving…* / *Saved* / *Couldn't save — Retry*. A failed value stays on
  screen, marked; Retry resends it.
- Close commits typed text, waits for the queue, and if anything failed stops
  with **Retry / Close without saving them**. `beforeunload` warns on reload or
  tab close with unsaved edits. After any saved change, Close awaits the
  revalidating Server Action (`refreshMyHomes`) before navigating, so no page
  later restored by Back/Forward shows stale data (the #152 fix, kept).

## 4. Data model — Laundry Location (separate approval required)

`supabase/migrations/2026-10-18-laundry-location.sql`: one nullable text column
`homes.laundry_location`, no default, no backfill, CHECK
(`basement` | `first_floor` | `second_floor`), column grants to
`authenticated` matching the Pass 3C.3 model. Null = Unknown. Not a Match
input (no JS or SQL scorer reads it; pinned by tests). Separate from
`in_unit_laundry` and personal laundry answers.

**The code is compatible with both schemas.** `laundry_location` is an
*optional* column: if the database says it does not exist, reads retry without
it (the field is hidden, value `undefined`) and writes retry without it. Any
other missing column still fails visibly. So merging does not depend on the
migration, and applying it later simply reveals the field.

Import: only from a structured provider value that names exactly one location
("Basement", "First Floor", "Main Level", "Second Floor"). Several locations,
hookups, yes/no, "in unit", "upper level"/"upstairs" and the existence of a
basement are never mapped. Import still only fills empty fields.

Production rollout (not done here):

1. Review the SQL.
2. Run `supabase/laundry-location-preflight.sql` (read-only); every `required`
   row must be `ok = true`.
3. Confirm a production backup.
4. Apply `supabase/migrations/2026-10-18-laundry-location.sql` (re-runnable)
   only after explicit approval.
5. Run `supabase/laundry-location-verification.sql`; every row `ok = true`,
   section 7 = `0`.

`test/home-overlay-db.test.js` runs the app on a database **without** the
migration, then the preflight, the migration twice and the verification, and
asserts no home row changes.

## 5. Listing photos — audit

- `normalizeRentCastFields` reads no photo field and the importer never sets
  `photoUrl`; nothing is being discarded.
- RentCast's property-record and listing endpoints, as integrated, return
  structural and market facts (and, for listings, MLS id, status, description).
  We found no photo or media field in any response the importer handles.
  RentCast's documentation host is blocked from this environment, so this could
  not be re-verified against the live reference — **a check of the current
  RentCast schema / our plan's terms is still recommended.**
- MLS listing photos are licensed by the listing brokerage / MLS; neither a
  RentCast record nor a Zillow/Redfin URL grants FLH a right to copy them. FLH
  does not fetch listing pages (URL parsing is string-only) and must not scrape
  them.
- No Next.js image configuration is involved: photos render with a plain
  `<img>`, so any `https` URL the buyer has a right to use works.
- **Decision: no automatic photo import in this PR.** The upload / Photo URL
  experience is kept and polished: Upload / Photo URL / Remove sit under the
  photo; an invalid URL is never saved; a broken URL shows "Photo couldn't load";
  a replaced upload of our own is removed only after the new one is saved.
- Verified against the dev Storage stand-in (upload → public URL → renders →
  persisted). **Real Supabase Storage was not exercised** (no project access
  from this environment); its bucket and policies are unchanged.

## 6. What the buyer sees

- **Header:** photo; asking price; address (street large, city below); beds ·
  baths · sqft · acres; View listing ↗ (pencil to change). Right column: Year
  built, Annual taxes · year, Heating, Cooling (free text with suggestions, so
  "Forced Air, Gas" stays as imported), Laundry Location. All edit in place.
- **Home Facts** (two columns): Basic Details (estimated monthly payment —
  the buyer's own estimate; property type; home layout and home condition as
  compact choose-any dropdowns; secondary bedrooms when that is part of the
  search or already known; HOA when known), School Details, Garage, Basement.
  Unknown fields have a warm tint. Unknown ≠ None ("None" is a real option and
  is stored as one). Listing ID, Exterior and Roof are no longer shown (still
  stored).
- **Your Match:** % pill, "Unknown isn't No…", the existing factual Must-Have /
  Important sentence, the co-buyer's own Match. Tiers (Must-Haves 4×,
  Important 2×, Nice to Have 1×) with two columns of compact rows. Fact-scored
  rows show ✓ Yes / ✕ No / — Unknown and a link that scrolls to and focuses the
  fact; personal rows have Yes / No / Unknown. After-tour rows point to Tour
  Feedback.
- **Phones:** full-screen sheet; photo beside price/address; Photo options,
  Year/taxes/utilities and School details collapse into rows; Important and
  Nice to Have collapse ("Show"); 40–44 px controls, 16 px inputs (no iOS zoom).
- **Tour Feedback & notes** (footer button) switches the overlay to the existing
  Tour Feedback view (same URL with `?section=tour`); Home details returns.

## 7. Unchanged

Scoring (weights, Unknown excluded, JS/SQL parity, personal Match per
co-buyer), RLS, grants, SECURITY DEFINER functions, Tour Feedback data and
features, Want to Tour / Archive / Favorites flows, the Add Home card and its
protections, apartments and rentals (keep the full editor via "More … details";
no purchase-only fields), the Realtor's read-only workspace.

## 8. Known limitations / follow-ups

- Relocating Tour Feedback into Want to Tour: not done (kept reachable from the
  overlay and the cards' "I toured this home" / "Edit my thoughts").
- The full editor for apartments/rentals is still a modal over the overlay.
- Heating / Cooling are suggestion inputs, not strict dropdowns (the data is free
  text; forcing a list would overwrite imported wording).
- The co-buyer's Match shown in the overlay is computed when it opens; a shared
  fact edited meanwhile updates it on the next open.

## 9. Verification

- `npm test` against real Postgres 16 (`docs/database-tests.md`): **1,018
  tests, 1,018 pass, 0 skipped.** New: `test/home-overlay-db.test.js`
  (migration/preflight/verification, schema tolerance, partial autosave,
  co-buyer / Realtor / outsider permissions, the autosave queue against real
  Postgres, scorer untouched) and `test/home-overlay.test.js`.
- `next build`: passes.
- Full stack, real browser, real Postgres (`scripts/qa/supabase-standin.mjs` +
  `scripts/qa/rentcast-fixture.mjs`):
  - `scripts/qa/home-overlay-e2e.mjs`: **27/27 steps** — import → one Add
    (double-click) → one row → overlay; close without edits (Back / Forward /
    reload); edit → close → reopen (filters and scroll kept); personal answers
    move the Match % live; Laundry Location and None vs Unknown; rapid edits,
    a network failure → Retry, close held while unsaved, close straight after
    typing; direct links / reload / `?section=` / `?home=`; duplicate URL,
    manual entry with an interrupted save, iOS share intake (new and existing);
    an older home (legacy values never rewritten by viewing) and its Tour
    Feedback data byte-for-byte unchanged; photo upload and Photo URL; co-buyer
    shared edit + own answer (owner's untouched); Realtor read-only; keyboard
    (focus in, Tab trapped, Escape, focus back to the card, scroll lock);
    rentals and apartments; visual matrix at 1440 / 1024 / 768 / 390 / 375 with
    5 Must-Haves, 7 Important, 15 Nice to Have and a long address. Every step
    also fails on horizontal overflow or a console error.
  - `scripts/qa/tour-feedback-e2e.mjs` (#153, adapted to the overlay):
    **52/52 steps** at 1440 / 1024 / 768 / 390.
- `scripts/qa/long-address-qa.mjs`: four hard addresses (long street, long
  city, no comma, one unbroken word) at 1440 / 1280 / 1024 / 768 / 390 / 375 /
  320 and on the My Homes cards — measured for sideways scroll, clipped text
  and overlapping blocks: none.
- `test/home-overlay-unknown-db.test.js`: Unknown fact ≠ None and Unknown
  answer ≠ No, with exact percentages and JS/SQL scorer parity.
- At 100% zoom the sheet measures 1260 px wide at 1440 with a 340 px photo
  column, matching the approved frame (≈1260 / ≈341 px).
- Screenshots: `docs/home-overlay-screenshots/` (widths in the file names).
- Release checklist (Preview, production Storage photo test, migration order):
  `docs/home-overlay-release-checklist.md`.
