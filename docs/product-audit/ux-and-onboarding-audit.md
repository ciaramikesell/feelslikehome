# UX & onboarding audit

This audit is based on reading the code and copy on `main` @ `9032151`.
**No live-device or usability session was run.** Every UX judgement below is a
hypothesis to confirm in QA.

## 1. First-run journey (as built)

```
Landing ("Create a free account")
  → Sign up (first/last name, email, password) → confirm email → /auth/callback
  → /onboarding (V1):
      Basics (search type, budget, beds, baths, sqft, lot, types, layout, condition)
      → What Matters (suggested chips, custom, garage)
      → Rank (drag board)
      → Ready ("Your search is ready": Add your first home | View My Search)
  → /homes (empty state: "You found the homes. We'll help you choose.")
```

**Strengths**
- It is short: three steps.
- Basics only blocks on search type.
- Progress resumes, and is saved when the app backgrounds.
- The name is captured at sign-up and never asked for again.

**Gaps against the locked V2 sequence**

| Target step | Today | Gap / risk |
|---|---|---|
| Welcome / value | Absent | The first screen is a form. Users never hear the "why" (Match, Unknown ≠ No) before giving data |
| Who are you searching with | Absent (answer storage exists) | A co-buyer can only be invited later, from My Search. The locked decision puts collaboration first |
| Basics | Present | Matches the locked semantics (budget max; beds/baths "at least") |
| Ranked location areas | Absent | Places (commute) exist outside onboarding; there are no areas or ranks |
| Priorities | Present (What Matters + Rank) | OK |
| Tour Discoveries concept | Absent | Post-tour capture exists but is never introduced |
| Import / share lesson | Absent | The Share Extension is the strongest native feature but is undiscoverable without teaching |
| First Match reveal | Partial | The Ready screen sends people to "Add your first home". The match appears on the card with no moment around it |
| Homes + Get Started | Partial | No checklist |

**Update 2026-10-09 (D-02, APPROVED):** the **full** V2 sequence must ship before external TestFlight. Already-onboarded users accepting invitations must not be forced through it. The entrant-by-entrant routing (new account, invited new account, existing account, Realtor-started buyer, Realtor) is specified in [decision-implementation-conflicts.md, C-06](decision-implementation-conflicts.md#c-06--onboarding-v2-vs-existing-user-invitation-continuation) and scheduled as roadmap P2-01…P2-05.

*Original text (superseded):* V2 was paused; only a share lesson and a welcome screen were recommended before launch.

## 2. Co-buyer journey

**As built on `main`:**
1. The owner opens My Search → Invite → picks Co-buyer or Realtor → copies the link and sends it themself.
2. The invitee opens the link → signs in or up with the invited email → accepts.

**Problems (fixed on `4168309`, ⟳ in flight, unmerged):**
- An existing account accepting an invite was routed through the *full account*
  onboarding instead of a shared-search setup.
- The tiny "My Search / Shared Search" select made the person's own search appear lost.
- Switching left stale client state on screen.

**Remaining UX gaps after that fix:**
- **No email.** The copy says "Send connection request", but nothing is sent.
  Users must paste the link themselves. **D-08 (APPROVED): ship both email delivery and a copy link, clearly distinguished** (P1-03).
- **A pending invite cannot be cancelled** (COLLAB-009).
- **An already-onboarded co-buyer starts with an empty priority document on the
  shared search,** so their Match is empty. The planned explicit "bring over my
  preferences" copy is not built (COLLAB-014).
- Collaborator perspective is summarised (match %, feeling, signals). There is
  no comment thread (COLLAB-012), and no realtime updates, so a refresh is
  needed (COLLAB-013).

## 3. Realtor journey

- **Realtor sign-up** via `/for-realtors`, then:
  - `/realtor` (connect to an existing buyer, or invite a new one);
  - `/people` (roster);
  - `/people/[searchId]` (a read-mostly view of the buyer's search).
- Realtors can:
  - suggest homes (staged until a buyer promotes them);
  - write private-to-the-search notes;
  - suggest tours.
- **Realtor-started searches:** the Realtor drafts the buyer's priorities. The
  buyer confirms them at `/invite/[token]/confirm`. A buyer without a search gets
  `search_not_ready`.
- **Gaps:**
  - no email notification to buyers;
  - no tour scheduling;
  - no Realtor dashboard of "what changed since last visit".
- **Production:** these objects were missing in production before the drift
  repair. Re-verify (REALTOR-006/007).

## 4. Core loop UX notes (static review)

| Area | Observation | Suggestion |
|---|---|---|
| Import | The copy names Zillow, Redfin, Realtor.com and "any listing site". Only the listed sites get explicit parsing; others fall back to generic address extraction | Keep the copy as is (no Trulia mention, which is correct). Show a helpful failure message for unparseable URLs (verify in QA) |
| Import failure | A RentCast 429 or a missing key surfaces as an import error | Make sure the message invites manual entry (QA) |
| Statuses | Saved / Want to Tour / Toured / Archived | Offer and closing states are missing. Fine for V1; parking lot |
| Match | The explanation lists must-haves met, missing and unknown | The "Pre-tour" label (locked decision 7) is not built |
| Compare | Up to 4 homes, differences-only | Good |
| Map | Needs a browser key **and** a Map ID; otherwise shows "unconfigured" | Verify the production env |
| Account | Name only; no deletion, email change or data export | Deletion is required for the App Store |
| Feedback | A floating Beta Feedback tab on every page | **D-11 (APPROVED):** remove the floating tab; add "Send Feedback" in Account (P3-05) |
| Dark mode | None | iOS users in dark mode get a light WebView. Acceptable for V1; list in the parking lot |
| Accessibility | Source-text checks only | Run a VoiceOver and Dynamic Type pass on a device (QA matrix J-10) |

## 5. Landing pages

- **`/` (`PublicLanding`):** the claims (Match Scores, comparison, commute,
  buyers / co-buyers / Realtors) all exist in code. It says "free". It has no
  privacy, terms or support links, and no App Store badge.
- **`/for-realtors`:** collaboration copy only. No pricing claims.
- **Needed before L2/L3:** footer links to a privacy policy, terms and support.

## 6. Decision-lock UX implications (2026-10-09)

| Decision | UX surface | Notes |
|---|---|---|
| D-05 | Account → Delete account | Disclosure must name the surviving co-buyer ("<Name> will keep this shared search") or list what is deleted when no successor exists |
| D-06 | Leave search sheet | Two explicit choices with plain consequences; owners see "Delete account" instead of Leave |
| D-07 | Invite screens | `co_buyer_limit` copy for owner and invitee |
| D-08/D-09 | Invite screens | Separate **Send email** and **Copy link**; pending list with Revoke; send-failure state |
| D-15 | Home card / detail / Compare | Search-wide "Offer submitted" / "Under contract" badge; buyers set it, Realtors see it |
| D-17 | Native | Branded offline screen with Retry instead of a blank WebView |
| D-01 | Paywall | Copy must stay consistent with "Create a free account" (free tier) |
