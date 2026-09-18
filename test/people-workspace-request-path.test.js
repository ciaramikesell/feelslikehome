const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadPeopleWorkspace } = require('../src/lib/supabase/peopleWorkspace.cjs');

const page = fs.readFileSync('src/app/(app)/people/page.js', 'utf8');
const layout = fs.readFileSync('src/app/(app)/layout.js', 'utf8');
const detailPage = fs.readFileSync('src/app/(app)/people/[searchId]/page.js', 'utf8');
const collaboration = fs.readFileSync('src/lib/supabase/collaboration.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/2026-09-18-people-workspace-draft-select-privileges.sql', 'utf8');

function routeLoad({ clients = [], drafts = [] } = {}) {
  const calls = [];
  const loaders = {
    getRealtorRelationships: async (_supabase, userId) => {
      calls.push(['roster', userId]);
      return clients;
    },
    getProspectiveSearches: async () => {
      calls.push(['drafts']);
      return drafts;
    },
  };
  return loadPeopleWorkspace({ request: '/people' }, 'realtor-1', loaders)
    .then((result) => ({ result, calls }));
}

test('actual /people request loader accepts a first-run Realtor zero state', async () => {
  const { result, calls } = await routeLoad();
  assert.deepEqual(result, { clients: [], drafts: [] });
  assert.deepEqual(calls, [['roster', 'realtor-1'], ['drafts']]);
  assert.match(page, /loadPeopleWorkspace\(supabase, user\.id/);
  assert.match(page, /Your workspace is ready/);
  assert.match(page, /Start a client search/);
  assert.doesNotMatch(page, /resolveActiveSearch|getRealtorSearchContext/);
  assert.doesNotMatch(layout.match(/if \(isRealtorWorkspace\) \{[\s\S]*?\n    \}/)[0], /resolveActiveSearch|getAccessibleSearches/);
});

test('actual /people request loader returns a Realtor-owned draft', async () => {
  const draft = { id: 'draft-1', client_name: 'Casey', status: 'draft' };
  const { result } = await routeLoad({ drafts: [draft] });
  assert.deepEqual(result, { clients: [], drafts: [draft] });
});

test('actual /people request loader returns an authorized client', async () => {
  const client = { id: 'search-1', people: [{ display_name: 'Casey' }], activeCount: 0, wantToTourCount: 0 };
  const { result } = await routeLoad({ clients: [client] });
  assert.deepEqual(result, { clients: [client], drafts: [] });
});

test('specific client routes still fail closed for absent or revoked membership', () => {
  assert.match(collaboration, /eq\('search_id', searchId\)\.eq\('user_id', userId\)\.eq\('role', 'realtor'\)\.maybeSingle\(\)/);
  assert.match(collaboration, /if \(!membership\) return null/);
  assert.match(detailPage, /if \(!context\) notFound\(\)/);
});

test('buyer and dual-role route contexts remain separated', () => {
  const realtorBranch = layout.match(/if \(isRealtorWorkspace\) \{[\s\S]*?\n    \}/)[0];
  const buyerBranch = layout.slice(layout.indexOf("const { search } = await resolveActiveSearch"));
  assert.match(realtorBranch, /workspace="realtor"/);
  assert.doesNotMatch(realtorBranch, /resolveActiveSearch/);
  assert.match(buyerBranch, /resolveActiveSearch\(supabase, user\.id\)/);
  assert.match(buyerBranch, /resolvePriorities/);
});

test('draft ACL permits only the workspace projection and keeps owner RLS', () => {
  assert.match(migration, /revoke select on table public\.prospective_searches from authenticated/);
  assert.match(migration, /grant select \(\s*id, client_name, invited_email, status, draft_priorities, created_at, updated_at\s*\)/);
  assert.match(migration, /for select to authenticated using \(started_by = auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /grant (all|select) on table public\.prospective_searches to authenticated/);
});
