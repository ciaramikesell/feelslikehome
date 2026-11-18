# Phase 1B implementation and founder QA

Guest onboarding reuses the current V3 screens and desktop priority board. Purchase, home rental, and apartment rental use the same category, importance, custom-feature, and review logic as signed-in onboarding. Places remains in My Search. The existing invitation destinations and shared-search setup continue to use their current paths.

## Data flow and recovery

1. The native welcome and personal web Get Started links lead to `/guest` when enabled. The guest route reuses the V3 onboarding components with local persistence services instead of Supabase. Browser storage contains the versioned draft ID, seven-day expiry, preferences, progress, and the frozen request if a save is pending. It holds no names, email addresses, credentials, invite secrets, or account IDs. The draft can be discarded. On a shared device, anyone using the same browser profile can see those answers. The app drops expired drafts when it next checks storage.
2. The Review or quick-start Basics action goes to `/guest/signup`. Signup uses existing fields through a same-origin server POST. Preparation stores an HttpOnly, Secure, same-origin binding cookie before GoTrue creates the account. The cookie binds to the draft and email. Starting a new attempt for a different email requires confirmation. Signup keeps the proof available across errors or lost responses. The verification link carries a continuation route, with the existing PKCE exchange handling the verified signup.
3. In the original browser, verified users can confirm the displayed account and click Save. If the mail link opened in Safari outside the WebView, the continuation explains how to return to the original app and sign in there. The other browser has neither the local answers nor proof needed to transfer. An existing signed-in account with a mismatched binding cannot apply the draft.
4. The server authenticates with Supabase `getUser()`, checks the exact configured Origin and cookie binding, bounds the request bytes and depth, and validates the complete V3 shape and eligible step list. It sends only normalized data to the dedicated database writer through TLS and parameterized SQL. The private function writes priorities, onboarding completion and its receipt in one transaction. A frozen, identical retry returns the receipt. The local draft is removed only after confirmed success, and cookie cleanup follows in a separate best-effort request so a lost save response cannot consume the proof.
5. The completion screen introduces the existing Add Home path through My Homes. My Search opens saved preferences for review. A normal owner onboarding session in the enabled app uses an authenticated, invoker-rights save function that locks the profile and refuses writes after completion. It uses existing RLS and can only write the caller's current owned search. Shared-search and Realtor paths continue unchanged.

## Local QA

- [ ] At 320, 375, 390, and 430 px, open Get Started and choose each search type. Check Back, Skip, ranking, custom features, and review. Confirm Places appears later in My Search.
- [ ] On desktop, check the priority board and complete an As I Go path as well as Personalize. Confirm the signed-out browser cannot open protected My Homes.
- [ ] Answer part of the flow, refresh, close and reopen the browser, and continue. Start over from Discard draft. Confirm signup validation errors leave the answers available.
- [ ] Sign up and verify in the starting browser. Save, open My Search, and then open Add Home from My Homes. Confirm one search and a single application of the saved answers.
- [ ] Start in the iOS app and open email verification in Safari. Return to the app, sign in with the same email, and save. Sign in with a different account in a separate run and confirm the existing preferences are preserved.
- [ ] Accept co-buyer and Realtor invitations using new and existing accounts. Confirm the destinations and search permissions stay scoped to the invitation.
- [ ] With the guest flag off, verify Welcome and the public home page keep their existing signup and sign-in paths.

The [screenshot comparisons](screenshots/README.md), [local test evidence](test-evidence.md), and [rollout plan](rollout.md) are included in this draft.
