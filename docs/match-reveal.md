# Match Reveal

A one-time, dismissible payoff: when a buyer has gathered enough of the
details that matter to them on a home, their own Match % for it is revealed in
a small dialog. It doesn't change Match, add a task, or show anywhere else.

| Piece | File |
|---|---|
| Completeness, threshold, copy | `src/lib/matchReveal.js` |
| Dialog | `src/components/MatchReveal.jsx` (+ `.flh-reveal*` in `globals.css`) |
| Trigger | `src/components/HomeOverlay.jsx` |
| Persistence | `supabase/migrations/2026-11-05-match-reveals.sql`, `claimMatchReveal` in `src/lib/supabase/collaboration.js` |
| Tests | `test/match-reveal.test.js`, `test/match-reveal-db.test.js` (real Postgres), `scripts/qa/match-reveal-qa.mjs` (browser) |

## How Match works today (what this builds on)

* `computeMatch(home, priorities)` is the one per-participant scorer. `home`
  carries this buyer's own `checks` / `ratings` (from their
  `home_member_state` row) plus the shared Home Facts; a co-buyer's answers are
  never on it.
* `allSelected` lists every selected priority once, with `evaluated`, `met`
  (`true` / `false`, or `null` for a neutral tour response) and `objective`:
  * `objective: true` — the Basics targets (budget, sq ft, lot, beds, baths,
    property type, layout, condition, bedroom locations), every Yes / No
    criterion (the buyer's own answer, else a Home Facts-derived answer, else
    Unknown — `homeFactCriteria.js`), the shared rental facts, and Commute.
  * `objective: false` — star ratings and in-person criteria (Natural Light,
    Layout / Flow, Noise …), which are answered on a tour.
* Saves: the home overlay (`/homes/[id]`) autosaves every change through
  `useHomeAutosave` — applied locally first, then written; its status is
  `saved` only when every queued write has succeeded and nothing is pending.
  Apartments / rentals also have the full editor (`HomeModal`), whose save
  resolves after the write. Add Home and the board's card actions are separate
  paths; the Realtor's view of a client home is read-only `HomeDetail`.

## Completeness (not Match)

`matchCompleteness(match)` over the same `allSelected`:

* **Eligible:** `objective` criteria, except `location:Commute`.
  * In: Basics targets, Yes / No criteria (including custom ones), shared
    rental facts — all can be settled before a tour, by Home Facts or by the
    buyer.
  * Out: in-person / tour criteria and star ratings (can't be settled before
    visiting, so answering them never boosts completeness); Commute (computed
    from saved destinations by a route lookup, nothing the buyer answers on the
    home); unselected or "doesn't matter" priorities (never in `allSelected`).
* **Determined:** `evaluated` with `met` `true` or `false` — an explicit Yes,
  an explicit No, a Home Facts-derived answer, or a known fact. Unknown, a
  historical `false` check (still Unknown in Match) and a neutral response
  never count.
* `pct = floor(determined / eligible × 100)`; unlocked when
  `determined / eligible ≥ 90%` **and** `eligible ≥ 3` (a home with almost
  nothing selected can't "complete" trivially; a buyer with fewer than three
  pre-tour criteria never sees the reveal).

## Trigger

* The overlay takes a **baseline** from the persisted home as read from the
  server — when it opens and whenever it is re-read. Opening a home, switching
  searches, a co-buyer's edits, Realtor suggestions and background data can
  only move the baseline; they never trigger.
* After **this buyer's own save persists** (autosave status `saved`, or the
  full editor's save resolving), completeness is recomputed from their own
  Match. Only a move from locked to unlocked continues.
* Not triggered: Add Home (the first save of a new home, however complete the
  import made it), a home already at 90%+ when opened, later edits, a fall
  below 90% (nothing is reset), Realtors (no answering surface; refused by the
  server anyway).

## Persistence: once per buyer and home

`public.match_reveals (home_id, user_id, revealed_at)`, primary key
`(home_id, user_id)`; the search is the home's own. `claim_match_reveal(home)`
(security definer, empty `search_path`) inserts the caller's row and returns
`true` only for the insert that created it.

* **Claim, then show.** The dialog appears only if the claim returned `true`.
  Rapid saves, a second tab, or a reload can't show it twice (one insert
  wins). If the claim fails (offline, migration missing), nothing shows and the
  save is unaffected. If the claim succeeds but its response is lost, or the
  page closes first, that reveal is consumed unseen — chosen over ever showing
  it twice. "Shown" and "dismissed" are the same record: dismissing writes
  nothing.
* **Private.** A table of its own because `home_member_state` rows are readable
  by the other participants and the Realtor. `match_reveals` has RLS on, no
  policies and no table grants: nobody reads it; the only write is the
  function, for the caller.
* **Permissions.** The function refuses (42501) anyone who isn't the owner or
  an accepted co-buyer of the home's search (`is_search_decision_maker`), and a
  home still staged as a Realtor suggestion. Owner and co-buyer each have their
  own row.
* Deleting a home cascades its rows. The app reads nothing back, so a buyer's
  progress is never exposed.

## Copy

From the real Match % (never adjusted to a band) and Must Have status:

| Match | Headline | Notes |
|---|---|---|
| 90%+ | Well, hello there! | With a failed Must Have: "Strong, with one catch." (no confetti); with unknown Must Haves: "…A few Must Haves still need confirming." |
| 75–89% | There's something here! | Mentions a missed or unconfirmed Must Have when there is one |
| 50–74% | A little give and take. | |
| below 50% | Not quite your match? | Informative, never "ruled out" |

Plus "You've gathered N% of the details that matter to you.", **See the
breakdown** (closes and lands on Your Match) and **Keep going**. Confetti only
at 90%+ with no failed Must Have; none with `prefers-reduced-motion`.

## Rollout (needs approval; nothing applied)

1. Apply `supabase/migrations/2026-11-05-match-reveals.sql` (adds one table and
   one function; touches nothing existing; re-runnable).
2. Deploy the app. In either order it is safe: without the migration the claim
   fails and simply shows nothing.
3. Existing homes: no backfill. A home at 90%+ today is never interrupted; it
   only reveals if its buyer later takes it from below 90% to 90%+ themselves.

Rollback: revert the app; optionally `drop function public.claim_match_reveal(uuid); drop table public.match_reveals;`.
