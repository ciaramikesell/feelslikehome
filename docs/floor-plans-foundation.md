# Floor Plans foundation (PR 1 of 2)

Database, Storage, authorization and data access for optional floor plans.
**No UI in this PR**: nothing calls the new data layer yet, so applying it
changes nothing a user can see. The UI (My Homes card link, viewer) is PR 2.

Floor plans are separate from the home's cover photo (`homes.photo_url`,
bucket `home-photos`) and never feed Match. The legacy apartment column
`homes.floor_plan_image_url` is not read, written or altered.

## What it adds

| Piece | File |
|---|---|
| `home_floor_plans` table, helpers, RLS, grants, 4-per-home limit | `supabase/migrations/2026-10-18-home-floor-plans.sql` |
| Private `home-floor-plans` bucket and its `storage.objects` policies | `supabase/migrations/2026-10-18-home-floor-plans-storage.sql` |
| Read-only preflight | `supabase/home-floor-plans-preflight.sql` |
| Read-only verification | `supabase/home-floor-plans-verification.sql` |
| Data layer (add / replace / remove / sign / counts) | `src/lib/homeFloorPlans.js` |
| Orphaned-image sweep (operator, service role) | `scripts/ops/floor-plan-orphans.mjs` |
| Tests | `test/home-floor-plans-db.test.js` (real Postgres), `test/home-floor-plans.test.js` |

## Design

* One row per image: `id, home_id → homes on delete cascade, storage_path
  (unique), created_by (defaults to the caller), created_at, updated_at`. No
  labels, ordering or tags (plans show oldest first).
* Objects live at `home-floor-plans/{home_id}/{uuid}.{jpg|png|webp}`. A CHECK
  keeps every row inside its own home's folder; any other object name is
  refused by the Storage policies.
* Bucket: private, 10 MB, `image/jpeg`, `image/png`, `image/webp`. Images are
  read through signed URLs valid for 15 minutes.
* Maximum four plans per home (trigger under a per-home advisory lock, so
  concurrent adds cannot overshoot). Replace updates the row in place.
  A home folder holds at most eight objects, which bounds uploads that never
  get a row.

## Permissions

| | Owner | Co-buyer | Connected Realtor | Removed / departed member | Outsider, anon |
|---|---|---|---|---|---|
| See plans, get signed URLs | yes | yes | yes | no (immediately) | no |
| Add, replace, remove any plan | yes | yes | no | no | no |
| Plans on a pending Realtor suggestion | none until accepted | | | | |
| Image with no row (failed / abandoned upload, removed plan) | can see and delete | can see and delete | cannot see | no | no |

Signed URLs already issued stay valid until they expire (at most 15 minutes).

## Consistency and cleanup

* **Add**: upload, then insert the row; if the insert fails (limit, revoked
  access) the upload is deleted.
* **Replace**: upload, then repoint the row only if it still points at the old
  image; the old image is deleted afterwards. If someone else changed or
  removed the plan first, the new upload is deleted and the caller is told
  (`reason: 'changed'`).
* **Remove**: delete the row (gone for everyone at once), then the image.
* **Deleting a home** cascades its rows. Postgres cannot delete Storage
  objects, so the images stay behind, unreadable to everyone (no home, no
  access), until the sweep removes them.
* **Sweep**: `scripts/ops/floor-plan-orphans.mjs` lists images that no row
  references and are older than 24 hours. Dry run by default; `--apply`
  deletes them. Verification rows 14–15 report the counts.

## Release order

Nothing here has been applied to Production.

1. Merge PR 1 (no visible change).
2. Production SQL Editor: run `supabase/home-floor-plans-preflight.sql`.
   Every `ok` must be true. If row 9 lists a `storage.objects` policy with no
   `bucket_id` restriction, stop: it would also open the private bucket.
   Scope it to its bucket first (separate approval).
3. Run `supabase/migrations/2026-10-18-home-floor-plans.sql`.
4. Run `supabase/migrations/2026-10-18-home-floor-plans-storage.sql`.
   If the editor refuses the `create policy … on storage.objects` statements
   for ownership, the whole file rolls back. Create the bucket and the three
   policies in Dashboard → Storage with the same settings and expressions,
   then continue.
5. Run `supabase/home-floor-plans-verification.sql`. Every `ok` must be true;
   rows 13–15 should read `0 / 0 / 0`, `0`, `0`. Row 16 should end in
   `yes`; if it says `NO`, the 8-object upload cap is inert in this project
   (rows are still capped at 4 and unattached images stay unreadable to
   Realtors) — report it before PR 2.
6. Smoke test against real Supabase Storage (the local tests cannot cover the
   Storage API itself): as a test owner, add a plan to a test home through the
   PR 2 preview or a console call to `addFloorPlan`, sign it, replace it,
   remove it, and confirm a test Realtor can sign but not upload.
7. Then PR 2 (UI). It hides itself on any database without the table, so the
   order of steps 3–5 and the PR 2 deploy cannot break My Homes.

Rollback (before any real plans exist): drop the three storage policies, the
bucket (empty), the table and the six functions. Nothing else depends on them.
