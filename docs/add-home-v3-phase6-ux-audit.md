# Add Home V3, phase 6: Home Facts + Match UX polish

**FLH does the homework. The buyer makes the decisions.**

This phase makes the time after **Save Home** clearer for a first-time buyer,
especially on iPhone. It is display and copy only:
- no Match algorithm, score, weight or threshold change;
- no schema, RLS, migration or storage change;
- no new dependency and no paid API call;
- no auto-saving and no automatic answer;
- Floor Plans and #166 are untouched.

It was built on `main` at `25ef9e9` (the #179 merge).

| Piece | File |
|---|---|
| Open-priority counts (display only) | `src/lib/matchProgress.js` (new) |
| One-line listing context summary | `listingContextSummary` in `src/lib/listingContext.js` |
| Shortcut, progress line, next step, personal-answers note | `src/components/HomeOverlay.jsx` |
| Tier "N open" badge; opening a tier and focusing a row | `src/components/MatchCriteria.jsx` |
| Context row + Details sheet; Unknown legend | `src/components/HomeFacts.jsx` |
| Saved state next-step copy | `src/components/HomeModal.jsx` (`SavedHomeView`) |
| Styles | `src/app/globals.css` (`.flh-hf2-context-row`, `.flh-match-jump`, `.flh-match-next`, `.flh-mc2-open`, `.flh-hf2-legend`) |
| Tests | `test/add-home-phase6-post-save.test.js` (12: 11 unit, 1 on real Postgres) |
| Browser QA | `scripts/qa/post-save-ux-e2e.mjs` (18 steps), `scripts/qa/post-save-ux-capture.mjs` (screenshots + measurements) |
| Screenshots | `docs/add-home-v3-phase6-ux-audit-screenshots/` (`before-*` = `main` at `25ef9e9`) |

---

## 1. Audit: before

I read the earlier docs first: phase 1 (simple save), phase 3 (RentCast
context), Match Reveal, the home overlay (phase 2) and the Home Facts flow
redesign. Then I drove the real app on the Supabase stand-in (real Postgres
16) with the RentCast fixture, at desktop 1440 and iPhone 390. Four homes were
used:
- a **standard** lookup (51621);
- an **enriched** RentCast home with county records, listing type and history
  (51692);
- a **sparse** home: a failed lookup saved with an address only (51619);
- the enriched home **as the co-buyer**, who has a different priority list.

The search uses the stand-in's seeded priorities:
- **owner:** budget, beds and Garage (Must-Haves); baths, property type, Home
  Condition and Finished basement (Important); Fireplace (Nice to Have);
- **co-buyer:** Fireplace (Must-Have).

**Measured before** (`post-save-ux-capture.mjs`). "Your Match starts" is its
heading's distance from the top of the overlay's scroll area.

| Home | Viewport | Your Match starts | Screen height | Screens down |
|---|---|---|---|---|
| Enriched | iPhone 390 | 1,566 px | 664 px | 2.4 |
| Standard | iPhone 390 | 1,411 px | 664 px | 2.1 |
| Sparse | iPhone 390 | 1,372 px | 664 px | 2.1 |
| Enriched | Desktop 1440 | 1,034 px | 900 px | 1.1 |

### Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| F1 | My Match | **"100% Match" with 2–3 of the buyer's own priorities still Unknown, and nothing says so.** On the enriched home the owner saw "100% Match · All Must-Haves met", but Home Condition, Finished basement and Fireplace were open. The co-buyer saw "100% Match" next to "1 Must-Have still unknown". The only hint was the generic "Unknown isn't No". A first-time buyer reads 100% as "done". | **High** |
| F2 | Post-save, iPhone | **Your Match is 2.1–2.4 screens below the top**, after Photo options, Year/taxes, Home Facts, Schools, Garage, Basement and Notes. Nothing at the top says it exists. This is the main friction between saving a home and understanding its Match. | **High** |
| F3 | My Match, iPhone | **Unanswered priorities are hidden.** Important and Nice to Have are collapsed on phones (by design, phase 2), and their headers gave no sign that they held open questions ("Important · 4 · Show"). | Medium |
| F4 | Home Facts top | **Secondary listing history crowds the essentials.** Under View listing, on iPhone: five lines of dated listing and county-record context (status/dates/days, listing type, earlier periods, fireplace/pool/view). It sits between the home's identity and Photo options, and competes with price and size. | Medium |
| F5 | Provenance | The context lines said "When added (date)" and "county records", but nowhere said that the snapshot isn't refreshed or that it never changes Home Facts or Match. | Low–Medium |
| F6 | Unknown | 6 (iPhone) to 40 (desktop, sparse home) warm "Unknown" fields. The only explanation of what Unknown means was in Your Match ("Unknown isn't No"), far from the fields. | Medium |
| F7 | Owner / co-buyer | Shared Home Facts vs personal answers was correct in data, but on screen only the co-buyer line hinted at it. Nothing told a buyer that their Yes/No is theirs alone, or that a fact they edit changes it for everyone. | Low–Medium |
| F8 | Saved state | Clear and calm (phase 1). The hint "Home Facts, Match and notes are there whenever you're ready" lists three places, but not what *View home* gives the buyer. | Low |
| F9 | Jargon | "Fact-based results update from Home Facts", and the desktop column header "Result \| your answer". | Low |
| — | Unchanged, checked | Save Home; duplicate detection; A-to-B draft isolation; same-property re-paste keeping answers; Match Reveal trigger and threshold; county/listing pointers staying "suggest" + Why?; Realtor read-only. All behaved as documented. | — |

No owner/co-buyer **data** inconsistency was found:
- both saw the same shared facts and context;
- each saw only their own pointers and answers;
- neither got an answer at save.

---

## 2. Buyer-facing changes and rationale

### 2.1 My Match: say what is still open, and offer one next step (F1, F3, F9)

Under the Your Match heading, the old line "Unknown isn't No. Fact-based
results update from Home Facts." is replaced by a progress line:

- **"3 priorities are still open. Your % counts only what's known."**
- Adds "**2 more are for after a tour.**" when the buyer has tour criteria.
- Says "**Everything you can check before a tour is settled.**" when nothing
  is open.

Under that, one quiet text button names the single most useful next step:
- **Fill in next: Home Condition →** when a shared Home Fact settles it. It
  scrolls to the field and focuses it.
- **Answer next: Finished Basement →** when it is the buyer's own Yes/No. It
  opens the tier if it is collapsed, scrolls to the row and focuses the first
  choice.

The next step:
- goes in tier order: Must-Haves, then Important, then Nice to Have;
- **never answers anything**. The buyer still taps Yes, No or Unknown
  themselves.

Each tier header now shows a small "**2 open**" badge when it holds open
priorities. A collapsed phone tier no longer hides that work.

**What "open" means.** It reuses Match Reveal's own rule
(`isCompletenessEligible`): objective criteria that can be settled before a
tour, minus Commute. A priority is settled only by a real Yes or No, exactly as
`matchCompleteness` counts it. So the two can never disagree.
- Unknown, a historical `false` and a neutral tour response all stay open.
- No completeness **percentage** is shown, so Match Reveal's 75% moment stays
  the payoff.
- The %, its rows and its weights are computed exactly as before: a test
  checks that `computeMatch` returns the same result, and that the inputs are
  untouched.

### 2.2 A "Your Match" shortcut on the first screen (F2)

Under View listing in the property header there is now a small pill:
**Your Match 100% · 3 open ↓** (or "See breakdown" once nothing is open).
- It smooth-scrolls to Your Match.
- It is visible on the first screen at 390 and 1440, on all three home types
  and for the co-buyer (the browser QA checks this).
- It is not shown to read-only viewers (Realtors).

**What this does not do.** It doesn't move Your Match higher on the page. On
iPhone the heading is still about 1,500–1,600 px down, because the new lines
take space (§4). What changed is that the buyer can **see** that Match exists
and **reach** it in one tap from the top. I chose not to reorder the page:
Home Facts first, then Match, is the established flow (phase 2), and moving
Notes or Match would be a larger product decision.

### 2.3 Home Facts: the essentials first; listing history one tap away (F4, F5)

The five context lines become **one dated row**:
- "When added (Nov 13, 2026): Active · New Construction · 23 days on market
  **Details**";
- or "County records for this home **Details**" when only records exist.

**Details** opens the existing `Sheet` (the same pattern as "From the listing ·
Review"), titled **Found when this home was added**. It contains:
- every line that was there before, unchanged: the dated status line, listing
  type, earlier listing periods, and the county-record features;
- a provenance note: *"From the listing and the county property record FLH
  looked up when this home was added on Nov 13, 2026. It isn't refreshed after
  that and can be out of date. None of it changes Home Facts or your Match."*

What stays as it was:
- no inline accordion or fold-out was added (pinned by a test);
- the subdivision line under the address;
- the Unknown-only hints (Layout "County records: 2 stories", Condition
  "Listing type: New Construction", the Basement foundation note);
- every edit path;
- the snapshot itself: a test and the browser QA confirm it is byte-for-byte
  unchanged after opening the sheet.

### 2.4 What "Unknown" means, said once, where the Unknowns are (F6)

Under the Home Facts heading: *"Unknown means FLH hasn't found it yet. It never
counts as No in your Match."* Nothing is converted. Missing data stays Unknown,
and None stays a real choice.

### 2.5 Shared vs personal, in plain words (F7)

In a collaborative search, Your Match says: *"Your answers here are yours
alone. Home Facts are shared with everyone in this search."* (The Notes block
already said "Shared with this search".) The co-buyer line is unchanged.

### 2.6 Saved state: one clear next step (F8)

The two actions are unchanged: **Back to My Homes** (primary) and **View
home**. The hint now says what the next step gives the buyer: *"Next, when
you're ready: View home shows what FLH found and how it fits your priorities.
Nothing else is required."*

---

## 3. Deliberately left alone

- **Save Home**, the found card, duplicate detection, the share-intake path and
  the A-to-B draft isolation (phases 1 and 4) are untouched. They were
  regression-tested (§5).
- **The saved state's button hierarchy.** Back to My Homes stays primary. It
  was a phase 1 decision for buyers adding several homes in a row. Swapping it
  would add a decision, not remove one.
- **Match % pill, Match Reveal** (trigger, 75% threshold, minimum of three,
  claim-once) and every scorer. The new line counts; it never re-scores.
- **The order of the page** (Home Facts → Notes → Your Match) and the phone
  collapse of Important / Nice to Have. The badge and the next step make the
  collapse honest without lengthening the page further.
- **The county-record / listing-text pointers**: they still say "suggest",
  still show Why? with the source, and still disappear when the buyer answers.
  The existing `<details>` Why? in Match Criteria (phase 2/3) is unchanged;
  the no-fold-out rule is for Home Facts.
- **Realtor suggestions** stay suggestions: no change to staging or acceptance.
- **The desktop column header "Result | your answer"** stays. It is jargon,
  but low impact, and it is pinned by earlier work.
- **No walkthrough, popover or onboarding** was added.

## 4. Before / after, measured

| Home | Viewport | Your Match starts (before → after) | Overlay length (before → after) | Match reachable from the first screen |
|---|---|---|---|---|
| Enriched | iPhone 390 | 1,566 → 1,591 px | 2,208 → 2,308 px | No → **Yes** (1 tap) |
| Standard | iPhone 390 | 1,411 → 1,515 px | 2,053 → 2,232 px | No → **Yes** |
| Sparse | iPhone 390 | 1,372 → 1,467 px | 1,913 → 2,082 px | No → **Yes** |
| Co-buyer | iPhone 390 | 1,566 → 1,591 px | 2,117 → 2,217 px | No → **Yes** |
| Enriched | Desktop 1440 | 1,034 → 1,060 px | 1,636 → 1,729 px | No → **Yes** |

**Honest reading.** The page got 90–180 px longer, because the shortcut, the
legend, the progress line, the next step and the shared/personal note each take
a line. Collapsing the listing context saved about 100 px on the enriched home,
which is why it barely moved. The improvement is reachability and clarity, not
length. A buyer now sees "3 open" at the top, reaches Your Match in one tap,
and reaches the right row in one more.

### Screenshots

`docs/add-home-v3-phase6-ux-audit-screenshots/`. Each name is
`before-` or `after-`, then the viewport, then one of the views below:

| View | What it shows |
|---|---|
| `enriched-1-saved` | Saved state (hint copy) |
| `enriched-2-overlay-top` | First screen of the home: shortcut and context row |
| `enriched-3-overlay-full` | The whole overlay |
| `enriched-4-match` | Your Match: progress line, next step, tier badges |
| `sparse-2-overlay-top` | Failed lookup, address only: no context row, legend |
| `cobuyer-4-match` | Co-buyer's own Your Match |

Phase 6 flow shots from the browser QA, both viewports:
- `qa-<viewport>-3-context-sheet`;
- `qa-<viewport>-5-answer-next` (the phone tier opened and the row focused);
- `qa-<viewport>-6-cobuyer-settled`.

## 5. Testing evidence

All runs used real PostgreSQL 16 (the `docs/database-tests.md` harness) and the
dev server with the RentCast fixture (`scripts/qa/rentcast-fixture.mjs`). No
live RentCast call was made.

- **New tests:** `test/add-home-phase6-post-save.test.js`, 12 pass. They cover:
  - what counts as open; tier order;
  - agreement with `matchCompleteness`;
  - the copy;
  - Match unchanged on a real `computeMatch`;
  - the summary row never showing a price;
  - wiring pins: no `<details>` in Home Facts; the next step never saves or
    answers; the Match Reveal trigger is unchanged; the saved-state actions
    are unchanged;
  - a scope pin: no change under `supabase/`, to scorers, to Floor Plans or to
    package files since `25ef9e9`;
  - **real Postgres:** owner and co-buyer load the same saved home; the same
    context; their own progress; the co-buyer's answer settles only their own
    progress; the owner's checks and the snapshot are untouched.
- **Full suite (real Postgres): 1,420 pass, 0 fail, 2 skipped.** The baseline
  on `main` was 1,409 / 0 / 2. The 2 skips are the same pre-existing ones.
  - The first full run caught 7 onboarding "scoped styles" pins. Those pins
    read `globals.css` from an onboarding marker to the end of the file, and my
    new styles had been appended at the end. I moved them beside the phase 3
    context styles.
- **`next build`:** passes.
- **Phase 6 browser QA**, `post-save-ux-e2e.mjs`: **18 / 18** (desktop 1440 and
  iPhone 390). It covers:
  - saved-state copy and actions;
  - the shortcut on the first screen;
  - the legend;
  - the summary row; the Details sheet, closed by Escape without closing the
    overlay; the snapshot unchanged;
  - the progress line and tier badges;
  - Fill in next → Home Condition focused → the buyer sets it;
  - Answer next opening the collapsed phone tier and focusing Finished
    basement, with nothing answered until the buyer taps No;
  - a reload keeping the answer and the fact;
  - the co-buyer's own progress and answer, with the owner's answers
    untouched;
  - the sparse home.

  Every step also fails on horizontal overflow or a console error.
- **Regression browser QA:** see the table below. It was re-run on this
  branch, same stand-in.

| Script | Covers | Result |
|---|---|---|
| `post-save-ux-e2e` (new) | This phase | **18 / 18** |
| `add-home-rentcast-context-e2e` | Phase 3 context (now read through the Details sheet), county pointers, owner/co-buyer | **10 / 10** |
| `add-home-lookup-efficiency-e2e` | Phase 4: one lookup per Find, **A-to-B draft isolation**, duplicate at Find | **16 / 16** |
| `add-home-simple-save-e2e` | Phase 1: Save Home, **duplicate detection**, share intake, failed lookup, photo | **20 / 20** (see note) |
| `pasted-listing-answers-e2e` | Personal answer suggestions; **answers kept across same-property re-pastes** | **11 / 11** |
| `match-reveal-qa` | Reveal trigger, 75% threshold, once per buyer, co-buyer, Realtor | **21 / 21** |

**Note.** The first `add-home-simple-save-e2e` run, back to back with the
others, went 10 / 20. The dev log showed 18 "per-user lookup limit reached":
the stand-in owner had used up phase 4's 20-lookups-per-10-minutes limit.
On a dev server restarted with `IMPORT_LOOKUP_USER_LIMIT=500` (an override
the route already supports), the same script passed 20 / 20. No code was
changed between the two runs.

## 6. Remaining friction for future phases

1. **Page length on iPhone.** Your Match is still about 2.3 screens down. The
   next lever is structural: for example, collapse Notes, Pros & Cons on
   phones into one summary row (they are also in Tour Feedback), or offer a
   "Facts | Match" segmented switch. Both need a product decision.
2. **100% with open priorities.** The new line explains it, but the pill
   still says "100% Match". A future option, which is a scoring-presentation
   decision for the founder, is to show "100% so far" until Match Reveal
   unlocks.
3. **"Fill in next" for a multi-select fact** focuses the field, but the buyer
   still has to open it. Opening the menu automatically was left out to avoid
   surprise on iPhone.
4. **Desktop jargon:** the "Result | your answer" column header.
5. **Saved state:** consider a quiet "3 priorities to check" line on the saved
   card. That would need the buyer's Match to be computed in Add Home, which
   today deliberately doesn't score.
6. **Listing context freshness:** still a one-time snapshot. Refreshing it
   needs new paid calls and approval (phase 3, §4).
