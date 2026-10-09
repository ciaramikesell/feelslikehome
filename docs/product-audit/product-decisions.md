# Product decisions — LOCKED

**Status:** all 18 decisions raised by the 2026-10-09 audit are now **APPROVED PRODUCT
DIRECTION**. The product owner locked them on 2026-10-09. Together with the 10
rules locked on 2026-10-07, they define the intended V1.

**How to read this document:**
- An approved decision says what FLH will do. It is **not** evidence that anything is
  built. Implementation status stays in [feature-inventory.md](feature-inventory.md)
  and changes only with code evidence.
- Where a decision meets an existing implementation constraint, the conflict and a
  *recommended* engineering approach are in
  [decision-implementation-conflicts.md](decision-implementation-conflicts.md).
  Those recommendations still need technical validation and, where they touch
  production SQL, the owner's explicit approval.
- The original audit's recommended defaults (2026-10-09, `main` @ `9032151`) are kept
  in the history section at the end, for traceability. **They are superseded.**

## Approved decisions (2026-10-09)

### Round 1 — Launch strategy

| ID | Decision | Status | Approved direction | Supersedes original recommendation |
|---|---|---|---|---|
| D-01 | Launch | **APPROVED** | Free internal **and** external TestFlight beta. **The public App Store release includes FLH+.** TestFlight must not rely on a fragile client-side payment bypass; it uses a controlled beta/grandfathered entitlement model. The earlier locked FLH+ rules stand | "Free App Store launch first, FLH+ later" |
| D-02 | Onboarding | **APPROVED** | **The full Onboarding V2 is complete before external TestFlight.** Sequence: Welcome → Who → Basics → Locations → Priorities → Tour Discoveries → Import lesson → Match reveal → Homes + Get Started. Reuse the existing preference and Match logic. Already-onboarded users who accept an invitation are **not** forced through full onboarding | "Welcome + share lesson only before launch" |
| D-03 | Multi-search | **APPROVED** | Verify the existing-user invitation/multi-search repair **on both real accounts** before beta. Personal and shared searches are preserved independently. Test active-search switching, saved homes, personal preferences, invitations and session persistence. Never silently merge searches or overwrite personal data | (Was "merge after review + QA"; now also requires real-account QA on both accounts) |

### Round 2 — Accounts and collaboration

| ID | Decision | Status | Approved direction | Supersedes original recommendation |
|---|---|---|---|---|
| D-05 | Account deletion & shared-search preservation | **APPROVED** | When a search owner deletes their account, **the shared search is preserved automatically for the remaining eligible co-buyer**, with ownership transferred safely. Searches are never merged. The deleted owner's private personal data is **not** retained just because the search survives. If no eligible buyer remains, a clearly disclosed deletion path applies. **Safe succession must be designed for when the co-buyer already owns a search** (the `unique(user_id)` constraint). Constraint, RLS, ownership-RPC and data-migration work are explicit implementation tasks that need approval | "Delete the owner's search; members lose access; no transfer" |
| D-06 | Leaving a search | **APPROVED** | The departing member chooses **(a) leave and retain** their personal preferences and reactions for a possible rejoin, or **(b) leave and permanently delete** their personal data for that search. Access is revoked immediately. Retained data is **not visible to other members** while the person is absent. Account deletion is separate and permanently deletes the user's personal account data. Retention, rejoin and edge cases are documented (see conflicts doc C-03) | "Retain on leave; delete only on account deletion" |
| D-07 | Co-buyer limit | **APPROVED** | V1 = one owner + **one co-buyer** + the existing Realtor role. Enforced **at the database/acceptance boundary, including concurrent acceptance**. Realtor permissions are unchanged. Multiple co-buyers are post-launch | Same direction; adds the concurrency requirement |
| D-08 | Invitation delivery | **APPROVED** | **Both transactional invitation email and a copyable link**, for co-buyer and Realtor flows as appropriate. The UI must clearly distinguish *sending an email* from *copying a link*. QA covers delivery failures, expired links, duplicate invitations and wrong-account recovery. **An email provider decision and integration are required** | "Relabel to Copy link now; email post-launch" |
| D-09 | Invitation revocation | **APPROVED** | Owners can view and revoke pending invitations **before beta**. The server/database rejects revoked invitations even when the original link is opened. Email binding and expiry rules are preserved | Same direction |

