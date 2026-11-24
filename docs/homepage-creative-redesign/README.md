# Public homepage creative redesign: founder review guide

**Status:** draft. Not merged or deployed. Needs founder approval.
**Supersedes:** PR #204 (built on its branch, so it keeps #204's approved image assets).

## What changed and why

| Before (#204) | Problem | Now |
| --- | --- | --- |
| The hero photo faded into a flat beige column. Small headline, nothing explaining the product. | Pretty, but you couldn't tell what FLH does. | The same **Warm Cottage** photo sits in a large frame with a soft arch at the bottom left. The headline is bigger and more confident, with one supporting line under it. A small **"How this one fits you"** card, marked with a discreet *Example* tag, sits on the photo: Front porch ✓, Mature trees ✓, Garage *Not listed yet*, then *"Unknown isn't no."* It explains the product, and its core principle, in about two seconds. |
| How It Works: three small cards floating in an empty band, plus small Previous/Next controls and 3px dots. | Too small to read, looked disconnected, and felt like a slide deck. | **One large product story.** There are four clear, numbered steps (desktop: a vertical list; mobile: a 4-up segmented control). Each step changes a large tinted stage that holds the approved artwork. Each step gets its own tint (peach, wheat, sage, apricot), so switching steps reads as a real change. |
| Page ended straight into the footer. | No final invitation. | **A closing invitation in terracotta.** "Your shortlist deserves *a closer look.*" plus the sign-up CTA, a Realtor link, and three fanned home photos from the approved artwork. |

The page is still short: **Hero → How it works → Closing invitation → Footer.**

## The four steps (copy)

1. **Rank what matters.** Pick the features you care about, then decide how much each one matters to you.
2. **Save homes from anywhere.** Paste a listing link from any site and keep every contender in one place.
3. **See your personal Match.** Each home is measured against your priorities. Facts that aren't listed yet stay unknown, because unknown isn't no.
4. **Decide together.** Invite a co-buyer or your Realtor. Everyone keeps their own priorities and their own Match.

Product-truth guardrails kept: FLH doesn't find listings, unknown facts aren't mismatches, and Ciara and Andrew get separate Matches with no combined score. The "illustrative mockups / no affiliation" note stays.

## Interaction

- **No autoplay and no parallax.** Nothing moves unless the visitor acts. The one exception is the hero fit-card, which fades up once on load.
- The step tabs follow the WAI-ARIA tabs pattern. Arrow keys (all four), Home and End move between steps. Only the selected step is in the Tab order, and focus rings are visible.
- On touch screens, swiping the stage left or right changes the step.
- When a step changes, the panel fades and rises, then the cards inside arrive one after another. Buttons respond to hover and focus, and the CTA arrow nudges on hover.
- `prefers-reduced-motion` turns off every animation and transition on the page.
- The tabs only become interactive in a normal browser. The existing bridge/flag detection (`isNativeApp` + `data-flh-native`) is unchanged, and the native app still hides this whole page and shows its own welcome.

## Things to decide

The overall direction is approved. Final refinements in this round:

1. The hero supporting line is now: "Save the homes you love, see how they match what matters, and decide together."
2. The hero priority card has a discreet **Example** tag beside its title. "Unknown isn't no." stays.
3. The mobile step navigation was checked at 320 and 375 px:
   - Targets were already fine: 67×66 px at 320, 80×66 px at 375, with a 4 px gap.
   - The one change: step labels used to shrink to 10.5 px at 320. They're now a fixed 12 px, and every label still fits its tab.
   - The card header is tightened on phones so the title and the Example tag stay on one line.

Layout, illustrations, imagery, typography and interactions are otherwise unchanged.

## Also fixed

On desktop, the closing and footer "Get started"/"Sign in" buttons used to open the account panel up in the masthead, off-screen. The page now scrolls up to the panel and puts focus in its first field.

## Evidence

Screenshots are from a local **production build** (`npm run build && next start`) at 2× device scale, in `screenshots/`:

- Full page: `home-1440.jpg`, `home-1024.jpg`, `home-768.jpg`, `home-390.jpg`, `home-375.jpg`, `home-320.jpg`
- Every step: `step-{1..4}-1440.jpg`, `step-{1..4}-390.jpg`
- Native shell still shows its own welcome: `native-welcome-390.jpg`

Before (#204): `../homepage-final-four-columns/approved-implementation/screenshots/website-{1440,1024,768,390,320}.png`

Page height (CSS px): 1440 → 2,575 · 1024 → 2,209 · 768 → 2,795 · 390 → 2,353 · 375 → 2,313 · 320 → 2,324.

Checks:

- `npm run build`: passed.
- `npm test`: **1,418 / 1,418** passed. Homepage tests were rewritten for the new structure. They cover the tabs semantics, native exclusion, approved assets, the unknown-isn't-no principle, page length, and banned claims.
- `node scripts/qa/homepage-creative-redesign.mjs`: **81 / 81** browser checks passed at 1440, 1024, 768, 390, 375 and 320 (`browser-results.json`). It checks:
  - no horizontal overflow at any width
  - the cottage photo renders at every width
  - no live text below 10.5px
  - tabs are at least 44px; on mobile, step labels are at least 12px, fit their tab and keep a gap between targets
  - the Example tag shows and the card header stays on one line
  - no console errors
  - every step selects exactly one panel
  - keyboard roving focus, focus ring, and Tab leaving the tablist
  - touch swipe
  - reduced motion
  - the native bridge hides the page
  - the Realtor link, hero CTA, closing CTA focus handoff, and the mobile sign-up and menu links

Not verified:

- **No-JS:** Next streams this dynamic route inside hidden wrappers that JavaScript reveals, so a full no-JS page isn't established. This was already true and was noted in #204. The component still ships a `<noscript>` rule that would show all four steps.
- Physical iPhone / VoiceOver and Safari rendering.
- An automated axe audit. axe isn't a dependency, and none was added.

## Scope

Changed: `PublicLanding.jsx`, `PublicHomeFeatures.jsx`, `PublicFeatureArtwork.jsx` (now exports `SourcePhoto`), and the homepage block of `globals.css`. Shared header, button and footer rules used by the Realtor page are untouched. Also two homepage test files and the new QA script.
Untouched: onboarding, Match scoring, auth, iOS/Capacitor detection, paywall, database, Realtor page, Floor Plans, and PRs #166, #198, #205, #206. No new dependencies.
