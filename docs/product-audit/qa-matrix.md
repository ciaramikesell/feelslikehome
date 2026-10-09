# QA matrix

None of these journeys has a recorded real-device or production run. Automated
coverage is noted per step; most of it is contract-level (source-text or DB), not
UI behaviour.

**Environments**
- **W:** desktop web (Safari + Chrome).
- **M:** mobile web (iOS Safari).
- **N:** native iOS app (TestFlight build on a physical iPhone; plus a small iPhone or SE if available).

**Accounts needed**
- Buyer A: new.
- Buyer B: existing account with its own homes.
- Buyer C: fresh account.
- Realtor R.
- Use test accounts only; never real users' data.

## Top 10 journeys

| # | Journey | Steps (abridged) | Expected | Automated coverage | Env |
|---|---|---|---|---|---|
| J-1 | Sign up → onboarding → first home | Landing → sign up → confirm email → Basics/What Matters/Rank → Ready → Add first home | Email arrives; onboarding resumes if interrupted; lands on `/homes` | onboarding-flow (U), onboarding-state-db (D), auth tests (S) | W M N |
| J-2 | Import from a listing URL | Paste Zillow / Redfin / Realtor.com / Homes.com / Apartments.com / Rent.com / unknown site URL | Address extracted; RentCast fills only empty fields; nothing saved until Save; unknown site degrades to manual | listing-autofill-v2, import-review (U) | W N |
| J-3 | Share from Safari/Zillow app → FLH | Share sheet → Feels Like Home → app opens `/homes?url=` | Opens the **app** (not Safari) with the add form prefilled; works signed out → after sign-in | ios-share-extension, universal-links (S) | N |
| J-4 | Priorities → Match → explanation | Edit basics/tiers/custom → open a home | Match updates; Unknown never counts against; must-haves met/missing/unknown listed | matching (U), match-scorer-parity (D) | W N |
| J-5 | Lifecycle | Favorite → Want to Tour → Toured (post-tour modal) → Archive with reason → Restore → Delete from Archive | Each state persists across reload and devices | lifecycle (U), save-reliability (S) | W N |
| J-6 | Compare + Map + Commute | Compare 2–4 homes; add Places; open Map | Differences toggle; commute minutes and max; map pins; unconfigured key shows a clear state | commute, map (U/S) | W N |
| J-7 | Invite co-buyer (**new** account) | A invites C → C signs up with the invited email → accepts | C joins A's search; independent priorities; A sees C's perspective in Compare | invitation-acceptance-db, cobuyer-journey-db (D) | W N |
| J-8 | Invite co-buyer (**existing** account B with own homes) | A invites B → B accepts → switch between searches | B's own homes are never lost and remain reachable; the switcher is clear; no stale lists after switching | ⟳ multi-search-invitation-db on `4168309` only | W N |
| J-9 | Realtor flow | R signs up via `/for-realtors` → invites A (or starts a prospective search) → A confirms → R suggests a home, writes a note, suggests a tour → A promotes or dismisses | Permissions hold (R can't edit buyer state); staged suggestions aren't contenders until promoted | realtor-* tests (S), cobuyer/production-drift DB tests | W N |
| J-10 | Account & resilience | Edit name; sign out/in; password reset; airplane mode in the native app; VoiceOver + largest Dynamic Type on the main screens | No blank screen offline; readable at large text | auth tests (S), accessibility-ux (S) | N |

## Negative and edge cases

| # | Case | Expected |
|---|---|---|
| E-1 | Accept an invite while signed in as the wrong email | `wrong_account` message; no membership |
| E-2 | Accept an expired (> 7 days) or already-accepted invite | Clear refusal |
| E-3 | Owner invites themself | `self_invite` refusal |
| E-4 | Second co-buyer invitation | **Current behaviour: allowed.** After P1-01 (D-07): refused with `co_buyer_limit`, including two concurrent acceptances |
| E-5 | Realtor tries to edit a home / state via the UI | No edit affordance; RLS refuses |
| E-6 | Import with a RentCast 429 / missing key | Friendly message; manual entry still possible |
| E-7 | Commute with an unresolvable address | Per-address "ambiguous / invalid" state, no crash |
| E-8 | Photo picker → **Take Photo** in the native app | **Expected crash today** (no `NSCameraUsageDescription`). Verify, then fix in A7 |
| E-9 | Universal Link with `www.` host | Not handled (exact host only). Confirm the desired behaviour |
| E-10 | Duplicate URL import | Exact-match duplicate warning |
| E-11 | Removed co-buyer reloads | Loses access; own search intact |
| E-12 | Beta feedback submit | Row stored; no error |

## Journeys added by the locked decisions (2026-10-09)

| # | Journey | Expected | Decision | Task |
|---|---|---|---|---|
| J-11 | Existing account (Ciara/Andrew pattern) accepts a co-buyer invite on the merged multi-search build; switch searches; kill and relaunch the app | Both searches intact and labelled; own preferences unchanged; shared-search setup only (no full onboarding); session persists | D-03 | P0-01 |
| J-12 | Owner sends an invitation by **email**; separately copies a link | Email arrives (Gmail, iCloud), not spam; link opens the app; UI says which action happened | D-08 | P1-03 |
| J-13 | Owner revokes a pending invite; invitee opens the old link | Refused as revoked; owner list updates | D-09 | P1-02 |
| J-14 | Co-buyer leaves with **retain**, then rejoins; another leaves with **delete** | Access revoked at once; retained data invisible to owner and Realtor; rejoin restores; delete leaves nothing | D-06 | P1-04 |
| J-15 | Owner with a co-buyer deletes their account (co-buyer also owns a primary search) | Co-buyer now owns the shared search plus their own; no merge; the deleted owner's personal data gone | D-05 | P1-06 |
| J-16 | Solo owner / Realtor with authored notes deletes their account | Disclosed deletion completes; the buyer keeps promoted homes | D-05 | P1-06 |
| J-17 | Full Onboarding V2 as: new account, invited new account, Realtor-started buyer | Each follows the C-06 routing table | D-02 | P2-01 |
| J-18 | Mark Offer Submitted → Under Contract; co-buyer and Realtor view | Search-wide badge; Realtor read-only; Match unchanged; archive warns | D-15 | P2-06 |
| J-19 | Native offline: airplane mode at cold launch; server 5xx; Retry | Branded offline screen; Retry recovers | D-17 | P3-03 |
| J-20 | Send Feedback from Account | Stored; no floating tab anywhere | D-11 | P3-05 |
| J-21 | FLH+: post-cutoff account adds home #3; buys (sandbox); restores on a second device; refund | Blocked → purchase unlocks → restore works → refund revokes; grandfathered account never blocked | D-01, locked 1–7 | P4-02…P4-05 |
| J-22 | Co-buyer with FLH+ unlocks collaboration on the owner's search; Realtor never unlocks | Per-search unlock only | locked 4, 5 | P4-02 |

## Edge cases added by the locked decisions

| # | Case | Expected |
|---|---|---|
| E-13 | Email bounce / provider outage | Send failure shown; Copy link still works |
| E-14 | Duplicate invite to the same email and search | The existing pending invite is reused and refreshed; no second row |
| E-15 | Wrong-account recovery after an emailed invite | Clear "sign in as <email>" path |
| E-16 | Account deletion retried after a partial failure | Completes idempotently |
| E-17 | Restore of a purchase owned by another FLH account | Account-state message; never reassigned |
| E-18 | App rate limit hit on import or commute | Friendly 429; manual entry still possible |

## Device and release checklist (from `docs/native-device-qa.md`, condensed)

- Cold launch signed in and signed out.
- Session persists after an app kill.
- Universal Link: cold and warm launch.
- Share Extension from Safari and from the Zillow app.
- Keyboard covering inputs; sheet scrolling; safe areas (notch, home indicator).
- Status bar contrast.
- Orientation (portrait lock?).
- Small screen (SE / mini).
- iPad: **native app is iPhone-only (D-04).** Check that iPad Safari web access still works.

## Results log (fill in)

| Date | Build | Journey | Env | Result | Notes / issue link |
|---|---|---|---|---|---|
| | | | | | |
