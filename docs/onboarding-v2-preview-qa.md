# Onboarding V2 — six-step Preview journey (temporary)

`/qa/onboarding` runs the real, inactive six-step onboarding (`<Onboarding version={3}>`)
end to end with demo data, so it can be tried hands-on as a signed-in user on
this branch's Vercel Preview. It exists only for this QA round. Remove it afterwards.

## Safeguards

| Requirement | How |
|---|---|
| Not on Production | The same gate as `/qa/step-2` (`src/lib/previewQa.js`). It is allowed only when `VERCEL_ENV=preview` **and** the host is this deployment's own branch or deployment URL (never `feelslikehome.app`), or in `next dev`. Middleware and the page both check it. Anything else returns 404. |
| Signed-in only | The page calls `auth.getUser()` and sends signed-out visitors to sign-in. Outside `next dev`, it returns 404 if Supabase isn't configured. |
| No Supabase writes | `OnboardingJourneyHarness.jsx` replaces every service `<Onboarding>` uses with an in-memory stand-in: preferences, progress, onboarding completion, active search, places and feedback. It never imports a Supabase client. The page reads nothing beyond the sign-in check. |
| Signed-in account untouched | The demo uses fixed demo IDs, not your user or search IDs. Your onboarding status, searches, members and invitations are never read or written. |
| No fake success | Finishing goes to `services.navigate`, which shows a **"Demo finished — nothing was saved"** panel. The panel shows what the real app would do and the in-memory data it would have saved. |
| Demo vs live data | A "Demo" bar sits above the flow. Sample area results say **"Sample result — not from Google"** and sample addresses end in **"(sample)"**. Only **Live Google Places** sends lookups to Google, using the existing browser key. |
| Live flow unchanged | `CURRENT_ONBOARDING_VERSION` stays `1`. The only change to `Onboarding.jsx` is an optional `services.navigate`, which the real services don't define. |
| Not indexed | `robots: noindex, nofollow`. |

## Using it

Open `https://<this branch's Preview URL>/qa/onboarding` and sign in.

The demo bar has these controls:

- **Scenario A / B / C** switches scenarios.
- **Restart** clears every answer.
- **Start at Review (sample answers)** (A only) jumps straight to Step 6.
- **Area results** has three options:
  - Live Google Places
  - Sample results (not Google)
  - Simulate Google outage
- **Simulate save failures** makes saving and finishing fail, so you can see the error states. Untick it and try again.

### A — Decisive buyer
Answer everything. Add two or three areas and a place, choose a Realtor, and pick
many priorities, including a grouped choice such as House + Condo. Move priorities
between levels in Step 5, including the group, which moves as one item. On Review:

1. Edit something, such as Areas. You return to Review.
2. Click **Change rankings**.
3. Finish with **Add my first home**.

### B — Exploratory buyer
Choose a search type, then skip everything you can. Choose no priorities, so
Step 5 shows its empty state. Review shows "Not set yet" and the "Add…" prompts.
Finish with **Go to My Search**.

### C — Co-buyer joining "Ciara (demo)'s" search
This scenario uses shared-search setup mode:

- The header names the owner's search.
- Who you're searching with is fixed.
- An exit link goes back to your own search.

Edit answers, then finish. The finished panel confirms that onboarding completion
was **not** recorded (count 0), that no search was created and that the owner's
preferences weren't touched.

## Removal

Delete:

- `src/app/qa/onboarding/`
- `src/components/onboarding/OnboardingJourneyHarness.jsx`
- the "Preview journey harness" tests in `test/onboarding-review.test.js`
- this file

Optionally also remove the `services.navigate` branch in `Onboarding.jsx`'s
`leave`, along with its test. To remove `/qa/` entirely, follow
`docs/onboarding-step2-preview-qa.md` as well.
