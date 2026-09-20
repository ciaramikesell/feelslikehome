// Database-level regression test for the live 42702 "column reference
// search_id is ambiguous" bug in accept_invitation. Unlike every other test
// in this suite, this one actually EXECUTES the real function body (parsed
// verbatim out of the migration files) against a real Postgres instance —
// proving the fix works, not just that the SQL text looks right.
//
// This needs a reachable Postgres server, which most environments running
// `npm test` will not have (this repo has no other DB-backed tests and no
// CI Postgres service defined). Rather than making `npm test` flaky/
// environment-dependent, every test here skips itself (not fails) when no
// server is reachable, logging why. Point PGHOST/PGPORT/PGUSER/PGPASSWORD/
// PGDATABASE (or DATABASE_URL) at a real Postgres 14+ to actually run it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const BROKEN_MIGRATION = read('supabase/migrations/2026-09-22-realtor-invitation-acceptance-repair.sql');
const FIXED_MIGRATION = read('supabase/migrations/2026-09-25-accept-invitation-ambiguous-search-id-fix.sql');

function extractFunction(source) {
  // The fixed migration tags its dollar-quote $accept_invitation$ instead
  // of bare $$ (see that file's header comment) — match either so this
  // still finds the pre-fix (bare $$) and fixed (tagged) bodies alike.
  const match = source.match(/create or replace function public\.accept_invitation\(p_token uuid\)[\s\S]*?end; (?:\$\$|\$accept_invitation\$);/);
  if (!match) throw new Error('accept_invitation definition not found in migration source');
  return match[0];
}

const BROKEN_FN = extractFunction(BROKEN_MIGRATION);
const FIXED_FN = extractFunction(FIXED_MIGRATION);

const adminConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
  connectionTimeoutMillis: 2000,
};

async function checkAvailable() {
  const client = new pg.Client(adminConfig);
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    try { await client.end(); } catch { /* already failed to connect */ }
    return false;
  }
}

const available = await checkAvailable();

