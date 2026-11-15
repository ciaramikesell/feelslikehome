# Desktop Priority Board (Mobile Priority Onboarding V3, flow 4)

On desktop, choosing and ranking priorities now happens on **one screen**:
a feature library grouped by category, and three importance columns
(**Must Have · Important · Nice to Have**) of compact, text-only, draggable
chips. Phones keep the photo-card category screens and importance sheets,
unchanged. Everything stays behind `FLH_ONBOARDING_V3` (still off in
Production); `CURRENT_ONBOARDING_VERSION` is still 1.

> FLH does the homework. The buyer makes the decisions.

## 0. No geography screen (founder decision)

FLH is a decision tool for homes people have already found, not a listing
search, so flow 4 no longer has a "Where are you looking?" screen, on desktop
or phones. Saved areas and places are kept; Places That Matter (with commute
distances) stays an optional My Search setting; an in-progress session stored
on the old screen resumes at the next unfinished one. See
`docs/mobile-priority-onboarding-v3.md` and `test/onboarding-v3-no-geography.test.js`.

## 1. Rental onboarding (#184, merged)

#184 (rental onboarding Stage 3) is merged into `main` (`8a781fd`) and this
branch includes it. The board uses #184's code directly; nothing is copied.

| From #184 | On the desktop board |
|---|---|
| Rental Essentials pets question (`PetsQuestion`) | Rental Essentials stays **its own screen** on desktop (a question category is never folded into the board), rendered by the same `CategoryStep` as on phones, so the pets question, its hints and its Undo are identical. |
| Pet-Friendly from the pets answer | Shown **once**, in its column, using #184's icon-only `PETS_FEATURE` (the pet photo is only ever shown with the question). Moving it is an explicit edit through the canonical write, which ends FLH's automatic ownership (`clearPetsAuto`). |
| Home to Rent lot-size importance (D4) | See §2 *Ideal lot size*. |
| Rental Basics / Apartment Basics titles | Unchanged; the desktop step order reads Search Type · Rental Basics (or Apartment Basics) · Rental Essentials · What matters most · Review. |

## 2. How it works

### Screens (desktop, ≥ 1024 CSS px)

| Search | Desktop screens | Phone screens (unchanged) |
|---|---|---|
| Home to Buy | Search Type · Basics · **What matters most** · Review | 9 + Review |
| Home to Rent | Search Type · Rental Basics · Rental Essentials · **What matters most** · Review | 7 + Review |
| Apartment to Rent | Search Type · Apartment Basics · Rental Essentials · **What matters most** · Review | 5 + Review |

The flow-4 step list in `onboardingFlow.js` is **unchanged**. The board is a
presentation of the consecutive card-category steps (`src/lib/priorityBoard.js`):

- it is shown while the stored step is **any** card-category step;
- **Continue** completes all of them (`advanceBoard`), **Skip** marks each
  skipped (Review offers each category again), **Back** leaves from the first
  (`retreatBoard`);
- the rail and step count show the board once (`desktopProgress`).

So a desktop and a phone read and write the same `onboarding_state` and the
same priorities document. Resizing, zooming or resuming on another device
never loses an answer or restarts onboarding.

### Breakpoint

`DESKTOP_BOARD_QUERY = (min-width: 1024px)` (`src/lib/priorityBoard.js`),
read by `useDesktopBoard` (`useSyncExternalStore` + `matchMedia`; the server
render is always the phone flow). Below 1024: phones, portrait tablets
(768/820), and any desktop at 200% zoom keep the photo-card screens. 1024 and
up: the board. At every desktop width the **feature library is a full-width
section on top** (Add your own first, then the categories in a wrapping grid,
chips wrapping within each), and **Must Have · Important · Nice to Have sit
below it in one row of three equal columns** that grow with their priorities
(220px minimum, so an empty column is a comfortable drop target). Nothing
scrolls inside itself. When the columns are below the fold, dragging toward
the window edge auto-scrolls (QA drags this way at 1440 × 900); click-to-rank
never needs scrolling.

