# UX: Editorial Sliding Feature Showcase

The public homepage now presents one editorial feature at a time, replacing the desktop/tablet columns and mobile-only carousel. Desktop pairs short copy on the left with a large floating visual on the right; mobile web places the visual above the copy. Progress, arrows/dots, touch swipe, keyboard navigation, reduced motion and a no-JS fallback are included, with no autoplay.

Artwork uses unchanged founder-approved photo pixels with careful DOM/CSS composition and legible HTML cards/labels. It removes baked-in backgrounds and browser framing while preserving all four concepts, fictional Match values and exact separate Ciara/Andrew heart states. No generated mockup bitmaps are shipped. The tall hero, small terracotta HOW IT WORKS heading, divider, brand, signup-first CTA and shared illustrative note remain unchanged.

The installed native runtime is explicitly excluded through the existing platform helper and bridge-driven flag at every width, including a late flag. Native retains its original static assets and welcome. No onboarding, Match, permission, native configuration or application functionality changes.

Validation: production build; 48 focused tests; 1,418 unit tests; 1,671 PostgreSQL-enabled tests passed (two optional live RentCast fixtures skipped); 326 showcase browser assertions across 320–1440px; 61 full native bridge regression checks passed. The legacy native QA harness now matches existing approved tutorial copy and the test server hostname; product/native code is untouched.

Screenshots, source-art provenance, design-comment reference and founder checklist: docs/homepage-final-four-columns/editorial-showcase/README.md.

Leave draft/unmerged for founder approval. No deployment command performed.
