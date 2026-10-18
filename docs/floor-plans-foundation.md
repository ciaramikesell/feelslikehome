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
| Read-only Storage usage report | `supabase/home-floor-plans-usage.sql` |
| Stage A results (real Storage, local) | `docs/floor-plans-stage-a-report.md` |
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
* Maximum four plans per home — **strict**, including when two buyers add at
  the same moment (trigger under a per-home advisory lock; verified against
  real Supabase Storage in Stage A). Replace updates the row in place.
* A home folder holds at most eight objects, which bounds uploads that never
  get a row — **best-effort** under simultaneous uploads (see **Upload cap**).

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

## Upload cap (8 objects per home folder) — best-effort

The Storage INSERT policy calls `can_upload_home_floor_plan_object`, which
counts the home's objects in `storage.objects`.

**Fail-closed role check (kept).** The count runs as the function's owner
(whoever runs the migration — in the SQL Editor, `postgres`). `storage.objects`
has RLS on and is owned by `supabase_storage_admin`, so the count is only real
if the owner reads every row: superuser, `BYPASSRLS`, or owner of the table
without `FORCE ROW LEVEL SECURITY` (plus `SELECT`). Otherwise:

| Layer | What happens if the owner cannot see every row |
|---|---|
| Preflight row 11 | `ok = false`, with the role's attributes — stop before applying |
| Storage migration | aborts with "upload cap cannot be enforced"; nothing is installed |
| At runtime (e.g. ownership or role attributes change later) | every upload is refused (fail-closed), never allowed uncounted |
| Verification row 16 | `ok = false` |

In Supabase's own `supabase/postgres` image (Stage A), `postgres` is not a
superuser but has `BYPASSRLS`, so the check passes there. Production's role
is still checked read-only by preflight row 11.

**Best-effort under simultaneous uploads (v1 decision).** Supabase Storage
(storage-api v1.25.7, `Uploader.canUpload` / `completeUpload`) checks the
INSERT policy in a pre-check transaction it rolls back, writes the file, and
then inserts the row as its own admin role, which RLS does not apply to. A
policy therefore only sees uploads that had completed before its pre-check:

* one at a time, the 9th upload is always refused (exact);
* uploads whose pre-checks all run before any of them completes can together
  pass 8 — in Stage A, two simultaneous uploads at 7 both succeeded (9).
  Each burst can add up to one image per parallel request (≤ 10 MB each).

Accepted for v1 because only the owner and co-buyers can upload at all, the
extra images never get a row (Realtors cannot read them; the 4-plan limit
still holds), and the operator sweep finds them. A bucket-scoped trigger on
`storage.objects` made the cap strict in a Stage A prototype but was
**declined**: it modifies Supabase's managed Storage table. Usage monitoring
(below) is the safeguard instead.

## Storage usage monitoring (no new infrastructure)

Run `supabase/home-floor-plans-usage.sql` (read-only, counts and bytes only —
no names, paths or user data) in the SQL Editor:

* weekly during the first weeks after the UI ships, then monthly;
* before deciding on any sweep.

| Row | Watch for | Then |
|---|---|---|
| homes with more than 8 images | anything above 0 means the best-effort cap was exceeded | look at the largest folder (row 5); it is either a simultaneous-upload burst or abuse |
| images with no row older than 24 h (count, bytes) | steady growth | run the sweep's **dry run**; deleting needs explicit approval |
| total bucket bytes | compare with the project's Storage quota on the Supabase dashboard (Usage page) | expected ceiling ≈ homes with plans × 4 × typical file size |

The Supabase dashboard's Usage page (Storage size) is the second, independent
signal; no alerting service, schedule or new credential is added.

## Testing real Supabase Storage

The local tests run the real policies and functions on Postgres with a
Storage stand-in that reproduces Storage's two-stage upload (rolled-back
pre-check as the caller, then the real insert as the admin role); they
**cannot** prove how the hosted Storage service applies
them (which policies `upload`, `remove` and `createSignedUrls` consult, how
bucket limits are enforced, signed-URL expiry). Treat that as unverified
until the smoke test passes on the target project.

`scripts/qa/floor-plans-storage-smoke.mjs` runs the same scenario list the
local DB test runs (`scripts/qa/floor-plans-storage-scenarios.mjs`, ~40
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
* two buyers adding the 4th and 5th plan at once: exactly one is saved, and
  the refused add leaves no image behind;
* the folder fills to 7; two simultaneous uploads are recorded as **INFO**
  (best-effort, never a failure); a further upload is refused;
* remove deletes the row and image for everyone;
* the run deletes its temporary home and every image it created.

Setup: four confirmed test accounts in that project's Auth (owner, co-buyer,
Realtor, outsider). The script connects them to the owner's search if needed.
It refuses to run unless `--project=<ref>` repeats the project ref.

## Release order

Nothing here has been applied anywhere. Each step needs your go-ahead.

**Stage A — rehearsal on a non-production project** (done locally on
2026-10-18 with Supabase's real images — results in
`docs/floor-plans-stage-a-report.md`; a hosted staging project would add the
hosted-only checks listed there):
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
