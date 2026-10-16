# Add Home → Home Facts → Match Criteria

"We found your home. Here's what we know. Now let's see whether it matches
what matters to you."

Paste a listing → FLH finds it → **Add to My Homes** (the only action) → the
saved home's **Home Facts** → **Next: Match Criteria**. This builds on the
workspace from #150 (desktop property sidebar, phone section switcher) and
supersedes the post-import parts of `docs/home-facts-redesign.md`.

## 1. Audit (before this change)

| Area | Where | Finding |
|---|---|---|
| Import actions | `HomeModal` `ImportFoundCard` | Two competing buttons: **Add to My Homes** and **Review details first** (the old full editor). Pasted text, "nothing found", lookup errors and manual entry all went to the old editor. |
| Persistence | `saveHomePersonalAndShared` | Correct: shared `homes` row, then the caller's `home_member_state`; `partialHomeId` recovery; synchronous double-save guard in `submit()`. Rows were always written. |
| **Disappearing home** | `HomesBoard.saveEditedHome` → `router.push`; `HomeDetail` Back → `router.back()` | See §2. Not a data loss: the home was saved, but My Homes rendered without it. |
| Home Facts | `HomeFacts.jsx` | Home features card, School details card, a collapsed **All listing details** panel (the "imported facts" panel), Edit Home side panel for everything else. |
| Structured fields | `homes` | Present: price, est. monthly, beds, baths, sqft, lot size (text), year built, property type, home layout (list), home condition (list), primary bedroom location, garage spaces, HOA, taxes, photo, listing URL. **Missing:** listing ID, heating, cooling, exterior, roof, garage type, basement style / condition, school district / elementary / middle / high (only free-text `basement_notes` / `schools_notes`, and a legacy, privacy-locked `school_district`). |
| Match | `computeMatch` (JS) + `resolve_cobuyer_compare_perspectives` (SQL) | Garage is scored from `garage_spaces` (a personal Garage check is ignored); layout / condition / property type from the shared lists; other check criteria from each buyer's `home_member_state.checks`; Pets / Utilities / In-Unit Laundry from shared booleans. |

## 2. The disappearing home — root cause and fix

On save, `saveHome` called `router.refresh()` and `saveEditedHome` then
called `router.push('/homes/{id}')`. In the Next.js 15 App Router a
navigation **discards** a pending refresh (`app-router-instance.js`:
"Navigations take priority over any pending actions"). The client Router
Cache therefore kept My Homes' **pre-save** RSC payload. **Back to My Homes**
(`router.back()`) and the browser Back button both restore that cached
payload as is (`restore-reducer.js` reuses `state.cache`), and `HomesBoard`
remounts from it: the new home is missing until a reload. Any edit on Home
Facts ran its own `router.refresh()`, which rebuilt the cache, which is why
the bug appeared only "without making edits".

Reproduced in a real browser against real Postgres (button and browser Back
both lost the home). Two fixes that look right were tried and rejected in
the browser:

- `router.refresh()` right after `router.push()`: while the navigation is in
  flight it **cancels the navigation** (the buyer never reaches Home Facts).
- `router.refresh()` on arrival at Home Facts: a quick Back during that
  refresh discards it again (reproduced with the manual-entry journey).

**Fix:** `saveEditedHome` awaits a revalidating Server Action
(`src/app/(app)/homes/actions.js`, `revalidatePath('/homes')`) before
navigating. A revalidating action makes the router rebuild the **entire**
client cache from the server ("server actions have to invalidate the entire
cache"), and because it is awaited (plus one macrotask so the router commits
it), nothing is pending when the navigation starts. Add Home stays on
"Adding…" until Home Facts opens (`keepModalOpen`). Verified: Back button,
browser Back, an immediate Back, and reload all show the home.

## 3. What changed

### Add Home: one action
- One card for every buyer path to a home: listing found ("We found your home",
  photo, price, facts, N details) or, for pasted text / nothing found / lookup
  error / **Enter manually**, just the address. One button: **Add to My Homes**.
  "Review details first" is gone.
- Unchanged: exact-URL duplicate check at Find and again at Add (and share
  intake), the synchronous double-click guard, `partialHomeId` recovery, iOS
  share intake (`/homes?url=` auto-find), co-buyer search ownership (the home
  joins the active search; the adder stays the adder).
- Apartment searches and the Realtor **Suggest this home** flow keep the
  existing editor (property name / unit / floor plan).

### Home Facts
- **Property header:** photo (upload or URL), asking price, address, beds,
  baths, square footage, lot size, original listing link — all editable in
  place. Lot size normalizes acres / sq ft / sq m / hectares to acres when a
  person edits it (a bare number is acres). One quiet line names what came
  "From listing"; missing facts are listed as Unknown.
- **Basic details:** estimated monthly payment (user-entered), listing ID,
  year built; HOA and property taxes when known.
- **Home details:** property type (Single-Family / Multi-Family /
  Condominium), home layout (Ranch / Two-Story / Split Level / First-Floor
  Primary), home condition (New Construction / Move-in Ready / Renovation
  Potential), heating, cooling, exterior, roof.
- **School details:** district, elementary, middle, high (Unknown where
  missing; no disclaimer). Earlier free-text school notes stay visible.
- **Garage:** type (None / Attached / Detached) and spaces (None / 1 / 2 / 3+).
- **Basement:** style (None / Traditional / Gardenview / Walkout) and condition
  (None / Unfinished / Partially Finished / Finished).
- Each group has its own Edit → inline form → Save / Cancel; one save at a
  time; only changed fields are written. No cards-within-cards: hairline rows
  in two balanced columns on desktop, one column on phones.
