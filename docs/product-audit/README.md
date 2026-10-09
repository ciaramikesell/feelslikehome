# FLH product, feature & launch-readiness audit

**Original audit:** 2026-10-09, `main` @ `9032151` (PR #138).
**Decision-lock refresh:** 2026-10-09, `main` @ `3651f7e`. All 18 product decisions are approved; the roadmap is rebased on them.

Both passes are documentation only. No application code, migrations, policies, RPCs,
native project files, environment variables, production data, pricing or payment
configuration were changed.

| Document | What it answers |
|---|---|
| [executive-summary.md](executive-summary.md) | Where are we, and what is the approved plan? |
| [product-decisions.md](product-decisions.md) | **All 18 decisions APPROVED**; the 10 earlier locked rules; rule↔code discrepancies; open implementation-rule questions |
| [decision-implementation-conflicts.md](decision-implementation-conflicts.md) | Where approved decisions meet the current code (C-01…C-10), new evidence N-1…N-10, owner questions Q-01…Q-10 |
| [roadmap.md](roadmap.md) | Phases 0–5 with task IDs, dependencies, effort, risk, gates; parallel tracks; critical path |
| [implementation-pr-sequence.md](implementation-pr-sequence.md) | Proposed small PRs (PR-01…PR-35). **Not implemented** |
| [launch-readiness.md](launch-readiness.md) | Gates G0 (dev/device) → G1 (internal TestFlight) → G2 (external TestFlight) → G3 (public with FLH+); platform-required vs FLH requirements |
| [feature-inventory.md](feature-inventory.md) | What exists, layer by layer (150 rows), plus the decision mapping. Statuses are evidence-based |
| [ux-and-onboarding-audit.md](ux-and-onboarding-audit.md) | Journeys as built vs the approved V2 sequence; UX implications of the decisions |
| [technical-and-security-audit.md](technical-and-security-audit.md) | Findings T-01…T-26; privacy inventory; redaction requirements |
| [qa-matrix.md](qa-matrix.md) | Journeys J-1…J-22, edge cases E-1…E-18, device checklist, results log |
| [ideas-parking-lot.md](ideas-parking-lot.md) | Unbuilt ideas FUTURE-001…048, and which are now scheduled for V1 |
| [audit-evidence.md](audit-evidence.md) | Commands, file:line evidence, read-only production checks, decision-lock evidence |

## Status vocabulary

Implementation statuses:
- COMPLETE — VERIFIED
- BUILT — QA PENDING
- PARTIAL
- NOT STARTED
- DEFERRED
- SUPERSEDED
- UNKNOWN
- NEEDS VERIFICATION

Decision status: **APPROVED**. That records product direction, never implementation.

## In-flight work that may change these findings

Branch `claude/charming-bell-i0xo4w` @ `4168309` (the existing-user invitation +
multi-search fix):
- **not merged**;
- tests 719/719 and build OK on 2026-10-09;
- no real-account QA.

Rows marked ⟳ depend on it. Neither audit pass modified any file it touches.

## Keeping this audit current

- Change an implementation status only with code or QA evidence, and add that evidence to `audit-evidence.md`.
- Log device and production QA in `qa-matrix.md`.
- Re-run the status-count command in `audit-evidence.md` after edits.
- Owner answers to Q-01…Q-10 go into `product-decisions.md`, with the date.
