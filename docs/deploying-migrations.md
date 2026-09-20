# Deploying database migrations

This project has no CI/CD pipeline and no `.github/` workflows — every
migration in `supabase/migrations/` has so far been applied by hand. Pasting
large multi-statement migration files into the Supabase dashboard's SQL
Editor has repeatedly corrupted the paste (the editor's "enable RLS on new
tables" assistant misreads `plpgsql` local variable declarations as table
definitions and injects `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
statements into the middle of the function body, producing `42601:
unterminated dollar-quoted string`). Use one of the methods below instead.

## Why this isn't `supabase db push`

The official Supabase CLI migration-tracking workflow (`supabase db push`,
which compares local files against a `supabase_migrations.schema_migrations`
history table on the remote database) was evaluated and is **not** set up
here, for two concrete, tested reasons:

1. **Filename convention.** `supabase db push` only recognizes migrations
   named `<14-digit-timestamp>_name.sql` and silently skips anything else —
   confirmed by running it locally against this repo's actual files (all
   named `YYYY-MM-DD-name.sql`). Adopting it would mean renaming every
   existing migration file, which risks desyncing whatever history the live
   database already has from being applied by hand.
2. **No known remote history.** Because every migration to date was applied
   manually (dashboard paste), the CLI's own tracking table almost certainly
   has zero rows recorded for this project. Bootstrapping it correctly means
   reconciling that table against what's actually live in the database
   (`supabase migration repair`) — which itself requires a live connection
   to inspect current state, decide what's already applied, and mark it
   without re-running it.

Confirmed directly, not assumed: running `supabase migration list --db-url
<connection>` against a database with this repo's actual filenames and an
empty history table returns `{"migrations":[],"message":"Migrations
listed"}` — every local file is skipped, and there is nothing to compare
against. `supabase db push` behaves the same way (reports "up to date"
while silently skipping every file). Neither command can currently tell you
anything about this project's migration state — use `npm run db:check`
below instead, which asks the database directly.

Setting the CLI workflow up properly is possible, but it's a deliberate,
separate project (renaming ~30 files, then reconciling history against the
live database) — not something to do unilaterally alongside an unrelated
bug fix.

## Checking what's actually live: `npm run db:check`

`scripts/check-migration-state.mjs` is read-only — it connects and queries
`pg_proc`/`information_schema`/`pg_constraint` directly for the specific
objects this session's repairs depend on, and prints a plain pass/fail per
object. This is the only way to know what's live; GitHub commit state, the
web host's build log, and the Supabase CLI's migration-tracking (per above)
all say nothing about database state.

```bash
export SUPABASE_DB_URL="postgresql://postgres:[password]@[host]:5432/postgres"
npm run db:check
```

It checks: `profiles.first_name`/`last_name`, `resolve_search_relationships`,
`search_entitlements` + `resolve_search_entitlement`, and — specifically,
by inspecting the live function source text — whether `accept_invitation`
and `claim_prospective_search` contain the fixed `ON CONFLICT ON
CONSTRAINT ...` form or the known-ambiguous `ON CONFLICT (search_id,
user_id)` form.

## Applying a migration now: `npm run db:migrate`

`scripts/apply-migration.mjs` sends a migration file's SQL directly to a
Postgres connection string using `pg` (the same library this repo's
database-backed tests already use) — no browser, no dashboard editor, no
filename convention required. Every migration in this repo already wraps
itself in its own `begin;`/`commit;`, so this runs each file as one
transaction, in whatever order you list them.

```bash
# Get this from: Supabase dashboard -> Project Settings -> Database ->
# Connection string -> URI. Never commit it, never put it in shell history
# you'll share — export it in your own shell session only.
export SUPABASE_DB_URL="postgresql://postgres:[password]@[host]:5432/postgres"

npm run db:migrate -- supabase/migrations/2026-09-26-claim-prospective-search-ambiguous-search-id-fix.sql
```

You can pass multiple files (applied in the order given):

```bash
npm run db:migrate -- \
  supabase/migrations/2026-09-25-accept-invitation-ambiguous-search-id-fix.sql \
  supabase/migrations/2026-09-26-claim-prospective-search-ambiguous-search-id-fix.sql
```

Equivalent with plain `psql`, if you prefer it or don't have Node available:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
```

## Every migration here is written to be safely re-run

Every migration in this repo uses `create table if not exists`, `create or
replace function`, `drop policy if exists` + `create policy`, `drop
constraint if exists` + `add constraint`, `add column if not exists`, and
`on conflict ... do nothing` for any one-time backfill — deliberately, so
that applying a migration a second time (e.g. because you're unsure whether
a dashboard paste actually succeeded) is a safe no-op, not a duplicate or an
error. This does not replace knowing what's already live — it just means a
retry after an uncertain/corrupted attempt is safe.
