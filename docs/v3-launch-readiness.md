# Milestone 4: first-run end-to-end QA and V3 launch readiness

**Integration base:** PR #190's approved head `8ddd1de` (still an unmerged draft). Nothing has been merged, and Production V3 has **not** been enabled.

**Code changes:** two small first-run fixes (§5), plus a sign-up endpoint for the dev-only Supabase stand-in so QA can drive the real sign-up form. No changes to Match, scoring, catalog, schema, migrations, native files, Capacitor config or the flag default.

## 1. How this was tested, and what it is not

| | Done here | Not done here: founder (§9) |
|---|---|---|
| Runs in | Chromium on Linux against **production builds** of this branch (flag ON on one server, OFF on another) and of `main`, on the repository's Supabase stand-in (real Postgres, real RLS, real `handle_new_user`) | The installed Capacitor app in the iOS Simulator or on an iPhone |
| Sign-up | The real form, through the stand-in's new `/auth/v1/signup` (a project **without** email confirmation) | Production Supabase, which may require email confirmation |
| Native | **Browser emulation** of Capacitor's injected bridge (real `native-bridge.js`, App and Haptics headers; `appUrlOpen` delivered the way `AppPlugin.swift` does) | Real WKWebView launch timing, the real Share Extension, Universal Links, real haptics, VoiceOver |
| Listing lookup | RentCast/Google are unreachable here, so imports used the existing "add the address" fallback | A real RentCast lookup on Preview |

## 2. First-run journey test matrix

All rows come from `scripts/qa/first-run-e2e.mjs`: **79/79 checks pass** (`v3-launch-readiness-screenshots/run-log.txt`). Every step was also checked in the database, not just on screen.

| Journey | Step | Result |
|---|---|---|
| **A. Personalize first** (native emulation, flag on) | Welcome (no homepage frame) → Get Started → real sign-up → one account, one search | ✅ |
| | Search type → **Let's personalize** → Basics ($450k, 3 beds) → Layout: Home Office *Must Have* → Kitchen: Walk-in Pantry *Important* → skip the rest | ✅ |
| | Review shows both choices and the one-time "Nicely done." → finish: onboarding complete (v4, `personalize`), exactly those answers, **no `dontcare`** | ✅ |
| | Add Home (address) → nothing saved until **Save Home** → one home on this search | ✅ |
| | View home → Match: "Nothing is known yet… no % yet. 4 unanswered" (price and beds unknown ≠ No) | ✅ |
| | Answer Home Office **Yes** → "100% Match", "based on 1 known priority" → **No** → 0% → **Unknown** → no % | ✅ |
| | Close → My Homes lists the new home; **"View home" tapped instantly, 3 of 3 open** (was failing, §5.1) | ✅ |
| **B. Save first** | Sign-up → **I'll figure it out as I go** → skip Basics → lands **in Add Home** | ✅ |
| | Save → the confirmation no longer promises a "fit to your priorities" that don't exist (§5.2) | ✅ |
| | Home overlay and My Homes card: **no % anywhere**, never framed as a poor fit, plus a gentle "Explore My Priorities" link | ✅ |
| | Explore → Home Office *Must Have*, Walk-in Pantry *Important* → Done → onboarding state untouched | ✅ |
| | Back on the home: both listed, still no % (nothing known) → own answer Yes → 100% from that answer only; Pantry stays Unknown and is not written | ✅ |
| **C. Share Extension hand-off** (emulated) | Cold, signed out, new user: the shared Zillow link survives sign-in → **Create an account** (same form, destination kept) → onboarding (`?redirect=` kept) → Quick Start → **Add Home pre-filled** with "77 Birch Ln, Troy, MI 48084" | ✅ |
| | Nothing saved before the buyer confirms; saved once with the original listing URL | ✅ |
| | Warm, signed in: sharing the **same** listing opens the saved home (no duplicate); a **new** listing opens Add Home pre-filled | ✅ |
| | Pasted listing text containing an image URL → **no photo imported** | ✅ |

## 3. Returning users, collaboration, Realtor

| Check | Result |
|---|---|
| Sign out → sign in → straight to My Homes; visiting `/onboarding` sends a finished account home (never restarts) | ✅ |
| My Search Quick Edit lists the onboarding choices | ✅ |
| Explore preloads choices; an edit saves; My Search says "Pick up at Kitchen"; resume and category jump work | ✅ |
| The Explore change reaches the home's Match | ✅ |
| "Homes" is always one tap away in the bottom nav | ✅ |
| **Invitation:** signed-out link → sign-in keeps `/invite/<token>` → Create an account → back to the invitation → **Join search** → co-buyer membership on the intended search; still exactly one own search | ✅ |
| Co-buyer onboarding (Personalize) writes **only their** row (Home Office *Nice to Have*); **owner's row byte-identical** | ✅ |
| Co-buyer opens the owner's home: **their own** Match (owner's Yes isn't theirs) | ✅ |
| Co-buyer Explore shows **their** answers; an edit stays in their row; switching to their own search shows that search's (empty) priorities | ✅ |
| **Realtor** sign-up from *For Realtors* → People workspace, never buyer onboarding; one account and one search | ✅ |
| Seeded Realtor: nothing they do in Explore changes a buyer's priorities (Explore edits only their own row on their own active search) | ✅ |