**Visual hierarchy.** The library is a substantial panel (1.5px border, soft
shadow): its title and Add your own share the first row, then the categories
flow into three balanced columns (Your own features first, under the field),
with light chips and a subtle hover lift. The three importance columns are the
centerpiece: tinted per level (TIER_META colours), each with its heading, short
explanation and count, and a small, non-sticky "Your priorities" summary of
counts above them.

### One catalog, one write path

- The library is `priorityCategoriesFor` / `categoryView` — the phone
  catalog with the same identities per kind of search. No desktop catalog.
- Every move is `placeOnBoard` → `setFeatureLevel`, the phone sheet's write.
  A test proves a board session and a phone session making the same choices
  produce **identical** documents (also through real Postgres).
- Columns are read with `priorityLevels` (the reader My Search and Match use),
  so a priority chosen anywhere is shown once, in its level.
- Moving a chip back to the library is the existing "don't care" state
  (the phone's Not important): never a No, never a mismatch.
- No new scoring, storage, migration or field.

### Interactions

| | |
|---|---|
| Drag | library → column, column → column, column → library. Drop targets are marked while dragging; when a ranked chip is dragged the library shows "Drop here to remove it from your priorities" as an overlay (it never moves the columns mid-drag). When the columns are below the fold, dragging toward the window edge auto-scrolls. Dropping where it already is changes nothing. |
| Click / Enter / Space | opens a small importance chooser beside the chip: Must Have, Important, Nice to Have, and Remove (if ranked) or Not now. Focus moves in, Tab wraps inside it, Escape closes without change and returns focus; after a choice focus follows the chip to its new column. |
| Undo | every board move announces itself (`role="status"`) with one-step Undo. |
| Add your own | one field, no category to choose. Typing first lists matching library features (any category). Add / Enter uses `addBoardOwnFeature`: anything that already exists (an offered feature, something in the person's document, a catalog criterion) is reused through the phone's `addOwnFeature` dedupe (case, spacing and punctuation ignored) and the chooser says where it lives; only a genuinely new feature is created, as an ordinary custom Yes / No priority (Home Features) with the additive `group: 'own'`, shown in the library's **Your own features** section. The chooser opens immediately; it then drags like any feature and returns to that section when removed. (On phones such an item appears on Review under "More of your priorities".) |
| Garage (Home to Buy) | one **Garage** chip with the existing `exterior:Garage` identity (same write as the phone's garage question; removal = Not important). Once it is ranked, the chip shows its attached / detached answer (or "Attached or detached?") and its chooser holds Attached / Detached / Either (the existing `garagePreference`); ranking it from the chooser reopens the chooser on the chip so this can be answered at once. The garage details (Workbench …) appear in the library once it matters, as on the phone. Home to Rent Garage and apartment Garage Parking have no qualifier. |
| Garage (rentals) | Home to Rent **Garage** and apartment **Garage Parking** are the phone's cards. `heldGarage` switching logic is untouched; tests cover house ↔ apartment round trips through the board. |
| Ideal lot size (Home to Rent) | a threshold, so it has its own panel in the Exterior group ("Ideal lot size · A minimum you can rank"). The acreage writes through #184's `setLotSizeValue`; once entered, the panel holds an **"Ideal lot size · n+ acres"** chip with "Drag to a column, or click to rank". It is not part of Match until ranked (`setLotSizeImportance`, the phone sheet's write); ranked, the panel takes that level's tint and says so. Clearing the acreage removes the chip and resets the importance; re-entered acreage starts unranked. |
| Ideal lot size (Home to Buy) | the same panel with a plain acreage field: value only, no chip, no importance (unchanged behaviour). |
| Legacy priorities | chosen earlier but not offered: shown in their column, movable; removed ones stay in a "From earlier" library group for the visit. Never deleted. |
| Co-buyers | the board edits only the document it is given (the caller's own row). |

### Hover / focus previews

After 450 ms of mouse hover (or 200 ms after keyboard focus), a 232 px card
appears next to the chip — above it when there is room — with the feature's
onboarding photo (the existing explicit manifest and its 400w/800w card
derivatives, via `FeatureVisual`, so the same photo → illustration → icon
fallback), its name and one sentence (`src/lib/featureDescriptions.js`, one
written sentence per offered feature). It is `aria-hidden` and
`pointer-events: none`, disappears on drag start, never opens with the chooser,
and is only ever rendered by the desktop board. The sentence is also each
chip's `aria-describedby`, so nothing depends on hovering. No photo was added,
modified or downloaded.

### Initial desktop load

The server can't know the window width, so its HTML for a board step is the
phone screen, and the board replaces it once JavaScript runs. To keep the
photo cards from flashing on a desktop in that moment, the server HTML wraps a
board step in `.flh-ob-board-gate` together with a board-shaped placeholder
(`BoardGate` in `PriorityFlow.jsx`, `aria-hidden`):

- below 1024px the gate is `display: contents` and the placeholder is not
  displayed — the phone screen is unchanged (pixel-compared with `main`);
- at ≥ 1024px CSS shows the placeholder (the board's own header and empty
  library/column frames) instead of the cards, widens the column, and shows the
  rail with the board as one step. The gate only exists until hydration (after
  it, a desktop always renders the board), so these rules never apply to a
  hydrated page.

Server and first client render are the same markup, so there is no hydration
mismatch, and the heading does not move when the board arrives (QA measures
it). Trade-off: the placeholder needs JavaScript to become the board — as does
everything in onboarding.

### Shared top bar at 150–200% zoom

Phones at 150–200% zoom (≤ 300 CSS px — no phone at 100% is that narrow) let
the wordmark wrap instead of running under the step count, and the empty Back
slot takes no room. At ≤ 200 CSS px the mark and type shrink slightly, and on
screens that also show Back (Review) the top bar shows the brand mark alone;
the wordmark is decorative, not a control. Back stays 44 × 44 px.

## 3. Review

Desktop Review is the existing editable Review. A priority opens the existing
importance sheet; **Edit** on a category returns to the board, whose Continue
reads **Back to review**. Back from Review returns to the board.

## 4. Tests and QA

- `test/onboarding-v3-no-geography.test.js` (5): no geography screen, resume, kept areas, My Search places.
- `test/desktop-priority-board.test.js` (20): desktop screen order for all
  three searches; progress; Continue / Skip / Back / resume across devices;
  library per search; every move and exactly-once; board = phone writes;
  removal never scored and Unknown ≠ No; garage; house/apartment garage across
  switches; Add your own; legacy; pets (#184); Home to Rent lot size; Home to
  Buy lot size unchanged; co-buyer purity; descriptions and images; initial
  load gate; zoomed top bar; UI and release-safety contracts.
- `test/desktop-priority-board-db.test.js` (real Postgres 16, 3): board =
  phone document; round-trip; co-buyer independence; JS = SQL on homes with a
  garage / none / unknown, after a No answer, for apartment Garage Parking with
  a held house Garage, and for Home to Rent lot size through rank → library →
  clear → re-enter.
- `scripts/qa/desktop-priority-board-qa.mjs` (see the PR for counts).
- `docs/desktop-priority-board-screenshots/`.

## 5. Open decisions

1. Breakpoint 1024 (iPad landscape and 1024-wide portrait tablets get the board).
2. Wording of the 59 preview sentences (founder review).
3. Rename of your own features is offered in the phone sheet and on Review,
   not in the board's small chooser.
4. Desktop drag uses native HTML5 drag and drop; touch tablets at ≥ 1024 use
   tap-to-choose (drag on touch is browser-dependent).
5. Pre-existing, not changed here: at ≤ 215 CSS px (a 320–430px phone at
   150–200% zoom) a few step bodies are still wider than the screen — the
   single word "neighborhood" in the Location & Neighborhood title and the
   photo grid on some category screens. Identical on `main`; outside the
   shared top bar. (The Areas of interest row went with the geography screen.)
