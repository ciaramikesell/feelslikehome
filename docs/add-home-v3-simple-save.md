# Add Home V3, phase 1: the simple save

**FLH does the homework. The buyer makes the decisions.**

A buyer pastes or shares a listing link, FLH finds the home, and the buyer
saves it with **one Save Home**. Everything else is optional and comes after.

This is phase 1 of `docs/add-home-v3-friction-audit.md`, a journey
simplification and not an importer rewrite. It has:
- no schema, RLS or storage-policy change;
- no new provider and no extra or background RentCast call;
- no change to Match scoring;
- no automatic Match answers.

Floor Plans and PR #166 are untouched.

| Piece | File |
|---|---|
| Found card, Add photo, saved state, compact Find line | `src/components/HomeModal.jsx` (`ImportFoundCard`, `FoundHomePhoto`, `SavedHomeView`) |
| Pure helpers (essentials, price line, saved summary) | `src/lib/addHomeSave.js` |
| Stay on the saved state; open the home on request | `src/components/HomesBoard.jsx` (`saveEditedHome` `landing`, `openSavedHome`) |
| Styles | `src/app/globals.css` (`.flh-find-compact`, `.flh-found-*`, `.flh-saved*`) |
| Tests | `test/add-home-simple-save.test.js` (20, 3 on real Postgres) |
| Browser QA | `scripts/qa/add-home-simple-save-e2e.mjs` (18 steps, desktop 1440 and iPhone 390) |
| Screenshots | `docs/add-home-v3-simple-save-screenshots/` (`before-*` = `main` at `7964384`) |

## What changed for the buyer

**1. Find (unchanged).** The same input and Find button, the same lookup,
and the same entry paths:
- the Share Extension and universal link (`/homes?url=` auto-finds);
- duplicate detection (exact listing URL, at Find, at Save and at share
  intake);
- the address-match guard and the failure notes.

**2. The found home comes first.** Once a home shows:
- The Find section folds to one line, "Searched zillow.com · Change".
- The header's subtitle is dropped.
- The card shows:
  - the photo the home already has, or a neutral placeholder with **Add
    photo** on it;
  - "We found your home";
  - the street, with a map pin and the city/state/ZIP;
  - the price (an inactive listing still says "No current asking price");
  - beds · baths · sq ft · lot · year built;
  - one quiet line: "We found 18 details about this home." It is singular for
    one ("We found 1 detail…") and never implies the home is already saved.
    Where each detail came from stays on Home Facts, marked From listing.

**3. One Save Home**, directly under the card.
- It needs only an address. Pasting, Home Facts review, Match answers, notes
  and a photo are not required.
- On iPhone 390 it is on screen without scrolling. It used to sit 705 px
  below the fold.

**4. Everything optional is folded below Save Home:**
- **Add more from the listing** (Smart Paste, unchanged). The paste box, the
  Home Facts review and the possible Match answers now live inside this
  disclosure. Its summary shows "Optional · 5 to review" when suggestions are
  waiting. An unreviewed suggestion is simply not written: no fact and no
  answer.
