# iOS safe-area contract

## Why
The Capacitor iOS WebView is edge-to-edge: Capacitor's default
`ios.contentInset` is `never`, the root layout sets `viewport-fit=cover`, and
the status bar is transparent over the page. Nothing in iOS keeps web content
out from under the clock / Dynamic Island. The page itself has to.

## One owner per region (see "Safe-area contract" at the end of `src/app/globals.css`)
| Region | Owner |
| --- | --- |
| In-flow content (every shell: public, auth, onboarding, app, account) | `body { padding-top: var(--flh-safe-top) }` |
| Shell spacing that used to be `max(N, inset)` | `var(--flh-flow-top-N)` = N collapsed by the inset body already gave. The position is unchanged. |
| Content scrolled up past the top | `body::before` fixed guard, height `--flh-safe-top`, z-index 45 (above page and sticky chrome, below modals/sheets) |
| Sticky headers | `top: var(--flh-safe-top)` |
| Fixed overlays (modals, Record Your Take, sheets, Edit Home) | Pad themselves with `--flh-safe-top` / `--flh-safe-bottom` or `env()` |
| Bottom edge | The mobile nav owns the home-indicator inset. Feedback sits at nav height + inset + 8px, and above Home Detail's action bar. The page reserves room so the last item scrolls clear of the tab. |

Off-device every inset is 0, so desktop and mobile Safari (whose own browser
chrome covers the status bar) are unchanged. Don't add per-page top margins.
A surface that genuinely wants to paint under the status bar must opt in
explicitly (none do today). If `ios.contentInset` is ever set in
`capacitor.config.js`, iOS will inset the WebView itself and this contract must
be revisited, because the padding would double. The contract test guards this.

## Physical iPhone acceptance checks (Dynamic Island device, portrait)
After `git pull`, `npx cap sync ios`, then a clean build and run from Xcode
(or reload the WebView if only web assets changed; the app loads the live site):

1. **Public homepage** (signed out): the logo, "Feels Like Home" and Menu start clearly below the clock and Dynamic Island. Scroll: nothing appears behind the clock, Wi-Fi or battery; the strip stays the paper colour.
2. **Header logo** (signed in, My Homes): the house mark and wordmark are fully visible below the island at rest. Scroll down and back up: the header never slides under the status bar while visible.
3. **My Search**: the initial position is the same as before. Scroll the long page: content disappears under a solid strip at the status-bar edge, never behind the clock.
4. **Compare**: scroll down so "Showing differences only" passes the top. It goes under the solid strip, not the Dynamic Island. Swipe the chip row and the home cards sideways: the next chip or card peeks at the right edge and nothing is clipped.
5. **Focused editors** (My Search → Priorities / Places): the back/Cancel header sits below the island at rest and stays pinned just below it while scrolling.
6. **Record Your Take** (Want to Tour → "I toured this home"): the title and close ✕ sit fully below the Dynamic Island, and ✕ is easy to tap. Scroll the sheet to the end: Cancel and Save my take sit above the home indicator.
7. **Other modals**: Edit Home (header and ✕ below the island; Save above the home indicator) and Add Home, the same way.
8. **Feedback tab**: on My Homes it sits just above the bottom nav; scroll to the very bottom and the last card's actions are not covered. On a Home Detail it sits above the Want to tour / Favorite bar, not over it. Hidden on focused editors.
9. **Bottom nav**: unchanged; icons clear the home indicator.
10. **Rotate to landscape and back**: no content under the notch side; the layout recovers in portrait.
11. **Mobile Safari** (not the app) at feelslikehome.app: no visual change from before.
