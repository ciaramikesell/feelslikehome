# Tour Feedback integration (#151 onto the #152 workspace)

#152 (Add Home → Home Facts → Match Criteria) is the approved direction and is
merged. #151 (Check the Match + Tour Feedback) overlapped it in `HomeDetail`,
`HomeModal`, the Match UI and the styles. This branch starts fresh from the
new `main` and brings over only #151's complementary work. #151 is not merged
here, and it stays open as the reference until this is reviewed.

There are no migrations, no RPC changes and no scoring changes.

## Kept from #152 (unchanged)
- Single-action Add Home and the corrected save → navigation flow (`saveEditedHome` + revalidating action).
- Structured Home Facts: inline Edit groups, "From listing" provenance, no imported-facts panel, and the orange **Next: Match Criteria** button.
- **Match Criteria**: the name, the Must-Haves / Important / Nice to Have sections, Yes / No / Unknown radios, read-only facts from Home Facts, and the Realtor text-only view.
- The workspace shell: sidebar, phone switcher, `?section=` URLs and the `replaceState(null, …)` fix.

## Brought over from #151
| What | Where |
|---|---|
| Redesigned Tour Feedback: plans row; take hero (reaction shown for the first time, plus older overall-feeling stars); "How it felt in person" (saved `tour-v2:*` survey answers and any in-person criteria); notes; co-buyer's take; Realtor context | `src/components/TourFeedback.jsx`; `.flh-tour-*` CSS only |
| Pre-tour notes: "Notes so far" before a tour, "What stood out" after, labeled as notes rather than tour feedback | `TourFeedback.jsx` |
| Pros / cons / notes edited in place through the existing shared-home save (`saveWhole`). A failed save keeps the draft open with an error. | `HomeDetail.jsx` `onSaveNotes` |
| Recording a take reuses `PostTourModal` unchanged (its verdict and response lists are now exported). Nothing marks a home toured by itself. | `PostTourModal.jsx` |
| Co-buyer attribution. The Realtor view names each buyer ("Ciara M's take", "Andrew M's take", "Andrew M's Match"). Realtors get no buyer controls. | `people/[searchId]/homes/[homeId]/page.js`, `TourFeedback.jsx`, `HomeDetail.jsx` |
| Alias-safe Unknown (#151's `answerPatch` rule, re-homed in #152's `lib/matchCriteria.js`). Choosing Unknown on a priority whose older alias still holds an answer (for example `features:Home Office`) now sets the canonical key to `false`, which Match already reads as Unknown. Before, the old Yes folded straight back in. A historical `false` now shows as Unknown in the radios instead of no option selected. | `criterionAnswerPatch`, `criterionAnswer` |
| The phone sticky action bar shows on Match Criteria only, because Tour Feedback carries the same actions inline | `HomeDetail.jsx` |

## Review decisions (round 2)

### 1. In-person Match criteria: "Things to check in person" in Tour Feedback
**How the scorer reads them (confirmed before building; unchanged).**
- **Which criteria count.** A selected priority is in-person when `isExperientialCriterion` says so (the `TOUR_CRITERIA` set: Natural Light, Layout / Flow, Noise Level, Curb Appeal …).
- **Where the answer lives.** Both scorers read it from the buyer's own `home_member_state.ratings[key]`: the JS `computeMatch` (`src/lib/matching.js`) and the SQL co-buyer / Compare scorer (`2026-10-15-cobuyer-compare-mudroom-parity.sql`).
- **How each value scores:**
  - `'positive'`: 1 (matches)
  - `'negative'`: 0 (doesn't match)
  - `'neutral'`: evaluated but unscored, so it's left out of the score
  - absent: Unknown
  - an older numeric 1–5 rating: scores rating/5, and counts as met at 3 or above
- **Weights:** Must-Have 4, Important 2, Nice to Have 1.
- **What doesn't count.** The post-tour survey (`tour-v2:*`) and the overall-feeling rating (`tour:overall`) are not Match criteria.

**Who sees it.**
- In **rental** searches, in-person criteria are active priorities.
- In **purchase** searches, the in-person built-ins are retired (`RETIRED_PURCHASE_BUILT_INS`). Only priorities the buyer created as custom items appear, as in older searches.
- When a buyer has no in-person criteria selected, the section is hidden.

**What was built.** Nothing new is stored and nothing scores differently.
- `inPersonCriteria(match)` (`lib/matchCriteria.js`) lists those rows of the same `computeMatch` result. No criteria are duplicated.
- Each row offers that criterion's existing tour responses (`tourResponseOptions`, e.g. Too noisy / Noticeable / Comfortable) plus Unknown. It uses the same radio control as Match Criteria.
- An answer goes through `answerInPerson` → `savePersonal(inPersonAnswerPatch(...))`: only this buyer's personal row, and only that one key of `ratings`.
  - Status, tour date, reaction, the survey answers, overall feeling and the shared notes are carried as they are.
  - Unknown removes the key.
  - The co-buyer's row is never written.
- Answering never marks a home toured. Tour Feedback's "take" state now depends only on a reaction, overall feeling or survey answers, never on an in-person answer.
- **Match Criteria picks the answer up immediately** (same in-memory home, so no reload is needed). Its read-only label for these rows now reads "Checked in person · Tour Feedback" instead of "Answered after your tour". The rest of the Match Criteria design is unchanged.
- **The post-tour reaction and survey stay separate,** in "How it felt in person" via `PostTourModal`. `PostTourModal` starts from `home.ratings`, so recording a take keeps in-person answers.
- An older 1–5 rating shows as "Earlier rating N/5 still counts until you choose". Choosing an answer replaces only that key.

### 2. Realtor wording
- On the Realtor's Tour Feedback, the page eyebrow no longer says "Your take". It names the buyers ("Ciara M & Andrew M"), and the page heading reads **Tour Feedback**. The take itself is headed "Ciara M's take", and the co-buyer's is "Andrew M's take".
- "From the Realtor" now tells the Realtor that those notes are visible to the buyers, and that their private client notes stay in My Clients. Nothing from `client_records` is loaded on this page.

### 3. Pros / cons: faithful display, no data change
- Tour Feedback shows pros and cons **exactly as written** (`white-space: pre-wrap`). It no longer splits on commas, so "Bright, open living room, Huge backyard" stays intact. The editor uses text areas with no "separate with commas" hint.
- Stored values are never rewritten.
- Compare (`CompareBoard.jsx`) and the My Homes card (`HomesBoard.jsx`) still split on commas. That code predates this PR and sits outside Tour Feedback, so it's left for review.

### Future improvement: individually authored pros / cons (not built; needs a schema change)
Today `homes.pros`, `homes.cons` and `homes.notes` are single shared text fields with no author, and the last save wins. A future pass could add a `home_thoughts` table: `(id, home_id, search_id, author_id, kind: 'pro' | 'con' | 'note', body, created_at, updated_at)`, with RLS allowing everyone in the search to read and only the author to write.
- Each item would be shown with its author, and each co-buyer would edit only their own.
- Realtors would stay read-only.
- Existing shared text would be shown as a "Shared notes (before authorship)" item, preserved verbatim and never split.
- That needs a migration, a backfill-free read path and RLS tests. None of it is in this PR.

## Not brought over (on purpose)
- `CheckTheMatch.jsx` and `lib/matchReview.js`, #151's competing Match page: overview ring, "Still wondering about…", compact confirmed list, and in-person answering on Match. #152's Match Criteria is the approved screen.
- `evaluationElsewhere` on `HomeModal`. In #152 the full editor only opens for apartments and rentals (`usesFullEditor`), and it still edits pros / cons / notes exactly as before. Nothing is hidden or reset there.
- #151's in-memory `persistence` prop and preview fixtures. QA here runs against real Postgres through #152's stand-in instead, so no development-only hook was added to production code.

## Data that must survive (verified)
- Older pros / cons / notes display as written, and viewing never writes them.
- A recorded take **appends** its note to the older notes and keeps pros and cons.
- Older `tour:overall` stars and in-person criteria responses are kept when a take is edited (`PostTourModal` starts from `home.ratings`). The original tour date is kept.
- A co-buyer's reaction, checks and ratings are never touched by the owner's take, notes edit or Match answer.

## Known limitations (unchanged)
- Pros, cons and notes are single shared fields with no author, labeled "Shared with everyone in this search" (see the future improvement above).
- The co-buyer projection exposes their %, overall feeling and older "different takes", but not their reaction or survey.
- The survey's "Curb Appeal" (`tour-v2:curb_appeal`) and a selected "Curb Appeal" Match criterion are different stored answers. This was already the case: the survey isn't Match criteria. They're shown in separate sections.

## QA
- `npm test` against real Postgres 16, including `test/tour-feedback-integration.test.js`.
- `scripts/qa/tour-feedback-e2e.mjs` (new): owner, co-buyer and Realtor, full stack on real Postgres, at 1440 / 1024 / 768 / 390. For the run it gives both buyers custom in-person priorities and restores them afterwards. It covers:
  - legacy saved notes and tour data
  - in-person answers before and after a tour: answer, change, clear, and Match Criteria reflecting each one
  - co-buyer independence
  - the Realtor's wording and read-only view
- Regression: #152's `scripts/qa/home-flow-e2e.mjs` and `scripts/visual/home-facts-screens.mjs`.
- Screenshots: `docs/tour-feedback-screenshots/`.