- **Add notes, pros, or cons** (unchanged, #171).

**5. Saved.** The modal turns into an unmistakable "Saved to My Homes" state:
- a check;
- "51613 Sass Rd is now in My Homes", plus ", shared with everyone in this
  search" when the search is collaborative;
- a small summary of the saved home;
- **Back to My Homes** (primary) and **View home** (opens the home's
  overview);
- closing it (× or the backdrop) also returns to My Homes.

Before, Add to My Homes jumped straight into the home's overlay.

**Missing data and failed lookups** use the same card:
- It says "Where is this home?" with the address, the calm reason note and
  Add photo.
- **Save Home** works the same way.

**Apartments and the Realtor's Suggest a Home** keep the full editor,
unchanged. The quick card was never theirs.

## Photo

- **Add photo** on the card reuses the existing staged upload:
  - the same file input rules (JPEG/PNG/WebP, 5 MB) and handler;
  - nothing is uploaded until Save;
  - the same `home-photos` bucket and path.
- **Change photo** / **Remove** work while the photo is staged.
- **FLH never fetches, copies or hotlinks a listing site's images.**
- **Pasted text can no longer set the photo** (final review correction).
  - **Before:** `parseListingText` (`src/lib/matching.js`) turned the first
    image link in pasted listing text into `photoUrl`. That filled an empty
    photo silently, as a hotlink to the listing site.
  - **The extractor no longer reads image links.** An image link is also
    never taken as the listing URL.
  - **`photoUrl` is no longer an import destination** (`IMPORT_DESTINATIONS`
    in `src/lib/importDomain.js`). A finding, `resolveImport` patch or
    `mergeImportFields` patch for it is refused from any source, lookup or
    paste.
  - **Not changed:**
    - an explicit upload;
    - a Photo URL the buyer types into Home Facts or the editor;
    - any photo already saved on a home, including one previously set from
      pasted text (no stored data is touched);
    - storage policies.
  - **Pasting or re-pasting text never removes or replaces** a photo the
    buyer chose.
  - Covered by unit tests, a real-Postgres test and a browser step on
    desktop and iPhone.
- **A failed upload never costs the home** (Save Home only).
  - Today Save Home carries on and saves the home and everything typed,
    without the photo.
  - The saved state then says: "The photo didn't upload, so the home was
    saved without it. You can add a photo from its overview."
  - A thrown upload (a network error) is handled the same way.
  - The full editor (Edit Home, apartments) keeps its existing behaviour: it
    stops and offers to retry or save without the photo. Nothing is lost
    there either.

## What is kept

- **Everything the lookup returned is saved**, including what the card no
  longer shows: every field, the `listing_import` snapshot (listing facts,
  status, sources) and the trusted map point. This is checked in real
  Postgres and in the browser (HOA $0, taxes, garage, coordinates, snapshot).
- **Smart Paste, Home Facts suggestions, personal answer suggestions** and
  their Use / Skip / Undo / Use all / Confirm logic are unchanged.
- **Notes / Pros / Cons** are unchanged.
- The **double-save guard and partial-write recovery** (`partialHomeId`) are
  unchanged.
- The **Router Cache fix**: the board is refreshed before the saved state
  shows, so Back to My Homes and a reload both show the new home.

## Actual action counts

These were measured by the browser runs (`scripts/qa/add-home-simple-save-e2e.mjs`,
plus the same measurement against `main` at `7964384` on a second dev server
with the same data). Each tap, paste or fill is one action.

| Task | Before (`main`) | After |
|---|---|---|
| Save a found home from a pasted link | Add a Home → paste link → Find → **scroll** (705 px on iPhone, 208 px on desktop) → Add to My Homes = **4 + a scroll**, then you land inside the home's overlay; closing it to get back to My Homes is a 5th action | Add a Home → paste link → Find → **Save Home** = **4, no scroll**. Then **Back to My Homes** (1) or **View home** (1) |
| Save from the Share Sheet (`/homes?url=`) | Share → FLH → scroll → Add to My Homes | Share → FLH → **Save Home** (no scroll; checked on iPhone) |
| Save after pasting the description | Save Home sat **1,883 px** below the fold on iPhone (1,293 px on desktop), after 6 review buttons | Save Home stays on screen (**0 px** of scroll). The 6 review buttons are optional, below it, and folded |
| Open the optional paste | 2 actions (paste, Fill in details) | 3 actions (open "Add more from the listing", paste, Fill in details): **one more**, the cost of keeping it out of the way |
| Missing data / failed lookup | Address → Add to My Homes | Address → Save Home (unchanged count; Save Home visible without scrolling) |
| Add a photo while adding | Not possible on the card. Afterwards: open the home → (phone) Photo options → Upload photo → choose = 3–4 actions | **Add photo → choose = 2**, on the card |

The core tap count to save is the same: 4. What changed:
- you no longer have to find the button;
- nothing above it asks for attention;
- a clear success state replaces an unexplained jump into the home;
- the photo can be added in place.

## Tests and QA

- `test/add-home-simple-save.test.js`: 15 pass.
  - Pure helpers.
  - The card contract: one action, address only, optional parts after Save
    and folded.
  - Photo reuse and failure handling.
  - The saved state, and Board landing and opening.
  - Entry paths: share intake, duplicate redirect, one lookup per Find.
  - **Real Postgres:** Save Home's exact payload as the owner (every
    looked-up value and the snapshot kept, no Match answer, duplicate found by
    the co-buyer) and as the co-buyer (the owner sees it, no personal answers
    written).
- Updated source pins for the new name and order in
  `home-facts-redesign`, `listing-text-home-facts`,
  `buyer-mobile-add-edit-account` and `rentcast-import-accuracy`. No behaviour
  pin was loosened.
- Text pasted on the "No link?" path before a card exists keeps **Add more
  from the listing** open, so the results the buyer just asked for stay in
  view, still below Save Home.
- **Full suite, real PostgreSQL 16:** 1341 / 1341 pass, 0 skipped.
- **Browser QA, `add-home-simple-save-e2e.mjs`:** 18 / 18 (desktop 1440 and
  iPhone 390). It covers:
  - a successful lookup;
  - optional paste left unreviewed;
  - missing data;
  - a failed (rate-limited) lookup;
  - a duplicate;
  - photo added;
  - photo upload failed;
  - the co-buyer;
  - Share Extension entry (`/homes?url=`), including a shared duplicate.
- **Regression QA.** The existing scripts now save with Save Home and open the
  home with View home.

  | Script | Result |
  |---|---|
  | `rentcast-import-e2e` | 12 / 12 |
  | `smart-listing-paste-e2e` | 12 / 12 |
  | `pasted-listing-answers-e2e` | 15 / 15 |
  | `home-card-notes-qa` | 7 / 7 |
  | `home-overlay-e2e` (fresh stand-in) | 19 / 27 |

  The 8 `home-overlay-e2e` failures (steps 3, 4, 7/8, 9) are the ones already
  documented on `main` in `smart-listing-details-paste.md`; there are none
  new. Its Add Home, duplicate, manual, interrupted-save and share-intake
  steps pass.
- `scripts/visual/home-facts-screens.mjs` was not updated. It drives an older
  preview harness that already referred to the retired "Can't find the
  home?" copy on `main`.

## Not in this PR

- Automatic saving. This is a product decision: the buyer always taps Save
  Home.
- School district, Walk Score, new RentCast fields, a lookup cache.
- Merging the review lists into one (audit PR 3).
- Changes to the Home Details overlay.
- Native Share Extension changes. The extension still hands `/homes?url=` to
  the app. Only that web entry was exercised here (iPhone emulation); a
  device check is in the PR's manual list.
