# First-use refinement, Part A

Based on main at `734ade38addb6218bd14f1954af5539cd3f691a2`.

The native welcome keeps its original cottage photography, branding, gradient and tagline. Larger copy explains that users bring listings they have already found. A more visible optional practice run is available from welcome and signup, and now lets people try confirmed versus unknown example facts before creating an account. It is explicitly a simulation and offers a copy-link fallback rather than promising an unverified native handoff.

Signup keeps all account fields and the existing authentication code. Names share a row where space permits, then stack at small widths or increased text size. V3 and Explore share a responsive serif heading with a dark introduction, terracotta emphasis and readable supporting copy. Search-type radios retain their exact stored values and lose the redundant budget/rent descriptions.

Kitchen now surfaces Eat-in Kitchen and Kitchen Island (five cards total). Bathroom surfaces the existing Separate Shower / Tub and Linen Closet suggestions (four cards total). Their assets, IDs, categories and custom-versus-catalog identities are unchanged. No features were created; remaining suggestions stay available. Skipping still writes no importance.

V3 review introduces the first listing import with optional iPhone practice. The earlier ready screen has matching encouragement. Initial Add Home defers Pros & Cons, including apartment/manual-entry editor paths. Saved Home Detail and Edit Home keep the shared evaluation fields; no stored values or save payloads were removed.

No schema, RLS, Match weights, unknown semantics, co-buyer/Realtor permissions, import safeguards, production flags, native configuration or Floor Plans were changed.

## Before and after

Screenshots use Chromium at CSS widths 320, 375, 390 and 430, with a viewport height of 844. These are browser captures, not proof of native iPhone handoff. Welcome uses the existing native presentation attribute. The signed-in Add Home captures use the repository's development Supabase stand-in and a throwaway local PostgreSQL database. The missing-provider fallback is intentional; it avoids claiming a live listing import was verified.

| Surface at 390px | Before | After |
| --- | --- | --- |
| Native welcome | [Before](screenshots/before/welcome-390.png) | [After](screenshots/after/welcome-390.png) |
| Signup | [Before](screenshots/before/signup-390.png) | [After](screenshots/after/signup-390.png) |
| Search type | [Before](screenshots/before/search-type-390.png) | [After](screenshots/after/search-type-390.png) |
| Kitchen | [Before](screenshots/before/kitchen-390.png) | [After](screenshots/after/kitchen-390.png) |
| Bathroom | [Before](screenshots/before/bathroom-390.png) | [After](screenshots/after/bathroom-390.png) |
| Review → first import | [Before](screenshots/before/first-import-intro-390.png) | [After](screenshots/after/first-import-intro-390.png) |
| Add Home entry | [Before](screenshots/before/add-home-390.png) | [After](screenshots/after/add-home-390.png) |
| First save | [Before](screenshots/before/first-save-390.png) | [After](screenshots/after/first-save-390.png) |

All four widths are in [before](screenshots/before) and [after](screenshots/after). [Large-text captures](screenshots/after/large-text) use a 200% root text size for buyer, home-renter and apartment-renter journeys. Demo captures are also in the after directory.

## Founder QA checklist

- [ ] On an iPhone, welcome preserves the cottage and one-line tagline at normal text size; the explanation clearly describes importing homes already found.
- [ ] Try the optional import practice before signup. Switch between Kitchen Island and Soaking Tub; unknown never sounds like a negative. Close with Escape/Back and return to the original control.
- [ ] Signup keeps first name, last name, email, password and confirmation. Check the paired name fields at standard widths and stacked fields with larger text.
- [ ] Select each search type. Buyer personalization shows the expanded Kitchen/Bathroom cards; renters keep their own categories. Skip and Back leave unanswered choices unanswered.
- [ ] Finish personalization. The next action clearly brings in an existing listing; the Share Sheet practice is optional.
- [ ] Paste a listing link, review found Home Facts and save. No Pros & Cons appear before save, including apartments/manual entry. Open the saved home and confirm evaluation fields remain available and old content is intact.
- [ ] On a physical iPhone, check Dynamic Type, keyboard visibility, Share Sheet availability and the actual handoff. If sharing is unavailable, copy/paste the listing link. Native handoff remains unverified by browser tests.

## Validation results

- PostgreSQL-enabled suite: **1,655 passed, 0 failed, 2 skipped** (missing sanitized live RentCast fixtures).
- Production build: **passed** against the final changed source.
- Focused first-use browser checks: **64/64 passed**.
- Existing V3 browser suite: **564/564 passed**, including buyer/renter journeys, 150%/200% text, keyboard/focus and image-failure fallbacks.
- Production first-run suite: **79/79 passed**, including native-bridge simulation, real forms, local database writes, first save, Match Yes/No/Unknown, collaboration/Realtor boundaries and V3 flag-on/off regressions.
- Before/after captures cover all four requested phone widths. [Machine-readable summary](verification.json).

## Repeating verification

Run `npm test` and `npm run build` from the repository. Do not run `next build` and `next dev` against the same `.next` directory simultaneously. This validation built a temporary copy of the changed source while the screenshot dev server remained running.

Real database tests follow `docs/database-tests.md`. PostgreSQL 17 was downloaded using verified Debian package metadata and extracted outside the checkout because system directories are read-only. The local cluster used a Unix socket, no TCP listener and throwaway test databases. This does not configure or migrate a hosted Supabase project.

With the dev server running, run:

```sh
FLH_CHROMIUM=/usr/bin/chromium node scripts/qa/first-use-part-a.mjs http://localhost:3100 /tmp/first-use-qa
FLH_CHROMIUM=/usr/bin/chromium node scripts/qa/mobile-priority-onboarding-v3-qa.mjs http://localhost:3100 /tmp/v3-qa
```

The existing `scripts/qa/first-run-e2e.mjs` exercises production servers with V3 on/off and the local Supabase stand-in; its header documents the setup. Google Maps, live RentCast data, hosted email delivery and a real Capacitor Share Extension require their respective external services or device testing.