- The **All listing details** panel and the imported-details banner are gone;
  provenance is a small inline **From listing** tag. For homes imported before
  these fields existed, the listing's value shows as a muted
  "Listing says: …" hint and is never copied into a field unless someone saves it.
- An orange **Next: Match Criteria** closes the page.

### Match Criteria (renamed from "Check the Match")
- Match % summary, then three sections — **Must-Haves**, **Important**,
  **Nice to Have** — listing exactly `computeMatch(...).allSelected` (the rows
  the % is scored from).
- Criteria answered by the buyer get a Yes / No / Unknown segmented control
  (real radio inputs in a `fieldset` with a `legend`). Answers are written
  exactly where Edit Home always wrote them: the buyer's own
  `home_member_state.checks` (Unknown removes the key), or the shared Pets /
  Utilities / In-Unit Laundry fields.
- Facts scored from Home Facts (budget, beds, baths, sqft, lot, property type,
  layout, condition, **Garage** spaces) and after-tour / Commute criteria are
  shown with their state and source, never as controls.
- Realtors see answers as text; no controls. Location & Commute and the
  co-buyer perspective follow unchanged. Tour Feedback is unchanged.

## 4. Data integrity

- Migration `supabase/migrations/2026-10-17-home-facts-details.sql`: 12
  nullable text columns on `homes`, **no defaults, no backfill**; CHECK
  constraints for the three choice facts; column grants to `authenticated`
  matching the Pass 3C.3 model. Null = Unknown; `'none'` = a real "None".
- The legacy `homes.school_district` stays locked; the shared district is
  `school_district_name`.
- Not a Match input: no JS or SQL scorer reads any new column (pinned by a
  test that also shows `computeMatch` is identical with and without them).
  Existing Match inputs (`garage_spaces`, `home_layout`,
  `primary_bedroom_location`, `home_condition`, `property_type`) are written
  in their existing form.
- Import: RentCast values become fields only when explicit and unambiguous
  (string heating / cooling / exterior / roof; Attached xor Detached; basement
  finish / walkout; the MLS number, never RentCast's own record id). Import
  still only fills empty fields.
- `getHomesForUser` now falls back to the pre-Pass-B projection only for a
  missing **Pass B** column; any other missing column (e.g. this migration
  not applied) fails visibly instead of silently dropping `property_type`.
- Lot size: stored values are never rewritten. Note (pre-existing, unchanged):
  Match compares `parseNum(lot_size)` to the acre target, so a legacy
  `"8712 sq ft"` reads as 8712. Editing it on Home Facts stores acres.

## 5. Production rollout (not done in this PR)

**Merge blocker:** the app now reads the new columns. Apply the migration
before deploying this code.

1. Run `supabase/home-facts-details-preflight.sql` (read-only). Every
   `required` row must be `ok = true`.
2. Apply `supabase/migrations/2026-10-17-home-facts-details.sql` (re-runnable).
3. Run `supabase/home-facts-details-verification.sql`; every row `ok = true`,
   section 7 = `0`.
4. Deploy.

`test/home-facts-redesign.test.js` runs the preflight, migration (twice) and
verification on a pre-migration database and asserts no row changes.

## 6. Verification

- `npm test` with real Postgres (`docs/database-tests.md`).
- Full stack, real Postgres, real browser: `scripts/qa/supabase-standin.mjs`
  (a dev-only Supabase HTTP stand-in over the test harness: RLS, grants,
  triggers apply) + `scripts/qa/rentcast-fixture.mjs` + `scripts/qa/home-flow-e2e.mjs`
  at 390 / 768 / 1024 / 1440. Steps: import → double-click Add → one row →
  Home Facts; Back / browser Back / reload without edits; duplicate URL;
  share-intake duplicate; interrupted save + retry; manual entry; Home Facts
  edits (None, schools, lot size); Match Criteria Yes / No / Unknown; legacy
  home unchanged by viewing; co-buyer shared edit + personal answer;
  Realtor read-only.
- Fixture screens: `scripts/visual/home-facts-screens.mjs` (`/dev/home-facts`).

Screenshots: `docs/home-facts-screenshots/` (from the full-stack run; widths
in the file names).

## 7. Design-gap report

1. **Reference photos #5, #6 and #7 were not attached** to the request. The
   layout follows the written spec and FLH's existing tokens (warm paper,
   terracotta, sage provenance, Fraunces / Plus Jakarta). It needs a side-by-side
   review against those references.
2. **Beyond the spec, kept on purpose:** HOA fee and property taxes appear in
   Basic details when known (money facts were visible before). **Dropped from
   Home Facts:** days on market, description-mentioned features, and other
   snapshot-only facts (stories, water, sewer, …). They are still stored in
   `listing_import`; nothing was deleted.
3. The status / Favorite chips left the property header; those actions live
   in Tour Feedback and the phone action bar.
4. **Still the old editor:** the My Homes card's pencil, apartments, and
   rentals ("Edit … information" / "More … details"). Not redesigned here.
5. **Photo upload** uses the same Storage path as Edit Home
   (`src/lib/homePhoto.js`). The browser run exercised photo URL rendering
   but not an upload to real Storage (the stand-in keeps objects in memory).
6. **Pre-existing, unchanged scoring quirks** (not changed, per "don't quietly
   change Match"): legacy lot sizes stored as "N sq ft" compare as N against the
   acre target; the personal First-Floor Primary check and
   `primary_bedroom_location` remain separate criteria
   (`docs/home-facts-redesign.md` §4).
7. Fixed along the way: section switches used `replaceState(window.history.state, …)`,
   which Next.js does not sync. Any later save's `router.refresh()` then silently
   dropped `?section=` (a reload returned to Home Facts). They now pass `null`.
8. Full-page phone screenshots show the sticky section switcher and the action
   bar mid-page. That is a capture artifact, not the layout.
