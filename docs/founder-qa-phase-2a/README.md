# Founder QA Phase 2A — iOS form focus and signup

Base commit `cfcf28dea5b5aed4aad880a96ccabfe908c0f2b3` includes merged PR #199. Before is on the left and after is on the right. The mobile captures use the native signup layout with a simulated Capacitor bridge.

[320px](signup-320.jpg) · [375px](signup-375.jpg) · [390px](signup-390.jpg) · [430px](signup-430.jpg) · [1440px desktop](signup-1440.jpg)

## Focus audit

- Chromium measured Last Name, First Name, Email, Password, and Confirm Password at 14px before the fix in the native signup layout. The focus targets had no transformed ancestors, the document fit each viewport, and the viewport meta declared device width and initial scale 1. The measured 14px is below the iOS focus zoom threshold. The actual zoom symptom still needs physical-device verification.
- The mobile and native form font floor raises undersized controls to 16 CSS px or the user's root font size, whichever is larger. The shared field styles cover profile, account, import, notes, invitations, and filters. The audit also included compact search and sort, onboarding category and rank selects, and inline Home Facts text controls. The V3 Basics, custom feature, and lot-size text inputs already used 16px. The viewport declaration and Capacitor configuration are unchanged.
- Both signup layouts use the same form. The promotion was removed from that form. The native Welcome screen still offers **See how it works** alongside **Get Started**.

## Local verification

- Chromium checked signup, sign-in, password recovery, V3 Basics, custom features and lot size, and local render fixtures for Account, Homes search, sort and filters, and notes at 320, 375, 390, and 430px. The checked mobile controls computed at 16px or above. During focus changes, the simulated viewport stayed at scale 1 with no horizontal page overflow. The desktop signup page and homepage signup popover were checked at 1440px.
- The production build passed. The standard test suite passed with 1,412 passing, zero failures, and 253 skipped with optional PostgreSQL and live fixtures unset.
- Chromium ran against the local production build to verify signup required names, password confirmation, the outgoing signup data, and the check-email state. The signup request was intercepted and answered locally.
- The Linux environment ran mobile Chromium with a simulated Capacitor bridge for the native layout. The reduced-height viewport check simulates the space occupied by a keyboard. iOS Safari, WKWebView, the actual software keyboard, and pinch gestures need the physical-device pass below.

## Physical iPhone checklist

Use an isolated test account on an approved QA build or preview containing this commit. Record model, iOS version, build, and whether each observation came from Safari or Capacitor.

- [ ] In the app, open **See how it works** from Welcome, close it, then use **Get Started**. Confirm signup appears first and the promotion is gone. Open the Safari signup page and confirm the same form.
- [ ] Start with Last Name, then move through First Name, Email, Password, and Confirm Password via taps and the keyboard navigation where available. Type into each field and check that the left edge stays visible and the page does not unexpectedly magnify or scroll sideways.
- [ ] With the software keyboard open, scroll to reach the remaining controls, toggle password visibility, and then dismiss the keyboard. Repeat after dismissal and with larger text settings. Confirm pinch-to-zoom remains available in Safari.
- [ ] Check sign-in and **Forgot password?**. Complete an isolated signup, email confirmation, and sign-in, then confirm that onboarding opens. Check Realtor signup and a co-buyer invite from QA accounts.
- [ ] In onboarding, edit the budget, square footage, a custom feature, and ideal lot size. In the signed-in app, focus Homes search, a filter number, Account name, an editable note, and a native select. Check the numeric and text keyboards, picker dismissal, and viewport position after dismissal.