## 4. Empty and sparse Match assessment (Part 3)

| A first-time user should understand… | Today (flag on) | Verdict |
|---|---|---|
| The listing was saved | "Saved to My Homes — 12 Oak St is now in My Homes" | ✅ clear |
| Match is personal, from *their* priorities | Overlay: "Your 100% is based on 1 known priority"; co-buyer lines say "from their own priorities and answers" | ✅ clear |
| Unknown stays unknown | "Unknown isn't No. Fact-based results update from Home Facts"; Yes / No / **Unknown** answers; "Nothing is known yet… no % yet" | ✅ clear |
| They can add Home Facts or their own answers | "Answer next: Home Office →", "Fill in next: Within budget →", radio answers in place | ✅ clear |
| They can refine priorities anytime | No priorities: "No Match yet—it starts once you tell FLH what matters. **Explore My Priorities**" (card and overlay) | ✅ clear |
| — | Saved confirmation said "how it fits your priorities" when there were none | ⚠️ **gap → fixed (§5.2)** |

No tutorial, no modal and no forced step was added, and nothing invents a %: `computeMatch` returns no percentage until something is actually known.

## 5. Issues found, with severity

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | **P2** | Tapping **"View home"** within ~1–2s of saving left the buyer on My Homes. The dialog closed but the home didn't open: 2–4 of 5 quick taps in QA, flag on **and off**, so it is pre-existing on `main`. Cause: the save's revalidating `refreshMyHomes()` makes the App Router refetch the board in the background; that refetch superseded the tap's navigation (the navigation request was aborted). It sits on the first-run path right after the first save. | **Fixed:** a brand-new home skips its redundant `router.refresh()`, and "View home" re-issues the same navigation only if the buyer is still on `/homes` (≤ 3×). **20/20** quick taps in a stress loop, 3/3 in the journey. |
| 2 | **P2** | Quick Start's saved confirmation promised "how it fits your priorities" when none existed. | **Fixed (flag on only):** "…shows what FLH found. Your Match starts once you tell FLH what matters—anytime, in My Search." With the flag off, or with priorities set, the old line is byte-identical. |
| 3 | P3 | Review says "2 priorities shape your Match" while the home's Match counts 4 (budget and bedrooms from Basics also count). Both are true; the counts are just scoped differently. | Punch list |
| 4 | P3 | A user mid-way through the **live** flow when the flag turns on restarts at V3's search-type screen (answers kept, one extra screen). Covered by design (`legacyKeys`). | Punch list |
| 5 | P3 | The invitation page says co-buyers "see each other's search preferences". In-app they see a count summary only, not itemized priorities (existing copy). | Punch list |
| 6 | P3 | The existing first-run mobile tour bubble ("Homes · 1 of 4") appears on My Homes right after the first Add Home, which is a little busy. | Punch list |
| 7 | P3 | In the browser QA only, the first ~200ms of some pages render blank while the server responds (the existing loading behaviour; native shows the boot screen). | Note |

**No P0/P1 issues were found:** no data loss, no authorization leak, no broken core flow.

## 6. V3 flag scope (`FLH_ONBOARDING_V3`)

