# Onboarding V2 — final design decisions (2026-10-11)

These decisions come from the product owner, made during the Phase 1 review.
They **supersede** the sequences recorded in two earlier places:

- the D-02 row of `docs/product-audit/product-decisions.md`;
- locked decision 1 of `docs/onboarding-v2-product-evolution-audit.md`.

That earlier sequence was Welcome → Who → Basics → Locations → Priorities →
Tour Discoveries → Import lesson → Match reveal → Homes.

They record intent. **Phase 1 implements none of the new steps.**

## Decisions

1. **Maximum budget** is a directly editable currency field that formats itself
   automatically. There is no slider.
2. **Website and iPhone share one experience:** the same six-step sequence and the
   same underlying functionality. Only the layout adapts to the screen.
3. **The six numbered steps**, in this order:
   1. Basics
   2. Locations
   3. Collaboration
   4. Select Priorities
   5. Rank Priorities
   6. Review
4. **Unnumbered screens on either side of the steps:**
   - **Welcome** comes before the numbered steps.
   - **The first-home experience** comes after them: the import walkthrough, then the Match reveal.
   - **Tour education** happens later, in context. It is not an onboarding step.
5. **The desktop two-column shell** is still subject to visual approval. That is the
   layout from 960px wide, with the brand and progress on the left and the active
   step on the right.
6. **The native iPhone safe-area behaviour must not change without device testing.**
   This covers the body top inset, the status-bar guard, and the sticky and fixed
   bottom elements.

## Where the code differs today (to change in later phases, not in Phase 1)

| Area | Today | Decided |
|---|---|---|
| Live flow (`CURRENT_ONBOARDING_VERSION = 1`) | Basics → What Matters → Rank, then "Your search is ready" | The six steps above |
| Planned V2 flow (`ONBOARDING_FLOWS[2]` in `src/lib/onboardingFlow.js`) | welcome, collaboration, collaboration_intro, basics, locations, priorities, rank, tour_discoveries, import_lesson | Collaboration moves after Locations. Welcome stays outside the numbered steps. Tour Discoveries and the import lesson stop being onboarding steps. Review becomes a step |
| Budget input | Digits only, unformatted | Formatted currency field |
| Progress indicator | Counts the live flow (3) | Will count 6 once the steps exist. The shell already reads the real step count |

Changing `ONBOARDING_FLOWS[2]` is a logic change. It belongs to the phase that builds
the steps, together with tests that move people who are part-way through onboarding
across safely.
