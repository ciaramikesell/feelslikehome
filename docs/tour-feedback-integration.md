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
- Pros, cons and notes are single shared fields with no author, labeled "Shared with everyone in this search". Pros and cons are comma-separated, so "Bright, open living room" shows as two items.
- The co-buyer projection exposes their %, overall feeling and older "different takes", but not their reaction or survey.
- In-person Match criteria (older and rental searches) still have no writer. Match Criteria shows them as "Answered after your tour", as #152 did. #151 answered them on Check the Match. Moving that into Tour Feedback is a design call left for review.
- The section eyebrow reads "Your take" on the Realtor view too. This is #150's section metadata, not new here.

## QA
- `npm test` against real Postgres 16, including `test/tour-feedback-integration.test.js`.
- `scripts/qa/tour-feedback-e2e.mjs` (new): owner, co-buyer and Realtor, full stack on real Postgres, at 1440 / 1024 / 768 / 390.
- Regression: #152's `scripts/qa/home-flow-e2e.mjs` and `scripts/visual/home-facts-screens.mjs`.
- Screenshots: `docs/tour-feedback-screenshots/`.
