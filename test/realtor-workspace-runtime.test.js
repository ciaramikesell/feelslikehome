import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRealtorWorkspace } from '../src/lib/realtorWorkspace.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = read('src/app/(app)/people/page.js');
const layout = read('src/app/(app)/layout.js');
const collaboration = read('src/lib/supabase/collaboration.js');
const migration = read('supabase/migrations/2026-09-18-realtor-workspace-draft-select-privilege.sql');
const detail = read('src/app/(app)/people/[searchId]/page.js');
const shell = read('src/components/AppShell.jsx');
const peopleError = read('src/app/(app)/people/error.js');
const detailError = read('src/app/(app)/people/[searchId]/error.js');

async function executeWorkspace({ relationships = [], drafts = [] } = {}) {
  const calls = [];
  const result = await loadRealtorWorkspace({
    supabase: { kind: 'authenticated-test-client' },
    userId: 'realtor-a',
    loadRelationships: async (client, userId) => {
      calls.push(['relationships', client.kind, userId]);
      return relationships;
    },
    loadDrafts: async (client) => {
      calls.push(['drafts', client.kind]);
      return drafts;
    },
  });
  return { result, calls };
}

test('first-run Realtor executes the root workspace path with two successful empty collections', async () => {
  const { result, calls } = await executeWorkspace();
  assert.deepEqual(result, { relationships: [], prospective: [] });
  assert.deepEqual(calls.map(([name]) => name).sort(), ['drafts', 'relationships']);
  assert.match(page, /getRealtorWorkspace\(supabase, user\.id\)/);
  assert.match(page, /People I’m Helping/);
  assert.match(page, /Start a client search/);
  assert.doesNotMatch(page, /getRealtorSearchContext|resolveActiveSearch|notFound/);
  const realtorLayout = layout.match(/if \(isRealtorWorkspace\) \{[\s\S]*?^    \}/m)?.[0] || '';
  assert.doesNotMatch(realtorLayout, /resolveActiveSearch|resolvePriorities|getSearchParticipantIds/);
});

test('root workspace preserves a Realtor-owned draft and an authorized client', async () => {
  const draft = { id: 'draft-a', client_name: 'Jamie', status: 'draft' };
  const client = { id: 'search-a', people: [{ display_name: 'Morgan' }] };
  assert.deepEqual((await executeWorkspace({ drafts: [draft] })).result.prospective, [draft]);
  assert.deepEqual((await executeWorkspace({ relationships: [client] })).result.relationships, [client]);
  assert.match(page, /prospective\.map/);
  assert.match(page, /relationships\.map/);
});

test('root loader is distinct from fail-closed client detail loading', () => {
  assert.match(collaboration, /if \(!membership\) return null/);
  assert.match(detail, /getRealtorSearchContext/);
  assert.match(detail, /if \(!context\) notFound\(\)/);
  assert.doesNotMatch(page, /getRealtorSearchContext/);
  assert.match(detailError, /We couldn’t load this client search/);
  assert.match(detailError, /Back to People I’m Helping/);
  assert.doesNotMatch(peopleError, /this client search/);
  assert.match(peopleError, /We couldn’t load People I’m Helping/);
});

test('draft ACL repair grants only the projected columns and retains owner RLS', () => {
  assert.match(migration, /revoke select on table public\.prospective_searches from authenticated/);
  for (const column of ['id', 'client_name', 'invited_email', 'status', 'draft_priorities', 'created_at', 'updated_at']) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
  assert.doesNotMatch(migration, /grant select \([^)]*started_by/);
  assert.doesNotMatch(migration, /disable row level security|using \(true\)|service_role/i);
  assert.match(collaboration, /select\('id,client_name,invited_email,status,draft_priorities,created_at,updated_at'\)/);
});

test('buyer and dual-role routing remain context-derived', () => {
  assert.match(layout, /workspace="realtor"/);
  assert.match(layout, /const \{ search \} = await resolveActiveSearch/);
  assert.match(layout, /activeSearchId=\{search\.id\}/);
  assert.match(shell, /workspace = 'buyer'/);
  assert.match(shell, /!isRealtorWorkspace && <nav className="hh-tabs"/);
  assert.match(shell, /!isRealtorWorkspace && <MobileNav/);
  assert.match(shell, /\(isRealtorWorkspace \|\| hasRealtorRelationships\).*People I’m Helping/);
});
