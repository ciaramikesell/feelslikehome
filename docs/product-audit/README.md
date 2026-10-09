# FLH product, feature & launch-readiness audit (2026-10-09)

**Baseline:** `main` @ `9032151`. This is an audit only. No application code,
migrations, production data, pricing or payment configuration was changed.

| Document | What it answers |
|---|---|
| [executive-summary.md](executive-summary.md) | Where are we, and what should happen next? |
| [feature-inventory.md](feature-inventory.md) | What exists, layer by layer, with stable IDs and statuses (150 rows) |
| [launch-readiness.md](launch-readiness.md) | Blockers per milestone (web beta → TestFlight → App Store → FLH+), plus hidden blockers |
| [ux-and-onboarding-audit.md](ux-and-onboarding-audit.md) | Journeys as built vs. the locked V2 sequence |
| [technical-and-security-audit.md](technical-and-security-audit.md) | Architecture, findings T-01…T-20, privacy inventory |
| [roadmap.md](roadmap.md) | Roadmap A (minimum reliable launch), B (ideal V1), C (post-launch) |
| [product-decisions.md](product-decisions.md) | Open decisions D-01…D-18 with recommended defaults; locked decisions |
| [qa-matrix.md](qa-matrix.md) | Top 10 journeys, edge cases, device checklist, results log |
| [ideas-parking-lot.md](ideas-parking-lot.md) | Every unbuilt idea (FUTURE-001…048) and why it is parked |
| [audit-evidence.md](audit-evidence.md) | Commands run, file:line evidence, read-only production checks, limitations |

## Status vocabulary

The statuses used throughout are:
- COMPLETE — VERIFIED
- BUILT — QA PENDING
- PARTIAL
- NOT STARTED
- DEFERRED
- SUPERSEDED
- UNKNOWN
- NEEDS VERIFICATION

Definitions are at the top of [feature-inventory.md](feature-inventory.md).

## In-flight work that may change these findings

Branch `claude/charming-bell-i0xo4w` @ `4168309` (the existing-user invitation +
multi-search fix) is **not merged**. Rows marked ⟳ in the inventory depend on it.
This audit did not modify any file that branch touches.

## Keeping this audit current

- Update a row's status only with evidence. Add that evidence to `audit-evidence.md`.
- Record device and production QA in the results log in `qa-matrix.md`. That is
  what moves rows to COMPLETE — VERIFIED.
- Re-run the status count command in `audit-evidence.md` after edits.
