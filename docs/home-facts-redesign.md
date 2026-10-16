# Home Facts redesign + post-import landing

Goal: importing a home should feel like the start of exploring it, not the
start of a questionnaire. FLH does the homework; the buyer reviews, corrects,
or adds whenever they like; anything missing stays **Unknown** and never
counts against the home.

This is a UX change only. Match weights, Must-Have / Important / Nice-to-Have
semantics, the SQL co-buyer Compare scorer, and the schema are all unchanged.

## 1. Audit (pre-change)

| Concern | Where | Behavior |
|---|---|---|
| Add Home entry | `HomesBoard.jsx` → `HomeModal.jsx` | `+ Add`, `/homes?add=1`, share intake `/homes?url=` (iOS Share Extension, Universal Links) all open `HomeModal`. |
| Import | `HomeModal.handleFind` → `POST /api/import-listing` (`rentcast.js`) | String-only URL → address parsing, one RentCast property + listing lookup. Result merged into an **in-memory** form (`mergeImportFields` only fills empty fields). |
| Review | `EditHomeEditor` (`mode="add"`) | Mandatory "Check what came through." form (two steps on phone). |
| Persistence | `saveHomePersonalAndShared` (`collaboration.js`) | **Nothing is written before Save home.** Then: insert `homes` (with the `listing_import` snapshot) and upsert the caller's `home_member_state`. If the second write fails, `partialHomeId` lets a retry update the row instead of inserting a duplicate. |
| Duplicates | `findHomeByListingUrl` | Exact listing-URL match, in both `handleFind` and share intake. Address-only duplicates were never detected (unchanged). |
| Home page | `/homes/[homeId]` → `HomeDetail.jsx` | "Property Facts / More details" was a flat list; editing went through the same `EditHomeEditor` (`mode="edit"`) in a side panel. |

## 2. What changed

### Post-import flow
1. Buyer pastes a URL (or shares one from iOS). The lookup runs exactly as before.
2. On a successful lookup, Add Home now shows **what FLH found**: photo (if any; RentCast supplies none, so a placeholder), address, price, beds / baths / sq ft / lot, and "We found N listing details for you."
   It is explicitly marked **"Not saved yet."**
3. **Add to My Homes** first re-checks the listing URL against the search's homes (exact match → the existing "already here" view), then calls the very same `submit()` → `onSave` → `saveHomePersonalAndShared`. The synchronous double-submit guard, the visible save error, and `partialHomeId` adoption are all unchanged.
4. Only **after the save resolves with a real id** does `HomesBoard` navigate to `/homes/{id}?added=import` (or `?added=manual` for homes added without an import snapshot). The marker only picks the one-time welcome copy and is removed from the address bar.
5. **Review details first** opens the existing editor for anyone who wants it. Pasted-text, manual, lookup-empty and lookup-error paths still go to the editor, and after saving they land on Home Facts too.
6. Closing at any point before step 3 saves nothing.

Not changed: apartment searches keep the editor first (property name, unit and floor plan need it), and the Realtor **Suggest this home** flow never sees the quick add.

### Home Facts (on `/homes/[homeId]`)
- **Header**: the existing hero (photo, address, price, beds / baths / sq ft / lot, View original listing, Saved status). It is not repeated below.
- **Acknowledgement**: "Welcome home (at least for now)." once after adding; otherwise a small sage line "FLH found N listing details. See imported details."
  N counts only what the importer supplied: structured fields (excluding address, coordinates and the tax year), listing facts, and features stated in the description. It never says "verified."
- **Home features** (primary): Garage, Basement, Home layout, Home condition, with one **Edit** that opens chips in place. It saves through `saveWhole` → `saveHomePersonalAndShared`, the same shared-home path as Edit Home, so co-buyers see the change and Match re-evaluates where it already did.
- **School details**: the existing `schoolsNotes` text, or "Unknown — not added yet". It states plainly that FLH doesn't pull school information from listings.
- **All listing details**: collapsed. Small rows grouped as Price & listing, Size, Property, Structure & exterior, Parking, Utilities & systems, plus features mentioned in the description.
  Each row carries provenance: *From listing* or *Added by you*. Facts that exist only in the snapshot are read-only. **Correct details** opens the existing full editor.
- **See how this home matches your search** scrolls to the unchanged Match section.

Pros / cons, notes, your take, post-tour reflection, Realtor context, and the Match breakdown all remain on the page, below Home Facts and unchanged.

## 3. Home Features: what is real today

| Category | Stored field (shared) | Imported? | Match evidence | UI in this PR |
|---|---|---|---|---|
| Garage spaces | `garage_spaces` (text; `0` = no garage) | Yes | **Yes**: `exterior:Garage` (JS + SQL) | Editable: No garage / 1–4 car / Unknown; an earlier free-text value stays as its own chip |
| Garage attached/detached | none | Snapshot only (`listingFacts.garageType`) | No (`garagePreference` is buyer context only) | Read-only "Listing says: …" |
| Basement finish / walkout | `basement_notes` (descriptive text) | Yes (Finished / Partially finished / Unfinished / Walkout) | **No**: `Finished basement` / `Walkout basement` are each buyer's own Yes / No checks | Editable as descriptive text (finish + walkout); never written to anyone's checks |
| Layout | `home_layout` (list) | No | **Yes** (`homeLayout`) | Editable multi-select: Ranch / Two-Story / Split Level / Other |
| First-floor primary | `primary_bedroom_location` | No | Yes for the single-select preference; the onboarding `First-Floor Primary` criterion is a personal check | Editable: First-floor primary / Primary upstairs / Unknown |
| Condition | `home_condition` (list) | No | **Yes** (`homeCondition`) | Editable multi-select: New Construction / Move-in Ready / Renovation Potential |
| Schools | `schools_notes` (text) | No | No (school priorities are personal checks) | Free text |

Unknown is always the empty value, exactly as the editor already wrote it.

## 4. Deferred (needs schema and/or scoring parity — not done here)

1. **Structured basement fact** (finish + walkout columns) that Match could read for `Finished basement` / `Walkout basement` in place of each buyer's check. This needs a migration and JS + SQL scorer parity (see `docs/mudroom-match-parity.md` for the pattern).
2. **Garage type** column (attached / detached), so the onboarding garage qualifier could become evidence.
3. **First-Floor Primary parity**: either derive the criterion from `primary_bedroom_location = 'Main Floor'` or retire one of the two, in both scorers.
4. **School district** as a structured, imported field (no current provider supplies it).
5. Address-level duplicate detection (exact listing URL only, as before).
6. Optionally, a dedicated tabbed Home / Match / Your take layout. This PR keeps one page and adds no navigation.

## 5. QA

- `node scripts/visual/home-facts-screens.mjs <outDir> http://localhost:3000` (dev server; no `.env` needed) renders `/dev/home-facts` (production 404s) at 390 / 768 / 1024 / 1440.
  It covers 17 scenarios: found, saved, save error, review first, duplicate, manual, landing, editing, schools, details collapsed/open, no photo, partial import, unknown features, manual entry, Realtor read-only, and co-buyer.
  It fails on any horizontal overflow, console error, or interaction that doesn't reach its state.
- `test/home-facts-redesign.test.js`: pure helper tests, the flow guarantees, and real-Postgres checks:
  - an imported home saves once with its snapshot
  - a co-buyer's Home Features and School edits persist for the owner without touching anyone's checks
  - clearing returns to Unknown
  - a Realtor cannot write