async function withTestDb(run) {
  const dbName = `flh_accept_invitation_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client(adminConfig);
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const client = new pg.Client({ ...adminConfig, database: dbName });
  await client.connect();
  try {
    await client.query(`
      create extension if not exists pgcrypto;
      create schema if not exists auth;
      create table auth.users (id uuid primary key default gen_random_uuid(), email text);
      create or replace function auth.uid() returns uuid language sql stable as $$
        select current_setting('test.caller_id', true)::uuid
      $$;

      create table public.searches (id uuid primary key default gen_random_uuid(), user_id uuid not null);

      create table public.search_invitations (
        id uuid primary key default gen_random_uuid(),
        token uuid not null default gen_random_uuid() unique,
        search_id uuid,
        invited_by uuid not null,
        invited_email text not null,
        relationship_type text not null default 'co_buyer',
        invitation_direction text not null default 'buyer_to_realtor',
        prospective_search_id uuid,
        status text not null default 'pending',
        expires_at timestamptz not null default now() + interval '7 days',
        responded_at timestamptz
      );

      -- Same shape as 2026-09-05-cobuyer-phase-a-foundation.sql: an
      -- unnamed inline UNIQUE constraint, so Postgres auto-names it
      -- search_members_search_id_user_id_key — the exact name the fixed
      -- function references via ON CONFLICT ON CONSTRAINT.
      create table public.search_members (
        id uuid primary key default gen_random_uuid(),
        search_id uuid not null,
        user_id uuid not null,
        role text not null,
        unique (search_id, user_id)
      );
    `);

    const ciara = '11111111-1111-1111-1111-111111111111';
    const andrew = '22222222-2222-2222-2222-222222222222';
    const ciaraSearch = '33333333-3333-3333-3333-333333333333';
    await client.query('insert into auth.users (id, email) values ($1,$2),($3,$4)', [ciara, 'ciara@example.com', andrew, 'andrew@example.com']);
    await client.query('insert into public.searches (id, user_id) values ($1,$2)', [ciaraSearch, ciara]);

    try {
      return await run({ client, ciara, andrew, ciaraSearch });
    } finally {
      await client.end();
      const cleanupAdmin = new pg.Client(adminConfig);
      await cleanupAdmin.connect();
      await cleanupAdmin.query(`drop database if exists ${dbName}`);
      await cleanupAdmin.end();
    }
  } catch (err) {
    await client.end().catch(() => {});
    const cleanupAdmin = new pg.Client(adminConfig);
    await cleanupAdmin.connect();
    await cleanupAdmin.query(`drop database if exists ${dbName}`);
    await cleanupAdmin.end();
    throw err;
  }
}

async function acceptAs(client, callerId, token) {
  await client.query(`select set_config('test.caller_id', $1, false)`, [callerId]);
  const result = await client.query('select * from public.accept_invitation($1)', [token]);
  return result.rows[0];
}

test('root cause reproduced: the currently-deployed (pre-fix) accept_invitation genuinely raises 42702 on a co-buyer acceptance', { skip: !available && 'no reachable Postgres server (set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE to run this)' }, async () => {
  await withTestDb(async ({ client, ciara, andrew, ciaraSearch }) => {
    await client.query(BROKEN_FN);
    const invite = await client.query(
      `insert into public.search_invitations (search_id, invited_by, invited_email, relationship_type, invitation_direction)
       values ($1,$2,$3,'co_buyer','buyer_to_realtor') returning token`,
      [ciaraSearch, ciara, 'andrew@example.com'],
    );
    const row = await acceptAs(client, andrew, invite.rows[0].token);
    assert.equal(row.success, false);
    assert.match(row.reason, /^error_insert_member_42702$/, `expected the exact reproduced 42702, got: ${row.reason}`);
  });
});

test('fix verified: the corrected accept_invitation accepts a co-buyer invitation with no ambiguity error, creating the membership', { skip: !available && 'no reachable Postgres server (set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE to run this)' }, async () => {
  await withTestDb(async ({ client, ciara, andrew, ciaraSearch }) => {
    await client.query(FIXED_FN);
    const invite = await client.query(
      `insert into public.search_invitations (search_id, invited_by, invited_email, relationship_type, invitation_direction)
       values ($1,$2,$3,'co_buyer','buyer_to_realtor') returning token`,
      [ciaraSearch, ciara, 'andrew@example.com'],
    );
    const row = await acceptAs(client, andrew, invite.rows[0].token);
    assert.equal(row.success, true);
    assert.equal(row.reason, null);
    assert.equal(row.search_id, ciaraSearch);

    const members = await client.query('select * from public.search_members where search_id=$1 and user_id=$2', [ciaraSearch, andrew]);
    assert.equal(members.rowCount, 1);
    assert.equal(members.rows[0].role, 'co_buyer');

    const invitationRow = await client.query('select status from public.search_invitations where token=$1', [invite.rows[0].token]);
    assert.equal(invitationRow.rows[0].status, 'accepted');
  });
});

test('fix verified: the corrected accept_invitation accepts a Realtor invitation (realtor_to_buyer direction) with no ambiguity error', { skip: !available && 'no reachable Postgres server (set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE to run this)' }, async () => {
  await withTestDb(async ({ client, ciara, andrew: realtorId, ciaraSearch }) => {
    await client.query(FIXED_FN);
    // realtorId (reusing the "andrew" auth.users row as the accepting
    // Realtor here) needs their own owned search for the realtor_to_buyer
    // branch's search_not_ready check.
    const realtorSearch = '88888888-8888-8888-8888-888888888888';
    await client.query('insert into public.searches (id, user_id) values ($1,$2)', [realtorSearch, realtorId]);
    const invite = await client.query(
      `insert into public.search_invitations (search_id, invited_by, invited_email, relationship_type, invitation_direction)
       values (null,$1,$2,'realtor','realtor_to_buyer') returning token`,
      [ciara, 'andrew@example.com'],
    );
    const row = await acceptAs(client, realtorId, invite.rows[0].token);
    assert.equal(row.success, true);
    assert.equal(row.search_id, realtorSearch);

    const members = await client.query('select role from public.search_members where search_id=$1 and user_id=$2', [realtorSearch, ciara]);
    assert.equal(members.rowCount, 1);
    assert.equal(members.rows[0].role, 'realtor');
  });
});

test('fix verified: re-accepting an already-accepted invitation is idempotent — safe success, no duplicate membership row', { skip: !available && 'no reachable Postgres server (set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE to run this)' }, async () => {
  await withTestDb(async ({ client, ciara, andrew: realtorId }) => {
    await client.query(FIXED_FN);
    const realtorSearch = '99999999-9999-9999-9999-999999999999';
    await client.query('insert into public.searches (id, user_id) values ($1,$2)', [realtorSearch, realtorId]);
    const invite = await client.query(
      `insert into public.search_invitations (search_id, invited_by, invited_email, relationship_type, invitation_direction)
       values (null,$1,$2,'realtor','realtor_to_buyer') returning token`,
      [ciara, 'andrew@example.com'],
    );
    const first = await acceptAs(client, realtorId, invite.rows[0].token);
    assert.equal(first.success, true);
    const second = await acceptAs(client, realtorId, invite.rows[0].token);
    assert.equal(second.success, true);
    assert.equal(second.reason, 'already_member');

    const members = await client.query('select count(*)::int as n from public.search_members where search_id=$1 and user_id=$2', [realtorSearch, ciara]);
    assert.equal(members.rows[0].n, 1, 'idempotent re-acceptance must not create a duplicate membership row');
  });
});
