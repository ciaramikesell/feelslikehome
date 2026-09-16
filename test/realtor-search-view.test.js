const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const data = fs.readFileSync('src/lib/supabase/collaboration.js', 'utf8');
const workspace = fs.readFileSync('src/components/RealtorWorkspace.jsx', 'utf8');
const shell = fs.readFileSync('src/components/AppShell.jsx', 'utf8');
const detail = fs.readFileSync('src/components/HomeDetail.jsx', 'utf8');
const listPage = fs.readFileSync('src/app/(app)/people/page.js', 'utf8');
const contextPage = fs.readFileSync('src/app/(app)/people/[searchId]/page.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/2026-09-16-realtor-search-view.sql', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('People I’m Helping is relationship-scoped, batched, and coexists with My Criteria', () => {
  assert.match(data, /eq\('user_id', userId\)\.eq\('role', 'realtor'\)/);
  assert.match(data, /\.in\('search_id', ids\)/);
  assert.doesNotMatch(data, /service.role|service_role/i);
  assert.match(shell, /People I’m Helping/);
  assert.match(shell, /My Criteria/);
  assert.match(listPage, /activeCount/);
  assert.match(listPage, /wantToTourCount/);
});

test('one or many authorized clients render while empty relationships are intentional', () => {
  assert.match(listPage, /relationships\.map/);
  assert.match(listPage, /No buyer searches yet/);
  assert.match(listPage, /invite someone to start searching with your help/);
});

test('URL access fails closed before any client context is returned', () => {
  assert.match(data, /eq\('search_id', searchId\).*eq\('user_id', userId\).*eq\('role', 'realtor'\)/s);
  assert.match(data, /if \(!membership\) return null/);
  assert.match(contextPage, /if \(!context\) notFound\(\)/);
  assert.match(migration, /is_search_realtor\(participants\.search_id, auth\.uid\(\)\)/);
  assert.match(migration, /revoke execute.*anon, service_role/);
});

test('priorities preserve tiers and participant attribution rather than consensus', () => {
  assert.match(workspace, /\['must', 'important', 'nice'\]/);
  assert.match(workspace, /context\.people\.map\(\(person\)/);
  assert.match(workspace, /person\.display_name/);
  assert.doesNotMatch(workspace, /average|combined score|consensus/i);
});

test('active, Want to Tour, Favorite, reaction, rating and archived signals are visible', () => {
  for (const signal of ['Want to Tour', 'Favorite', 'reaction', 'TOUR_RATING_KEY', 'Archived', '% Match']) assert.ok(workspace.includes(signal), signal);
  assert.match(workspace, /states\.every\(\(state\) => state\.status === 'Archived'\)/);
  assert.match(workspace, /tour\.length > 0/);
});

test('Realtor detail is read-only below controls and Compare has no Realtor Match', () => {
  assert.match(detail, /!readOnly && <div className="hh-detail-actions">/);
  assert.match(detail, /!readOnly && editing && <HomeModal/);
  assert.match(detail, /!readOnly && archiveTarget/);
  assert.match(detail, /!readOnly && reflecting/);
  assert.match(workspace, /Compare contenders/);
  assert.doesNotMatch(workspace, /Realtor Match/);
});

test('loading, error, no-home, no-WTT, no-archive and mobile states are explicit', () => {
  assert.ok(fs.existsSync('src/app/(app)/people/loading.js'));
  assert.ok(fs.existsSync('src/app/(app)/people/error.js'));
  assert.match(workspace, /No homes have been added yet/);
  assert.match(workspace, /tour\.length > 0/);
  assert.match(workspace, /archived\.length > 0/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
