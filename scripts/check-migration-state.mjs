#!/usr/bin/env node
// Read-only. Queries the live database directly for the exact objects this
// session's repairs depend on, and prints a clear present/absent + (for the
// two 42702 fixes) fixed/broken verdict for each — the only trustworthy way
// to know what's actually live, since `supabase migration list`/`db push`
// report nothing useful here (see docs/deploying-migrations.md: this repo's
// migration filenames don't match the CLI's required <timestamp>_name.sql
// pattern, so every local file is silently skipped and the remote history
// table — almost certainly never populated, since every migration to date
// was applied by hand — can't be reconciled through the CLI either).
// Deployment/build logs and GitHub commit state say nothing about database
// state; this connects to the database itself.
//
// Usage:
//   SUPABASE_DB_URL="postgresql://postgres:[password]@[host]:5432/postgres" \
//     npm run db:check
import pg from 'pg';

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "Set SUPABASE_DB_URL (or DATABASE_URL) to this project's Postgres connection string first.\n" +
    'Find it in the Supabase dashboard: Project Settings -> Database -> Connection string -> URI.'
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

let anyFail = false;
const ok = (label, detail = '') => { console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`); };
const fail = (label, detail = '') => { anyFail = true; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); };

async function functionSource(name) {
  const res = await client.query(
    `select pg_get_functiondef(p.oid) as def
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1
     order by p.oid desc limit 1`,
    [name],
  );
  return res.rows[0]?.def ?? null;
}

async function columnExists(table, column) {
  const res = await client.query(
    `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column],
  );
  return res.rowCount > 0;
}

async function tableExists(table) {
  const res = await client.query(
    `select 1 from information_schema.tables where table_schema='public' and table_name=$1`,
    [table],
  );
  return res.rowCount > 0;
}

async function constraintExists(name) {
  const res = await client.query(`select 1 from pg_constraint where conname=$1`, [name]);
  return res.rowCount > 0;
}

console.log('\n== profiles.first_name / last_name ==');
{
  const first = await columnExists('profiles', 'first_name');
  const last = await columnExists('profiles', 'last_name');
  first ? ok('profiles.first_name exists') : fail('profiles.first_name is MISSING');
  last ? ok('profiles.last_name exists') : fail('profiles.last_name is MISSING');
}

console.log('\n== resolve_search_relationships(uuid) ==');
{
  const def = await functionSource('resolve_search_relationships');
  def ? ok('function exists') : fail('function is MISSING (PGRST202 for any caller)');
}

console.log('\n== search_entitlements + resolve_search_entitlement(uuid) ==');
{
  const table = await tableExists('search_entitlements');
  table ? ok('search_entitlements table exists') : fail('search_entitlements table is MISSING');
  const def = await functionSource('resolve_search_entitlement');
  def ? ok('function exists') : fail('function is MISSING');
}

console.log('\n== accept_invitation(uuid) — the confirmed 42702 repair ==');
{
  const def = await functionSource('accept_invitation');
  if (!def) {
    fail('function is MISSING entirely');
  } else {
    const hasFix = def.includes('on conflict on constraint search_members_search_id_user_id_key');
    const hasBroken = /on conflict\s*\(\s*search_id\s*,\s*user_id\s*\)/i.test(def);
    if (hasFix && !hasBroken) ok('LIVE definition contains the fix (ON CONFLICT ON CONSTRAINT search_members_search_id_user_id_key)');
    else if (hasBroken) fail('LIVE definition STILL has the ambiguous ON CONFLICT (search_id, user_id) — 2026-09-25 migration not applied');
    else fail('LIVE definition has neither the known-broken nor the known-fixed form — inspect manually, something else is live');
  }
}

console.log('\n== claim_prospective_search(uuid, jsonb) — the proactive sibling repair ==');
{
  const def = await functionSource('claim_prospective_search');
  if (!def) {
    fail('function is MISSING entirely');
  } else {
    const hasFix = def.includes('on conflict on constraint search_member_priorities_search_id_user_id_key')
      && def.includes('on conflict on constraint search_members_search_id_user_id_key');
    const hasBroken = /on conflict\s*\(\s*search_id\s*,\s*user_id\s*\)/i.test(def);
    if (hasFix && !hasBroken) ok('LIVE definition contains the fix (both ON CONFLICT ON CONSTRAINT clauses)');
    else if (hasBroken) fail('LIVE definition STILL has an ambiguous ON CONFLICT (search_id, user_id) — 2026-09-26 migration not applied');
    else fail('LIVE definition has neither the known-broken nor the known-fixed form — inspect manually');
  }
}

console.log('\n== supporting constraints the two fixes above depend on ==');
{
  const smKey = await constraintExists('search_members_search_id_user_id_key');
  smKey ? ok('search_members_search_id_user_id_key exists') : fail('search_members_search_id_user_id_key is MISSING — the ON CONFLICT ON CONSTRAINT fix cannot work without it');
  const smpKey = await constraintExists('search_member_priorities_search_id_user_id_key');
  smpKey ? ok('search_member_priorities_search_id_user_id_key exists') : fail('search_member_priorities_search_id_user_id_key is MISSING');
}

await client.end();
console.log(`\n${anyFail ? 'One or more checks FAILED — see ❌ lines above for what still needs to be applied.' : 'All checks passed.'}\n`);
process.exit(anyFail ? 1 : 0);
