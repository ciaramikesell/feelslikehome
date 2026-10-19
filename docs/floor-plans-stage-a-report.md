# Floor Plans foundation — Stage A report (real Supabase Storage, local)

Rehearsal of PR 1 (`docs/floor-plans-foundation.md`) on 2026-10-18, against
an **isolated local Supabase stack** — no hosted project, no Production
credentials, no user data. Final run on the PR's latest commit (after the
v1 decision that the object cap is best-effort).

## Environment

| Service | Image (Docker Hub) | Image ID |
|---|---|---|
| Postgres (Supabase build, Supabase roles) | `supabase/postgres:15.8.1.085` | `af083ef64d04` |
| Storage API (real service) | `supabase/storage-api:v1.25.7` | `018be0ff5342` |
| PostgREST | `postgrest/postgrest:v12.2.12` | `5f4ce744539b` |
| Auth | `supabase/gotrue:v2.177.0` | `6a916b47af03` |

A small local path router stood in for Kong (`/auth/v1`, `/rest/v1`,
`/storage/v1`). Storage created its own schema with its own migrations
(`storage.objects` owned by `supabase_storage_admin`, RLS on, not forced).
The app's existing schema (`schema.sql` + the post-snapshot migrations, minus
floor plans) was applied as `postgres`, the SQL Editor's role. Four test
accounts (`flh-stagea-{owner,cobuyer,realtor,outsider}@example.test`) signed
up through Auth with the anon key. Secrets were generated locally and
discarded with the stack.

## Results

| Step | Result |
|---|---|
| Preflight (read-only), as `postgres` | 13 / 13 ok. Row 11: `postgres` superuser=false, **bypassrls=true** — the cap can count |
| Table migration, then storage migration, as `postgres` (function bodies checked) | applied; `postgres` could create the `storage.objects` policies |
| Verification (read-only) | 17 / 17 ok |
| Both migrations re-run | clean |
| Smoke test (`scripts/qa/floor-plans-storage-smoke.mjs`), anon key + 4 signed-in users | **40 / 40 passed, twice**, plus 1 INFO line (below) |
| Supplementary probe (revocation, races, error shapes, home deletion) | as below |
| Usage report (read-only) | runs on real Storage metadata (`metadata.size` present) |
| Orphan sweep | **dry run only**; `--apply` was not run |

### Behaviour observed on the real service

* **Signed URLs** — owner, co-buyer and Realtor downloads return 200
  `image/png`; outsider and anon get none; an expired URL returns 400. A URL
  issued before a member was removed keeps working until it expires
  (15-minute TTL; documented trade-off).
* **Owner / co-buyer** — each adds, replaces and removes the other's plans; a
  replaced or removed image is deleted.
* **Realtor** — reads plans and signs URLs; every upload, row insert, delete
  and remove is refused; images with no row are invisible.
* **Revoked members** — a removed co-buyer loses rows, URLs and uploads (their
  plan stays with the home); a removed Realtor loses read access and regains
  it when re-invited.
* **Bucket limits** — SVG and PDF refused (400), > 10 MB refused (413), nested
  paths refused (403), existing name 409.
* **4-plan row limit: strict.** Two buyers adding the 4th and 5th plan at
  once: exactly one saved, the other `limit`, its image deleted — 5 of 5
  races (3 probe rounds + 2 smoke runs).
* **8-object upload cap: best-effort (accepted for v1).** One at a time, the
  next upload is refused. Simultaneous uploads at 7: 2 of 2 accepted (9 files)
  in 5 of 5 runs; a 10-wide burst accepted 5, 10 and 10 (12–17 files).
  Cause: Storage pre-checks the INSERT policy in a rolled-back transaction,
  then inserts the row as its admin role (`Uploader.canUpload` /
  `completeUpload`). In one 10-wide round the local Kong stand-in returned one
  502 (Storage logged no error); not attributed to Storage.
* **Home deletion** — rows cascade; the images remain, readable and deletable
  by nobody through the API; verification row 14 and the usage report count
  them; the sweep's dry run lists them and holds them until they are a day old.

### Real service vs the Postgres stand-in

| Behaviour | Stand-in before Stage A | Real Storage | Now |
|---|---|---|---|
| Upload | one INSERT as the caller | rolled-back pre-check as the caller, then INSERT as Storage's admin role | stand-in reproduces both stages; regression test pins the limitation |
| Simultaneous uploads at the cap | refused (wrongly claimed strict) | both accepted | stand-in and real both report `2 of 2 accepted; folder holds 9` |
| Bad MIME type | 415 | 400 | stand-in returns 400 |
| Single `createSignedUrl` refused | — | 404 `Object not found` | app uses `createSignedUrls` only (per-entry error) |
| Everything else in the smoke list | | | identical |

## Not covered here — hosted Supabase checks still open

Stage A used Supabase's published images locally. These need the hosted
project itself:

1. **Production `postgres` role attributes** — preflight row 11 (read-only)
   must be true; the local image says bypassrls=true, superuser=false.
2. **Hosted SQL Editor permission** to create policies on `storage.objects`
   (owned by `supabase_storage_admin`); the migration rolls back entirely if
   refused.
3. **Hosted Storage version** may differ from v1.25.7; the smoke test against
   the hosted project (with approval) re-checks behaviour, and its INFO line
   shows how the best-effort cap behaves there.
4. **Hosted gateway/CDN** (Kong, signed-URL host) — exercised only by a hosted
   smoke run.
5. Any **existing `storage.objects` policies** in Production — preflight rows
   9–10.
