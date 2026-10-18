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
| Real-Supabase Storage smoke test (test accounts, anon key) | `scripts/qa/floor-plans-storage-smoke.mjs`, scenarios in `scripts/qa/floor-plans-storage-scenarios.mjs` |
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
  get a row (see **Upload cap**).

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

## Upload cap (8 objects per home folder)

The Storage INSERT policy calls `can_upload_home_floor_plan_object`, a
SECURITY DEFINER function that counts the home's objects in `storage.objects`.
That count runs as the function's **owner** (whoever runs the migration — in
the SQL Editor, `postgres`). `storage.objects` has RLS on and is owned by
`supabase_storage_admin`, so the count is only real if the owner role reads
every row: superuser, `BYPASSRLS`, or owner of the table without
`FORCE ROW LEVEL SECURITY` (plus `SELECT`). Otherwise RLS would hide rows from
it and the cap would count zero forever — failing open.

Supabase's hosted `postgres` role is commonly reported to have `BYPASSRLS`,
but that is **unverified** for this project. So the cap does not assume it:

| Layer | What happens if the owner cannot see every row |
|---|---|
| Preflight row 11 | `ok = false`, with the role's attributes — stop before applying |
| Storage migration | aborts with "upload cap cannot be enforced"; nothing is installed |
| At runtime (e.g. ownership or role attributes change later) | every upload is refused (fail-closed), never allowed uncounted |
| Verification row 16 | `ok = false` |

Concurrent uploads to the same home take a per-home advisory lock inside the
check, so a burst cannot overshoot 8. All of this is covered by real-Postgres
tests, including mutation checks (removing the lock or the guard fails them).

If preflight row 11 is false in Production, the alternatives are (needs a
decision, not built):

1. **A bucket-scoped `SELECT` policy on `storage.objects` for the owner
   role** (`to postgres using (bucket_id = 'home-floor-plans')`), so the
   count sees every row without `BYPASSRLS`. Small; stays in SQL; grants the
   admin role nothing it cannot already do via the dashboard. The guard
   would then accept "owner has a covering policy" as countable.
2. **Server-issued signed upload URLs**: remove the client INSERT policy; a
   Next.js route checks access and the count with a service-role key, then
   returns `createSignedUploadUrl`. Strict and server-controlled, but adds the
   app's first service-role secret to the Vercel runtime and a new route.
3. **Rows-only limit** (no object cap): unattached uploads stay unreadable to
   Realtors and are swept, but are unbounded between sweeps. Not recommended.

## Testing real Supabase Storage

The local tests run the real policies and functions on Postgres with a
Storage shim; they **cannot** prove how the hosted Storage service applies
them (which policies `upload`, `remove` and `createSignedUrls` consult, how
bucket limits are enforced, signed-URL expiry). Treat that as unverified
until the smoke test passes on the target project.

`scripts/qa/floor-plans-storage-smoke.mjs` runs the same scenario list the
local DB test runs (`scripts/qa/floor-plans-storage-scenarios.mjs`, ~35
checks) against a real project as four real signed-in test users, with the
anon key only — **no service-role key**:

* owner adds; co-buyer and Realtor see it; outsider and anon see nothing;
* signed URLs download the image for members (HTTP 200, `image/png`), are
  refused to outsider and anon, and stop working after they expire;
* the Realtor cannot upload, insert, delete or remove; the outsider cannot
  upload;
* an upload with no row: buyers can see and delete it, the Realtor cannot;
* SVG, PDF, > 10 MB and nested paths are refused by the service;
* co-buyer replaces the owner's plan and the old image is deleted;
* the folder fills to 8 and the 9th upload is refused;
* remove deletes the row and image for everyone;
* the run deletes its temporary home and every image it created.

Setup: four confirmed test accounts in that project's Auth (owner, co-buyer,
Realtor, outsider). The script connects them to the owner's search if needed.
It refuses to run unless `--project=<ref>` repeats the project ref.

## Release order

Nothing here has been applied anywhere. Each step needs your go-ahead.

**Stage A — rehearsal on a non-production project** (a Supabase staging
project, or a local `supabase start` stack, which runs the real Storage
service):
1. Run the preflight. Every `ok` true, including row 11 (upload cap).
2. Apply `…home-floor-plans.sql`, then `…home-floor-plans-storage.sql`.
3. Run the verification. Every `ok` true; row 16 true.
4. Run `floor-plans-storage-smoke.mjs` against it. All checks pass.
5. Optional: run `floor-plan-orphans.mjs` there in its default dry run; it
   should report 0 unreferenced images.

**Stage B — Production schema, feature still off** (after PR 1 is merged;
merging changes nothing visible):
6. Production preflight. Stop on any `false`: row 9 (an unscoped storage
   policy) or row 11 (upload cap) need a decision before going further.
7. Apply the table migration, then the storage migration. Either aborts as a
   whole on a failed guard. If the SQL Editor refuses `create policy … on
   storage.objects` for ownership, the storage file rolls back entirely —
   stop and decide; do not hand-create policies without the guards.
8. Production verification. Every `ok` true.
9. Production smoke test with dedicated test accounts — only with your
   explicit approval, as it writes temporarily to Production (it cleans up
   after itself and uses no service-role key).

**Stage C — UI**:
10. PR 2 ships behind a flag that is off by default, so the UI cannot appear
    before steps 6–9 pass. Turn it on only after they have.

The orphan sweep stays dry-run by default; `--apply` additionally needs
`--project=<ref>`, and running it on Production (or using Production
service-role credentials at all) needs your explicit approval.

Rollback (before any real plans exist): drop the three storage policies, the
bucket (empty), the table and the seven functions. Nothing else depends on
them.
