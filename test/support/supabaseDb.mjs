// Real-Postgres harness for authorization regression tests.
//
// Builds a throwaway database from the repository's own SQL (schema.sql plus
// the migrations the snapshot does not yet contain) on top of a minimal
// Supabase shim (auth.users, auth.uid(), anon/authenticated/service_role), and
// exposes a tiny Supabase-shaped client whose queries execute through psql as
// the `authenticated` role with `request.jwt.claim.sub` set — so RLS policies,
// column grants, triggers, and SECURITY DEFINER RPCs behave exactly as they do
// for a signed-in app user. No npm dependency: only the `psql` binary.
//
// Opt-in: set FLH_TEST_PGHOST (socket directory or host) and optionally
// FLH_TEST_PGPORT / FLH_TEST_PGUSER (a superuser, default `postgres`). Without
// FLH_TEST_PGHOST the database tests skip. See docs/database-tests.md.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const ROOT = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

export const DB_TESTS_ENABLED = Boolean(process.env.FLH_TEST_PGHOST);
export const DB_SKIP_REASON = 'set FLH_TEST_PGHOST to run real-Postgres authorization tests (docs/database-tests.md)';

// schema.sql is a cumulative snapshot. These are the migrations it does not
// yet contain, in production order. Keep this list current when a migration
// lands without a matching schema.sql update.
export const POST_SNAPSHOT_MIGRATIONS = [
  // schema.sql still defines the pre-display-name collaborator context; the
  // later definition changes its return type, which Postgres cannot do in place.
  { sql: 'drop function public.resolve_collaborator_search_context(uuid);' },
  { file: 'supabase/migrations/2026-09-16-my-search-collaborator-display-name.sql' },
  { file: 'supabase/migrations/2026-09-16-realtor-suggestions-homes-select-fix.sql' },
  { file: 'supabase/migrations/2026-09-17-listing-import-z-privileges-hotfix.sql' },
  { file: 'supabase/migrations/2026-09-18-people-workspace-draft-select-privileges.sql' },
  { file: 'supabase/migrations/2026-09-18-tour-evaluations.sql' },
  { file: 'supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql' },
  { file: 'supabase/migrations/2026-10-07-cobuyer-compare-garage-parity.sql' },
  { file: 'supabase/migrations/2026-10-07-invitation-acceptance-conflict-targets.sql' },
  { file: 'supabase/migrations/2026-10-07-onboarding-state.sql' },
  // Conditional bridge: a no-op here (the 4-column version already exists).
  { file: 'supabase/migrations/2026-10-08-collaborator-context-return-type.sql' },
];

const SUPABASE_SHIM = `
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key, email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

function psql(database, script, { checkFunctionBodies = false } = {}) {
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', process.env.FLH_TEST_PGHOST, '-U', process.env.FLH_TEST_PGUSER || 'postgres', '-d', database, '-f', '-'];
  if (process.env.FLH_TEST_PGPORT) args.push('-p', process.env.FLH_TEST_PGPORT);
  // Repository SQL forward-references functions/tables the way pg_dump output
  // does; Supabase's editor tolerates that, so validate bodies at call time.
  const env = { ...process.env, PGOPTIONS: `-c check_function_bodies=${checkFunctionBodies ? 'on' : 'off'} -c client_min_messages=warning` };
  const result = spawnSync('psql', args, { input: script, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  const errorLine = (result.stderr || '').split('\n').find((line) => /ERROR:/.test(line));
  return { ok: result.status === 0, stdout: result.stdout.trim(), error: errorLine ? errorLine.replace(/^.*ERROR:\s*/, '') : (result.status === 0 ? null : result.stderr.trim()) };
}

function must(result, context) {
  if (!result.ok) throw new Error(`${context}: ${result.error}`);
  return result;
}

/* ------------------------------- SQL literals ------------------------------- */

const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsupported identifier: ${name}`);
  return name;
};
const text = (value) => `'${String(value).replace(/'/g, "''")}'`;
function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(`{${value.map((v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`);
  if (typeof value === 'object') return text(JSON.stringify(value));
  return text(value);
}
const columnList = (columns) => columns.split(',').map((c) => c.trim()).filter(Boolean).map((c) => (c === '*' ? '*' : ident(c))).join(', ');

/* ------------------------- Supabase-shaped client ------------------------- */

class Query {
  constructor(db, userId, table) {
    Object.assign(this, { db, userId, table: ident(table), filters: [], orderBy: [], mode: 'select', columns: '*', returning: null, cardinality: 'many' });
  }
  select(columns = '*') {
    if (this.mode === 'select') this.columns = columns;
    else this.returning = columns;
    return this;
  }
  insert(row) { return Object.assign(this, { mode: 'insert', row }); }
  update(row) { return Object.assign(this, { mode: 'update', row }); }
  upsert(row, { onConflict } = {}) { return Object.assign(this, { mode: 'upsert', row, onConflict }); }
  delete() { return Object.assign(this, { mode: 'delete' }); }
  eq(column, value) { this.filters.push(`${ident(column)} = ${literal(value)}`); return this; }
  in(column, values) { this.filters.push(values.length ? `${ident(column)} in (${values.map(literal).join(', ')})` : 'false'); return this; }
  order(column, { ascending = true } = {}) { this.orderBy.push(`${ident(column)} ${ascending ? 'asc' : 'desc'}`); return this; }
  maybeSingle() { this.cardinality = 'maybe'; return this; }
  single() { this.cardinality = 'one'; return this; }

