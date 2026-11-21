# UX: Implement Approved Homepage Feature Showcase

Implements the founder-approved static prototype across all four website feature slides, following the latest approval comment. Desktop keeps the borderless ~40/60 composition with enlarged layered artwork and copy/navigation together; mobile places artwork above copy and groups the visible Previous/Next buttons with the progress counter.

Includes the three requested finishes: tighter desktop vertical rhythm, a closer mobile navigation zone, and a smaller, muted shared disclaimer. Reuses the original approved photos, feature copy, separate fictional Match results and exact filled/outlined Ciara/Andrew hearts. No generated artwork, new outer frame, autoplay or dependency.

The accessible carousel retains swipe, buttons/indicators, keyboard focus and Left/Right/Home/End navigation, reduced motion, resize handling and a static component fallback. Native iOS remains excluded through the existing bridge/runtime flag; hero, branding, signup-first routing, footer, onboarding, Match, permissions and native configuration are unchanged.

Validation: production build; 48 focused tests; 1,418 unit tests; 1,671 PostgreSQL-enabled tests passed (two optional live RentCast fixtures skipped); full native bridge regression 61/61 passed. 446 browser assertions passed, with 2 SSR diagnostic observations recorded separately. Updated QA covers all eight requested widths, stationary focus/navigation, label clipping/overlap, 44px targets, actual prototype fonts and native exclusion. Exact final browser counts and all screenshots are in docs/homepage-final-four-columns/approved-implementation/README.md.

No-JS scope: the feature's static fallback is verified after completing Next's existing SSR stream wrapper in the isolated test. The dynamic root still needs JavaScript to reveal that wrapper; no routing/startup changes were made.

Full homepage captures at 1440px/390px and all four slide close-ups at both widths are included. Leave this PR draft and unmerged for final founder approval. No merge or deployment command performed.
