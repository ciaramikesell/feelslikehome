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
  { file: 'supabase/migrations/2026-10-12-realtor-access-and-home-ownership.sql' },
  { file: 'supabase/migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql' },
  { file: 'supabase/migrations/2026-10-15-buyer-realtor-management.sql' },
  { file: 'supabase/migrations/2026-10-16-realtor-my-clients.sql' },
  { file: 'supabase/migrations/2026-10-17-home-facts-details.sql' },
  { file: 'supabase/migrations/2026-10-18-laundry-location.sql' },
  { file: 'supabase/migrations/2026-10-18-home-floor-plans.sql' },
  { file: 'supabase/migrations/2026-10-18-home-floor-plans-storage.sql' },
];

const SUPABASE_SHIM = `
do $$ begin create role anon nologin; exception when duplicate_object or unique_violation then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end $$;
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
-- Supabase Storage, as far as its RLS is concerned: the Storage API runs each
-- upload / remove / signed-URL request as the caller against storage.objects
-- (bucket limits are checked by the API itself; StorageBucket below mirrors
-- that from storage.buckets).
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text not null,
  owner uuid, owner_id text, metadata jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as
  $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
`;

function psql(database, script, { checkFunctionBodies = false } = {}) {
  // VERBOSITY=verbose prefixes each ERROR with its SQLSTATE, which becomes the
  // error's `code` (as supabase-js reports PostgREST errors).
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', process.env.FLH_TEST_PGHOST, '-U', process.env.FLH_TEST_PGUSER || 'postgres', '-d', database, '-f', '-'];
  if (process.env.FLH_TEST_PGPORT) args.push('-p', process.env.FLH_TEST_PGPORT);
  // Repository SQL forward-references functions/tables the way pg_dump output
  // does; Supabase's editor tolerates that, so validate bodies at call time.
  const env = { ...process.env, PGOPTIONS: `-c check_function_bodies=${checkFunctionBodies ? 'on' : 'off'} -c client_min_messages=warning` };
  const result = spawnSync('psql', args, { input: script, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  const errorLine = (result.stderr || '').split('\n').find((line) => /ERROR:/.test(line));
  const [, code = null, message = null] = errorLine?.match(/ERROR:\s*(?:([0-9A-Z]{5}):\s*)?(.*)$/) || [];
  return { ok: result.status === 0, stdout: result.stdout.trim(), code, error: errorLine ? message : (result.status === 0 ? null : result.stderr.trim()) };
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

// Splits a select list at top-level commas, so `id,homes(id,address)` is two
// entries: a column and an embedded relation.
function selectEntries(columns) {
  const entries = [];
  let depth = 0; let current = '';
  for (const char of columns) {
    if (char === ',' && depth === 0) { entries.push(current.trim()); current = ''; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    current += char;
  }
  entries.push(current.trim());
  return entries.filter(Boolean);
}

// A to-one embed the way PostgREST runs it: the embedded table is aliased
// `<table>_1`, so a missing column fails exactly as in production
// ("column homes_1.laundry_location does not exist", 42703), and the embedded
// row is read under the caller's RLS (an invisible row embeds as null).
// Supported shape only: `<table>(<columns>)` on a row whose foreign key is
// `<table minus trailing s>_id` (realtor_suggestions.home_id -> homes.id).
function embedSql(base, entry) {
  const match = entry.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/);
  if (!match) return null;
  const [, relation, inner] = match;
  const alias = `${ident(relation)}_1`;
  const foreignKey = ident(`${relation.replace(/s$/, '')}_id`);
  const columns = inner.split(',').map((c) => c.trim()).filter(Boolean).map((c) => `${alias}.${ident(c)}`).join(', ');
  return `(select to_json(e) from (select ${columns} from public.${ident(relation)} ${alias} where ${alias}.id = ${base}.${foreignKey}) e) as ${ident(relation)}`;
}

/* ------------------------- Supabase-shaped client ------------------------- */

// storage.from(bucket): upload / remove / createSignedUrls as Supabase Storage
// (storage-api v1.25.7) runs them against Postgres. An upload has two stages:
//   1. pre-check: the INSERT runs as the caller, so storage.objects policies
//      decide, and is then rolled back (Uploader.canUpload → testPermission);
//   2. after the file is written: the real INSERT runs as Storage's admin
//      role, which RLS does not apply to (Uploader.completeUpload →
//      asSuperUser). Here that is the superuser.
// So an INSERT policy only ever sees rows committed before its pre-check —
// two uploads whose pre-checks both run before either completes both pass.
// preauthorizeUpload / completeUpload expose the stages so tests can
// interleave them; upload() runs both back to back. A refused pre-check is
// 403, a bad MIME type 400, an oversized file 413, an existing name 409; a
// remove silently skips objects the caller may not see or delete; a signed
// URL is issued only for an object the caller may SELECT.
class StorageBucket {
  constructor(db, userId, bucket) { Object.assign(this, { db, userId, bucket }); }
  async preauthorizeUpload(path, file, { contentType, upsert = false } = {}) {
    if (upsert) throw new Error('test storage supports upsert: false only');
    const [config] = this.db.admin(`select file_size_limit, allowed_mime_types from storage.buckets where id = ${text(this.bucket)}`);
    if (!config) return { error: { statusCode: '404', message: 'Bucket not found' } };
    const type = contentType || file.type;
    if (config.allowed_mime_types && !config.allowed_mime_types.includes(type)) return { error: { statusCode: '400', message: `mime type ${type} is not supported` } };
    if (config.file_size_limit && file.size > config.file_size_limit) return { error: { statusCode: '413', message: 'The object exceeded the maximum allowed size' } };
    const { error } = this.db.runAs(this.userId, this.insertSql(path, file, type), { rollback: true });
    if (error?.code === '23505') return { error: { statusCode: '409', message: 'The resource already exists' } };
    if (error) return { error: { statusCode: '403', message: 'new row violates row-level security policy' } };
    return { error: null };
  }
  async completeUpload(path, file, { contentType } = {}) {
    try {
      this.db.exec(`${this.insertSql(path, file, contentType || file.type)};`);
    } catch (err) {
      return { data: null, error: { statusCode: '500', message: err.message } };
    }
    return { data: { path }, error: null };
  }
  async upload(path, file, options = {}) {
    const pre = await this.preauthorizeUpload(path, file, options);
    if (pre.error) return { data: null, error: pre.error };
    return this.completeUpload(path, file, options);
  }
  insertSql(path, file, type) {
    return `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values (${text(this.bucket)}, ${text(path)}, ${text(this.userId)}, ${text(this.userId)}, ${literal({ mimetype: type, size: file.size })})`;
  }
  async remove(paths) {
    if (!paths.length) return { data: [], error: null };
    const query = `with r as (delete from storage.objects where bucket_id = ${text(this.bucket)} and name in (${paths.map(text).join(', ')}) returning name) select coalesce(json_agg(r), '[]'::json) from r`;
    return this.db.runAs(this.userId, query);
  }
  // Objects directly in `folder` the caller may SELECT, as { name } like list().
  async list(folder) {
    const query = `select coalesce(json_agg(json_build_object('name', split_part(name, '/', 2))), '[]'::json) from storage.objects where bucket_id = ${text(this.bucket)} and name like ${text(`${folder}/%`)}`;
    return this.db.runAs(this.userId, query);
  }
  async createSignedUrls(paths, expiresIn) {
    const query = `select coalesce(json_agg(name), '[]'::json) from storage.objects where bucket_id = ${text(this.bucket)} and name in (${paths.map(text).join(', ') || 'null'})`;
    const { data, error } = this.db.runAs(this.userId, query);
    if (error) return { data: null, error };
    return {
      data: paths.map((path) => (data.includes(path)
        ? { path, signedUrl: `https://storage.test/object/sign/${this.bucket}/${path}?expires=${expiresIn}`, error: null }
        : { path, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' })),
      error: null,
    };
  }
}

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
      const entries = selectEntries(this.columns);
      if (entries.some((entry) => entry.includes('('))) {
        const list = entries.map((entry) => embedSql(this.table, entry) || (entry === '*' ? `${this.table}.*` : `${this.table}.${ident(entry)}`)).join(', ');
        return `select coalesce(json_agg(t), '[]'::json) from (select ${list} from ${table} ${this.table}${where}${order}) t`;
      }
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
    // rollback: run the statement and roll it back (a permission pre-check).
    runAs(userId, query, { rollback = false } = {}) {
      const script = `begin;\nset local role authenticated;\nset local request.jwt.claim.sub = ${text(userId)};\n${query};\n${rollback ? 'rollback' : 'commit'};\n`;
      const result = psql(name, script);
      if (!result.ok) return { data: null, error: { code: result.code, message: result.error } };
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
        storage: { from: (bucket) => new StorageBucket(db, userId, bucket) },
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
