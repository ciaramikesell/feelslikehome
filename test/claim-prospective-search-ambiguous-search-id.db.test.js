// Database-level regression test for the same 42702 pattern proven in
// accept_invitation, now fixed proactively in its sibling
// claim_prospective_search. See accept-invitation-ambiguous-search-id.db
// .test.js for the shared rationale (skips itself, does not fail, when no
// Postgres server is reachable — this repo has no CI Postgres service).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const BROKEN_MIGRATION = read('supabase/migrations/2026-09-22-realtor-invitation-acceptance-repair.sql');
const FIXED_MIGRATION = read('supabase/migrations/2026-09-26-claim-prospective-search-ambiguous-search-id-fix.sql');

function extractFunction(source) {
  const match = source.match(/create or replace function public\.claim_prospective_search\(p_token uuid, p_confirmed_priorities jsonb\)[\s\S]*?end; (?:\$\$|\$claim_prospective_search\$);/);
  if (!match) throw new Error('claim_prospective_search definition not found in migration source');
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
  const dbName = `flh_claim_prospective_search_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

      create table public.profiles (id uuid primary key, onboarding_complete boolean not null default false);
      create table public.searches (id uuid primary key default gen_random_uuid(), user_id uuid not null unique);

      create table public.prospective_searches (
        id uuid primary key default gen_random_uuid(),
        started_by uuid not null,
        client_name text,
        draft_priorities jsonb not null default '{}'::jsonb,
        status text not null default 'draft'
      );

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

      create table public.search_members (
        id uuid primary key default gen_random_uuid(),
        search_id uuid not null,
        user_id uuid not null,
        role text not null,
        unique (search_id, user_id)
      );

      -- Same shape as 2026-09-05-cobuyer-phase-a-foundation.sql: an
      -- unnamed inline UNIQUE constraint, auto-named
      -- search_member_priorities_search_id_user_id_key — the exact name
      -- the fixed function references via ON CONFLICT ON CONSTRAINT.
      create table public.search_member_priorities (
        id uuid primary key default gen_random_uuid(),
        search_id uuid not null,
        user_id uuid not null,
        priorities jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        unique (search_id, user_id)
      );
    `);

    const whitney = '11111111-1111-1111-1111-111111111111';
    const andrew = '22222222-2222-2222-2222-222222222222';
    await client.query('insert into auth.users (id, email) values ($1,$2),($3,$4)', [whitney, 'whitney@example.com', andrew, 'andrew@example.com']);
    await client.query('insert into public.profiles (id, onboarding_complete) values ($1, false)', [andrew]);
    const andrewSearch = '55555555-5555-5555-5555-555555555555';
    await client.query('insert into public.searches (id, user_id) values ($1,$2)', [andrewSearch, andrew]);

    try {
      return await run({ client, whitney, andrew, andrewSearch });
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

async function seedInvitation(client, { whitney, andrew }) {
  const draftId = '33333333-3333-3333-3333-333333333333';
  await client.query(
    `insert into public.prospective_searches (id, started_by, client_name, status) values ($1,$2,'Andrew','invited')`,
    [draftId, whitney],
  );
  const invite = await client.query(
    `insert into public.search_invitations (invited_by, invited_email, relationship_type, invitation_direction, prospective_search_id)
     values ($1,$2,'realtor','realtor_to_buyer',$3) returning token`,
    [whitney, 'andrew@example.com', draftId],
  );
  return invite.rows[0].token;
}

async function claimAs(client, callerId, token, priorities = {}) {
  await client.query(`select set_config('test.caller_id', $1, false)`, [callerId]);
  const result = await client.query('select * from public.claim_prospective_search($1, $2)', [token, JSON.stringify(priorities)]);
  return result.rows[0];
}

test('root cause reproduced: the currently-deployed (pre-fix) claim_prospective_search genuinely raises 42702 saving confirmed priorities', { skip: !available && 'no reachable Postgres server (set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE to run this)' }, async () => {
  await withTestDb(async ({ client, whitney, andrew }) => {
    await client.query(BROKEN_FN);
    const token = await seedInvitation(client, { whitney, andrew });
    // Unlike accept_invitation, the pre-fix claim_prospective_search has no
    // exception handler at all, so the 42702 reaches the caller as a raw
    // thrown Postgres error rather than a graceful {success:false} row —
    // itself part of why this fix also adds the same stage-tracked handler
    // accept_invitation already has.
    await assert.rejects(
      () => claimAs(client, andrew, token, { budget: { value: '500000' } }),
      (err) => {
        assert.equal(err.code, '42702');
        assert.match(err.message, /column reference "search_id" is ambiguous/);
        return true;
      },
    );
  });
});

test('fix verified: the corrected claim_prospective_search saves priorities and creates the Realtor membership with no ambiguity error', { skip: !available && 'no reachable Postgres server (set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE to run this)' }, async () => {
  await withTestDb(async ({ client, whitney, andrew, andrewSearch }) => {
    await client.query(FIXED_FN);
    const token = await seedInvitation(client, { whitney, andrew });
    const row = await claimAs(client, andrew, token, { budget: { value: '500000' } });
    assert.equal(row.success, true);
    assert.equal(row.reason, null);
    assert.equal(row.search_id, andrewSearch);

    const priorities = await client.query('select priorities from public.search_member_priorities where search_id=$1 and user_id=$2', [andrewSearch, andrew]);
    assert.equal(priorities.rowCount, 1);
    assert.deepEqual(priorities.rows[0].priorities, { budget: { value: '500000' } });

    const members = await client.query('select role from public.search_members where search_id=$1 and user_id=$2', [andrewSearch, whitney]);
    assert.equal(members.rowCount, 1);
    assert.equal(members.rows[0].role, 'realtor');

    const invitationRow = await client.query('select status, prospective_search_id from public.search_invitations where token=$1', [token]);
    assert.equal(invitationRow.rows[0].status, 'accepted');
    assert.equal(invitationRow.rows[0].prospective_search_id, null);

    const profile = await client.query('select onboarding_complete from public.profiles where id=$1', [andrew]);
    assert.equal(profile.rows[0].onboarding_complete, true);

    const drafts = await client.query('select count(*)::int as n from public.prospective_searches');
    assert.equal(drafts.rows[0].n, 0, 'the claimed draft should be cleaned up');
  });
});

test('fix verified: re-claiming an already-claimed invitation is idempotent — safe "already_claimed" success, no duplicate rows', { skip: !available && 'no reachable Postgres server (set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE to run this)' }, async () => {
  await withTestDb(async ({ client, whitney, andrew, andrewSearch }) => {
    await client.query(FIXED_FN);
    const token = await seedInvitation(client, { whitney, andrew });
    const first = await claimAs(client, andrew, token, { budget: { value: '500000' } });
    assert.equal(first.success, true);

    const second = await claimAs(client, andrew, token, { budget: { value: '999999' } });
    assert.equal(second.success, true);
    assert.equal(second.reason, 'already_claimed');

    const members = await client.query('select count(*)::int as n from public.search_members where search_id=$1 and user_id=$2', [andrewSearch, whitney]);
    assert.equal(members.rows[0].n, 1, 'idempotent re-claim must not create a duplicate membership row');
    // Priorities from the first (successful) claim must be untouched by the
    // second, already-claimed attempt — it never reaches the save step.
    const priorities = await client.query('select priorities from public.search_member_priorities where search_id=$1 and user_id=$2', [andrewSearch, andrew]);
    assert.deepEqual(priorities.rows[0].priorities, { budget: { value: '500000' } });
  });
});