| Surface | Flag ON | Flag OFF |
|---|---|---|
| `/onboarding` for new and in-progress accounts | V3 (flow 4): setup-path choice, Personalize or Quick Start, category screens, Review | Live flow 1 (Basics → What Matters → Rank) |
| Shared-search setup (invited co-buyer with a finished account) | V3 screens | Live flow |
| `/search/explore` and the My Search card | Present | Not found / hidden |
| Match empty-state wording (card and overlay) and the Quick Start saved line | Points to Explore | Original wording |
| Category polish (#190: copy, motion, haptics) | On the V3 screens | Not reachable |
| Finished accounts | Never re-routed | Never re-routed |
| **Not flagged** (already live since #188) | Native iOS welcome and share tutorial | Same |

**Persona matrix, ON and OFF (all ✅, database-verified):** new buyer, new renter and new apartment renter each get one search and the right flow, and V3 Quick Start writes no `dontcare`. The existing completed buyer goes straight to homes both ways. In-progress users:
- live-flow user → flag ON: continues in V3, budget and Fireplace kept;
- V3 user → flag OFF: the live flow takes over, budget and Walk-in Pantry kept.

In both cases there's no reset and no duplicate search. Invited co-buyer and Realtor are covered in §3. With the flag OFF, `/homes`, `/search`, `/search/priorities`, a home overlay, `/compare` and `/account` all render for a V3-onboarded account.

## 7. Regression and data safety

- **Unit tests:** `npm test`: **1,399 pass / 0 fail**. With real Postgres: **1,648 pass / 0 fail / 2 skipped**. `next build` passes. That includes 4 new tests (`test/v3-launch-readiness.test.js`), and two existing tests updated deliberately for the "View home" fix.
- **Earlier suites re-run on this branch:** native welcome (#188) **60/60**; onboarding paths (#189) **48/48**, including flag-off pixel identity of My Search, Rank Priorities and My Homes with `main`; motion stack (#190) **8/8**.
- **Onboarding visual safety net:** run in #190 (462/480 identical, the rest anti-aliasing). No onboarding file changed since.
- **Public homepage** vs `main` (flag off): fully identical in 1 of 3 runs. The other two each differed at a single, different viewport by 0.14% (font and image edges; visually identical). `main` against itself was identical twice. This branch changes no homepage, layout or landing code (`git diff`), and #190's CSS is scoped to onboarding classes. I'm recording it as capture noise under load rather than claiming byte identity this time.
- **Data:** Unknown ≠ No; skipped ≠ Not important; per-member co-buyer rows; Home Facts and own-answer precedence; search ownership and invitations; notes and saved facts; Realtor scope; the duplicate-listing guard. All were exercised above. No Match, scoring, catalog, tier or migration change. PR #166 and Floor Plans are untouched.

## 8. Launch readiness, recommendation, activation and rollback

**Checklist**
- [x] Both first-run paths work end to end, and Quick Start lands in Add Home
- [x] No misleading %, an optional path to priorities, Unknown ≠ No
- [x] Share hand-off keeps the listing through sign-in and onboarding; duplicate guard; no photo from paste (emulated)
- [x] Co-buyer independence, invitation routing, Realtor entry
- [x] Flag ON/OFF personas: no duplicate search, reset, lost preference or broken route
- [x] Flag-off Production unchanged (pixel checks)
- [ ] **Founder:** device checks (§9), especially first paint, the Share Extension and email-confirmation sign-up
- [ ] **Founder:** merge #190, then this PR (retargeted to `main` and re-verified)

**Recommendation: conditional GO.** Turn V3 on in **Preview** now. Turn it on in **Production** after #190 and this PR are merged and the §9 device checks pass. I found nothing that blocks launch in the web or app flows I could test; the remaining risk is in what only a real device and Production Supabase can show.

**Activate in Production**
1. Vercel → Project → Settings → Environment Variables → add `FLH_ONBOARDING_V3` = `on`, scope **Production** only.
2. **Redeploy** the current Production deployment: Deployments → … → Redeploy (the build cache can stay). Env changes apply only to new deployments. It's read on the server per request (not `NEXT_PUBLIC_`), so no rebuild of the app code is needed, and the iOS app needs **no update** (it loads the live site).
3. Verify after deploy, as a **new** test account in a private window: you get the two setup cards; Quick Start lands in Add Home; My Search shows Explore My Priorities; an **existing** account goes straight to My Homes. Then repeat the new-account check in the iOS app.

**Roll back**
- **Fastest:** Vercel → Deployments → the previous Production deployment → **Instant Rollback**. It restores that deployment, including its environment snapshot.
- **Or:** set `FLH_ONBOARDING_V3` to `off` (or delete it) → Redeploy.
- **What users see after rollback** (tested in §6):
  - people mid-V3 continue in the live flow with all answers kept;
  - finished accounts are unaffected;
  - Explore disappears (the harmless `priorities.explore` key is ignored);
  - nothing in the database needs undoing.

## 9. Founder-only checks (iOS device, Production services)

Use `docs/native-welcome-share-tutorial.md` §6b (separate worktree, `CAP_SERVER_URL` set to the Preview with `FLH_ONBOARDING_V3=on` for Preview).

1. **First paint:** the Xcode console shows `native flag set before first paint`, then `first-paint native flag confirmed`, with no homepage flash over three cold launches.
2. **Sign-up with Production-like Supabase:** if email confirmation is on, Get Started → "Check your email" → the link → back in the app/site. Confirm that you land in onboarding, and that a shared-listing sign-up still ends on that listing.
3. **Share Extension, for real:** Safari and Zillow → Share → Feels Like Home with the app terminated, backgrounded and open; signed out → sign up → onboarding → Add Home with the listing; the same listing again → opens the saved home.
4. **Universal Links:** an invitation link with the app terminated opens the invitation.
5. **Real lookup on Preview:** a listing URL fills in details (RentCast). Lookup limits still apply after several tries.
6. **Haptics:** a tick on each importance; one tap after finishing onboarding or Explore Done; none on navigation; none with System Haptics off; an older installed build works without them.
7. **VoiceOver, Larger Text, Reduce Motion** on the category screens, the importance sheet, Explore and the home Match.
8. **"View home" right after saving,** tapped immediately, on the phone: it opens the home.
