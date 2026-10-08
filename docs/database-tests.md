# Real-Postgres authorization tests

Most of FLH's tests check source text. That cannot catch a SQL function that
is syntactically fine but fails at runtime, or an RLS policy that behaves
differently from what its text suggests. The database tests build a throwaway
Postgres from the repository's own SQL and run the real data-layer functions
(`src/lib/supabase/*.js`) as real signed-in users.

They found, on first run:

* every invitation acceptance failing with 42702 (`2026-10-07-invitation-acceptance-conflict-targets.sql`);
* co-buyer Compare Match disagreeing with the co-buyer's own Match (`2026-10-07-cobuyer-compare-garage-parity.sql`);
* `schema.sql` ending inside an open transaction, so a fresh `psql` install silently rolled back the Realtor-started-searches block.

## Running them

They are opt-in and skip (with a reason) unless `FLH_TEST_PGHOST` is set.
Any PostgreSQL 15+ superuser works. A throwaway local cluster:

```bash
# once (as a non-root user, e.g. `su postgres`):
initdb -D ~/flh-test/data -A trust
pg_ctl -D ~/flh-test/data -o "-k $HOME/flh-test -p 54329 -c listen_addresses=" -l ~/flh-test/log start

# each run:
FLH_TEST_PGHOST=$HOME/flh-test FLH_TEST_PGPORT=54329 npm test
```

| Variable | Meaning | Default |
|---|---|---|
| `FLH_TEST_PGHOST` | Socket directory or host. Enables the tests. | unset (skip) |
| `FLH_TEST_PGPORT` | Port | psql default |
| `FLH_TEST_PGUSER` | Superuser | `postgres` |
| `FLH_TEST_PGDATABASE` | Maintenance DB used to create/drop test DBs | `postgres` |

Each test file creates its own `flh_test_<pid>_<time>` database and drops it.

## How it works

`test/support/supabaseDb.mjs`:

1. Installs a minimal Supabase shim: `anon` / `authenticated` /
   `service_role` roles, `auth.users`, and `auth.uid()` reading
   `request.jwt.claim.sub`, the same claim Supabase sets.
2. Runs `supabase/schema.sql`, then `POST_SNAPSHOT_MIGRATIONS`: the
   migrations `schema.sql` does not yet contain, in production order.
3. Provides `clientFor(userId)`, a Supabase-shaped client
   (`from().select/insert/update/upsert/delete/eq/in/order/single/maybeSingle`,
   `rpc()`). It executes each call through `psql` inside
   `set local role authenticated` with that user's id as the JWT subject.
   RLS, column grants, triggers and SECURITY DEFINER functions all apply as
   they do in production.
4. Provides `admin(sql)` for fixtures and for checking ground truth
   independently of what RLS shows a caller.

`test/support/aliasHooks.mjs` maps the Next.js `@/` import alias so
application modules can be imported unmodified.

No npm dependency is involved: only the `psql` binary.

## Maintaining it

When a migration lands without a matching `schema.sql` update, append it to
`POST_SNAPSHOT_MIGRATIONS`. If it changes a function's return type that
`schema.sql` still defines the old way, add a `{ sql: 'drop function …' }` step
before it. That is already needed for `resolve_collaborator_search_context`.

## Limits

The shim is not GoTrue: there are no sessions, refresh tokens, email
confirmation, or Storage. The tests cover authorization and SQL behavior, not
authentication flows or HTTP/PostgREST serialization.
