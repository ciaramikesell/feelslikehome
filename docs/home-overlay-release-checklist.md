# Home overlay (PR #155) — release-readiness checklist

Nothing here is done automatically: no merge, no deploy, no production
migration. Each step names who runs it and what "pass" means.

## 1. Vercel Preview (hands-on)

Preview for the PR head: <https://feelslikehome-git-claude-eager-keller-5wfnwq-tbd-fcfc.vercel.app>
(Vercel status: Ready for the PR's latest commit; inspector link on the PR).

First confirm which Supabase project the Preview environment uses (Vercel →
Settings → Environment Variables → Preview: `NEXT_PUBLIC_SUPABASE_URL`).
If it is **production**, the Laundry Location column does not exist there yet:
the Laundry Location field must be **absent** from the overlay (expected — the
app hides it until the migration is applied) and every other edit must save.

Sign in as a test buyer with a few saved homes, then at normal browser zoom
(100%, Cmd/Ctrl-0) on a desktop window ~1440 px wide and on a phone:

1. My Homes → click a card → the overlay opens over My Homes; the address
   bar shows `/homes/<id>`.
2. Close without editing → back on My Homes, same scroll position and filters;
   reload → the home is still there.
3. Reopen → change Year built (Tab out) and Property type → "Saved" → Close →
   reopen → both kept.
4. Answer one of your own criteria Yes / No / Unknown → the Match % changes
   immediately; the card behind shows the same % after Close.
5. Paste a listing → Find home → Add to My Homes (double-click) → exactly one
   new card; the overlay opens on it.
6. A home with a very long address: it wraps under the price in the overlay
   (never under the right-hand column) and the title bar truncates with "…".
7. Phone: overlay is full screen; Photo options / Year, taxes & utilities /
   School details expand; Important and Nice to Have show with "Show".
8. Browser Back closes the overlay; Forward reopens it; a copied `/homes/<id>`
   link opens it directly.
9. Tour feedback & notes (overlay footer) shows the existing Tour Feedback;
   "Home details" returns.
10. As the co-buyer: answer a criterion → the owner's answer is unchanged.
    As the Realtor (`/people/<search>/homes/<id>`): no inputs anywhere.

## 2. Production Supabase Storage — photo upload test

The overlay uploads with the same code as before (`src/lib/homePhoto.js`):
JPEG / PNG / WebP up to 5 MB, path `<auth.uid()>/<random uuid>.<ext>` in the
public bucket `home-photos`, displayed from its public URL. The bucket and
its policies are configured in the Supabase dashboard (not in this repo).

**A. Read-only configuration check (SQL editor, production).** Run
`supabase/home-photos-storage-check.sql`. Rows 1–5 should be `ok = true`; read
the policy text in rows 4–5 (INSERT limited to the caller's own folder,
DELETE limited to the caller's own objects). Row 5 false is not a blocker
(replaced photos are just left in Storage), but note it.

**B. Upload on the Preview (or production after deploy), as a test buyer.**
Use a dedicated test account and a test home, never a real buyer's home.

1. Open the test home → Upload photo → choose a ~1–3 MB JPEG.
   Pass: "Uploading…" then "Saved"; the photo shows in the overlay and on the
   card after Close; reload keeps it.
2. Storage → `home-photos` → folder named with the test user's id contains
   exactly one new object (`<uuid>.jpg`), content type `image/jpeg`.
3. Table `homes` for the test home: `photo_url` is
   `https://<project>.supabase.co/storage/v1/object/public/home-photos/<user id>/<uuid>.jpg`.
4. Open that URL in a private window (signed out): the image loads (public).
5. Change photo → choose a PNG. Pass: new photo shows and is saved; within a
   few seconds the previous `.jpg` object is gone from the folder (only if
   the DELETE policy exists; otherwise it remains — note which).
6. Choose a 6 MB image → "That image is larger than 5MB…", nothing uploaded.
   Choose a GIF/HEIC → "Please choose a JPEG, PNG, or WebP image.", nothing
   uploaded.
7. Photo URL → type `not a url` and Tab → nothing saved (photo unchanged).
   Paste an `https://…` image URL you have the right to use → saved and shown.
8. Remove → the home shows "No photo yet" after reload (`photo_url` empty).
9. As the co-buyer on the same home: Upload photo → succeeds into the
   co-buyer's own folder; the home shows it for both buyers.
10. Clean up: delete the test objects from `home-photos` and the test home.

Fail any step → do not release; capture the browser console and the
Storage/API response.

## 3. Laundry Location migration (separate approval)

Release order: **migration first, then code.** The field appears once the
column exists.

This section previously said the code "tolerates the missing column", so
deploying before migrating was "safe". That was never verified for every read
path: `getSuggestions` embeds `homes(${HOME_SHARED_COLUMNS})` and had no
fallback, so on a database without `homes.laundry_location` PostgREST
answered `42703 column homes_1.laundry_location does not exist` and My Homes
failed — the production outage. It is fixed (every full-projection read now
goes through `withOptionalHomeColumns`, guarded by
`test/optional-home-columns-db.test.js`), but the fallback is a safety net
for a mistake, not a release plan.

1. Review `supabase/migrations/2026-10-18-laundry-location.sql`.
2. Run `supabase/laundry-location-preflight.sql` (read-only) in production —
   every `required` row `ok = true`.
3. Confirm a production backup / PITR point.
4. Apply the migration only after explicit approval.
5. Run `supabase/laundry-location-verification.sql` — every row `ok = true`,
   section 7 = `0`.
6. Only then merge / deploy the code. Smoke-test My Homes,
   `/homes/suggestions`, the Realtor client workspace and the home overlay.

### Rule for every migration-dependent release

Code that references a new column is released **after** its migration has
been applied and verified in production — never on the assumption that all
read paths handle a missing column. The optional-column fallback
(`OPTIONAL_HOME_COLUMNS`) exists so a mistaken order degrades instead of
failing; it is not a reason to change the order. Before relying on it for a
new column, it must be proven for direct reads, embedded reads (`homes(…)`)
and writes against a real database without the column.

## 4. Already verified locally (real Postgres, real browser)

- `npm test`: 1,018 / 1,018 pass, 0 skipped.
- `next build`: passes.
- `scripts/qa/home-overlay-e2e.mjs`: 27 / 27 steps.
- `scripts/qa/tour-feedback-e2e.mjs`: 52 / 52 steps.
- `scripts/qa/long-address-qa.mjs`: 4 hard addresses × 7 widths (1440 → 320)
  plus My Homes cards — no overflow, clipping or overlap (measured).
- `test/home-overlay-unknown-db.test.js`: Unknown facts vs None, Unknown
  answers vs No, exact percentages, JS/SQL scorer parity, weights 4 / 2 / 1.
