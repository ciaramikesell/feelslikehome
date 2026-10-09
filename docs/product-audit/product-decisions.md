# Product-owner decisions

The audit did **not** resolve any of these. Each has a recommended default that
the owner can accept or override. Decisions already locked on 2026-10-07
(`docs/onboarding-v2-product-evolution-audit.md`, Part 4) are listed at the end
and are not reopened.

## Open decisions

| ID | Decision | Options | Recommended default | Why | Blocks |
|---|---|---|---|---|---|
| D-01 | What is the first public launch? | (a) Free App Store launch, FLH+ later · (b) Launch with FLH+ | **(a) Free first** | FLH+ is not started (XL). Every App Store blocker is S–M. Grandfathering (locked) rewards early users | Roadmap A vs B |
| D-02 | Any Onboarding V2 pieces before launch? | none · welcome + share lesson only · full V2 | **Share lesson (static help page) + one welcome screen**, the rest post-launch | Cheap, and it teaches the native differentiator | ONBOARD-004/008 |
| D-03 | Merge the in-flight multi-search fix (`4168309`) before the beta? | merge · hold | **Merge after its own review + manual QA** | It fixes the "my search disappeared" incident | SEARCH-002, COLLAB-003/004 |
| D-04 | iPad | ship universal · iPhone-only | **iPhone-only for 1.0** (`TARGETED_DEVICE_FAMILY = 1`) | Avoids iPad screenshots and iPad QA; WebView layouts are phone-tuned | IOS-010 |
| D-05 | Account deletion semantics when the user owns a search others belong to | delete everything · transfer to a co-buyer · keep shared homes for remaining members | **Delete the owner's account and owned search; members lose access, after a clear warning listing them.** No transfer in V1 | Simplest correct behaviour; transfer conflicts with the one-owned-search constraint | AUTH-005 |
| D-06 | Removed / left members' personal data | retain · delete on removal · delete on account deletion only | **Delete on account deletion; retain on leave** (so a rejoin restores state), and disclose in the privacy policy | Balance between privacy and UX | INFRA-017 |
| D-07 | Co-buyer count | enforce max 1 · build multi | **Enforce max 1 co-buyer now** (acceptance RPC + UI); multi later | The V1 RPCs assume one; this prevents silent wrong perspectives | COLLAB-011 |
| D-08 | Invitation delivery | copy link (relabel UI) · transactional email | **Relabel to "Copy invite link" now; add email post-launch** | No email provider exists; honest copy costs nothing | COLLAB-010, NOTIFY-002 |
| D-09 | Revoke invitations | add now · later | **Add now** (small) | Wrong-address sends are common | COLLAB-009 |
| D-10 | Error monitoring + analytics vendor | none · Sentry-type only · Sentry + product analytics | **Error monitoring now; product analytics with the FLH+ work** | Monitoring protects launch; analytics affects the privacy label and needs a paywall funnel to matter | INFRA-007/008 |
| D-11 | Beta Feedback tab in the public App Store build | keep · hide in native · rename "Send feedback" | **Rename to "Send feedback", keep it in Account, remove the floating tab** | A floating "Beta" tab can read as unfinished to reviewers | INFRA-014 |
| D-12 | Spend protection for RentCast / Google | provider quotas only · app rate limit | **Provider quotas/budgets before L0; app-level limit before L3** | Fast and cheap first step | INFRA-010 |
| D-13 | Privacy policy / terms authorship | template + review · counsel | Owner's call. **At minimum a reviewed template that names Supabase, Google and RentCast** | Required for L2 | RELEASE-001/002 |
| D-14 | Support channel | email · web form | **A support email + `/support` page** | Required URL | RELEASE-003 |
| D-15 | Offer / under-contract statuses | add · keep 4 | **Keep 4 for V1** | Not needed to choose a home; parking lot | HOMES-007 |
| D-16 | `resolve_display_name` scope | restrict to related users · keep | **Restrict** (small SQL change, requires a production migration with approval) | Privacy label accuracy | INFRA-012 |
| D-17 | Native offline screen | add · rely on WebView error | **Add** a minimal native or offline fallback | Reviewers test in airplane mode | IOS-009 |
| D-18 | Remote-hosted app vs App Review 4.2 | ship as is with a strong review note · add a native feature | **Ship with a review note** emphasising the Share Extension, Universal Links and account workflow; revisit only if rejected | Avoids speculative native work | IOS-011 |

## Already locked (2026-10-07) — not reopened

1. V2 sequence: Welcome → Who → Basics → Locations → Priorities → Tour Discoveries → Import lesson → Match reveal → Homes + Get Started.
2. FLH+ is a permanent purchaser entitlement. Collaboration unlocks per search if any buyer participant owns FLH+. Realtors are free.
3. iOS IAP first. A scoped server privileged key is used only for entitlement writes, restore and refunds.
4. No silent purchase transfer on restore.
5. Homes #1–2 free, #3+ FLH+. One full collaborative loop is free.
6. Location rank is a label, not a weight.
7. After-tour separation ("Pre-tour" Match).
8. Grandfather all pre-monetization accounts with a persisted entitlement.
9. Unknown ≠ No.
10. No impersonation. "Add to mine" copies only on explicit action.