  toSql() {
    const where = this.filters.length ? ` where ${this.filters.join(' and ')}` : '';
    const table = `public.${this.table}`;
    if (this.mode === 'select') {
      const order = this.orderBy.length ? ` order by ${this.orderBy.join(', ')}` : '';
      return `select coalesce(json_agg(t), '[]'::json) from (select ${columnList(this.columns)} from ${table}${where}${order}) t`;
    }
    const returning = columnList(this.returning || 'id');
    if (this.mode === 'delete') return `with r as (delete from ${table}${where} returning ${returning}) select coalesce(json_agg(r), '[]'::json) from r`;
    const columns = Object.keys(this.row).map(ident);
    const source = `select ${columns.join(', ')} from jsonb_populate_record(null::${table}, ${literal(this.row)})`;
    if (this.mode === 'update') {
      return `with r as (update ${table} set (${columns.join(', ')}) = (${source})${where} returning ${returning}) select coalesce(json_agg(r), '[]'::json) from r`;
    }
    let conflict = '';
    if (this.mode === 'upsert') {
      const keys = (this.onConflict || 'id').split(',').map((c) => ident(c.trim()));
      const updates = columns.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
      conflict = ` on conflict (${keys.join(', ')}) do ${updates.length ? `update set ${updates.join(', ')}` : 'nothing'}`;
    }
    return `with r as (insert into ${table} (${columns.join(', ')}) ${source}${conflict} returning ${returning}) select coalesce(json_agg(r), '[]'::json) from r`;
  }

  then(resolve, reject) {
    try {
      const { data, error } = this.db.runAs(this.userId, this.toSql());
      if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
      if (this.cardinality === 'many') return Promise.resolve({ data, error: null }).then(resolve, reject);
      if (data.length > 1 || (this.cardinality === 'one' && data.length !== 1)) {
        return Promise.resolve({ data: null, error: { message: `expected one row, got ${data.length}` } }).then(resolve, reject);
      }
      return Promise.resolve({ data: data[0] || null, error: null }).then(resolve, reject);
    } catch (err) {
      return Promise.reject(err).then(resolve, reject);
    }
  }
}

// Options (both default to the repository's current state):
//   schemaSql — the baseline snapshot to run instead of supabase/schema.sql
//   steps     — the migration steps to run after it, instead of
//               POST_SNAPSHOT_MIGRATIONS ({ file } or { sql } each)
// Used to rebuild a known-drifted production state and prove a repair.
export function createTestDatabase({ schemaSql = null, steps = POST_SNAPSHOT_MIGRATIONS } = {}) {
  const maintenance = process.env.FLH_TEST_PGDATABASE || 'postgres';
  const name = `flh_test_${process.pid}_${Date.now()}`;
  must(psql(maintenance, `create database ${name};`), 'create database');

  must(psql(name, SUPABASE_SHIM), 'Supabase shim');
  // schema.sql is a sequence of begin/commit blocks; run it as-is, the way an
  // operator would, then the post-snapshot migrations each in one transaction.
  must(psql(name, schemaSql ?? read('supabase/schema.sql')), 'schema.sql');
  for (const step of steps) {
    const sql = step.sql || read(step.file);
    must(psql(name, sql), step.file || step.sql);
  }

  const db = {
    name,
    // Superuser query returning parsed JSON rows — for fixtures and for
    // asserting ground truth independently of what RLS lets a caller see.
    admin(query) {
      const { stdout } = must(psql(name, `select coalesce(json_agg(t), '[]'::json) from (${query}) t;`), query);
      return JSON.parse(stdout || '[]');
    },
    exec(statement) { must(psql(name, statement), statement); },
    // Runs a repository SQL file the way an operator pastes it into the
    // Supabase SQL Editor (function bodies validated, as Postgres does by
    // default); returns { ok, error } instead of throwing.
    applyFile(file) { const result = psql(name, read(file), { checkFunctionBodies: true }); return { ok: result.ok, error: result.error }; },
    runAs(userId, query) {
      const script = `begin;\nset local role authenticated;\nset local request.jwt.claim.sub = ${text(userId)};\n${query};\ncommit;\n`;
      const result = psql(name, script);
      if (!result.ok) return { data: null, error: { message: result.error } };
      return { data: JSON.parse(result.stdout || '[]'), error: null };
    },
    createUser({ email, firstName = null, lastName = null }) {
      const id = randomUUID();
      const meta = { ...(firstName ? { first_name: firstName } : {}), ...(lastName ? { last_name: lastName } : {}) };
      db.exec(`insert into auth.users (id, email, raw_user_meta_data) values (${text(id)}, ${text(email)}, ${literal(meta)});`);
      return id;
    },
    clientFor(userId) {
      return {
        from: (table) => new Query(db, userId, table),
        rpc: (fn, args = {}) => {
          const named = Object.entries(args).map(([key, value]) => `${ident(key)} => ${literal(value)}`).join(', ');
          const query = `select coalesce(json_agg(t), '[]'::json) from public.${ident(fn)}(${named}) t`;
          return Promise.resolve(db.runAs(userId, query));
        },
      };
    },
    drop() { psql(maintenance, `drop database if exists ${name} with (force);`); },
  };
  return db;
}
