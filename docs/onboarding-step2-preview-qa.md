# Onboarding V2 Step 2 — Preview QA harness (temporary)

`/qa/step-2` renders the real Step 2 ("Where are you looking?") on the inactive
six-step flow, so it can be checked against **live Google Places** on a Vercel
Preview. It exists only for this QA round and should be removed afterwards.

## Safeguards

| Requirement | How |
|---|---|
| Not on Production | `src/lib/previewQa.js`: allowed only when `VERCEL_ENV=preview` **and** the request host is that deployment's own branch or deployment URL (never `feelslikehome.app`), or in `next dev`. Checked in middleware and again in the page; anything else is a 404. |
| Signed-in only | The page calls `auth.getUser()` and sends signed-out visitors to sign-in. Outside `next dev`, it 404s if Supabase isn't configured rather than skipping the check. |
| No real user data | It reads no tables. Every value on the page is typed into it during the test. |
| No writes, no access-control bypass | Every write `<Onboarding>` can make is replaced by an in-memory stand-in (`Step2Harness.jsx`). It never imports a Supabase client. Analytics has no remote sink. |
| Not indexed | `robots: noindex, nofollow`. |

Only area and address lookups leave the browser. They go to Google with the
existing `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, exactly as the add-home address
field does.

## Using it

1. Open `https://<this branch's Preview URL>/qa/step-2` and sign in.
2. Search, add and remove areas, and add a place. The log under the step shows,
   for every search:
   - the types requested from Google;
   - every prediction Google returned, with its exact `types`;
   - how the step labelled it, or "not shown (unsupported type)".
   That log is the record of real provider behaviour. Nothing on this page is
   sample data.
3. **Simulate provider failure** forces the next searches to fail.
   **Reload from saved** remounts the step from what was saved in the tab, to
   check that answers are restored.

## Representative searches

`Grosse Pointe`, `Grosse Pointe Park`, `Grosse Pointe Public School System`,
`Grosse Pointe Public Schools`, `48230`, `Royal Oak`, `Midtown Detroit`,
`Ann Arbor Public Schools`.

## Removal

Delete:

- `src/app/qa/`
- `src/components/onboarding/Step2Harness.jsx`
- `src/lib/previewQa.js`
- the `/qa/` block and import in `src/middleware.js`
- the harness tests in `test/onboarding-locations.test.js`
- this file