### Round 3 — Native experience

| ID | Decision | Status | Approved direction | Supersedes original recommendation |
|---|---|---|---|---|
| D-04 | Supported devices | **APPROVED** | **iPhone-first native V1.** Dedicated iPad support comes after public launch. Browser access from iPads is not intentionally broken. This requires `TARGETED_DEVICE_FAMILY` changes in Xcode and iPhone-only App Store screenshots | Same direction |
| D-11 | Feedback | **APPROVED** | Remove the floating Beta Feedback tab. Keep a discoverable **"Send Feedback"** entry in Account. The existing submission flow is preserved. Available during TestFlight **and** the public release | Same direction |
| D-17 | Offline behavior | **APPROVED** | A **branded FLH offline screen** with a working **Retry**. It must work when the remote website cannot load. Offline home caching is not required for V1 | Same direction, more specific |
| D-18 | Native architecture | **APPROVED** | **Keep the Next.js + Capacitor remote-hosted architecture.** Improve purposeful native behaviours: loading, safe areas, keyboard, navigation, share handoff, offline recovery. **No full Swift rewrite.** App Review 4.2 considerations are documented without implying approval is guaranteed | "Ship with a review note; add native only if rejected" |

### Round 4 — Operations, privacy and lifecycle

| ID | Decision | Status | Approved direction | Supersedes original recommendation |
|---|---|---|---|---|
| D-10 | Monitoring | **APPROVED** | **Production error monitoring before beta.** Product analytics may follow, ideally aligned with onboarding and FLH+ measurement. Privacy implications and sensitive-data redaction are documented | Same direction |
| D-12 | API spending | **APPROVED** | Provider-side quotas, budgets and alerts, **plus application-level rate limits** on the paid external API routes. Evaluate caching where useful. **Budget alerts are not hard spending caps** | Adds app-level limits before beta, not just before L3 |
| D-13 | Legal policies | **APPROVED** | Draft an FLH-specific Privacy Policy and Terms from the **verified** data flows. Obtain appropriate review before public publication. Generated language is **never** presented as attorney-approved. Include account deletion, retention, sharing, service providers and purchase disclosures as applicable | Clarified authorship |
| D-14 | Support | **APPROVED** | A dedicated support email and a public `/support` page, linked from the app, website and App Store metadata. **The mailbox is not assumed to exist until configured and verified** | Same direction |
| D-15 | Home lifecycle | **APPROVED** | **Add basic "Offer Submitted" and "Under Contract" statuses in V1.** Existing states and history are preserved. The smallest coherent design is recommended (see conflicts doc C-07). **Out of scope:** contracts, escrow, documents, contingencies and closing management | "Keep 4 statuses for V1" |
| D-16 | Display-name privacy | **APPROVED** | Restrict `resolve_display_name` and related lookups to **authorized relationships**. Audit callers and permission boundaries. Prepare a narrowly scoped migration plan, **not executed** | Same direction |

## Previously locked product rules (2026-10-07) — preserved, not reopened

These are restated verbatim in substance. Nothing in the 2026-10-09 decisions
contradicts them. D-01 relies on rules 2, 3 and 7 and makes them more specific.

| # | Rule | Code today (evidence, not a change) |
|---|---|---|
| 1 | **FLH+ is a permanent purchaser entitlement, not a subscription.** Planning price **$9.99 lifetime**, subject to App Store Connect configuration | Not built (PAY-001…) |
| 2 | **Homes #1–2 free; #3 and later require FLH+** under the entitlement rules | Not built |
| 3 | **One meaningful collaborative loop is free** | Not built. The server-side definition is open (conflicts doc Q-07) |
| 4 | **Collaboration unlocks per search** when an eligible *buyer* participant has FLH+. Realtors never unlock and never need FLH+ | Not built |
| 5 | **Realtors remain free** | True today (no billing code) |
| 6 | **Pre-monetization accounts receive a persisted grandfathered entitlement** | Not built |
| 7 | **Purchases and restores are verified server-side; refunds/revocations are handled; no silent entitlement transfer between accounts** | Not built |
| 8 | **Unknown property facts never count as failed preferences** | Built (`matching.js` + SQL mirror). Known SQL drift on legacy alias folding: see discrepancy R-1 |
| 9 | **Match distinguishes pre-tour information from after-tour discoveries** | **Not yet true in code.** After-tour answers currently blend into the same %. See discrepancy R-2 |
| 10 | **Buyer preferences stay individually owned; Realtors suggest rather than silently adding contenders; no Realtor impersonation; buyers control suggestion promotion; another participant's private preferences are never copied automatically** ("Add to mine" is explicit only) | Built: own-row RLS, staged suggestions, buyer promotion. The Realtor-drafted priorities in prospective searches are written only on the buyer's explicit confirm |

