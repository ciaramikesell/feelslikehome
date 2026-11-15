# Desktop Priority Board (Mobile Priority Onboarding V3, flow 4)

On desktop, choosing and ranking priorities now happens on **one screen**:
a feature library grouped by category, and three importance columns
(**Must Have · Important · Nice to Have**) of compact, text-only, draggable
chips. Phones keep the photo-card category screens and importance sheets,
unchanged. Everything stays behind `FLH_ONBOARDING_V3` (still off in
Production); `CURRENT_ONBOARDING_VERSION` is still 1.

> FLH does the homework. The buyer makes the decisions.

## 1. Dependency on PR #184 (rental onboarding Stage 3)

#184 was open (draft, head `76597e9`) when this was built. This branch is cut
from `main` at `ef77c3e` and does **not** include, copy or modify any #184
code.

| #184 brings | Desktop board on `main` today | After #184 merges |
|---|---|---|
| `PetsQuestion` on Rental Essentials | Rental Essentials stays **its own screen** on desktop (it is a question category, never folded into the board). On `main` that screen has no question yet — exactly as on phones. | `PetsQuestion` renders inside `CategoryStep`, which the desktop Rental Essentials screen already uses, so desktop gets it with **no further change**. |
| Pet-Friendly level from the pets answer | If chosen, shown **once**, in its column (read from `priorityLevels`). Moving it is an explicit edit through the canonical write, which ends FLH's automatic ownership (`clearPetsAuto`, already on `main`). | Unchanged. |
| Home to Rent lot-size importance (`setLotSizeValue`, `lotSizeImportance`) | The board shows **Ideal lot size** in the Exterior group with `main`'s write (value only), as the phone screen does on `main`. | **Follow-up needed (small):** switch the board's lot-size field to `setLotSizeValue` and add a "How important is lot size?" control using `setLotSizeImportance`, mirroring #184's `LotSizeImportance`. Not done here to avoid duplicating unfinished work. |
| `BASICS_LABEL_V4` rail labels, renter hints | n/a | Text-level merge in `Onboarding.jsx` (both edit the rail `labels` line) and `PriorityFlow.jsx` imports; no semantic conflict. |

Shared files both branches touch: `Onboarding.jsx`, `PriorityFlow.jsx`,
`globals.css` (this branch's CSS is a separate block, inserted *before* the
V3 block so it does not collide with #184's appends at the end of the file).

## 2. How it works

### Screens (desktop, ≥ 1024 CSS px)

| Search | Desktop screens | Phone screens (unchanged) |
|---|---|---|
| Home to Buy | Search Type · Basics · Where · **What matters most** · Review | 10 + Review |
| Home to Rent | Search Type · Basics · Where · Rental Essentials · **What matters most** · Review | 8 + Review |
| Apartment to Rent | Search Type · Basics · Where · Rental Essentials · **What matters most** · Review | 6 + Review |

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
up: the board — 1024–1199 stacks the library (scrolls inside itself, ≤ 560px)
above the columns; ≥ 1200 puts the library left and the columns right (sticky).

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
| Drag | library → column, column → column, column → library. Drop targets are marked while dragging; the library shows "Drop here to remove it from your priorities". Dropping where it already is changes nothing. |
| Click / Enter / Space | opens a small importance chooser beside the chip: Must Have, Important, Nice to Have, and Remove (if ranked) or Not now. Focus moves in, Tab wraps inside it, Escape closes without change and returns focus; after a choice focus follows the chip to its new column. |
| Undo | every board move announces itself (`role="status"`) with one-step Undo. |
| Add your own | typing first lists canonical library features (any category) that match; Add / Enter uses `addOwnFeature` (dedupe ignoring case, spacing and punctuation, across every category, the person's document and the catalog), then the chooser opens immediately. A match on another category says where it lives. |
| Garage (Home to Buy) | one **Garage** chip with the existing `exterior:Garage` identity (same write as the phone's garage question; removal = Not important). Attached / Detached / Either and the garage details appear once it matters, as on the phone. |
| Garage (rentals) | Home to Rent **Garage** and apartment **Garage Parking** are the phone's cards. `heldGarage` switching logic is untouched; tests cover house ↔ apartment round trips through the board. |
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

## 3. Review

Desktop Review is the existing editable Review. A priority opens the existing
importance sheet; **Edit** on a category returns to the board, whose Continue
reads **Back to review**. Back from Review returns to the board.

## 4. Tests and QA

- `test/desktop-priority-board.test.js` (15): desktop screen order for all
  three searches; progress; Continue / Skip / Back / resume across devices;
  library per search; every move and exactly-once; board = phone writes;
  removal never scored and Unknown ≠ No; garage; house/apartment garage across
  switches; Add your own; legacy; pets; co-buyer purity; descriptions and
  images; UI and release-safety contracts.
- `test/desktop-priority-board-db.test.js` (real Postgres 16, 2): board =
  phone document; round-trip; co-buyer independence; JS = SQL on homes with a
  garage / none / unknown, after a No answer, and for apartment Garage Parking
  with a held house Garage.
- `scripts/qa/desktop-priority-board-qa.mjs`: **81 / 81** (see the PR).
- `docs/desktop-priority-board-screenshots/`.

## 5. Open decisions

1. Breakpoint 1024 (iPad landscape and 1024-wide portrait tablets get the board).
2. Wording of the 58 preview sentences (founder review).
3. Lot-size importance on the board for Home to Rent, after #184.
4. Rename of your own features is offered in the phone sheet and on Review,
   not in the board's small chooser.
5. Desktop drag uses native HTML5 drag and drop; touch tablets at ≥ 1024 use
   tap-to-choose (drag on touch is browser-dependent).
