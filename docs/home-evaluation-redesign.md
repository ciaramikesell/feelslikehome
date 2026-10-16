# Home evaluation redesign: Check the Match + Tour Feedback

Completes the home workspace from #150 (Home Facts / Check the Match / Tour
Feedback). The two areas this PR changes each have one job:

- **Check the Match**: does this home meet what matters to me?
- **Tour Feedback**: how did I actually feel about this home?

There are no migrations and no scoring changes. Every value is read from or
written to storage that already exists, with the permissions it already has.

## 1. Audit: who owned what (before)

| Information | Stored in | Written by (before) | Shown by (before) |
|---|---|---|---|
| Match %, tiers, Unknown | computed by `computeMatch`: weighted average over priorities with a confirmed answer (Must-Have 4, Important 2, Nice-to-Have 1); Unknown and neutral excluded | — | `HomeDetail` breakdown; `DetailMatchPanel` on phones |
| Personal Yes / No / Unknown | `home_member_state.checks` (per buyer) | **only** the full editor's "Personalized Match" list | Match breakdown (unanswered items read "Some listing details couldn’t be determined reliably") |
| Pets / Utilities / In-unit laundry | shared `homes` columns | the same editor | Match breakdown |
| Budget, beds, baths, size, lot, type, layout, condition, garage | shared home facts | Home Facts / editor | scored automatically |
| In-person Match criteria (Natural Light, Layout / Flow…; older and rental searches only) | `home_member_state.ratings` (tour responses) | **nothing** | Match breakdown |
| Reaction, tour date | `home_member_state.reaction`, `toured_at` | `PostTourModal` | **not displayed** |
| In-person survey (Curb appeal, Layout, Privacy, Neighborhood) | `ratings` `tour-v2:*` (not Match criteria) | `PostTourModal` | **not displayed** |
| Pros, cons, notes | shared `homes` columns (no author) | notes card; full editor; post-tour note (appended) | Tour Feedback notes card |
| Co-buyer view | security-definer RPC: their %, overall feeling, older "different takes" | — | co-buyer section |
| Realtor notes and tour suggestions | `realtor_notes`, `tour_suggestions` | `RealtorContributions` (Realtor only) | Tour Feedback |
| Realtor-private client notes (#149) | `client_records` | My Clients | not on the home page (unchanged) |

## 2. Component structure (after)

`HomeDetail` is still the shell: sidebar, mobile switcher, `?section=` URLs, Home Facts and all save functions. It renders three areas:

- **Home Facts**: `HomeFacts` (unchanged).
- **Check the Match**: `CheckTheMatch`, with rules in `lib/matchReview.js`.
- **Tour Feedback**: `TourFeedback`, which reuses `PostTourModal` and `RealtorContributions`.

### Check the Match
1. **Overview.** The Match % and a plain explanation of how it is built: a weighted share of confirmed answers, Must-Haves 4×, Important 2×, Nice-to-Haves 1×, Unknown not counted. It shows "N of M priorities have an answer" and match / don't match / unknown counts, and offers **Review what's still unknown**. When a confirmed Nice-to-Have "No" lowers the score, it says so. There's no completion meter.
2. **A Must-Have isn't met.** Shown only for *confirmed* misses, never for Unknown.
3. **Still wondering about…** lists unknown priorities, Must-Haves first. The first five show, the rest are behind "Show N more". Each is answered where it truly lives:

| Source | How it's answered here | Stored as |
|---|---|---|
| Personal (check-kind) | Yes / No / Unknown | this buyer's own `checks` (`saveHomePersonalState`) |
| Shared fact (Pets / Utilities / Laundry) | Yes / No / Unknown, marked shared | shared `homes` field (`saveHomePersonalAndShared`) |
| Home Facts (budget, beds, garage, layout, …) | "Add in Home Facts" link | the fact itself; **no duplicate answer** |
| Commute | calculated from saved places | — |
| In person (older/rental) | its existing three tour responses | this buyer's own `ratings` |
| Older 1–5 rating priorities | read-only | nothing writes these today |

4. **What's confirmed / All priorities.** Answered priorities by tier, one compact line each, with **Change** to reopen the controls.
5. **Co-buyer's Match.** Their %, from their own priorities and answers, labeled as theirs.
6. **Location & Commute** is unchanged.

Choosing Unknown removes the answer. If an older alias of the same priority still holds a value, the canonical key is set to `false`, which Match already reads as Unknown. That way the old answer can't reappear, and nothing is deleted.

### Tour Feedback
- **Plans row:** Want to tour, Favorite, Archive / Restore (personal, unchanged handlers).
- **Not toured:** an inviting empty state ("Your impressions will live here"). The only way in is **I've toured it — record my take**, which opens the existing `PostTourModal`. Nothing is marked toured unless a take is saved there.
- **Toured:**
  - the reaction (Love it / Still considering / Definitely not), shown for the first time, plus any older overall-feeling stars
  - **How it felt in person**: the existing survey answers and any in-person Match criteria
  - **What stood out**: what you loved, what gave you pause, and notes
  - **Edit your take** reopens `PostTourModal`; there are no duplicate questions
- **Notes so far / What stood out:** pros, cons and notes, now edited inline here, primarily. Notes written before a tour stay visible and are labeled as notes, not tour feedback.
- **Co-buyer's take:** their overall feeling and "where you see it differently", attributed to them.
- **From the Realtor:** the existing `RealtorContributions`, unchanged.

### Full editor
Opened from the workspace, the editor's Personalized Match and Shared notes sections are replaced by a pointer to Check the Match and Tour Feedback. The fields still travel with the form, so nothing is reset. Add Home and the My Homes card editor are unchanged.

### Realtor view
The same workspace, read-only. There are no answer, notes, plans or take controls. Reflections are attributed by name ("Jordan's take", "Sam's take"), using the names the Realtor page already loads. Realtor notes keep their existing permissions.

## 3. Data-model limitations (documented, not changed)
- **Pros, cons and notes have no author.** They are single shared fields, so they're labeled "Shared with everyone in this search". Per-person attribution needs a schema change.
- **Pros and cons are stored comma-separated.** "Bright, open living room" shows as two items. That's existing behavior.
- **The survey and Match don't connect.** The in-person survey (`tour-v2:*`) isn't Match criteria, and the in-person Match criteria have no survey questions. This PR only exposes the existing answer path for the latter.
- **The co-buyer projection is narrow.** It exposes their %, overall feeling and older numeric "different takes", but not their reaction or survey answers. Showing more needs an RPC change (out of scope).
- **Older 1–5 rating priorities** (non in-person) have no writer anywhere and are shown read-only.
- **Nice-to-Haves move the score** (weight 1). That's explained in the UI, not changed (a future weighting project).

## 4. QA
- `scripts/visual/home-evaluation-screens.mjs <out> http://localhost:3000`: 17 scenarios × 390 / 768 / 1024 / 1440. It covers:
  - every review state
  - interactions run against the preview's in-memory save paths: personal answer, clear to Unknown, save error and rollback, notes edit, opening the survey without marking the home toured, section URLs
  - read-only assertions for the Realtor view
  - 44px tap targets on phones
- `scripts/visual/home-facts-screens.mjs`: the #150 suite, rerun as a regression check.
- `test/home-evaluation-redesign.test.js`: routing and score-honesty unit tests, source guarantees, and real-Postgres tests:
  - per-buyer answers stay independent
  - shared-fact answers are shared
  - take and survey persistence, with notes appended
  - legacy pros/cons/notes are preserved
  - a Realtor can't write either buyer's state
