const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadPeopleWorkspace } = require('../src/lib/supabase/peopleWorkspace.cjs');

const page = fs.readFileSync('src/app/(app)/people/page.js', 'utf8');
const layout = fs.readFileSync('src/app/(app)/layout.js', 'utf8');
const detailPage = fs.readFileSync('src/app/(app)/people/[searchId]/page.js', 'utf8');
const collaboration = fs.readFileSync('src/lib/supabase/collaboration.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/2026-09-18-people-workspace-draft-select-privileges.sql', 'utf8');

function routeLoad({ clients = [], drafts = [], clientsThrows = null, draftsThrows = null } = {}) {
  const calls = [];
  const loaders = {
    getRealtorRelationships: async (_supabase, userId) => {
      calls.push(['roster', userId]);
      if (clientsThrows) throw clientsThrows;
      return clients;
    },
    getProspectiveSearches: async () => {
      calls.push(['drafts']);
      if (draftsThrows) throw draftsThrows;
      return drafts;
    },
  };
  return loadPeopleWorkspace({ request: '/people' }, 'realtor-1', loaders)
    .then((result) => ({ result, calls }));
}

test('actual /people request loader accepts a first-run Realtor zero state', async () => {
  const { result, calls } = await routeLoad();
  assert.deepEqual(result, { clients: [], clientsError: false, drafts: [], draftsError: false });
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
  assert.deepEqual(result, { clients: [], clientsError: false, drafts: [draft], draftsError: false });
});

test('actual /people request loader returns an authorized client', async () => {
  const client = { id: 'search-1', people: [{ display_name: 'Casey' }], activeCount: 0, wantToTourCount: 0 };
  const { result } = await routeLoad({ clients: [client] });
  assert.deepEqual(result, { clients: [client], clientsError: false, drafts: [], draftsError: false });
});

test('a client-roster query failure is isolated: drafts still load, and the failure is distinguishable from a legitimate empty roster', async () => {
  const draft = { id: 'draft-1', client_name: 'Casey', status: 'draft' };
  const { result, calls } = await routeLoad({ drafts: [draft], clientsThrows: new Error('roster boom') });
  assert.deepEqual(result, { clients: [], clientsError: true, drafts: [draft], draftsError: false });
  assert.deepEqual(calls, [['roster', 'realtor-1'], ['drafts']]);
  assert.match(page, /clientsError \? \(/);
  assert.match(page, /We couldn&apos;t load your clients/);
});

test('a drafts query failure is isolated: the client roster still loads', async () => {
  const client = { id: 'search-1', people: [{ display_name: 'Casey' }], activeCount: 0, wantToTourCount: 0 };
  const { result } = await routeLoad({ clients: [client], draftsThrows: new Error('drafts boom') });
  assert.deepEqual(result, { clients: [client], clientsError: false, drafts: [], draftsError: true });
  assert.match(page, /draftsError && <section className="hh-realtor-empty" role="alert">/);
  assert.match(page, /Couldn&apos;t load searches waiting for a buyer/);
});

test('a client-roster failure never falls back to the "Your workspace is ready" empty state — a real error is never presented as a legitimate zero state', async () => {
  const { result } = await routeLoad({ clientsThrows: new Error('roster boom') });
  assert.equal(result.clientsError, true);
  const clientsBranch = page.match(/clientsError \? \([\s\S]*?\) : relationships\.length \?/)?.[0] || '';
  assert.ok(clientsBranch, 'expected an explicit clientsError branch before the relationships.length check');
  assert.doesNotMatch(clientsBranch, /Your workspace is ready/);
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