### Rule ↔ code discrepancies (reported, not altered)

- **R-1 (rule 8):** the SQL scorer does not apply `PURCHASE_LEGACY_LABEL_ALIASES` folding, and it skips retired keys that a buyer entered as a custom criterion. Legacy priority documents can therefore score differently in JS and SQL. Rule 8 itself holds (Unknown is excluded in both). Scheduled for the Match-semantics task (roadmap P2-03).
- **R-2 (rule 9):** tour responses feed the same Match % as pre-tour data. The rule is approved but not implemented; the code is not wrong relative to what has been built. Scheduled for P2-03.
- **R-3 (rules 4/6 × D-05):** automatic ownership succession must **not** move an entitlement. If the deleted owner was the only FLH+ holder on a shared search, the surviving co-buyer's search can lose its collaboration unlock. That is the correct consequence of rule 7, but it is a product-visible edge case. **Owner decision needed:** conflicts doc Q-05.
- **R-4 (D-01 × rule 6):** if the grandfathering cutoff is the public-launch moment, every TestFlight tester is grandfathered and the paywall cannot be exercised with ordinary tester accounts. The cutoff definition needs an explicit owner choice: conflicts doc Q-06.

## Open implementation-rule questions

These are *not* reopened product decisions. They are rules the approved decisions
leave unspecified, which engineering cannot settle alone. Full context and
recommended defaults are in
[decision-implementation-conflicts.md](decision-implementation-conflicts.md#owner-questions).

| ID | Question | Arises from |
|---|---|---|
| Q-01 | Succession when the co-buyer already owns a search: allow a second *owned* (non-primary) search, or something else? | D-05 |
| Q-02 | What happens to shared homes *created by* a departing or deleted member: stay with the search (attributed to "former member") or go? | D-05, D-06 |
| Q-03 | Does a Realtor ever count as an "eligible" successor? (Recommended: no, buyers only) | D-05, D-07 |
| Q-04 | Retention period for "leave and retain" data (indefinite until account deletion, or time-boxed)? | D-06 |
| Q-05 | After succession, if no remaining buyer has FLH+, is the collaboration unlock lost, or kept for that search? | D-05 × rule 4/7 |
| Q-06 | Grandfathering cutoff and beta-grant model (single cutoff vs cutoff + beta allowlist) | D-01 × rule 6 |
| Q-07 | Exact server-side definition of the "one free collaborative loop" | rule 3 |
| Q-08 | Who may set Offer Submitted / Under Contract: buyers only, or Realtor too? (Recommended: buyers only) | D-15 |
| Q-09 | Email provider and sending domain | D-08 |
| Q-10 | Do staged Realtor suggestions count toward the 2-free-homes cap? (Recommended: no, until promoted) | rule 2 |

## History — original audit recommendations (superseded)

The table below is kept unchanged from the 2026-10-09 audit (PR #138) so the
reasoning stays traceable. **It is not current direction.**

| ID | Original recommended default |
|---|---|
| D-01 | Free first, FLH+ later |
| D-02 | Share lesson + one welcome screen, rest post-launch |
| D-03 | Merge after its own review + manual QA |
| D-04 | iPhone-only for 1.0 |
| D-05 | Delete the owner's account and owned search; members lose access; no transfer |
| D-06 | Delete on account deletion; retain on leave |
| D-07 | Enforce max 1 co-buyer now |
| D-08 | Relabel to "Copy invite link" now; email post-launch |
| D-09 | Add revoke now |
| D-10 | Error monitoring now; analytics with FLH+ |
| D-11 | Rename to "Send feedback", move to Account |
| D-12 | Provider quotas before L0; app limit before L3 |
| D-13 | Owner's call; reviewed template minimum |
| D-14 | Support email + `/support` |
| D-15 | Keep 4 statuses for V1 |
| D-16 | Restrict |
| D-17 | Add offline fallback |
| D-18 | Ship with a review note |
